/**
 * Correspondent Agent — Core Pipeline
 *
 * The five-stage processing pipeline:
 * 1. Ingest — pull messages from connected channels
 * 2. Identify — match senders to People Database
 * 3. Triage — score urgency and importance
 * 4. Draft — generate replies using Claude + voice model
 * 5. Queue — compile into the decision queue for morning dispatch
 */

import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from './supabase';
import { fetchNewEmails, type IngestedEmail } from './gmail';
import {
  findPersonByEmail,
  findPersonByName,
  buildRelationshipContext,
  logInteraction,
} from './people';
import { recordFeedback, getRefinementsForDraft } from './feedback';
import type {
  CorrespondentMessage,
  CorrespondentDraft,
  CorrespondentRun,
  Person,
  TriageResult,
  DraftResult,
  DraftTier,
  VoiceSample,
} from '@/types';

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _anthropic;
}

// ============================================================
// Stage 1: INGEST
// ============================================================

/** Pull all new messages from connected channels and store them */
async function ingest(userId: string): Promise<{ ingested: number; debug: string }> {
  let ingested = 0;
  const debugInfo: string[] = [];

  // --- Email Channel ---
  const { data: config, error: configError } = await supabaseAdmin
    .from('correspondent_config')
    .select('gmail_connected, excluded_emails')
    .eq('user_id', userId)
    .maybeSingle();

  if (configError) {
    debugInfo.push(`Config error: ${configError.message}`);
    return { ingested: 0, debug: debugInfo.join('; ') };
  }

  if (!config?.gmail_connected) {
    debugInfo.push('Gmail not connected');
    return { ingested: 0, debug: debugInfo.join('; ') };
  }

  debugInfo.push('Gmail connected, fetching emails...');

  const emails = await fetchNewEmails(userId);
  debugInfo.push(`Fetched ${emails.length} emails from Gmail API`);

  const excludedEmails = new Set((config.excluded_emails || []).map((e: string) => e.toLowerCase()));

    for (const email of emails) {
      // Skip excluded senders
      if (excludedEmails.has(email.sender_email.toLowerCase())) continue;

      // Deduplicate by external_id
      const { data: existing } = await supabaseAdmin
        .from('correspondent_messages')
        .select('id')
        .eq('user_id', userId)
        .eq('external_id', email.external_id)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { error } = await supabaseAdmin.from('correspondent_messages').insert({
        user_id: userId,
        channel: 'email',
        external_id: email.external_id,
        thread_id: email.thread_id,
        sender_email: email.sender_email,
        sender_name: email.sender_name,
        subject: email.subject,
        body: email.body,
        body_html: email.body_html,
        snippet: email.snippet,
        labels: email.labels,
        received_at: email.received_at,
        attachments: email.attachments.length > 0 ? email.attachments : null,
        processed: false,
      });

      if (error) {
        debugInfo.push(`Insert error: ${error.message}`);
      } else {
        ingested++;
      }
    }

  return { ingested, debug: debugInfo.join('; ') };
}

// ============================================================
// Stage 2: IDENTIFY
// ============================================================

/** Match each unprocessed message sender to a Person record */
async function identify(userId: string): Promise<void> {
  const { data: unmatched } = await supabaseAdmin
    .from('correspondent_messages')
    .select('*')
    .eq('user_id', userId)
    .eq('processed', false)
    .is('person_id', null);

  if (!unmatched || unmatched.length === 0) return;

  for (const message of unmatched) {
    let person: Person | null = null;

    // Try email match first
    if (message.sender_email) {
      person = await findPersonByEmail(userId, message.sender_email);
    }

    // Try name match as fallback
    if (!person && message.sender_name) {
      person = await findPersonByName(userId, message.sender_name);
    }

    if (person) {
      await supabaseAdmin
        .from('correspondent_messages')
        .update({ person_id: person.id })
        .eq('id', message.id);
    }
    // If no match found, person_id stays null — flagged as unknown in the queue
  }
}

// ============================================================
// Stage 3: TRIAGE
// ============================================================

