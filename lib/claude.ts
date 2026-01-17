import Anthropic from '@anthropic-ai/sdk';
import { getContextSnapshot } from './supabase';
import type { ContextSnapshot, Message, Action, EnergyBreakdown } from '@/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Build system prompt with context
function buildSystemPrompt(context: ContextSnapshot): string {
  const { currentWeekEnergy, activeProjects, relationships, recentIntegrations, activeDecisions, weeklyNonNegotiables } = context;

  let prompt = `You are Edgelands, Lara's life operating system. You help her manage energy allocation, projects, relationships, and decisions across multiple life domains.

CURRENT CONTEXT:

`;

  // Current week energy
  if (currentWeekEnergy) {
    prompt += `**This Week's Planned Energy Allocation:**
- Colleagues: ${currentWeekEnergy.colleagues_pct}%
- Airbnb: ${currentWeekEnergy.airbnb_pct}%
- Forest: ${currentWeekEnergy.forest_pct}%
- Personal: ${currentWeekEnergy.personal_pct}%
- Other: ${currentWeekEnergy.other_pct}%
${currentWeekEnergy.notes ? `Notes: ${currentWeekEnergy.notes}` : ''}

`;
  } else {
    prompt += `**This Week's Energy:** No planned allocation set yet.

`;
  }

  // Active projects
  if (activeProjects && activeProjects.length > 0) {
    prompt += `**Active Projects (${activeProjects.length}):**
${activeProjects.map(p => `- ${p.name} (${p.domain || 'no domain'})${p.description ? `: ${p.description}` : ''}`).join('\n')}

`;
  } else {
    prompt += `**Active Projects:** None currently active.

`;
  }

  // Relationships needing contact
  if (relationships && relationships.length > 0) {
    const needsContact = relationships.filter(r => {
      if (!r.last_contact_date) return true;
      const daysSinceContact = Math.floor((Date.now() - new Date(r.last_contact_date).getTime()) / (1000 * 60 * 60 * 24));
      if (r.tier === 1 && daysSinceContact > 7) return true;
      if (r.tier === 2 && daysSinceContact > 14) return true;
      return false;
    });

    if (needsContact.length > 0) {
      prompt += `**Relationships Needing Contact:**
${needsContact.map(r => {
  const daysSince = r.last_contact_date
    ? Math.floor((Date.now() - new Date(r.last_contact_date).getTime()) / (1000 * 60 * 60 * 24))
    : 'never';
  return `- ${r.name} (Tier ${r.tier}) - Last contact: ${daysSince === 'never' ? 'never' : `${daysSince} days ago`}`;
}).join('\n')}

`;
    }
  }

  // Active decisions
  if (activeDecisions && activeDecisions.length > 0) {
    prompt += `**Active Decisions:**
${activeDecisions.map(d => `- ${d.title} (${d.type})${d.deadline ? ` - Deadline: ${d.deadline}` : ''}`).join('\n')}

`;
  }

  // Weekly non-negotiables
  if (weeklyNonNegotiables && weeklyNonNegotiables.length > 0) {
    prompt += `**This Week's Non-Negotiables:**
${weeklyNonNegotiables.map(n => `- [${n.completed ? 'x' : ' '}] ${n.task} (${n.domain})`).join('\n')}

`;
  }

  // Recent integrations/insights
  if (recentIntegrations && recentIntegrations.length > 0) {
    prompt += `**Recent Insights (last ${recentIntegrations.length}):**
${recentIntegrations.slice(0, 5).map(i => `- ${i.content.substring(0, 100)}${i.content.length > 100 ? '...' : ''}`).join('\n')}

`;
  }

  prompt += `
CAPABILITIES:
You can help Lara with:
1. **Energy logging**: Parse natural language like "Today was 60% Colleagues, 40% Airbnb" into structured data
2. **Project management**: Update project states (active/glacier/compost), create new projects
3. **Insight capture**: Extract and tag insights from conversations
4. **Relationship tracking**: Update last contact dates when mentioned
5. **Planning**: Set weekly non-negotiables, create decisions/forcing functions
6. **Analysis**: Provide pattern observations and recommendations

When Lara describes her day or week, extract actionable data and respond conversationally while maintaining awareness of her goals and patterns.

RESPONSE FORMAT:
Respond naturally and conversationally. If you need to take actions (logging energy, updating projects, etc.), include them in your response using this JSON format at the end:

ACTIONS:
\`\`\`json
[
  {
    "type": "log_energy",
    "data": {
      "log_date": "2024-01-15",
      "colleagues_pct": 60,
      "airbnb_pct": 40,
      "forest_pct": 0,
      "personal_pct": 0,
      "other_pct": 0,
      "narrative": "user's description"
    }
  }
]
\`\`\`

Available action types:
- log_energy: { log_date, colleagues_pct, airbnb_pct, forest_pct, personal_pct, other_pct, narrative }
- update_project: { project_id, state } // state: active, glacier, compost
- create_project: { name, state, domain, description }
- log_insight: { content, tags, source }
- update_relationship: { relationship_id, last_contact_date }
- set_non_negotiable: { week_start, domain, task }
- create_decision: { type, title, description, deadline, status }

Be proactive but not overwhelming. Focus on helping Lara maintain awareness and intentionality across her life domains.
`;

  return prompt;
}

