/**
 * Envoy Agent — Core Pipeline
 *
 * The outward-facing relationship agent. Manages four outreach pipelines:
 * 1. Design Partners — potential users/collaborators for Colleagues
 * 2. Builders & Kindred Spirits — peers building adjacent things
 * 3. Artists & Creative Community — enriching life beyond work
 * 4. People You Can Help — generosity-first connections
 *
 * Plus: Coffee Chat Engine, Newsletter Growth, and Dispatch integration.
 *
 * The Five Mandates:
 * - Every outreach references something real and specific
 * - Lead with generosity
 * - Match the channel to the relationship
 * - Respect the natural pace of relationship
 * - When in doubt, don't send
 */

import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from './supabase';
import { buildRelationshipContext, logInteraction } from './people';
import type {
  EnvoyCandidate,
  EnvoyOutreach,
  EnvoyCoffeeChat,
  EnvoyConfig,
  EnvoyRun,
  EnvoyPipeline,
  EnvoyOutreachQueueItem,
  EnvoyOutreachQueueResponse,
  EnvoyCoffeeChatSuggestion,
  EnvoyWeeklyReport,
  EnvoyNewsletterMetrics,
  Person,
  RunStatus,
} from '@/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG: Omit<EnvoyConfig, 'user_id' | 'created_at' | 'updated_at'> = {
  design_partner_weekly_target: 3,
  builder_weekly_target: 2,
  creative_weekly_target: 1,
  generous_weekly_target: 2,
  weekly_coffee_chat_target: 2,
  daily_invite_target: 1,
  monthly_cross_promo_target: 3,
  follow_up_days: 7,
  max_follow_ups: 2,
};

async function getConfig(userId: string): Promise<EnvoyConfig> {
  const { data } = await supabaseAdmin
    .from('envoy_config')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (data) return data as EnvoyConfig;

  // Create default config
  const { data: created } = await supabaseAdmin
    .from('envoy_config')
    .insert({ user_id: userId, ...DEFAULT_CONFIG })
    .select()
    .single();

  return (created || { user_id: userId, ...DEFAULT_CONFIG }) as EnvoyConfig;
}

// ============================================================
// Pipeline: Candidate Research & Outreach Drafting
// ============================================================

/**
 * Draft outreach for approved candidates that don't yet have a draft.
 * Called during the weekly pipeline run.
 */
async function draftOutreach(userId: string): Promise<number> {
  let drafted = 0;

  // Get candidates that are approved but have no pending outreach
  const { data: candidates } = await supabaseAdmin
    .from('envoy_candidates')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .eq('excluded', false)
    .order('priority', { ascending: false });

  if (!candidates || candidates.length === 0) return 0;

  // Check which candidates already have pending outreach
  const candidateIds = candidates.map(c => c.id);
  const { data: existingOutreach } = await supabaseAdmin
    .from('envoy_outreach')
    .select('candidate_id')
    .eq('user_id', userId)
    .in('status', ['suggested', 'approved'])
    .in('candidate_id', candidateIds);

  const hasOutreach = new Set((existingOutreach || []).map(o => o.candidate_id));
  const needsDraft = candidates.filter(c => !hasOutreach.has(c.id));

  for (const candidate of needsDraft) {
    // Get person context if linked
    let person: Person | null = null;
    let relationshipContext = '';
    if (candidate.person_id) {
      const { data: personData } = await supabaseAdmin
        .from('people')
        .select('*')
        .eq('id', candidate.person_id)
        .single();
      person = personData as Person | null;
      if (person) {
        relationshipContext = await buildRelationshipContext(person);
      }
    }

    // Build candidate context for Claude
    const candidateContext = buildCandidateContext(candidate);

    // Determine best channel
    const channel = determineChannel(candidate, person);

    // Generate draft
    const result = await generateOutreachDraft(candidate, person, candidateContext, relationshipContext, channel);

    if (result) {
      const { error } = await supabaseAdmin.from('envoy_outreach').insert({
        user_id: userId,
        candidate_id: candidate.id,
        person_id: candidate.person_id,
        channel,
        subject: result.subject,
        body: result.body,
        pipeline: candidate.pipeline,
        candidate_context: candidateContext,
        relationship_context: relationshipContext || null,
        voice_notes: result.voice_notes,
        status: 'suggested',
      });

      if (!error) drafted++;
    }
  }

  // Assign queue positions
  await assignOutreachQueuePositions(userId);

  return drafted;
}

