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

/** Detect no-reply / automated sender patterns */
function isAutomatedSender(email: string): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();

  // Check for noreply/no-reply anywhere in the local part (catches cloudplatform-noreply@, security-noreply@, etc.)
  const localPart = lower.split('@')[0];
  if (/noreply|no-reply|donotreply|do-not-reply/.test(localPart)) return true;

  // Common automated sender prefixes
  const automatedPrefixes = [
    'notifications@', 'notification@', 'notify@',
    'newsletter@', 'news@', 'updates@', 'update@',
    'marketing@', 'promo@', 'promotions@',
    'mailer@', 'mailer-daemon@', 'postmaster@',
    'billing@', 'receipts@', 'receipt@',
    'events@', 'contact@', 'messages+',
    'customer_success@', 'customerservice@',
    'support@', 'help@', 'info@', 'hello@', 'team@',
    'admin@', 'service@', 'orders@', 'feedback@',
  ];
  if (automatedPrefixes.some(p => lower.startsWith(p))) return true;

  // Common automated domains
  const autoDomains = [
    'vercel.com', 'github.com', 'gitlab.com', 'bitbucket.org',
    'netlify.com', 'heroku.com', 'aws.amazon.com',
    'googleusercontent.com', 'google.com',
    'facebookmail.com', 'linkedin.com',
    'shopify.com', 'stripe.com', 'paypal.com',
    'squarespace.com', 'squaremktg.com', 'amazon.com',
    'capitalone.com', 'uber.com', 'etsy.com',
    'garmin.com', 'dreamstime.com',
    'replit.com', 'notion.so', 'slack.com', 'atlassian.com',
  ];
  const domain = lower.split('@')[1];
  if (domain && autoDomains.some(d => domain.endsWith(d))) return true;

  return false;
}

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

      // Add synthetic labels for triage signals
      const labels = [...email.labels];
      const senderIsAutomated = isAutomatedSender(email.sender_email);
      if (email.is_list_email || senderIsAutomated) labels.push('_LIST');
      if (email.is_reply) labels.push('_REPLY');
      if (!email.is_list_email && !senderIsAutomated && email.recipient_count <= 2) labels.push('_DIRECT');
      if (email.cc_recipients.length > 5) labels.push('_BULK_CC');

      // Check if user previously sent in this thread (reply to user's own message)
      if (email.thread_id) {
        const { data: sentInThread } = await supabaseAdmin
          .from('correspondent_drafts')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'sent')
          .limit(1);

        if (sentInThread && sentInThread.length > 0) {
          // Check if any of those drafts belong to a message in the same thread
          const { data: threadMatch } = await supabaseAdmin
            .from('correspondent_messages')
            .select('id')
            .eq('thread_id', email.thread_id)
            .eq('user_id', userId)
            .limit(1);

          if (threadMatch && threadMatch.length > 0) {
            labels.push('_USER_THREAD');
          }
        }
      }

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
        labels,
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
  // Step 1: Get all unprocessed messages
  const { data: allUnprocessed } = await supabaseAdmin
    .from('correspondent_messages')
    .select('id, labels, sender_email')
    .eq('user_id', userId)
    .eq('processed', false);

  if (!allUnprocessed || allUnprocessed.length === 0) return;

  // Step 2: Separate into skip vs. needs-triage using BOTH labels AND sender patterns
  const skipIds: string[] = [];
  const triageIds: string[] = [];

  for (const msg of allUnprocessed) {
    const labels: string[] = msg.labels || [];
    const isList = labels.includes('_LIST') || isAutomatedSender(msg.sender_email || '');
    const isGmailAuto = labels.includes('CATEGORY_UPDATES') ||
      labels.includes('CATEGORY_PROMOTIONS') ||
      labels.includes('CATEGORY_SOCIAL');

    if (isList || isGmailAuto) {
      skipIds.push(msg.id);
    } else {
      triageIds.push(msg.id);
    }
  }

  // Step 3: Batch-skip all automated messages (chunked for large sets)
  for (let i = 0; i < skipIds.length; i += 50) {
    const chunk = skipIds.slice(i, i + 50);
    await supabaseAdmin
      .from('correspondent_messages')
      .update({
        urgency: 0,
        importance: 0,
        triage_summary: 'Automated/list email — skipped',
        processed: true,
      })
      .in('id', chunk);
  }

  console.log(`[Triage] Skipped ${skipIds.length} automated, triaging ${triageIds.length} personal messages`);

  if (triageIds.length === 0) return;

  // Step 4: Fetch full message data for personal messages only (cap at 25 per run)
  const { data: toTriage } = await supabaseAdmin
    .from('correspondent_messages')
    .select('*, people:person_id(*)')
    .in('id', triageIds.slice(0, 25));

  if (!toTriage || toTriage.length === 0) return;

  // Sort: replies first, then direct, then everything else
  const priority = (msg: any) => {
    const labels: string[] = msg.labels || [];
    const isReply = labels.includes('_REPLY') || (msg.subject && /^(re|fwd|fw):/i.test(msg.subject));
    const isDirect = labels.includes('_DIRECT') || !isAutomatedSender(msg.sender_email || '');
    if (isDirect && isReply) return 0;
    if (isDirect) return 1;
    if (isReply) return 2;
    return 50;
  };
  const sorted = [...toTriage].sort((a, b) => priority(a) - priority(b));

  // Step 5: Triage each message with Claude (sequential to avoid rate limits)
  for (const message of sorted) {
    const person = message.people as Person | null;

    try {
      const triagePrompt = buildTriagePrompt(message, person);

      const response = await getAnthropic().messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 512,
        messages: [{ role: 'user', content: triagePrompt }],
      });

      const resultText = response.content[0].type === 'text' ? response.content[0].text : '{}';

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

      console.log(`[Triage] ${message.sender_name}: urgency=${result.urgency} importance=${result.importance}`);
    } catch (err) {
      // Default to moderate scores on failure so the message still gets drafted
      console.error(`[Triage] Error triaging ${message.sender_email}:`, err);
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
  const labels = message.labels || [];

  // Check both synthetic labels AND sender patterns (for reprocessed messages)
  const senderAuto = isAutomatedSender(message.sender_email || '');
  const isDirect = labels.includes('_DIRECT') || (!senderAuto && !labels.includes('_LIST'));
  const isReply = labels.includes('_REPLY') || (message.subject && /^(re|fwd|fw):/i.test(message.subject));
  const isUserThread = labels.includes('_USER_THREAD');
  const isList = labels.includes('_LIST') || senderAuto;
  const isBulkCC = labels.includes('_BULK_CC');

  let prompt = `You are triaging an inbound message for the Correspondent agent. The user values personal, relational correspondence highly — even from unknown senders. Score on two axes:
- Urgency (0-10): Does this need a response soon? Look for deadlines, time-sensitive language, blocking decisions.
- Importance (0-10): Does this matter? Consider: personal/emotional content, direct communication (not mass email), replies to conversations the user started, relationship depth, financial/legal implications.

IMPORTANT scoring guidance:
- A heartfelt personal email from anyone (known or unknown) should score HIGH importance (7-10)
- A direct email to just the user (not a mailing list or mass CC) should get an importance boost
- A reply to something the user previously sent should score HIGH importance (the person is responding to THEM)
- Automated notifications, newsletters, marketing, and build alerts should score LOW (0-3)
- Mass CC'd emails are lower importance unless the content specifically addresses the user

Also determine the appropriate draft tier:
- "full_draft": Substantive, personalized reply needed (personal emails, important requests)
- "quick_reply": Simple acknowledgment or short answer
- "batched_reply": Similar to other messages (e.g., course inquiries)
- "no_reply": Newsletters, automated notifications, marketing, build alerts

Message details:
Channel: ${message.channel}
From: ${message.sender_name || 'Unknown'} <${message.sender_email || 'Unknown'}>
Subject: ${message.subject || '(none)'}
Snippet: ${message.snippet || message.body.substring(0, 300)}

`;

  // Add delivery context signals
  const signals: string[] = [];
  if (isDirect) signals.push('DIRECT EMAIL — sent specifically to the user (not a mass email or mailing list)');
  if (isReply) signals.push('REPLY — this is a reply in a conversation thread');
  if (isUserThread) signals.push('USER THREAD — the user has previously sent messages in this thread (someone is replying to them)');
  if (isList) signals.push('MAILING LIST — sent via a mailing list or newsletter');
  if (isBulkCC) signals.push('BULK CC — sent to many recipients');

  if (signals.length > 0) {
    prompt += `Delivery signals:\n`;
    for (const s of signals) {
      prompt += `- ${s}\n`;
    }
    prompt += '\n';
  }

  if (person) {
    prompt += `Sender is known:
- Name: ${person.name}
- Circle: ${person.circle}
- Closeness: ${person.closeness}/5
- Relationship: ${person.relationship}
`;
    if (person.care_notes) prompt += `- Current context: ${person.care_notes}\n`;
  } else {
    prompt += `Sender is NOT yet in the People Database — but this does NOT mean they're unimportant. Judge by the content and delivery signals above.\n`;
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
async function draft(userId: string, pipelineStartTime?: number): Promise<number> {
  let draftsGenerated = 0;
  const MAX_DRAFTS_PER_RUN = 5;
  // If we know when the pipeline started, bail before Vercel kills us
  const TIMEOUT_BUFFER_MS = 15_000; // stop 15s before hard limit
  const MAX_RUNTIME_MS = 55_000; // assume 60s max function duration

  // Get triaged but unprocessed messages that need a reply
  const { data: messages } = await supabaseAdmin
    .from('correspondent_messages')
    .select('*, people:person_id(*)')
    .eq('user_id', userId)
    .eq('processed', false)
    .not('triage_summary', 'is', null)
    .order('importance', { ascending: false })
    .order('urgency', { ascending: false });

  if (!messages || messages.length === 0) {
    console.log('[Draft] No triaged messages waiting for drafts');
    return 0;
  }

  console.log(`[Draft] Found ${messages.length} triaged messages, processing up to ${MAX_DRAFTS_PER_RUN}`);

  // First pass: mark no_reply messages as processed in bulk
  const noReplyIds: string[] = [];
  const toDraft: typeof messages = [];

  for (const message of messages) {
    const draftTier = determineDraftTier(message);
    if (draftTier === 'no_reply') {
      noReplyIds.push(message.id);
      console.log(`[Draft] ${message.sender_name || message.sender_email}: no_reply — skipping`);
    } else {
      toDraft.push(message);
    }
  }

  // Batch-skip no_reply messages
  if (noReplyIds.length > 0) {
    for (let i = 0; i < noReplyIds.length; i += 50) {
      await supabaseAdmin
        .from('correspondent_messages')
        .update({ processed: true })
        .in('id', noReplyIds.slice(i, i + 50));
    }
    console.log(`[Draft] Batch-skipped ${noReplyIds.length} no_reply messages`);
  }

  // Second pass: generate drafts for top messages (capped)
  const batch = toDraft.slice(0, MAX_DRAFTS_PER_RUN);
  console.log(`[Draft] Drafting ${batch.length} messages (${toDraft.length - batch.length} deferred to next run)`);

  for (const message of batch) {
    // Timeout guard: check if we're running out of time
    if (pipelineStartTime) {
      const elapsed = Date.now() - pipelineStartTime;
      if (elapsed > MAX_RUNTIME_MS - TIMEOUT_BUFFER_MS) {
        console.log(`[Draft] Timeout guard: ${elapsed}ms elapsed, stopping to preserve progress (${draftsGenerated} drafts saved)`);
        break;
      }
    }

    const person = message.people as Person | null;
    const draftTier = determineDraftTier(message);
    console.log(`[Draft] ${message.sender_name || message.sender_email}: tier=${draftTier} (u=${message.urgency} i=${message.importance})`);

    try {
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

        if (error) {
          console.error(`[Draft] Failed to save draft for ${message.sender_email}:`, error.message);
        } else {
          draftsGenerated++;
          console.log(`[Draft] Saved draft for ${message.sender_name || message.sender_email}`);
        }
      }

      // Mark message as processed immediately (preserves progress on timeout)
      await supabaseAdmin
        .from('correspondent_messages')
        .update({ processed: true })
        .eq('id', message.id);
    } catch (err) {
      console.error(`[Draft] Error drafting for ${message.sender_email}:`, err);
      // Still mark as processed to avoid infinite retry loops
      await supabaseAdmin
        .from('correspondent_messages')
        .update({ processed: true })
        .eq('id', message.id);
    }
  }

  // Assign queue positions (urgent+important first)
  await assignQueuePositions(userId);

  return draftsGenerated;
}

function determineDraftTier(message: any): DraftTier {
  const urgency = message.urgency || 0;
  const importance = message.importance || 0;
  let combined = urgency + importance;

  const labels = message.labels || [];
  const senderAuto = isAutomatedSender(message.sender_email || '');

  // Boost signals — check both synthetic labels AND sender patterns
  const isDirect = labels.includes('_DIRECT') || (!senderAuto && !labels.includes('_LIST'));
  const isReply = labels.includes('_REPLY') || (message.subject && /^(re|fwd|fw):/i.test(message.subject));
  const isUserThread = labels.includes('_USER_THREAD');
  const isList = labels.includes('_LIST') || senderAuto;

  // Direct personal email gets a boost
  if (isDirect && !isList) combined += 2;
  // Reply to user's own thread gets a strong boost
  if (isUserThread) combined += 3;
  // Any reply gets a small boost
  else if (isReply) combined += 1;

  // Check for no-reply signals
  const isAutomated = labels.includes('CATEGORY_UPDATES') ||
    labels.includes('CATEGORY_PROMOTIONS') ||
    labels.includes('CATEGORY_SOCIAL');

  // Mailing lists and automated messages need higher bar
  if (isList && combined < 10) return 'no_reply';
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

/** Extract a JSON object from text that may contain extra commentary */
function extractJSON(text: string): any | null {
  // Strip markdown code fences
  let cleaned = text.replace(/```json\n?|\n?```/g, '').trim();

  // Try parsing the whole thing first
  try {
    return JSON.parse(cleaned);
  } catch {
    // ignore
  }

  // Find the first { and its matching closing }
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.substring(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }

  return null;
}

/** Extract the plain-text email body from a draft, handling JSON or raw text */
function extractDraftBody(body: string): string {
  if (!body) return '';

  // If it looks like JSON, try to extract the body field
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
    const parsed = extractJSON(trimmed);
    if (parsed && parsed.body) {
      return parsed.body;
    }
  }

  // If body contains "body": " pattern, it's probably broken JSON in text
  const bodyMatch = body.match(/"body"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (bodyMatch) {
    return bodyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  return body;
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

  // Use current model IDs
  const model = draftTier === 'full_draft' ? 'claude-sonnet-4-5-20250929' : 'claude-haiku-4-5-20251001';
  const maxTokens = draftTier === 'full_draft' ? 2048 : 512;

  console.log(`[Draft] Calling ${model} for ${message.sender_name || message.sender_email} (${draftTier})`);

  const response = await getAnthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const resultText = response.content[0].type === 'text' ? response.content[0].text : '';
  console.log(`[Draft] Raw response (first 200 chars): ${resultText.substring(0, 200)}`);

  // Try to parse as JSON (handles extra text after JSON object)
  const parsed = extractJSON(resultText);

  if (parsed && parsed.body) {
    return {
      body: parsed.body,
      subject: parsed.subject || null,
      voice_notes: parsed.voice_notes || '',
      confidence: parsed.confidence || 0.5,
    };
  }

  // Fallback: if Claude returned plain text instead of JSON, use it directly
  // But strip any obvious JSON artifacts or meta-commentary
  const plainBody = resultText
    .replace(/```json\n?|\n?```/g, '')
    .replace(/^(Here'?s?|Note|I've|This)\s.*$/gm, '') // strip meta lines
    .trim();

  if (plainBody.length > 10) {
    console.log(`[Draft] JSON parse failed, using cleaned plain text`);
    return {
      body: plainBody,
      voice_notes: 'JSON parsing failed — used plain text fallback',
      confidence: 0.3,
    };
  }

  console.error(`[Draft] Could not extract usable draft from response`);
  return null;
}

function buildDraftSystemPrompt(voiceSamples: string[], draftTier: DraftTier, refinements: string[] = []): string {
  let prompt = `You are the Correspondent, a drafting agent that writes replies in the user's voice. You are ghostwriting as Lara — a real person, not an AI assistant.

CRITICAL RULES:
- Sound like a real human texting/emailing. NOT like ChatGPT.
- No "I hope this email finds you well." No "Thank you for reaching out." No "I wanted to follow up on..."
- No exclamation-point enthusiasm unless the voice samples show it.
- Never fabricate facts. If unsure, flag it with [VERIFY: ...].
- Be direct. Say what you mean. The user hates fluff.
- Match warmth to the relationship: casual and loving for family/close friends, straightforward for professional.
- When responding to a question, answer it. Don't restate it.
- Keep it short. Most emails should be 1-5 sentences.
`;

  if (draftTier === 'quick_reply') {
    prompt += `\nThis is a QUICK REPLY — 1-3 sentences max. Just the response, nothing extra.\n`;
  } else if (draftTier === 'full_draft') {
    prompt += `\nThis is a FULL DRAFT — address the key points in the message, but still keep it natural and concise. Don't pad it out.\n`;
  }

  // Include learned style refinements from the feedback loop
  if (refinements.length > 0) {
    prompt += `\nLEARNED STYLE RULES (from previous corrections — follow strictly):\n`;
    for (const r of refinements) {
      prompt += `- ${r}\n`;
    }
    prompt += '\n';
  }

  if (voiceSamples.length > 0) {
    prompt += `\nVOICE SAMPLES — this is how Lara actually writes. Match this voice exactly:\n`;
    prompt += '---\n';
    for (const sample of voiceSamples.slice(0, 5)) {
      prompt += sample.substring(0, 500) + '\n---\n';
    }
  } else {
    prompt += `\nNo voice samples available yet. Write in a natural, warm but concise tone. Think "how would a real person dash off this email" — not "how would a professional email template look."\n`;
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
  let prompt = `Draft a reply to this message as Lara.

FROM: ${message.sender_name || 'Unknown'} <${message.sender_email || ''}>
SUBJECT: ${message.subject || '(none)'}
RECEIVED: ${new Date(message.received_at).toLocaleDateString()}

RELATIONSHIP:
${relationshipContext}
`;

  if (threadContext) {
    prompt += `\nPREVIOUS MESSAGES IN THREAD:\n${threadContext}\n`;
  }

  prompt += `\nTHEIR MESSAGE:\n${message.body.substring(0, 3000)}\n`;

  prompt += `
IMPORTANT: Respond with ONLY a JSON object — no text before or after it. No markdown fences. Just the raw JSON.
{"body": "the actual email reply text", "subject": null, "voice_notes": "brief note on tone", "confidence": 0.8}

The "body" field should contain ONLY the email text that will be sent — no JSON, no metadata, no explanations. Write it exactly as it should appear in the recipient's inbox.`;

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

  // Extract clean body — handles case where body is stored as JSON string
  const rawBody = draft.edited_body || draft.body;
  const cleanBody = extractDraftBody(rawBody);

  // Send via the appropriate channel
  let sent = false;
  if (draft.channel === 'email' && message.sender_email) {
    const { sendEmail } = await import('./gmail');
    sent = await sendEmail(
      userId,
      message.sender_email,
      draft.subject || `Re: ${message.subject || ''}`,
      cleanBody,
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
      content: cleanBody,
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
// REPROCESS (retroactively fix labels and re-triage)
// ============================================================

/** Retroactively add synthetic labels to existing messages and re-triage them */
async function reprocessExisting(userId: string): Promise<number> {
  // Delete ALL existing drafts for this user in one query
  await supabaseAdmin
    .from('correspondent_drafts')
    .delete()
    .eq('user_id', userId);

  // Get ALL messages for this user
  const { data: messages } = await supabaseAdmin
    .from('correspondent_messages')
    .select('id, sender_email, labels, thread_id, subject')
    .eq('user_id', userId);

  if (!messages || messages.length === 0) return 0;

  // Build thread count map for _USER_THREAD detection
  const threadCounts = new Map<string, number>();
  for (const msg of messages) {
    if (msg.thread_id) {
      threadCounts.set(msg.thread_id, (threadCounts.get(msg.thread_id) || 0) + 1);
    }
  }

  // Classify messages into _LIST and _DIRECT groups
  const listIds: string[] = [];
  const directIds: string[] = [];
  const replyIds: string[] = [];
  const threadIds: string[] = [];

  for (const msg of messages) {
    const existingLabels: string[] = msg.labels || [];
    const gmailLabels = existingLabels.filter(l => !l.startsWith('_'));

    const senderIsAutomated = isAutomatedSender(msg.sender_email || '');
    const isGmailAutomated = gmailLabels.includes('CATEGORY_UPDATES') ||
      gmailLabels.includes('CATEGORY_PROMOTIONS') ||
      gmailLabels.includes('CATEGORY_SOCIAL');

    if (senderIsAutomated || isGmailAutomated) {
      listIds.push(msg.id);
    } else {
      directIds.push(msg.id);
    }

    if (msg.subject && /^(re|fwd|fw):/i.test(msg.subject)) {
      replyIds.push(msg.id);
    }

    if (msg.thread_id && (threadCounts.get(msg.thread_id) || 0) > 1) {
      threadIds.push(msg.id);
    }
  }

  // Batch reset ALL messages in one query
  await supabaseAdmin
    .from('correspondent_messages')
    .update({
      processed: false,
      urgency: 0,
      importance: 0,
      triage_summary: null,
    })
    .eq('user_id', userId);

  // For _LIST messages: mark as processed immediately (skip triage)
  if (listIds.length > 0) {
    // Supabase .in() has a limit, chunk if needed
    for (let i = 0; i < listIds.length; i += 50) {
      const chunk = listIds.slice(i, i + 50);
      await supabaseAdmin
        .from('correspondent_messages')
        .update({
          urgency: 0,
          importance: 0,
          triage_summary: 'Automated/list email — skipped',
          processed: true,
        })
        .in('id', chunk);
    }
  }

  // For the _DIRECT messages that remain: just leave them as processed=false
  // so triage picks them up. The labels don't need updating since triage
  // now checks sender patterns directly via buildTriagePrompt.
  // We only need to ensure they're not processed yet (already done above).

  return directIds.length;
}

// ============================================================
// MAIN PIPELINE
// ============================================================

/** Run the full Correspondent processing pipeline */
export async function runPipeline(userId: string, reprocess = false): Promise<CorrespondentRun> {
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
    const t0 = Date.now();

    // Re-queue any skipped drafts from yesterday
    await requeueSkipped(userId);

    // Reprocess existing messages if requested (retroactive label fix)
    if (reprocess) {
      const reprocessed = await reprocessExisting(userId);
      console.log(`[Pipeline] Reprocessed ${reprocessed} messages in ${Date.now() - t0}ms`);
    }

    // Stage 1: Ingest
    const t1 = Date.now();
    const ingestResult = await ingest(userId);
    const messagesIngested = ingestResult.ingested;
    console.log(`[Pipeline] Ingest: ${messagesIngested} new messages in ${Date.now() - t1}ms — ${ingestResult.debug}`);

    // Stage 2: Identify
    const t2 = Date.now();
    await identify(userId);
    console.log(`[Pipeline] Identify completed in ${Date.now() - t2}ms`);

    // Stage 3: Triage
    const t3 = Date.now();
    await triage(userId);
    console.log(`[Pipeline] Triage completed in ${Date.now() - t3}ms`);

    // Stage 4: Draft
    const t4 = Date.now();
    const draftsGenerated = await draft(userId, t0);
    console.log(`[Pipeline] Draft: ${draftsGenerated} drafts generated in ${Date.now() - t4}ms`);
    console.log(`[Pipeline] Total pipeline time: ${Date.now() - t0}ms`);

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