/** Score each unprocessed message on urgency and importance */
async function triage(userId: string): Promise<void> {
  const { data: unprocessed } = await supabaseAdmin
    .from('correspondent_messages')
    .select('*, people:person_id(*)')
    .eq('user_id', userId)
    .eq('processed', false);

  if (!unprocessed || unprocessed.length === 0) return;

  // Build triage context for Claude
  for (const message of unprocessed) {
    const person = message.people as Person | null;

    const triagePrompt = buildTriagePrompt(message, person);

    const response = await getAnthropic().messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 512,
      messages: [{ role: 'user', content: triagePrompt }],
    });

    const resultText = response.content[0].type === 'text' ? response.content[0].text : '{}';

    try {
      const result: TriageResult = JSON.parse(
        resultText.replace(/```json\n?|\n?```/g, '').trim()
      );

      await supabaseAdmin
        .from('correspondent_messages')
        .update({
          urgency: Math.min(10, Math.max(0, result.urgency)),
          importance: Math.min(10, Math.max(0, result.importance)),
          triage_summary: result.summary,
        })
        .eq('id', message.id);
    } catch {
      // Default to moderate scores on parse failure
      await supabaseAdmin
        .from('correspondent_messages')
        .update({
          urgency: 3,
          importance: 5,
          triage_summary: message.snippet || message.subject || 'Unable to triage',
        })
        .eq('id', message.id);
    }
  }
}

function buildTriagePrompt(message: CorrespondentMessage, person: Person | null): string {
  let prompt = `You are triaging an inbound message for the Correspondent agent. Score it on two axes:
- Urgency (0-10): Does this need a response soon? Look for deadlines, time-sensitive language, blocking decisions.
- Importance (0-10): Does this matter? Consider relationship closeness, emotional content, financial/legal implications.

Also determine the appropriate draft tier:
- "full_draft": Substantive, personalized reply needed
- "quick_reply": Simple acknowledgment or short answer
- "batched_reply": Similar to other messages (e.g., course inquiries)
- "no_reply": Newsletters, automated notifications, marketing

Message details:
Channel: ${message.channel}
From: ${message.sender_name || 'Unknown'} <${message.sender_email || 'Unknown'}>
Subject: ${message.subject || '(none)'}
Snippet: ${message.snippet || message.body.substring(0, 300)}

`;

  if (person) {
    prompt += `Sender is known:
- Name: ${person.name}
- Circle: ${person.circle}
- Closeness: ${person.closeness}/5
- Relationship: ${person.relationship}
`;
    if (person.care_notes) prompt += `- Current context: ${person.care_notes}\n`;
  } else {
    prompt += `Sender is NOT in the People Database (unknown contact).\n`;
  }

  prompt += `
Body (first 1000 chars):
${message.body.substring(0, 1000)}

Respond with ONLY a JSON object:
{
  "urgency": <0-10>,
  "importance": <0-10>,
  "draft_tier": "<full_draft|quick_reply|batched_reply|no_reply>",
  "summary": "<one-line context summary for the queue>",
  "reasoning": "<brief explanation of your scoring>"
}`;

  return prompt;
}

// ============================================================
// Stage 4: DRAFT
// ============================================================

/** Generate reply drafts for messages that need them */
async function draft(userId: string): Promise<number> {
  let draftsGenerated = 0;

  // Get triaged but unprocessed messages that need a reply
  const { data: messages } = await supabaseAdmin
    .from('correspondent_messages')
    .select('*, people:person_id(*)')
    .eq('user_id', userId)
    .eq('processed', false)
    .not('triage_summary', 'is', null);

  if (!messages || messages.length === 0) return 0;

  for (const message of messages) {
    const person = message.people as Person | null;

    // Determine draft tier from triage scores
    const draftTier = determineDraftTier(message);

    if (draftTier === 'no_reply') {
      // Mark as processed, no draft needed
      await supabaseAdmin
        .from('correspondent_messages')
        .update({ processed: true })
        .eq('id', message.id);
      continue;
    }

    // Build relationship context
    const relationshipContext = person ? await buildRelationshipContext(person) : 'Unknown sender — no relationship context available.';

    // Get voice samples for this circle
    const voiceSamples = await getVoiceSamples(userId, person?.circle || null);

    // Get thread context if this is part of a conversation
    const threadContext = await getThreadContext(userId, message.thread_id);

    // Get learned style refinements from feedback loop
    const refinements = await getRefinementsForDraft(
      userId,
      person?.circle || null,
      person?.id || null
    );

    // Generate draft
    const draftResult = await generateDraft(
      message,
      person,
      relationshipContext,
      voiceSamples,
      threadContext,
      draftTier,
      refinements
    );

    if (draftResult) {
      // Insert draft
      const { error } = await supabaseAdmin.from('correspondent_drafts').insert({
        user_id: userId,
        message_id: message.id,
        person_id: person?.id || null,
        channel: message.channel,
        subject: draftResult.subject || (message.subject ? `Re: ${message.subject}` : undefined),
        body: draftResult.body,
        draft_tier: draftTier,
        relationship_context: relationshipContext,
        thread_context: threadContext,
        voice_notes: draftResult.voice_notes,
        status: 'pending',
        urgency: message.urgency,
        importance: message.importance,
      });

      if (!error) draftsGenerated++;
    }

    // Mark message as processed
    await supabaseAdmin
      .from('correspondent_messages')
      .update({ processed: true })
      .eq('id', message.id);
  }

  // Assign queue positions (urgent+important first)
  await assignQueuePositions(userId);

  return draftsGenerated;
}