function buildCandidateContext(candidate: EnvoyCandidate): string {
  let ctx = `Name: ${candidate.name}`;
  if (candidate.role) ctx += `\nRole: ${candidate.role}`;
  if (candidate.organization) ctx += `\nOrganization: ${candidate.organization}`;
  if (candidate.location) ctx += `\nLocation: ${candidate.location}`;
  ctx += `\nPipeline: ${candidate.pipeline}`;
  ctx += `\nSource: ${candidate.source_pool}`;
  if (candidate.source_detail) ctx += ` (${candidate.source_detail})`;
  if (candidate.their_work) ctx += `\nTheir work: ${candidate.their_work}`;
  if (candidate.shared_interests && candidate.shared_interests.length > 0) {
    ctx += `\nShared interests: ${candidate.shared_interests.join(', ')}`;
  }
  if (candidate.mutual_connections && candidate.mutual_connections.length > 0) {
    ctx += `\nMutual connections: ${candidate.mutual_connections.join(', ')}`;
  }
  if (candidate.warm_path) ctx += `\nWarm path: ${candidate.warm_path}`;
  if (candidate.why_reach_out) ctx += `\nWhy reach out: ${candidate.why_reach_out}`;
  if (candidate.what_you_can_offer) ctx += `\nWhat you can offer: ${candidate.what_you_can_offer}`;
  if (candidate.outreach_count > 0) {
    ctx += `\nPrevious outreach: ${candidate.outreach_count} time(s)`;
    if (candidate.last_outreach_at) {
      const days = Math.floor(
        (Date.now() - new Date(candidate.last_outreach_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      ctx += ` (last: ${days} days ago)`;
    }
  }

  return ctx;
}

function determineChannel(candidate: EnvoyCandidate, person: Person | null): EnvoyOutreach['channel'] {
  // If warm intro is available, suggest that route
  if (candidate.warm_intro_through || candidate.warm_path) {
    return 'intro_request';
  }

  // If we know them and have email, use email
  if (person && person.email && person.email.length > 0) {
    return 'email';
  }
  if (candidate.email) {
    return 'email';
  }

  // Creative/local pipeline — in-person follow-up is often best
  if (candidate.pipeline === 'creative' && candidate.source_pool === 'gorge_community') {
    return 'in_person_followup';
  }

  // Default to email
  return 'email';
}

interface OutreachDraftResult {
  body: string;
  subject?: string;
  voice_notes: string;
}

async function generateOutreachDraft(
  candidate: EnvoyCandidate,
  person: Person | null,
  candidateContext: string,
  relationshipContext: string,
  channel: EnvoyOutreach['channel']
): Promise<OutreachDraftResult | null> {
  const systemPrompt = buildOutreachSystemPrompt(candidate.pipeline, channel);
  const userPrompt = buildOutreachUserPrompt(candidate, candidateContext, relationshipContext, channel);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());

    return {
      body: parsed.body || text,
      subject: parsed.subject || undefined,
      voice_notes: parsed.voice_notes || '',
    };
  } catch {
    return null;
  }
}

function buildOutreachSystemPrompt(pipeline: EnvoyPipeline, channel: EnvoyOutreach['channel']): string {
  let prompt = `You are the Envoy, a relationship cultivation agent. You draft outreach messages that are genuinely personal, deeply contextualized, and grounded in real shared interest.

THE FIVE MANDATES:
1. Every outreach must reference something real and specific — a piece of their work, a shared experience, a genuine overlap. Never generic.
2. Lead with generosity. What can you offer, share, or invite them into? Not what can you extract.
3. Match the tone to the channel and context.
4. Respect the natural pace of relationship. First touch is light.
5. When in doubt about authenticity, err on the side of brevity.

ANTI-PATTERNS (never do these):
- "Just wanted to connect" or "I'd love to pick your brain"
- LinkedIn-style networking language
- Pitching before showing genuine interest
- Fabricating connections that don't exist
- Over-explaining who you are
- Using corporate buzzwords

THE VOICE: You are writing as Lara — someone who lives on 50 acres in White Salmon, WA, builds AI agent infrastructure (Colleagues), writes a newsletter called Dispatches from White Salmon, and brings finishing-school warmth to everything. The tone is direct, warm, curious, and generous. Not salesy. Not performative.
`;

  switch (pipeline) {
    case 'design_partner':
      prompt += `\nPIPELINE: Design Partner outreach. Lead with shared experience or a specific problem you know they face. Reference Gandalf (your Airbnb security platform) or Colleagues naturally. You're looking for honest feedback, not pitching.`;
      break;
    case 'builder':
      prompt += `\nPIPELINE: Builders & Kindred Spirits. Lead with curiosity about their work. Reference a specific piece of what they've built or written. You're looking for intellectual companionship, not business.`;
      break;
    case 'creative':
      prompt += `\nPIPELINE: Creative Community. These are the most personal, least strategic. Keep it warm and real. Reference the specific thing you connected over — fermentation, conversation, craft.`;
      break;
    case 'generous':
      prompt += `\nPIPELINE: People You Can Help. This outreach offers something specific — advice, a connection, a resource. Not performative generosity, just genuinely useful.`;
      break;
  }

  switch (channel) {
    case 'email':
      prompt += `\nCHANNEL: Email. Can be a few paragraphs. Include a subject line.`;
      break;
    case 'intro_request':
      prompt += `\nCHANNEL: Warm introduction request. You're drafting a message to a mutual connection asking them to introduce you. Be specific about why and make it easy for the introducer.`;
      break;
    case 'dm':
      prompt += `\nCHANNEL: Direct message. Keep it short — 2-3 sentences max. Conversational.`;
      break;
    case 'in_person_followup':
      prompt += `\nCHANNEL: Follow-up after meeting in person. Reference the specific conversation or moment. Keep it warm and suggest a concrete next step.`;
      break;
    case 'handwritten':
      prompt += `\nCHANNEL: Handwritten note. Brief, personal, gracious. 3-5 sentences.`;
      break;
  }

  return prompt;
}

function buildOutreachUserPrompt(
  candidate: EnvoyCandidate,
  candidateContext: string,
  relationshipContext: string,
  channel: EnvoyOutreach['channel']
): string {
  let prompt = `Draft an outreach message to this person.

CANDIDATE:
${candidateContext}
`;

  if (relationshipContext) {
    prompt += `\nEXISTING RELATIONSHIP CONTEXT:\n${relationshipContext}\n`;
  }

  if (candidate.outreach_count > 0) {
    prompt += `\nNOTE: This is a follow-up (attempt ${candidate.outreach_count + 1}). Reference the previous outreach naturally — don't repeat the same message. Keep it lighter and shorter.\n`;
  }

  prompt += `\nRespond with ONLY a JSON object:
{
  "body": "<the outreach message>",
  ${channel === 'email' ? '"subject": "<email subject line>",' : ''}
  "voice_notes": "<brief note about why you made the tone/content choices you did>"
}`;

  return prompt;
}

async function assignOutreachQueuePositions(userId: string): Promise<void> {
  const { data: pending } = await supabaseAdmin
    .from('envoy_outreach')
    .select('id, pipeline')
    .eq('user_id', userId)
    .eq('status', 'suggested')
    .order('created_at', { ascending: true });

  if (!pending) return;

  // Interleave pipelines so the queue isn't all one type
  const byPipeline: Record<string, typeof pending> = {};
  for (const item of pending) {
    const p = item.pipeline;
    if (!byPipeline[p]) byPipeline[p] = [];
    byPipeline[p].push(item);
  }

  const ordered: typeof pending = [];
  const pipelines = Object.keys(byPipeline);
  let idx = 0;
  while (ordered.length < pending.length) {
    const pipeline = pipelines[idx % pipelines.length];
    const items = byPipeline[pipeline];
    if (items && items.length > 0) {
      ordered.push(items.shift()!);
    }
    idx++;
  }

  for (let i = 0; i < ordered.length; i++) {
    await supabaseAdmin
      .from('envoy_outreach')
      .update({ queue_position: i + 1 })
      .eq('id', ordered[i].id);
  }
}

// ============================================================
// Coffee Chat Engine
// ============================================================

/**
 * Generate coffee chat suggestions for the coming week.
 * Called during the Sunday Edgelands review pipeline.
 */
async function suggestCoffeeChats(userId: string): Promise<number> {
  const config = await getConfig(userId);
  const target = config.weekly_coffee_chat_target;

  // Get the coming week's Monday
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? 1 : 8); // next Monday
  const nextMonday = new Date(now);
  nextMonday.setDate(diff);
  nextMonday.setHours(0, 0, 0, 0);
  const weekStart = nextMonday.toISOString().split('T')[0];

  // Check existing suggestions for next week
  const { data: existing } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .select('id')
    .eq('user_id', userId)
    .eq('suggested_for_week', weekStart)
    .in('status', ['suggested', 'outreach_pending', 'scheduled']);

  const existingCount = existing?.length || 0;
  if (existingCount >= target + 3) return 0; // already have enough suggestions

  const suggestionsNeeded = (target + 3) - existingCount; // suggest a few extra for choice
  let suggested = 0;

  // Pull from candidates across all pipelines
  const { data: candidates } = await supabaseAdmin
    .from('envoy_candidates')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['approved', 'sent', 'responded'])
    .eq('excluded', false)
    .order('priority', { ascending: false })
    .limit(suggestionsNeeded * 2); // fetch extras for filtering

  if (!candidates || candidates.length === 0) return 0;

  // Also get people from the database who might be good coffee chat candidates
  const { data: people } = await supabaseAdmin
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .in('circle', ['professional', 'community', 'friend'])
    .order('closeness', { ascending: true })
    .limit(10);

  // Check which candidates/people already had recent coffee chats
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: recentChats } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .select('candidate_id, person_id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('completed_at', thirtyDaysAgo.toISOString());

  const recentCandidateIds = new Set((recentChats || []).map(c => c.candidate_id).filter(Boolean));
  const recentPersonIds = new Set((recentChats || []).map(c => c.person_id).filter(Boolean));

  // Generate suggestions from candidates
  for (const candidate of candidates) {
    if (suggested >= suggestionsNeeded) break;
    if (recentCandidateIds.has(candidate.id)) continue;
    if (candidate.person_id && recentPersonIds.has(candidate.person_id)) continue;

    const suggestion = await generateCoffeeChatSuggestion(candidate);

    const { error } = await supabaseAdmin.from('envoy_coffee_chats').insert({
      user_id: userId,
      candidate_id: candidate.id,
      person_id: candidate.person_id,
      participant_name: candidate.name,
      participant_role: candidate.role,
      participant_org: candidate.organization,
      pipeline: candidate.pipeline,
      why_now: suggestion.why_now,
      suggested_topics: suggestion.topics,
      your_ask: suggestion.your_ask,
      status: 'suggested',
      suggested_for_week: weekStart,
    });

    if (!error) suggested++;
  }

  return suggested;
}

