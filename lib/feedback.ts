/**
 * Correspondent Feedback Loop
 *
 * Analyzes user edits to drafts and extracts style preferences.
 * Feeds learned refinements back into future draft generation.
 *
 * The cycle:
 * 1. User edits a draft → recordFeedback() captures the diff
 * 2. Claude analyzes what changed → extractEditPatterns()
 * 3. Patterns become style refinements → updateStyleRefinements()
 * 4. Next draft generation includes refinements → getRefinementsForDraft()
 */

import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from './supabase';
import type { CorrespondentDraft, Person } from '@/types';

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _anthropic;
}

// ============================================================
// Types
// ============================================================

interface EditAnalysis {
  edit_types: string[];
  learned_preferences: string[];
  analysis: string;
}

interface StyleRefinement {
  id: string;
  user_id: string;
  circle?: string;
  person_id?: string;
  refinement: string;
  source: string;
  confidence: number;
  times_confirmed: number;
  times_contradicted: number;
  active: boolean;
}

interface FeedbackMetrics {
  total_drafts: number;
  total_sent: number;
  edit_rate: number;
  avg_edit_ratio: number;
  by_circle: Record<string, { sent: number; edited: number; edit_rate: number }>;
  top_refinements: StyleRefinement[];
}

// ============================================================
// 1. Record Feedback
// ============================================================

/** Record feedback when a user takes action on a draft */
export async function recordFeedback(
  userId: string,
  draft: CorrespondentDraft,
  action: 'sent' | 'sent_edited' | 'skipped' | 'deferred',
  person?: Person | null
): Promise<void> {
  const wasEdited = action === 'sent_edited' && !!draft.edited_body;
  const originalBody = draft.body;
  const finalBody = draft.edited_body || draft.body;

  // Calculate edit distance
  const editDistance = calculateEditDistance(originalBody, finalBody);
  const editRatio = originalBody.length > 0
    ? editDistance / Math.max(originalBody.length, finalBody.length)
    : 0;

  // Analyze the edit with Claude if there were changes
  let editAnalysis: EditAnalysis | null = null;
  if (wasEdited && editRatio > 0.05) {
    editAnalysis = await analyzeEdit(originalBody, finalBody, person);
  }

  // Store feedback record
  await supabaseAdmin.from('draft_feedback').insert({
    user_id: userId,
    draft_id: draft.id,
    person_id: draft.person_id || null,
    circle: person?.circle || null,
    draft_tier: draft.draft_tier,
    was_edited: wasEdited,
    original_body: originalBody,
    final_body: finalBody,
    edit_distance: editDistance,
    edit_ratio: editRatio,
    edit_types: editAnalysis?.edit_types || [],
    action_taken: action,
    edit_analysis: editAnalysis?.analysis || null,
    learned_preferences: editAnalysis?.learned_preferences || [],
  });

  // Update style refinements if we learned something
  if (editAnalysis?.learned_preferences && editAnalysis.learned_preferences.length > 0) {
    await updateStyleRefinements(
      userId,
      person?.circle || null,
      draft.person_id || null,
      editAnalysis.learned_preferences
    );
  }

  // Update voice sample effectiveness
  if (action === 'sent' || action === 'sent_edited') {
    await updateVoiceSampleSource(userId, draft, wasEdited);
  }

  // If draft was sent unedited, confirm existing refinements
  if (action === 'sent' && !wasEdited) {
    await confirmRefinements(userId, person?.circle || null, draft.person_id || null);
  }
}

// ============================================================
// 2. Edit Analysis
// ============================================================

