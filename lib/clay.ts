/**
 * Clay Integration for the Envoy Agent
 *
 * Clay (clay.com) enriches people data — finding emails, roles, company info,
 * social profiles, and recent activity. The Envoy uses Clay in two ways:
 *
 * 1. IMPORT: Pull enriched candidates from Clay tables into Envoy pipelines.
 *    Run a Clay table that finds target people, then import them as candidates.
 *
 * 2. ENRICH: Before drafting outreach, enrich existing candidates with fresh
 *    data from Clay — current role, recent posts, mutual connections.
 *
 * Requires CLAY_API_KEY environment variable.
 * API docs: https://docs.clay.com/api
 */

import type { EnvoyCandidate, EnvoyPipeline } from '@/types';

const CLAY_API_BASE = 'https://api.clay.com/v1';

function getApiKey(): string | null {
  return process.env.CLAY_API_KEY || null;
}

function headers(): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('CLAY_API_KEY is not configured');
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// ============================================================
// Types
// ============================================================

export interface ClayPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  linkedin_url?: string;
  title?: string;
  company?: string;
  company_domain?: string;
  location?: string;
  bio?: string;
  twitter_handle?: string;
  recent_posts?: string[];
  mutual_connections?: string[];
  tags?: string[];
  // Clay tables can have custom columns — these come through as extra fields
  [key: string]: any;
}

export interface ClayTableRow {
  id: string;
  data: ClayPerson;
  created_at?: string;
  updated_at?: string;
}

export interface ClayTable {
  id: string;
  name: string;
  row_count: number;
}

export interface ClayEnrichmentResult {
  enriched: boolean;
  person: ClayPerson;
  confidence: number;
}

// ============================================================
// 1. IMPORT: Pull candidates from Clay tables
// ============================================================

/** List available Clay tables */
export async function listTables(): Promise<ClayTable[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  try {
    const response = await fetch(`${CLAY_API_BASE}/tables`, {
      headers: headers(),
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data.tables || data.data || []) as ClayTable[];
  } catch (error) {
    console.error('Clay listTables error:', error);
    return [];
  }
}

/** Fetch rows from a Clay table */
export async function getTableRows(
  tableId: string,
  limit: number = 100,
  offset: number = 0
): Promise<ClayTableRow[]> {
  try {
    const response = await fetch(
      `${CLAY_API_BASE}/tables/${tableId}/rows?limit=${limit}&offset=${offset}`,
      { headers: headers() }
    );

    if (!response.ok) return [];

    const data = await response.json();
    return (data.rows || data.data || []) as ClayTableRow[];
  } catch (error) {
    console.error('Clay getTableRows error:', error);
    return [];
  }
}

/** Map a Clay table row to an Envoy candidate */
export function mapClayToCandidate(
  row: ClayTableRow,
  pipeline: EnvoyPipeline,
  sourcePool: string,
  columnMapping?: ClayColumnMapping
): Omit<EnvoyCandidate, 'id' | 'user_id' | 'created_at' | 'updated_at'> {
  const d = row.data;
  const mapping = columnMapping || {};

  const name = d.full_name
    || [d.first_name, d.last_name].filter(Boolean).join(' ')
    || d[mapping.name_column || '']
    || 'Unknown';

  const sharedInterests: string[] = [];
  if (d.tags) sharedInterests.push(...d.tags);
  if (d.bio) {
    // Extract interests from bio keywords
    const interestKeywords = ['AI', 'agent', 'compliance', 'security', 'fermentation',
      'systems thinking', 'permaculture', 'MCP', 'Claude'];
    for (const keyword of interestKeywords) {
      if (d.bio.toLowerCase().includes(keyword.toLowerCase())) {
        sharedInterests.push(keyword);
      }
    }
  }

  return {
    name,
    email: d.email || d[mapping.email_column || ''] || undefined,
    role: d.title || d[mapping.role_column || ''] || undefined,
    organization: d.company || d[mapping.company_column || ''] || undefined,
    location: d.location || d[mapping.location_column || ''] || undefined,
    pipeline,
    source_pool: sourcePool,
    source_detail: `Imported from Clay table${d.linkedin_url ? ` — ${d.linkedin_url}` : ''}`,
    mutual_connections: d.mutual_connections || undefined,
    shared_interests: sharedInterests.length > 0 ? sharedInterests : undefined,
    their_work: d.bio || d[mapping.work_column || ''] || undefined,
    why_reach_out: d[mapping.why_column || ''] || undefined,
    what_you_can_offer: d[mapping.offer_column || ''] || undefined,
    warm_path: d.mutual_connections && d.mutual_connections.length > 0
      ? `Mutual: ${d.mutual_connections.slice(0, 3).join(', ')}`
      : undefined,
    status: 'suggested',
    priority: 3,
    outreach_count: 0,
    excluded: false,
    notes: d[mapping.notes_column || ''] || undefined,
  };
}

export interface ClayColumnMapping {
  name_column?: string;
  email_column?: string;
  role_column?: string;
  company_column?: string;
  location_column?: string;
  work_column?: string;
  why_column?: string;
  offer_column?: string;
  notes_column?: string;
}

/**
 * Import candidates from a Clay table into an Envoy pipeline.
 * Returns the number of candidates imported.
 */
export async function importFromTable(
  tableId: string,
  pipeline: EnvoyPipeline,
  sourcePool: string,
  columnMapping?: ClayColumnMapping,
  limit: number = 100
): Promise<{ candidates: Omit<EnvoyCandidate, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]; total: number }> {
  const rows = await getTableRows(tableId, limit);

  const candidates = rows
    .map(row => mapClayToCandidate(row, pipeline, sourcePool, columnMapping))
    .filter(c => c.name !== 'Unknown'); // skip rows without a name

  return { candidates, total: candidates.length };
}