function determineDraftTier(message: any): DraftTier {
  const urgency = message.urgency || 0;
  const importance = message.importance || 0;
  const combined = urgency + importance;

  // Check for no-reply signals
  const labels = message.labels || [];
  const isAutomated = labels.includes('CATEGORY_UPDATES') ||
    labels.includes('CATEGORY_PROMOTIONS') ||
    labels.includes('CATEGORY_SOCIAL');

  if (isAutomated && combined < 8) return 'no_reply';
  if (combined >= 12) return 'full_draft';
  if (combined >= 6) return 'quick_reply';
  if (combined < 4) return 'no_reply';
  return 'quick_reply';
}

async function getVoiceSamples(userId: string, circle: string | null): Promise<string[]> {
  let query = supabaseAdmin
    .from('voice_samples')
    .select('content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (circle) {
    query = query.eq('circle', circle);
  }

  const { data } = await query;

  if (!data || data.length === 0) {
    // Fall back to any voice samples
    const { data: fallback } = await supabaseAdmin
      .from('voice_samples')
      .select('content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    return (fallback || []).map(s => s.content);
  }

  return data.map(s => s.content);
}

async function getThreadContext(userId: string, threadId: string | null): Promise<string> {
  if (!threadId) return '';

  const { data: threadMessages } = await supabaseAdmin
    .from('correspondent_messages')
    .select('sender_name, sender_email, subject, snippet, received_at')
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true })
    .limit(10);

  if (!threadMessages || threadMessages.length <= 1) return '';

  return threadMessages
    .map(m => `[${new Date(m.received_at).toLocaleDateString()}] ${m.sender_name || m.sender_email}: ${m.snippet}`)
    .join('\n');
}

async function generateDraft(
  message: CorrespondentMessage,
  person: Person | null,
  relationshipContext: string,
  voiceSamples: string[],
  threadContext: string,
  draftTier: DraftTier,
  refinements: string[] = []
): Promise<DraftResult | null> {
  const systemPrompt = buildDraftSystemPrompt(voiceSamples, draftTier, refinements);

  const userPrompt = buildDraftUserPrompt(
    message,
    person,
    relationshipContext,
    threadContext,
    draftTier
  );

  const model = draftTier === 'full_draft' ? 'claude-3-5-sonnet-20241022' : 'claude-3-5-haiku-20241022';
  const maxTokens = draftTier === 'full_draft' ? 2048 : 512;

  const response = await getAnthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const resultText = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(
      resultText.replace(/```json\n?|\n?```/g, '').trim()
    );
    return {
      body: parsed.body || resultText,
      subject: parsed.subject,
      voice_notes: parsed.voice_notes || '',
      confidence: parsed.confidence || 0.5,
    };
  } catch {
    // If parsing fails, use the raw text as the draft body
    return {
      body: resultText,
      voice_notes: 'Generated as raw text — JSON parsing failed',
      confidence: 0.3,
    };
  }
}