interface CoffeeChatSuggestionResult {
  why_now: string;
  topics: string[];
  your_ask: string;
}

async function generateCoffeeChatSuggestion(
  candidate: EnvoyCandidate
): Promise<CoffeeChatSuggestionResult> {
  const prompt = `You are the Envoy agent suggesting a coffee chat for the coming week.

CANDIDATE:
${buildCandidateContext(candidate)}

Generate a coffee chat suggestion. Think about:
- Why is NOW a good time for this conversation?
- What 2-3 topics would make this conversation genuinely interesting for both people?
- What is the right "ask" level? (For first conversations: listen first. For deeper relationships: can be more specific.)

Respond with ONLY a JSON object:
{
  "why_now": "<1-2 sentences on why this week>",
  "topics": ["<topic 1>", "<topic 2>", "<topic 3>"],
  "your_ask": "<what you hope to get or give in this conversation>"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());

    return {
      why_now: parsed.why_now || 'Good timing for an initial conversation.',
      topics: parsed.topics || ['Their current work', 'Shared interests'],
      your_ask: parsed.your_ask || 'Listen first. No specific ask yet.',
    };
  } catch {
    return {
      why_now: 'Good timing for an initial conversation.',
      topics: ['Their current work', 'Shared interests'],
      your_ask: 'Listen first. No specific ask yet.',
    };
  }
}

/**
 * Generate a pre-chat brief for a scheduled coffee chat.
 */
export async function generateCoffeeChatBrief(
  userId: string,
  chatId: string
): Promise<string> {
  const { data: chat } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .select('*, envoy_candidates(*), people:person_id(*)')
    .eq('id', chatId)
    .eq('user_id', userId)
    .single();

  if (!chat) return 'Coffee chat not found.';

  const candidate = chat.envoy_candidates as EnvoyCandidate | null;
  const person = chat.people as Person | null;

  let brief = `**Coffee Chat Brief**\n\n`;
  brief += `**Who:** ${chat.participant_name}`;
  if (chat.participant_role) brief += ` — ${chat.participant_role}`;
  if (chat.participant_org) brief += `, ${chat.participant_org}`;
  brief += `\n`;
  brief += `**Pipeline:** ${formatPipeline(chat.pipeline)}`;
  if (candidate?.warm_path) brief += ` (${candidate.warm_path})`;
  brief += `\n`;

  // Relationship context
  if (person) {
    const ctx = await buildRelationshipContext(person);
    brief += `**Context:**\n${ctx}\n`;
  } else if (candidate) {
    brief += `**Context:** ${candidate.their_work || 'New connection.'}\n`;
    if (candidate.source_detail) brief += `Found via: ${candidate.source_detail}\n`;
  }

  // Last contact
  if (chat.last_contact_summary) {
    brief += `**Last contact:** ${chat.last_contact_summary}\n`;
  } else if (candidate?.last_outreach_at) {
    const days = Math.floor(
      (Date.now() - new Date(candidate.last_outreach_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    brief += `**Last contact:** Outreach sent ${days} days ago\n`;
  } else {
    brief += `**Last contact:** First conversation\n`;
  }

  // Topics
  if (chat.suggested_topics && chat.suggested_topics.length > 0) {
    brief += `**You might discuss:**\n`;
    for (const topic of chat.suggested_topics) {
      brief += `  - ${topic}\n`;
    }
  }

  // Ask
  if (chat.your_ask) {
    brief += `**Your ask:** ${chat.your_ask}\n`;
  }

  // Update the chat record with the generated brief
  await supabaseAdmin
    .from('envoy_coffee_chats')
    .update({ brief })
    .eq('id', chatId);

  return brief;
}

/**
 * Generate follow-up after a completed coffee chat.
 */
export async function generateCoffeeChatFollowUp(
  userId: string,
  chatId: string,
  notes?: string
): Promise<EnvoyOutreach | null> {
  const { data: chat } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .select('*, envoy_candidates(*)')
    .eq('id', chatId)
    .eq('user_id', userId)
    .single();

  if (!chat) return null;

  const candidate = chat.envoy_candidates as EnvoyCandidate | null;

  const prompt = `You are the Envoy drafting a follow-up message after a coffee chat.

PARTICIPANT: ${chat.participant_name}${chat.participant_role ? ` (${chat.participant_role})` : ''}
PIPELINE: ${chat.pipeline}
TOPICS DISCUSSED: ${(chat.suggested_topics || []).join(', ')}
${notes ? `USER'S NOTES FROM THE CHAT: ${notes}` : ''}
${chat.your_ask ? `ORIGINAL ASK: ${chat.your_ask}` : ''}

Write a brief, warm follow-up that:
1. References something specific from the conversation (use the topics/notes as a guide)
2. Includes any promised follow-up items (links, intros, resources)
3. Naturally mentions the Dispatches newsletter if it wasn't discussed
4. Keeps it short — 3-5 sentences

Respond with ONLY a JSON object:
{
  "body": "<the follow-up message>",
  "subject": "<email subject line>",
  "voice_notes": "<brief note about tone choices>"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());

    const { data: outreach } = await supabaseAdmin.from('envoy_outreach').insert({
      user_id: userId,
      candidate_id: candidate?.id || chat.candidate_id,
      person_id: chat.person_id,
      channel: 'email',
      subject: parsed.subject || `Great talking with you`,
      body: parsed.body || text,
      pipeline: chat.pipeline,
      voice_notes: parsed.voice_notes || '',
      status: 'suggested',
    }).select().single();

    // Mark chat as having follow-up drafted
    await supabaseAdmin
      .from('envoy_coffee_chats')
      .update({
        follow_up_drafted: true,
        follow_up_notes: notes || null,
      })
      .eq('id', chatId);

    return outreach as EnvoyOutreach | null;
  } catch {
    return null;
  }
}