// ============================================================
// 2. ENRICH: Enhance existing candidates with Clay data
// ============================================================

/** Enrich a person by email lookup */
export async function enrichByEmail(email: string): Promise<ClayEnrichmentResult | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${CLAY_API_BASE}/enrich/person`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      enriched: true,
      person: data.person || data.data || data,
      confidence: data.confidence || 0.8,
    };
  } catch (error) {
    console.error('Clay enrichByEmail error:', error);
    return null;
  }
}

/** Enrich a person by LinkedIn URL */
export async function enrichByLinkedIn(linkedinUrl: string): Promise<ClayEnrichmentResult | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${CLAY_API_BASE}/enrich/person`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ linkedin_url: linkedinUrl }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      enriched: true,
      person: data.person || data.data || data,
      confidence: data.confidence || 0.8,
    };
  } catch (error) {
    console.error('Clay enrichByLinkedIn error:', error);
    return null;
  }
}

/** Enrich a person by name + company */
export async function enrichByNameAndCompany(
  name: string,
  company: string
): Promise<ClayEnrichmentResult | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${CLAY_API_BASE}/enrich/person`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name, company }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      enriched: true,
      person: data.person || data.data || data,
      confidence: data.confidence || 0.6,
    };
  } catch (error) {
    console.error('Clay enrichByNameAndCompany error:', error);
    return null;
  }
}

/**
 * Enrich an Envoy candidate with Clay data.
 * Tries email first, then name+company.
 * Returns the enriched fields to merge into the candidate.
 */
export async function enrichCandidate(
  candidate: EnvoyCandidate
): Promise<Partial<EnvoyCandidate> | null> {
  let result: ClayEnrichmentResult | null = null;

  // Try email first (highest confidence)
  if (candidate.email) {
    result = await enrichByEmail(candidate.email);
  }

  // Fall back to name + company
  if (!result && candidate.name && candidate.organization) {
    result = await enrichByNameAndCompany(candidate.name, candidate.organization);
  }

  if (!result || !result.enriched) return null;

  const person = result.person;
  const updates: Partial<EnvoyCandidate> = {};

  // Only fill in fields that are currently empty
  if (!candidate.email && person.email) {
    updates.email = person.email;
  }
  if (!candidate.role && person.title) {
    updates.role = person.title;
  }
  if (!candidate.organization && person.company) {
    updates.organization = person.company;
  }
  if (!candidate.location && person.location) {
    updates.location = person.location;
  }
  if (!candidate.their_work && person.bio) {
    updates.their_work = person.bio;
  }
  if (person.mutual_connections && person.mutual_connections.length > 0) {
    const existing = new Set(candidate.mutual_connections || []);
    const merged = [...(candidate.mutual_connections || [])];
    for (const mc of person.mutual_connections) {
      if (!existing.has(mc)) merged.push(mc);
    }
    if (merged.length > (candidate.mutual_connections || []).length) {
      updates.mutual_connections = merged;
    }
  }

  // Build warm path from mutual connections if we don't have one
  if (!candidate.warm_path && person.mutual_connections && person.mutual_connections.length > 0) {
    updates.warm_path = `Mutual: ${person.mutual_connections.slice(0, 3).join(', ')}`;
  }

  // Add LinkedIn as source detail if we found it
  if (person.linkedin_url && !candidate.source_detail?.includes('linkedin')) {
    updates.source_detail = candidate.source_detail
      ? `${candidate.source_detail} | LinkedIn: ${person.linkedin_url}`
      : `LinkedIn: ${person.linkedin_url}`;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

// ============================================================
// 3. Availability check
// ============================================================

/** Check if Clay integration is configured and available */
export function isAvailable(): boolean {
  return !!getApiKey();
}