// Parse actions from Claude's response
function parseActions(response: string): Action[] {
  const actionsMatch = response.match(/ACTIONS:\s*```json\s*([\s\S]*?)\s*```/);
  if (!actionsMatch) return [];

  try {
    return JSON.parse(actionsMatch[1]);
  } catch (e) {
    console.error('Failed to parse actions:', e);
    return [];
  }
}

// Clean response (remove actions section for display)
function cleanResponse(response: string): string {
  return response.replace(/ACTIONS:\s*```json\s*[\s\S]*?\s*```/, '').trim();
}

// Main Claude API call
export async function chatWithClaude(
  userId: string,
  message: string,
  conversationHistory: Message[] = []
): Promise<{ reply: string; actions: Action[] }> {
  // Get current context
  const context = await getContextSnapshot(userId);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(context);

  // Build messages array
  const messages = [
    ...conversationHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    {
      role: 'user' as const,
      content: message,
    },
  ];

  // Call Claude API
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  });

  const fullResponse = response.content[0].type === 'text' ? response.content[0].text : '';

  // Parse actions
  const actions = parseActions(fullResponse);

  // Clean response for display
  const reply = cleanResponse(fullResponse);

  return { reply, actions };
}

// Parse natural language energy description into structured data
export async function parseEnergyNarrative(narrative: string): Promise<EnergyBreakdown> {
  const prompt = `Parse this energy description into percentages for: colleagues, airbnb, forest, personal, other.
The percentages should add up to 100%.

Description: "${narrative}"

Respond with ONLY a JSON object in this exact format:
{
  "colleagues_pct": 0,
  "airbnb_pct": 0,
  "forest_pct": 0,
  "personal_pct": 0,
  "other_pct": 0
}`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const result = response.content[0].type === 'text' ? response.content[0].text : '{}';

  try {
    const parsed = JSON.parse(result.replace(/```json\n?|\n?```/g, '').trim());
    return parsed;
  } catch (e) {
    console.error('Failed to parse energy:', e);
    return {
      colleagues_pct: 0,
      airbnb_pct: 0,
      forest_pct: 0,
      personal_pct: 0,
      other_pct: 100,
    };
  }
}

// Analyze voice memo transcript for insights
export async function analyzeVoiceMemo(transcript: string): Promise<{ content: string; tags: string[] }> {
  const prompt = `Analyze this voice memo transcript and extract:
1. The main insight or content (1-2 sentences)
2. Relevant tags from: cross-pollination, newsletter-seed, colleagues-insight, airbnb-insight, forest-insight, personal-insight, decision, relationship

Transcript: "${transcript}"

Respond with ONLY a JSON object:
{
  "content": "the main insight",
  "tags": ["tag1", "tag2"]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const result = response.content[0].type === 'text' ? response.content[0].text : '{}';

  try {
    const parsed = JSON.parse(result.replace(/```json\n?|\n?```/g, '').trim());
    return parsed;
  } catch (e) {
    console.error('Failed to analyze voice memo:', e);
    return {
      content: transcript.substring(0, 200),
      tags: [],
    };
  }
}