// ============================================================
// Follow-Up Pipeline
// ============================================================

/**
 * Check for candidates that need follow-up and queue them.
 */
async function processFollowUps(userId: string): Promise<number> {
  const config = await getConfig(userId);
  const followUpDays = config.follow_up_days;
  const maxFollowUps = config.max_follow_ups;

  const followUpDate = new Date();
  followUpDate.setDate(followUpDate.getDate() - followUpDays);

  // Find candidates where:
  // - status is 'sent' (outreach sent but no response)
  // - last outreach was more than follow_up_days ago
  // - outreach_count < max_follow_ups
  const { data: needsFollowUp } = await supabaseAdmin
    .from('envoy_candidates')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'sent')
    .eq('excluded', false)
    .lt('outreach_count', maxFollowUps)
    .lt('last_outreach_at', followUpDate.toISOString());

  if (!needsFollowUp || needsFollowUp.length === 0) return 0;

  let queued = 0;

  for (const candidate of needsFollowUp) {
    // Check if there's already a pending follow-up
    const { data: existing } = await supabaseAdmin
      .from('envoy_outreach')
      .select('id')
      .eq('candidate_id', candidate.id)
      .in('status', ['suggested', 'approved'])
      .limit(1);

    if (existing && existing.length > 0) continue;

    // Set follow-up date and re-approve for drafting
    await supabaseAdmin
      .from('envoy_candidates')
      .update({
        status: 'approved',
        follow_up_after: null,
      })
      .eq('id', candidate.id);

    queued++;
  }

  // Also mark candidates that exceeded max follow-ups as 'not_now'
  const { data: maxedOut } = await supabaseAdmin
    .from('envoy_candidates')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'sent')
    .gte('outreach_count', maxFollowUps)
    .lt('last_outreach_at', followUpDate.toISOString());

  if (maxedOut) {
    for (const candidate of maxedOut) {
      await supabaseAdmin
        .from('envoy_candidates')
        .update({ status: 'not_now' })
        .eq('id', candidate.id);
    }
  }

  return queued;
}