function buildDraftSystemPrompt(voiceSamples: string[], draftTier: DraftTier, refinements: string[] = []): string {
  let prompt = `You are the Correspondent, a drafting agent that writes replies in the user's voice. You are NOT an AI assistant — you are ghostwriting as a specific person based on their writing patterns.

Key principles:
- Sound like the user, not like a polite AI. Study the voice samples carefully.
- Never fabricate facts. If you are unsure about something, flag it with [VERIFY: ...].
- Match the tone to the relationship: warmer for family, more precise for professional contacts.
- Be concise. The user values brevity and substance over pleasantries.
- Never use corporate language, buzzwords, or excessive formality unless the voice samples show it.
`;

  if (draftTier === 'quick_reply') {
    prompt += `\nThis is a QUICK REPLY — keep it to 1-3 sentences. Just acknowledge, confirm, or briefly respond.\n`;
  } else if (draftTier === 'full_draft') {
    prompt += `\nThis is a FULL DRAFT — write a complete, substantive reply that addresses all points in the original message.\n`;
  }

  // Include learned style refinements from the feedback loop
  if (refinements.length > 0) {
    prompt += `\nLEARNED STYLE RULES — the user has previously corrected drafts. Follow these rules strictly:\n`;
    for (const r of refinements) {
      prompt += `- ${r}\n`;
    }
    prompt += '\n';
  }

  if (voiceSamples.length > 0) {
    prompt += `\nVOICE SAMPLES — these are examples of how the user actually writes. Match this style:\n`;
    prompt += '---\n';
    for (const sample of voiceSamples.slice(0, 5)) {
      prompt += sample.substring(0, 500) + '\n---\n';
    }
  } else {
    prompt += `\nNo voice samples available yet. Write in a natural, warm but concise tone. Avoid AI-sounding language.\n`;
  }

  return prompt;
}

function buildDraftUserPrompt(
  message: CorrespondentMessage,
  person: Person | null,
  relationshipContext: string,
  threadContext: string,
  draftTier: DraftTier
): string {
  let prompt = `Draft a reply to this message.

FROM: ${message.sender_name || 'Unknown'} <${message.sender_email || ''}>
SUBJECT: ${message.subject || '(none)'}
RECEIVED: ${new Date(message.received_at).toLocaleDateString()}

RELATIONSHIP CONTEXT:
${relationshipContext}
`;

  if (threadContext) {
    prompt += `\nTHREAD HISTORY:\n${threadContext}\n`;
  }

  prompt += `\nMESSAGE BODY:\n${message.body.substring(0, 3000)}\n`;

  prompt += `\nRespond with a JSON object:
{
  "body": "<the draft reply text>",
  "subject": "<reply subject line, or null to use Re: original>",
  "voice_notes": "<brief note about tone/style choices you made>",
  "confidence": <0.0-1.0 how confident you are this sounds right>
}`;

  return prompt;
}

async function assignQueuePositions(userId: string): Promise<void> {
  const { data: pendingDrafts } = await supabaseAdmin
    .from('correspondent_drafts')
    .select('id, urgency, importance')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('urgency', { ascending: false })
    .order('importance', { ascending: false });

  if (!pendingDrafts) return;

  for (let i = 0; i < pendingDrafts.length; i++) {
    await supabaseAdmin
      .from('correspondent_drafts')
      .update({ queue_position: i + 1 })
      .eq('id', pendingDrafts[i].id);
  }
}

// ============================================================
// Stage 5: QUEUE
// ============================================================

/** Get the current decision queue for the morning dispatch */
export async function getQueue(userId: string) {
  const { data: drafts } = await supabaseAdmin
    .from('correspondent_drafts')
    .select('*, correspondent_messages!inner(*), people:person_id(*)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('queue_position', { ascending: true });

  if (!drafts) return { items: [], total: 0, pending: 0 };

  const items = drafts.map(d => ({
    draft: {
      id: d.id,
      user_id: d.user_id,
      message_id: d.message_id,
      person_id: d.person_id,
      channel: d.channel,
      subject: d.subject,
      body: d.body,
      draft_tier: d.draft_tier,
      relationship_context: d.relationship_context,
      thread_context: d.thread_context,
      voice_notes: d.voice_notes,
      status: d.status,
      skip_count: d.skip_count,
      queue_position: d.queue_position,
      urgency: d.urgency,
      importance: d.importance,
      edited_body: d.edited_body,
      sent_at: d.sent_at,
      created_at: d.created_at,
      updated_at: d.updated_at,
    } as CorrespondentDraft,
    message: d.correspondent_messages as unknown as CorrespondentMessage,
    person: d.people as Person | undefined,
    context_summary: d.correspondent_messages?.triage_summary || '',
  }));

  // Get last run info
  const { data: lastRun } = await supabaseAdmin
    .from('correspondent_runs')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    items,
    total: items.length,
    pending: items.filter(i => i.draft.status === 'pending').length,
    last_run: lastRun as CorrespondentRun | undefined,
  };
}

