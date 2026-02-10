import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabase';
import type { DebriefEntry, DebriefCategoryItem, EnergyReading } from '@/types';

/**
 * POST /api/debrief
 * Submit an evening debrief entry. The Chronicler categorizes it and
 * extracts an energy reading for the day.
 *
 * GET /api/debrief
 * Get recent debrief entries.
 *
 * GET /api/debrief?date=2026-02-10
 * Get a specific day's debrief.
 */

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _anthropic;
}

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (date) {
      const { data, error } = await supabaseAdmin
        .from('debrief_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ entry: data });
    }

    // Recent entries (last 14 days)
    const { data, error } = await supabaseAdmin
      .from('debrief_entries')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(14);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entries: data || [] });
  } catch (error) {
    console.error('Debrief GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch debriefs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();
    const { entry, date } = body;

    if (!entry || typeof entry !== 'string' || entry.trim().length === 0) {
      return NextResponse.json({ error: 'entry is required' }, { status: 400 });
    }

    const debriefDate = date || new Date().toISOString().split('T')[0];

    // Get context for the Chronicler
    const todayContext = await getTodayContext(userId, debriefDate);

    // Ask Claude to categorize and extract energy
    const result = await analyzeDebrief(entry, todayContext);

    // Also log as daily energy
    await supabaseAdmin.from('daily_energy').upsert({
      user_id: userId,
      log_date: debriefDate,
      narrative: entry,
      colleagues_pct: result.energy.colleagues_pct,
      airbnb_pct: result.energy.airbnb_pct,
      forest_pct: result.energy.forest_pct,
      personal_pct: result.energy.personal_pct,
      other_pct: result.energy.other_pct,
    }, { onConflict: 'user_id,log_date' });

    // Save debrief entry
    const { data: saved, error } = await supabaseAdmin
      .from('debrief_entries')
      .upsert({
        user_id: userId,
        date: debriefDate,
        raw_entry: entry,
        categories: result.categories,
        energy_reading: result.energy,
        chronicler_note: result.chroniclerNote,
      }, { onConflict: 'user_id,date' })
      .select()
      .maybeSingle();

    if (error) {
      console.error('Debrief save error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      entry: saved,
      categories: result.categories,
      energy: result.energy,
      chronicler_note: result.chroniclerNote,
    });
  } catch (error) {
    console.error('Debrief POST error:', error);
    return NextResponse.json({ error: 'Failed to process debrief' }, { status: 500 });
  }
}

async function getTodayContext(userId: string, date: string): Promise<string> {
  const parts: string[] = [];

  // Get today's correspondent activity
  const { data: runs } = await supabaseAdmin
    .from('correspondent_runs')
    .select('messages_ingested, drafts_generated, completed_at')
    .eq('user_id', userId)
    .gte('started_at', `${date}T00:00:00`)
    .lte('started_at', `${date}T23:59:59`)
    .order('started_at', { ascending: false })
    .limit(1);

  if (runs && runs.length > 0) {
    const run = runs[0];
    parts.push(`Today's correspondence: ${run.messages_ingested} messages processed, ${run.drafts_generated} drafts generated.`);
  }

  // Get sent drafts today
  const { data: sentDrafts } = await supabaseAdmin
    .from('correspondent_drafts')
    .select('subject, correspondent_messages!inner(sender_name)')
    .eq('user_id', userId)
    .eq('status', 'sent')
    .gte('sent_at', `${date}T00:00:00`)
    .lte('sent_at', `${date}T23:59:59`);

  if (sentDrafts && sentDrafts.length > 0) {
    const people = sentDrafts.map(d => {
      const msg = d.correspondent_messages as any;
      return msg?.sender_name || 'someone';
    });
    parts.push(`Replied to: ${people.join(', ')}.`);
  }

  return parts.join('\n') || 'No correspondence data for today.';
}

interface AnalysisResult {
  categories: DebriefCategoryItem[];
  energy: EnergyReading;
  chroniclerNote: string;
}

async function analyzeDebrief(entry: string, context: string): Promise<AnalysisResult> {
  const prompt = `You are the Chronicler — the evening reflection agent for Edgelands. The user is sharing what happened today. Your job:

1. CATEGORIZE: Sort the entry into these categories (only include ones that apply):
   - land: Property, house, pump house, construction, maintenance, rural life
   - garden: Plants, forest, outdoor work, nature, land stewardship
   - people: Relationships, conversations, visits, social interactions, correspondence
   - work: Professional tasks, meetings, projects, client work, design, product
   - body: Exercise, health, rest, food, physical wellbeing
   - creative: Art, writing, music, making things, inspiration
   - insights: Realizations, reflections, ideas, emotional processing, gratitude

2. ENERGY READING: Estimate where the user's energy went today as percentages:
   - colleagues_pct: Work with colleagues, professional collaboration
   - airbnb_pct: Airbnb/property/hosting
   - forest_pct: Land, garden, forest, outdoor stewardship
   - personal_pct: Personal care, relationships, creative, rest
   - other_pct: Everything else
   These must sum to 100.

3. CHRONICLER NOTE: Write 1-2 sentences reflecting back what you notice about the day — a warm, observant note. Not advice, just acknowledgment. Sound like a thoughtful friend who's been paying attention.

Context from today:
${context}

The user wrote:
"${entry}"

Respond with ONLY a JSON object:
{
  "categories": [
    { "category": "land", "items": ["Fixed the pump house door", "Called Brad about ceiling"] },
    { "category": "people", "items": ["Had coffee with Kerry"] }
  ],
  "energy": {
    "colleagues_pct": 20,
    "airbnb_pct": 10,
    "forest_pct": 30,
    "personal_pct": 35,
    "other_pct": 5,
    "narrative": "A day split between property work and personal connection."
  },
  "chronicler_note": "You gave the land a lot of attention today, and it sounds like Kerry's visit was the kind of nourishment that doesn't show up in a to-do list."
}`;

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';

  try {
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
    return {
      categories: parsed.categories || [],
      energy: {
        colleagues_pct: parsed.energy?.colleagues_pct || 0,
        airbnb_pct: parsed.energy?.airbnb_pct || 0,
        forest_pct: parsed.energy?.forest_pct || 0,
        personal_pct: parsed.energy?.personal_pct || 0,
        other_pct: parsed.energy?.other_pct || 0,
        narrative: parsed.energy?.narrative || '',
      },
      chroniclerNote: parsed.chronicler_note || 'The record is kept.',
    };
  } catch {
    return {
      categories: [{ category: 'insights', items: [entry.substring(0, 200)] }],
      energy: {
        colleagues_pct: 20, airbnb_pct: 20, forest_pct: 20,
        personal_pct: 20, other_pct: 20,
        narrative: 'Unable to parse energy — defaulting to even split.',
      },
      chroniclerNote: 'The record is kept.',
    };
  }
}