// ============================================================
// Queue Operations
// ============================================================

/** Get the current outreach queue */
export async function getOutreachQueue(userId: string): Promise<EnvoyOutreachQueueResponse> {
  const { data: outreach } = await supabaseAdmin
    .from('envoy_outreach')
    .select('*, envoy_candidates!inner(*), people:person_id(*)')
    .eq('user_id', userId)
    .eq('status', 'suggested')
    .order('queue_position', { ascending: true });

  if (!outreach) return { items: [], total: 0, pending: 0, by_pipeline: { design_partner: 0, builder: 0, creative: 0, generous: 0 } };

  const items: EnvoyOutreachQueueItem[] = outreach.map(o => ({
    outreach: {
      id: o.id,
      user_id: o.user_id,
      candidate_id: o.candidate_id,
      person_id: o.person_id,
      channel: o.channel,
      subject: o.subject,
      body: o.body,
      pipeline: o.pipeline,
      candidate_context: o.candidate_context,
      relationship_context: o.relationship_context,
      voice_notes: o.voice_notes,
      status: o.status,
      queue_position: o.queue_position,
      edited_body: o.edited_body,
      sent_at: o.sent_at,
      response_received_at: o.response_received_at,
      created_at: o.created_at,
      updated_at: o.updated_at,
    } as EnvoyOutreach,
    candidate: o.envoy_candidates as unknown as EnvoyCandidate,
    person: o.people as Person | undefined,
  }));

  const byPipeline: Record<EnvoyPipeline, number> = { design_partner: 0, builder: 0, creative: 0, generous: 0 };
  for (const item of items) {
    byPipeline[item.outreach.pipeline as EnvoyPipeline]++;
  }

  // Get last run
  const { data: lastRun } = await supabaseAdmin
    .from('envoy_runs')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  return {
    items,
    total: items.length,
    pending: items.length,
    by_pipeline: byPipeline,
    last_run: lastRun as EnvoyRun | undefined,
  };
}

/** Approve and send an outreach draft */
export async function approveOutreach(userId: string, outreachId: string): Promise<boolean> {
  const { data: outreach } = await supabaseAdmin
    .from('envoy_outreach')
    .select('*, envoy_candidates!inner(*)')
    .eq('id', outreachId)
    .eq('user_id', userId)
    .single();

  if (!outreach) return false;

  const candidate = outreach.envoy_candidates as unknown as EnvoyCandidate;

  // Mark outreach as sent
  await supabaseAdmin
    .from('envoy_outreach')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', outreachId);

  // Update candidate status and outreach tracking
  await supabaseAdmin
    .from('envoy_candidates')
    .update({
      status: 'sent',
      outreach_count: (candidate.outreach_count || 0) + 1,
      last_outreach_at: new Date().toISOString(),
    })
    .eq('id', candidate.id);

  // Log interaction if linked to a person
  if (outreach.person_id) {
    await logInteraction(userId, {
      person_id: outreach.person_id,
      date: new Date().toISOString(),
      type: 'email_sent',
      summary: `Envoy outreach: ${outreach.subject || 'strategic outreach'}`,
      sentiment: 'warm',
      auto_logged: true,
    });
  }

  return true;
}