// ============================================================
// Queue Actions
// ============================================================

/** Approve and send a draft */
export async function approveDraft(userId: string, draftId: string): Promise<boolean> {
  const { data: draft } = await supabaseAdmin
    .from('correspondent_drafts')
    .select('*, correspondent_messages!inner(*), people:person_id(*)')
    .eq('id', draftId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!draft) return false;

  const message = draft.correspondent_messages as any;
  const person = draft.people as Person | null;

  // Send via the appropriate channel
  let sent = false;
  if (draft.channel === 'email' && message.sender_email) {
    const { sendEmail } = await import('./gmail');
    sent = await sendEmail(
      userId,
      message.sender_email,
      draft.subject || `Re: ${message.subject || ''}`,
      draft.edited_body || draft.body,
      message.thread_id
    );
  }
  // Future: SMS, Slack send implementations

  if (sent) {
    const wasEdited = !!draft.edited_body;

    // Update draft status
    await supabaseAdmin
      .from('correspondent_drafts')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', draftId);

    // Log interaction
    if (person) {
      await logInteraction(userId, {
        person_id: person.id,
        date: new Date().toISOString(),
        type: 'email_sent',
        summary: `Re: ${message.subject || 'no subject'}`,
        sentiment: null as any,
        auto_logged: true,
      });
    }

    // Store the sent message as a voice sample for future learning
    await supabaseAdmin.from('voice_samples').insert({
      user_id: userId,
      person_id: person?.id || null,
      circle: person?.circle || null,
      channel: draft.channel,
      content: draft.edited_body || draft.body,
      sent_at: new Date().toISOString(),
    });

    // Record feedback for the learning loop
    await recordFeedback(
      userId,
      draft as unknown as CorrespondentDraft,
      wasEdited ? 'sent_edited' : 'sent',
      person
    );
  }

  return sent;
}

/** Edit a draft (stores the edit, doesn't send) */
export async function editDraft(
  userId: string,
  draftId: string,
  editedBody: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('correspondent_drafts')
    .update({ edited_body: editedBody, status: 'edited' })
    .eq('id', draftId)
    .eq('user_id', userId);

  return !error;
}

/** Skip a draft (returns next morning with a flag) */
export async function skipDraft(userId: string, draftId: string): Promise<boolean> {
  const { data: draft } = await supabaseAdmin
    .from('correspondent_drafts')
    .select('skip_count')
    .eq('id', draftId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!draft) return false;

  const { error } = await supabaseAdmin
    .from('correspondent_drafts')
    .update({
      status: 'skipped',
      skip_count: (draft.skip_count || 0) + 1,
    })
    .eq('id', draftId);

  return !error;
}

/** Defer a draft (remove from queue entirely) */
export async function deferDraft(userId: string, draftId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('correspondent_drafts')
    .update({ status: 'deferred' })
    .eq('id', draftId)
    .eq('user_id', userId);

  return !error;
}

/** Re-queue skipped drafts from yesterday */
async function requeueSkipped(userId: string): Promise<void> {
  const { data: skipped } = await supabaseAdmin
    .from('correspondent_drafts')
    .select('id, skip_count')
    .eq('user_id', userId)
    .eq('status', 'skipped');

  if (!skipped) return;

  for (const draft of skipped) {
    await supabaseAdmin
      .from('correspondent_drafts')
      .update({ status: 'pending' })
      .eq('id', draft.id);
  }
}

// ============================================================
// MAIN PIPELINE
// ============================================================

