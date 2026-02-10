import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabase';
import { createPerson, findPersonByEmail } from '@/lib/people';

/**
 * POST /api/people/auto-populate
 * Scan ingested emails to discover and create People Database entries.
 * Uses Claude to infer relationship details from email patterns.
 *
 * GET /api/people/auto-populate?preview=true
 * Preview discovered senders without creating records.
 */

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _anthropic;
}

interface SenderSummary {
  email: string;
  name: string;
  subjects: string[];
  messageCount: number;
  latestDate: string;
  hasReply: boolean;
  isDirect: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const preview = searchParams.get('preview') === 'true';

    const senders = await discoverSenders(userId);

    if (preview || true) {
      return NextResponse.json({
        discovered: senders.length,
        senders: senders.map(s => ({
          name: s.name,
          email: s.email,
          messages: s.messageCount,
          subjects: s.subjects.slice(0, 3),
          latest: s.latestDate,
          direct: s.isDirect,
          reply: s.hasReply,
        })),
      });
    }
  } catch (error) {
    console.error('Auto-populate preview error:', error);
    return NextResponse.json({ error: 'Failed to preview' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json().catch(() => ({}));
    const limit = body?.limit || 20;

    // Discover unique senders from _DIRECT messages
    const senders = await discoverSenders(userId);

    if (senders.length === 0) {
      return NextResponse.json({ created: 0, message: 'No new senders found' });
    }

    // Use Claude to classify senders in batches
    const batch = senders.slice(0, limit);
    const classifications = await classifySenders(batch);

    // Create people records
    let created = 0;
    const results: { name: string; email: string; circle: string; status: string }[] = [];

    for (const classification of classifications) {
      // Skip if classification says to ignore
      if (classification.skip) {
        results.push({
          name: classification.name,
          email: classification.email,
          circle: 'skipped',
          status: 'skipped — automated/commercial sender',
        });
        continue;
      }

      try {
        const person = await createPerson(userId, {
          name: classification.name,
          email: [classification.email],
          circle: classification.circle,
          closeness: classification.closeness,
          relationship: classification.relationship,
          notes: classification.notes,
          last_contact: classification.latestDate,
          contact_method: 'email',
          ideal_cadence: classification.cadence,
        } as any);

        if (person) {
          created++;
          results.push({
            name: classification.name,
            email: classification.email,
            circle: classification.circle,
            status: 'created',
          });
        } else {
          results.push({
            name: classification.name,
            email: classification.email,
            circle: classification.circle,
            status: 'failed to create',
          });
        }
      } catch (err: any) {
        results.push({
          name: classification.name,
          email: classification.email,
          circle: classification.circle || 'unknown',
          status: `error: ${err.message}`,
        });
      }
    }

    return NextResponse.json({
      created,
      total_discovered: senders.length,
      processed: batch.length,
      results,
    });
  } catch (error) {
    console.error('Auto-populate error:', error);
    return NextResponse.json({ error: 'Failed to auto-populate' }, { status: 500 });
  }
}

/** Find unique real senders from _DIRECT messages not already in People DB */
async function discoverSenders(userId: string): Promise<SenderSummary[]> {
  // Get all _DIRECT messages
  const { data: messages } = await supabaseAdmin
    .from('correspondent_messages')
    .select('sender_email, sender_name, subject, labels, received_at')
    .eq('user_id', userId)
    .order('received_at', { ascending: false });

  if (!messages || messages.length === 0) return [];

  // Group by sender email
  const senderMap = new Map<string, SenderSummary>();

  for (const msg of messages) {
    if (!msg.sender_email) continue;
    const email = msg.sender_email.toLowerCase();
    const labels: string[] = msg.labels || [];

    // Only consider _DIRECT messages
    if (!labels.includes('_DIRECT')) continue;

    if (!senderMap.has(email)) {
      senderMap.set(email, {
        email,
        name: msg.sender_name || '',
        subjects: [],
        messageCount: 0,
        latestDate: msg.received_at,
        hasReply: false,
        isDirect: true,
      });
    }

    const sender = senderMap.get(email)!;
    sender.messageCount++;
    if (msg.subject) sender.subjects.push(msg.subject);
    if (labels.includes('_REPLY')) sender.hasReply = true;
    if (msg.sender_name && !sender.name) sender.name = msg.sender_name;
  }

  // Filter out senders already in People DB
  const results: SenderSummary[] = [];
  for (const sender of senderMap.values()) {
    // Skip the user's own email
    if (sender.email.includes('laramckinneymossler') || sender.email.includes('laramossler')) continue;

    const existing = await findPersonByEmail(userId, sender.email);
    if (!existing) {
      results.push(sender);
    }
  }

  // Sort by message count descending (most frequent senders first)
  results.sort((a, b) => b.messageCount - a.messageCount);

  return results;
}

interface SenderClassification {
  name: string;
  email: string;
  circle: 'family' | 'neighbor' | 'friend' | 'professional' | 'community' | 'acquaintance';
  closeness: 1 | 2 | 3 | 4 | 5;
  relationship: string;
  notes: string;
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'seasonal' | 'as_needed';
  latestDate: string;
  skip: boolean;
}

/** Use Claude to classify a batch of senders into People Database entries */
async function classifySenders(senders: SenderSummary[]): Promise<SenderClassification[]> {
  const senderDescriptions = senders.map((s, i) =>
    `${i + 1}. "${s.name}" <${s.email}> — ${s.messageCount} message(s)
   Subjects: ${s.subjects.slice(0, 5).join('; ')}
   Latest: ${s.latestDate}
   Is reply thread: ${s.hasReply}`
  ).join('\n\n');

  const prompt = `You are helping build a People Database for a personal correspondence system. The user is Lara McKinney Mossler. Based on the email senders below, classify each person.

For each sender, determine:
- name: Their display name (clean it up if needed)
- circle: One of: family, neighbor, friend, professional, community, acquaintance
- closeness: 1-5 (5 = closest, 1 = most distant)
- relationship: Brief label like "mother", "contractor", "friend from college", "real estate agent", etc.
- notes: Brief context from the email subjects about what they communicate about
- cadence: How often this person likely expects contact: weekly, biweekly, monthly, quarterly, seasonal, as_needed
- skip: true if this is clearly a business/automated sender that slipped through (e.g., "office@company.com" for a generic business, marketing sender)

Clues for classifying:
- Shared last names likely = family
- @centrahealth.com, @somecompany.com with a human name = professional or friend depending on tone
- "Re: Pump House" type subjects = contractor/professional working on a project
- Personal, emotional subjects = close friend or family
- Generic business addresses (office@, info@, hello@) = likely skip unless clearly a specific person

SENDERS:
${senderDescriptions}

Respond with ONLY a JSON array:
[
  {
    "index": 1,
    "name": "Clean Name",
    "email": "their@email.com",
    "circle": "family|neighbor|friend|professional|community|acquaintance",
    "closeness": 1-5,
    "relationship": "brief label",
    "notes": "context from subjects",
    "cadence": "monthly",
    "skip": false
  },
  ...
]`;

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const resultText = response.content[0].type === 'text' ? response.content[0].text : '[]';

  try {
    const parsed = JSON.parse(
      resultText.replace(/```json\n?|\n?```/g, '').trim()
    );

    return parsed.map((p: any) => ({
      name: p.name || senders[p.index - 1]?.name || 'Unknown',
      email: p.email || senders[p.index - 1]?.email || '',
      circle: p.circle || 'acquaintance',
      closeness: Math.min(5, Math.max(1, p.closeness || 3)) as 1 | 2 | 3 | 4 | 5,
      relationship: p.relationship || 'contact',
      notes: p.notes || '',
      cadence: p.cadence || 'as_needed',
      latestDate: senders[p.index - 1]?.latestDate || new Date().toISOString(),
      skip: p.skip || false,
    }));
  } catch {
    // Fallback: create basic entries without AI classification
    return senders.map(s => ({
      name: s.name || 'Unknown',
      email: s.email,
      circle: 'acquaintance' as const,
      closeness: 3 as const,
      relationship: 'contact',
      notes: `Subjects: ${s.subjects.slice(0, 3).join(', ')}`,
      cadence: 'as_needed' as const,
      latestDate: s.latestDate,
      skip: false,
    }));
  }
}