/** Edit an outreach draft */
export async function editOutreach(
  userId: string,
  outreachId: string,
  editedBody: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_outreach')
    .update({ edited_body: editedBody })
    .eq('id', outreachId)
    .eq('user_id', userId);

  return !error;
}

/** Skip an outreach suggestion */
export async function skipOutreach(userId: string, outreachId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_outreach')
    .update({ status: 'skipped' })
    .eq('id', outreachId)
    .eq('user_id', userId);

  return !error;
}

/** Defer an outreach suggestion */
export async function deferOutreach(userId: string, outreachId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_outreach')
    .update({ status: 'deferred' })
    .eq('id', outreachId)
    .eq('user_id', userId);

  return !error;
}

// ============================================================
// Coffee Chat Queue Operations
// ============================================================

/** Get coffee chat suggestions for a given week */
export async function getCoffeeChatSuggestions(
  userId: string,
  weekStart?: string
): Promise<EnvoyCoffeeChatSuggestion[]> {
  let query = supabaseAdmin
    .from('envoy_coffee_chats')
    .select('*, envoy_candidates(*), people:person_id(*)')
    .eq('user_id', userId)
    .in('status', ['suggested', 'outreach_pending', 'scheduled'])
    .order('created_at', { ascending: true });

  if (weekStart) {
    query = query.eq('suggested_for_week', weekStart);
  }

  const { data } = await query;
  if (!data) return [];

  return data.map(chat => ({
    chat: {
      id: chat.id,
      user_id: chat.user_id,
      candidate_id: chat.candidate_id,
      person_id: chat.person_id,
      participant_name: chat.participant_name,
      participant_role: chat.participant_role,
      participant_org: chat.participant_org,
      pipeline: chat.pipeline,
      why_now: chat.why_now,
      suggested_topics: chat.suggested_topics,
      your_ask: chat.your_ask,
      brief: chat.brief,
      last_contact_summary: chat.last_contact_summary,
      status: chat.status,
      suggested_for_week: chat.suggested_for_week,
      scheduled_at: chat.scheduled_at,
      completed_at: chat.completed_at,
      follow_up_drafted: chat.follow_up_drafted,
      follow_up_notes: chat.follow_up_notes,
      created_at: chat.created_at,
      updated_at: chat.updated_at,
    } as EnvoyCoffeeChat,
    candidate: chat.envoy_candidates as EnvoyCandidate | undefined,
    person: chat.people as Person | undefined,
  }));
}

/** Accept a coffee chat suggestion and move to outreach */
export async function acceptCoffeeChat(
  userId: string,
  chatId: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .update({ status: 'outreach_pending' })
    .eq('id', chatId)
    .eq('user_id', userId);

  return !error;
}

/** Mark a coffee chat as scheduled */
export async function scheduleCoffeeChat(
  userId: string,
  chatId: string,
  scheduledAt: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .update({ status: 'scheduled', scheduled_at: scheduledAt })
    .eq('id', chatId)
    .eq('user_id', userId);

  return !error;
}

/** Mark a coffee chat as completed */
export async function completeCoffeeChat(
  userId: string,
  chatId: string,
  notes?: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      follow_up_notes: notes || null,
    })
    .eq('id', chatId)
    .eq('user_id', userId);

  if (error) return false;

  // Log interaction if linked to a person
  const { data: chat } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .select('person_id, participant_name')
    .eq('id', chatId)
    .single();

  if (chat?.person_id) {
    await logInteraction(userId, {
      person_id: chat.person_id,
      date: new Date().toISOString(),
      type: 'call',
      summary: `Coffee chat with ${chat.participant_name}`,
      sentiment: 'warm',
      auto_logged: true,
    });
  }

  return true;
}

/** Cancel a coffee chat */
export async function cancelCoffeeChat(
  userId: string,
  chatId: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .update({ status: 'cancelled' })
    .eq('id', chatId)
    .eq('user_id', userId);

  return !error;
}

// ============================================================
// Newsletter Growth
// ============================================================

/** Record newsletter metrics snapshot */
export async function recordNewsletterMetrics(
  userId: string,
  metrics: Omit<EnvoyNewsletterMetrics, 'id' | 'user_id' | 'created_at' | 'recorded_at'>
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_newsletter_metrics')
    .insert({
      user_id: userId,
      recorded_at: new Date().toISOString(),
      ...metrics,
    });

  return !error;
}