/** Run the full Correspondent processing pipeline */
export async function runPipeline(userId: string): Promise<CorrespondentRun> {
  // Create run record
  const { data: run } = await supabaseAdmin
    .from('correspondent_runs')
    .insert({
      user_id: userId,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();

  const runId = run?.id;

  try {
    // Re-queue any skipped drafts from yesterday
    await requeueSkipped(userId);

    // Stage 1: Ingest
    const ingestResult = await ingest(userId);
    const messagesIngested = ingestResult.ingested;
    console.log('[Correspondent] Ingest:', ingestResult.debug);

    // Stage 2: Identify
    await identify(userId);

    // Stage 3: Triage
    await triage(userId);

    // Stage 4: Draft
    const draftsGenerated = await draft(userId);

    // Count total processed
    const { count: messagesProcessed } = await supabaseAdmin
      .from('correspondent_messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('processed', true);

    // Update run record
    const completedRun: Partial<CorrespondentRun> & { debug?: string } = {
      completed_at: new Date().toISOString(),
      status: 'completed',
      messages_ingested: messagesIngested,
      messages_processed: messagesProcessed || 0,
      drafts_generated: draftsGenerated,
      debug: ingestResult.debug,
    };

    if (runId) {
      await supabaseAdmin
        .from('correspondent_runs')
        .update(completedRun)
        .eq('id', runId);
    }

    return { ...run, ...completedRun } as CorrespondentRun;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (runId) {
      await supabaseAdmin
        .from('correspondent_runs')
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
      messages_ingested: 0,
      messages_processed: 0,
      drafts_generated: 0,
      error: errorMessage,
      created_at: run?.created_at || new Date().toISOString(),
    };
  }
}

// ============================================================
// Emergency Alert Check
// ============================================================

/** Check for emergency messages that should bypass the queue */
export async function checkEmergencyAlerts(userId: string): Promise<CorrespondentMessage[]> {
  const { data: config } = await supabaseAdmin
    .from('correspondent_config')
    .select('emergency_alerts_enabled, emergency_closeness_threshold')
    .eq('user_id', userId)
    .maybeSingle();

  if (!config?.emergency_alerts_enabled) return [];

  const threshold = config.emergency_closeness_threshold || 2;

  // Get recent unprocessed messages from close contacts
  const { data: messages } = await supabaseAdmin
    .from('correspondent_messages')
    .select('*, people:person_id(*)')
    .eq('user_id', userId)
    .eq('processed', false)
    .not('person_id', 'is', null);

  if (!messages) return [];

  const emergencyKeywords = /\b(emergency|urgent|help|hospital|accident|911|asap|immediately|critical)\b/i;

  return messages.filter(msg => {
    const person = msg.people as Person | null;
    if (!person || person.closeness > threshold) return false;

    const fullText = `${msg.subject || ''} ${msg.body}`;
    return emergencyKeywords.test(fullText);
  }) as unknown as CorrespondentMessage[];
}

// ============================================================
// Dispatch Summary
// ============================================================

/** Generate the Messages to Decision section for the Morning Dispatch */
export async function generateDispatchSummary(userId: string): Promise<string> {
  const queue = await getQueue(userId);

  if (queue.items.length === 0) {
    return 'No messages waiting for your attention. Your correspondence is settled.';
  }

  let summary = `**Messages to Decision** (${queue.pending} pending)\n\n`;

  for (const item of queue.items) {
    const person = item.person;
    const msg = item.message;
    const d = item.draft;

    const fromLabel = person
      ? `${person.nickname || person.name} (${person.circle})`
      : msg.sender_name || msg.sender_email || 'Unknown';

    const urgencyLabel = d.urgency >= 7 ? ' [URGENT]' : '';
    const skipLabel = d.skip_count > 0 ? ` — waiting ${d.skip_count + 1} days` : '';

    summary += `---\n`;
    summary += `**From:** ${fromLabel}${urgencyLabel}${skipLabel}\n`;
    summary += `**Context:** ${item.context_summary}\n`;
    summary += `**Draft (${d.draft_tier}):**\n${d.body}\n`;
    summary += `**Actions:** Send | Edit | Skip\n\n`;
  }

  if (queue.last_run) {
    const runTime = new Date(queue.last_run.completed_at || queue.last_run.started_at);
    summary += `---\n*Last processed: ${runTime.toLocaleString()} — ${queue.last_run.messages_ingested} ingested, ${queue.last_run.drafts_generated} drafted*\n`;
  }

  return summary;
}