/** Use Claude to analyze what the user changed and why */
async function analyzeEdit(
  original: string,
  edited: string,
  person?: Person | null
): Promise<EditAnalysis> {
  const prompt = `You are analyzing how a user edited an AI-generated email draft. Your job is to extract specific style preferences that should inform future drafts.

ORIGINAL DRAFT:
${original}

USER'S EDITED VERSION:
${edited}

${person ? `CONTEXT: This message is to ${person.name} (${person.circle} circle, ${person.relationship}).` : ''}

Analyze the changes and respond with ONLY a JSON object:
{
  "edit_types": ["<categories of changes made>"],
  "learned_preferences": ["<specific, actionable style rules extracted from the edit>"],
  "analysis": "<one-sentence summary of what the user changed and why>"
}

For edit_types, use these categories:
- tone_softened: made the message warmer, more personal
- tone_firmed: made it more direct or formal
- shortened: removed words, made it more concise
- lengthened: added detail or context
- added_context: included information the AI didn't know
- removed_fluff: cut AI-sounding filler phrases
- corrected_fact: fixed factual errors
- restructured: reorganized the message
- changed_greeting: modified the opening
- changed_signoff: modified the closing
- added_personal_touch: added something only the user would say

For learned_preferences, extract SPECIFIC rules like:
- "Use first name only, never 'Dear [Name]' for family"
- "Keep replies under 3 sentences for quick_reply tier"
- "Don't use exclamation marks with professional contacts"
- "Always ask about [specific topic] when writing to this person"
- "Start emails with a direct response, not a pleasantry"

Be specific and actionable. Generic advice like "be more natural" is not useful.`;

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());

    return {
      edit_types: parsed.edit_types || [],
      learned_preferences: parsed.learned_preferences || [],
      analysis: parsed.analysis || 'Edit analysis failed',
    };
  } catch {
    return {
      edit_types: ['unknown'],
      learned_preferences: [],
      analysis: 'Failed to analyze edit',
    };
  }
}

// ============================================================
// 3. Style Refinements
// ============================================================

/** Update or create style refinements from learned preferences */
async function updateStyleRefinements(
  userId: string,
  circle: string | null,
  personId: string | null,
  preferences: string[]
): Promise<void> {
  for (const preference of preferences) {
    // Check if a similar refinement already exists
    const existing = await findSimilarRefinement(userId, circle, personId, preference);

    if (existing) {
      // Confirm the existing refinement
      await supabaseAdmin
        .from('style_refinements')
        .update({
          times_confirmed: existing.times_confirmed + 1,
          confidence: Math.min(1.0, existing.confidence + 0.1),
        })
        .eq('id', existing.id);
    } else {
      // Create new refinement
      await supabaseAdmin.from('style_refinements').insert({
        user_id: userId,
        circle,
        person_id: personId,
        refinement: preference,
        source: 'edit_analysis',
        confidence: 0.3,
        times_confirmed: 1,
        times_contradicted: 0,
        active: true,
      });
    }
  }
}

/** Find an existing refinement that matches a new one (semantic similarity via simple matching) */
async function findSimilarRefinement(
  userId: string,
  circle: string | null,
  personId: string | null,
  preference: string
): Promise<StyleRefinement | null> {
  // Get existing refinements for this scope
  let query = supabaseAdmin
    .from('style_refinements')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true);

  if (personId) {
    query = query.eq('person_id', personId);
  } else if (circle) {
    query = query.eq('circle', circle);
  }

  const { data: existing } = await query;
  if (!existing || existing.length === 0) return null;

  // Simple keyword overlap check — find the most similar existing refinement
  const prefWords = new Set(preference.toLowerCase().split(/\s+/));
  let bestMatch: StyleRefinement | null = null;
  let bestScore = 0;

  for (const ref of existing) {
    const refWords = new Set(ref.refinement.toLowerCase().split(/\s+/));
    const overlap = [...prefWords].filter(w => refWords.has(w)).length;
    const score = overlap / Math.max(prefWords.size, refWords.size);

    if (score > 0.5 && score > bestScore) {
      bestScore = score;
      bestMatch = ref;
    }
  }

  return bestMatch;
}

/** Confirm existing refinements when a draft is sent without edits */
async function confirmRefinements(
  userId: string,
  circle: string | null,
  personId: string | null
): Promise<void> {
  // Boost confidence of refinements that were used in a successful (unedited) draft
  let query = supabaseAdmin
    .from('style_refinements')
    .select('id, confidence, times_confirmed')
    .eq('user_id', userId)
    .eq('active', true);

  if (personId) {
    query = query.or(`person_id.eq.${personId},and(circle.eq.${circle},person_id.is.null)`);
  } else if (circle) {
    query = query.or(`circle.eq.${circle},circle.is.null`);
  }

  const { data: refinements } = await query;
  if (!refinements) return;

  for (const ref of refinements) {
    await supabaseAdmin
      .from('style_refinements')
      .update({
        times_confirmed: ref.times_confirmed + 1,
        confidence: Math.min(1.0, ref.confidence + 0.05),
      })
      .eq('id', ref.id);
  }
}

// ============================================================
// 4. Get Refinements for Draft Generation
// ============================================================