/** Get newsletter growth trend */
export async function getNewsletterMetrics(
  userId: string,
  limit: number = 12
): Promise<EnvoyNewsletterMetrics[]> {
  const { data } = await supabaseAdmin
    .from('envoy_newsletter_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
    .limit(limit);

  return (data || []) as EnvoyNewsletterMetrics[];
}

// ============================================================
// Dispatch Integration
// ============================================================

/** Generate the Envoy section for the Morning Dispatch */
export async function generateEnvoyDispatchSummary(userId: string): Promise<string> {
  const queue = await getOutreachQueue(userId);
  const coffeeChats = await getTodaysCoffeeChats(userId);
  let summary = '';

  // Outreach queue
  if (queue.items.length > 0) {
    summary += `**Envoy: ${queue.pending} outreach message${queue.pending !== 1 ? 's' : ''} ready for review**\n\n`;

    for (const item of queue.items) {
      const { outreach, candidate } = item;
      const pipelineLabel = formatPipeline(outreach.pipeline);
      const channelLabel = formatChannel(outreach.channel);

      summary += `---\n`;
      summary += `**To:** ${candidate.name}`;
      if (candidate.role) summary += ` (${candidate.role}`;
      if (candidate.organization) summary += `, ${candidate.organization}`;
      if (candidate.role) summary += `)`;
      summary += `\n`;
      summary += `**Pipeline:** ${pipelineLabel} · **Channel:** ${channelLabel}\n`;
      if (candidate.why_reach_out) {
        summary += `**Why:** ${candidate.why_reach_out}\n`;
      }
      summary += `**Draft:**\n${outreach.edited_body || outreach.body}\n`;
      summary += `**Actions:** Send | Edit | Skip\n\n`;
    }
  }

  // Coffee chat brief
  if (coffeeChats.length > 0) {
    summary += `\n**Coffee Chat${coffeeChats.length > 1 ? 's' : ''} Today**\n\n`;
    for (const chat of coffeeChats) {
      if (chat.brief) {
        summary += chat.brief + '\n\n';
      } else {
        summary += `**${chat.participant_name}**`;
        if (chat.participant_role) summary += ` — ${chat.participant_role}`;
        if (chat.participant_org) summary += `, ${chat.participant_org}`;
        summary += `\n`;
        if (chat.your_ask) summary += `Ask: ${chat.your_ask}\n`;
        summary += '\n';
      }
    }
  }

  if (!summary) {
    summary = 'No Envoy items today. The seeds are planted; watch them grow.';
  }

  return summary;
}

/** Get coffee chats scheduled for today */
async function getTodaysCoffeeChats(userId: string): Promise<EnvoyCoffeeChat[]> {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const { data } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('scheduled_at', startOfDay.toISOString())
    .lt('scheduled_at', endOfDay.toISOString());

  return (data || []) as EnvoyCoffeeChat[];
}

/** Generate the Envoy section for the Weekly Edgelands Review */
export async function generateWeeklyReport(userId: string): Promise<EnvoyWeeklyReport> {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(now);
  weekStart.setDate(diff);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // Outreach sent this week
  const { data: sentOutreach } = await supabaseAdmin
    .from('envoy_outreach')
    .select('pipeline, status')
    .eq('user_id', userId)
    .eq('status', 'sent')
    .gte('sent_at', weekStart.toISOString())
    .lt('sent_at', weekEnd.toISOString());

  // Responses received this week
  const { data: responses } = await supabaseAdmin
    .from('envoy_outreach')
    .select('pipeline')
    .eq('user_id', userId)
    .eq('status', 'responded')
    .gte('response_received_at', weekStart.toISOString())
    .lt('response_received_at', weekEnd.toISOString());

  // Coffee chats completed this week
  const { data: completedChats } = await supabaseAdmin
    .from('envoy_coffee_chats')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('completed_at', weekStart.toISOString())
    .lt('completed_at', weekEnd.toISOString());

  // Newsletter growth this week
  const { data: latestMetrics } = await supabaseAdmin
    .from('envoy_newsletter_metrics')
    .select('weekly_growth')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  // Active conversations per pipeline
  const { data: activeConversations } = await supabaseAdmin
    .from('envoy_candidates')
    .select('pipeline')
    .eq('user_id', userId)
    .in('status', ['sent', 'responded']);

  const sent = sentOutreach || [];
  const resp = responses || [];

  const byPipeline: Record<EnvoyPipeline, { outreach_sent: number; responses: number; active_conversations: number }> = {
    design_partner: { outreach_sent: 0, responses: 0, active_conversations: 0 },
    builder: { outreach_sent: 0, responses: 0, active_conversations: 0 },
    creative: { outreach_sent: 0, responses: 0, active_conversations: 0 },
    generous: { outreach_sent: 0, responses: 0, active_conversations: 0 },
  };

  for (const s of sent) {
    const p = s.pipeline as EnvoyPipeline;
    if (byPipeline[p]) byPipeline[p].outreach_sent++;
  }
  for (const r of resp) {
    const p = r.pipeline as EnvoyPipeline;
    if (byPipeline[p]) byPipeline[p].responses++;
  }
  for (const a of (activeConversations || [])) {
    const p = a.pipeline as EnvoyPipeline;
    if (byPipeline[p]) byPipeline[p].active_conversations++;
  }

  // Get suggested outreach for next week
  const outreachQueue = await getOutreachQueue(userId);
  const coffeeChatSuggestions = await getCoffeeChatSuggestions(userId);

  return {
    week_start: weekStartStr,
    outreach_sent: sent.length,
    outreach_responded: resp.length,
    response_rate: sent.length > 0 ? resp.length / sent.length : 0,
    coffee_chats_completed: completedChats?.length || 0,
    newsletter_growth: latestMetrics?.weekly_growth || 0,
    by_pipeline: byPipeline,
    suggested_outreach: outreachQueue.items,
    suggested_coffee_chats: coffeeChatSuggestions,
  };
}

// ============================================================
// Candidate Management
// ============================================================

/** Add a new candidate to a pipeline */
export async function addCandidate(
  userId: string,
  data: Omit<EnvoyCandidate, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'outreach_count' | 'excluded'>
): Promise<EnvoyCandidate | null> {
  const { data: candidate, error } = await supabaseAdmin
    .from('envoy_candidates')
    .insert({
      user_id: userId,
      outreach_count: 0,
      excluded: false,
      ...data,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to add candidate:', error);
    return null;
  }
  return candidate as EnvoyCandidate;
}

/** Get all candidates with optional pipeline filter */
export async function getCandidates(
  userId: string,
  pipeline?: EnvoyPipeline,
  status?: string
): Promise<EnvoyCandidate[]> {
  let query = supabaseAdmin
    .from('envoy_candidates')
    .select('*')
    .eq('user_id', userId)
    .eq('excluded', false)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });

  if (pipeline) query = query.eq('pipeline', pipeline);
  if (status) query = query.eq('status', status);

  const { data } = await query;
  return (data || []) as EnvoyCandidate[];
}

/** Exclude a candidate from all Envoy outreach */
export async function excludeCandidate(
  userId: string,
  candidateId: string,
  reason?: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('envoy_candidates')
    .update({
      excluded: true,
      excluded_reason: reason || 'User requested exclusion',
    })
    .eq('id', candidateId)
    .eq('user_id', userId);

  return !error;
}

/** Mark that a candidate responded to outreach */
export async function markResponse(
  userId: string,
  candidateId: string
): Promise<boolean> {
  const now = new Date().toISOString();

  const { error: candidateError } = await supabaseAdmin
    .from('envoy_candidates')
    .update({
      status: 'responded',
      last_response_at: now,
    })
    .eq('id', candidateId)
    .eq('user_id', userId);

  if (candidateError) return false;

  // Also update any sent outreach for this candidate
  await supabaseAdmin
    .from('envoy_outreach')
    .update({
      status: 'responded',
      response_received_at: now,
    })
    .eq('candidate_id', candidateId)
    .eq('status', 'sent');

  return true;
}

// ============================================================
// Main Pipeline
// ============================================================

/** Run the Envoy processing pipeline (called weekly on Monday mornings) */
export async function runPipeline(userId: string): Promise<EnvoyRun> {
  const { data: run } = await supabaseAdmin
    .from('envoy_runs')
    .insert({
      user_id: userId,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  const runId = run?.id;

  try {
    // Step 1: Process follow-ups for candidates who haven't responded
    const followUpsQueued = await processFollowUps(userId);

    // Step 2: Draft outreach for approved candidates
    const outreachDrafted = await draftOutreach(userId);

    // Step 3: Suggest coffee chats for the coming week
    const coffeeChatsSuggested = await suggestCoffeeChats(userId);

    // Step 4: Generate briefs for any scheduled coffee chats
    const { data: scheduledChats } = await supabaseAdmin
      .from('envoy_coffee_chats')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .is('brief', null);

    if (scheduledChats) {
      for (const chat of scheduledChats) {
        await generateCoffeeChatBrief(userId, chat.id);
      }
    }

    const completedRun: Partial<EnvoyRun> = {
      completed_at: new Date().toISOString(),
      status: 'completed' as RunStatus,
      candidates_identified: 0,
      outreach_drafted: outreachDrafted,
      coffee_chats_suggested: coffeeChatsSuggested,
      follow_ups_queued: followUpsQueued,
    };

    if (runId) {
      await supabaseAdmin
        .from('envoy_runs')
        .update(completedRun)
        .eq('id', runId);
    }

    return { ...run, ...completedRun } as EnvoyRun;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (runId) {
      await supabaseAdmin
        .from('envoy_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'failed',
          error: errorMessage,
        })
        .eq('id', runId);
    }

    return {
      id: runId || '',
      user_id: userId,
      started_at: run?.started_at || new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'failed',
      candidates_identified: 0,
      outreach_drafted: 0,
      coffee_chats_suggested: 0,
      follow_ups_queued: 0,
      error: errorMessage,
      created_at: run?.created_at || new Date().toISOString(),
    };
  }
}

// ============================================================
// Helpers
// ============================================================

function formatPipeline(pipeline: string): string {
  switch (pipeline) {
    case 'design_partner': return 'Design Partner';
    case 'builder': return 'Builder & Kindred Spirit';
    case 'creative': return 'Creative Community';
    case 'generous': return 'People You Can Help';
    default: return pipeline;
  }
}

function formatChannel(channel: string): string {
  switch (channel) {
    case 'email': return 'Email';
    case 'intro_request': return 'Warm Introduction';
    case 'dm': return 'Direct Message';
    case 'in_person_followup': return 'In-Person Follow-up';
    case 'handwritten': return 'Handwritten Note';
    default: return channel;
  }
}