/** Get active style refinements to include in draft generation prompts */
export async function getRefinementsForDraft(
  userId: string,
  circle: string | null,
  personId: string | null
): Promise<string[]> {
  // Get refinements in order of specificity: person > circle > global
  const refinements: string[] = [];

  // Global refinements (high confidence only)
  const { data: global } = await supabaseAdmin
    .from('style_refinements')
    .select('refinement, confidence')
    .eq('user_id', userId)
    .eq('active', true)
    .is('circle', null)
    .is('person_id', null)
    .gte('confidence', 0.5)
    .order('confidence', { ascending: false })
    .limit(5);

  if (global) refinements.push(...global.map(r => r.refinement));

  // Circle refinements
  if (circle) {
    const { data: circleRefs } = await supabaseAdmin
      .from('style_refinements')
      .select('refinement, confidence')
      .eq('user_id', userId)
      .eq('active', true)
      .eq('circle', circle)
      .is('person_id', null)
      .gte('confidence', 0.3)
      .order('confidence', { ascending: false })
      .limit(5);

    if (circleRefs) refinements.push(...circleRefs.map(r => r.refinement));
  }

  // Person-specific refinements (lower threshold — even new ones matter)
  if (personId) {
    const { data: personRefs } = await supabaseAdmin
      .from('style_refinements')
      .select('refinement, confidence')
      .eq('user_id', userId)
      .eq('active', true)
      .eq('person_id', personId)
      .order('confidence', { ascending: false })
      .limit(5);

    if (personRefs) refinements.push(...personRefs.map(r => r.refinement));
  }

  return refinements;
}

// ============================================================
// 5. Voice Sample Tracking
// ============================================================

/** Update voice sample metadata based on feedback */
async function updateVoiceSampleSource(
  userId: string,
  draft: CorrespondentDraft,
  wasEdited: boolean
): Promise<void> {
  // The voice sample was already inserted in approveDraft.
  // Find the most recent one for this draft and update its source.
  const { data: recent } = await supabaseAdmin
    .from('voice_samples')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (recent) {
    await supabaseAdmin
      .from('voice_samples')
      .update({
        source: wasEdited ? 'ai_edited' : 'ai_unedited',
        // Unedited AI drafts that get sent are high quality samples
        effectiveness_score: wasEdited ? 0.4 : 0.8,
      })
      .eq('id', recent.id);
  }
}

// ============================================================
// 6. Metrics
// ============================================================

/** Get feedback metrics for the Correspondent dashboard */
export async function getFeedbackMetrics(userId: string): Promise<FeedbackMetrics> {
  // Total feedback records
  const { data: allFeedback } = await supabaseAdmin
    .from('draft_feedback')
    .select('action_taken, was_edited, edit_ratio, circle')
    .eq('user_id', userId);

  const feedback = allFeedback || [];

  const totalDrafts = feedback.length;
  const sent = feedback.filter(f => f.action_taken === 'sent' || f.action_taken === 'sent_edited');
  const edited = feedback.filter(f => f.was_edited);

  // By circle
  const byCircle: Record<string, { sent: number; edited: number; edit_rate: number }> = {};
  for (const f of feedback) {
    const c = f.circle || 'unknown';
    if (!byCircle[c]) byCircle[c] = { sent: 0, edited: 0, edit_rate: 0 };
    if (f.action_taken === 'sent' || f.action_taken === 'sent_edited') {
      byCircle[c].sent++;
      if (f.was_edited) byCircle[c].edited++;
    }
  }
  for (const c of Object.keys(byCircle)) {
    byCircle[c].edit_rate = byCircle[c].sent > 0
      ? byCircle[c].edited / byCircle[c].sent
      : 0;
  }

  // Top refinements
  const { data: refinements } = await supabaseAdmin
    .from('style_refinements')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('confidence', { ascending: false })
    .limit(10);

  return {
    total_drafts: totalDrafts,
    total_sent: sent.length,
    edit_rate: sent.length > 0 ? edited.length / sent.length : 0,
    avg_edit_ratio: edited.length > 0
      ? edited.reduce((sum, f) => sum + (f.edit_ratio || 0), 0) / edited.length
      : 0,
    by_circle: byCircle,
    top_refinements: (refinements || []) as StyleRefinement[],
  };
}

// ============================================================
// Helpers
// ============================================================

/** Simple edit distance calculation (character-level) */
function calculateEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // For long texts, use a word-level approximation instead of full Levenshtein
  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);

  const aSet = new Set(aWords);
  const bSet = new Set(bWords);

  let added = 0;
  let removed = 0;

  for (const w of bWords) {
    if (!aSet.has(w)) added++;
  }
  for (const w of aWords) {
    if (!bSet.has(w)) removed++;
  }

  return added + removed;
}
