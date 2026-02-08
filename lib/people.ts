import { supabaseAdmin } from './supabase';
import type {
  Person,
  InteractionLogEntry,
  Circle,
  IdealCadence,
  InteractionType,
  Sentiment,
} from '@/types';

// Default cadences by circle (in days)
const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  seasonal: 120,
  as_needed: 365,
};

// Default cadences by circle
const DEFAULT_CADENCE: Record<Circle, IdealCadence> = {
  family: 'weekly',
  neighbor: 'biweekly',
  friend: 'monthly',
  professional: 'as_needed',
  community: 'monthly',
  acquaintance: 'quarterly',
};

// Nudge threshold: 50% past ideal cadence
const NUDGE_THRESHOLD = 1.5;

// ============================================================
// CRUD Operations
// ============================================================

export async function createPerson(
  userId: string,
  data: Omit<Person, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<Person | null> {
  const { data: person, error } = await supabaseAdmin
    .from('people')
    .insert({ user_id: userId, ...data })
    .select()
    .single();

  if (error) {
    console.error('Failed to create person:', error);
    return null;
  }
  return person;
}

export async function updatePerson(
  personId: string,
  data: Partial<Omit<Person, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<Person | null> {
  const { data: person, error } = await supabaseAdmin
    .from('people')
    .update(data)
    .eq('id', personId)
    .select()
    .single();

  if (error) {
    console.error('Failed to update person:', error);
    return null;
  }
  return person;
}

export async function getPerson(personId: string): Promise<Person | null> {
  const { data, error } = await supabaseAdmin
    .from('people')
    .select('*')
    .eq('id', personId)
    .single();

  if (error) return null;
  return data;
}

export async function deletePerson(personId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('people')
    .delete()
    .eq('id', personId);

  return !error;
}

export async function getAllPeople(userId: string): Promise<Person[]> {
  const { data, error } = await supabaseAdmin
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .order('closeness', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to fetch people:', error);
    return [];
  }
  return data || [];
}

export async function getPeopleByCircle(userId: string, circle: Circle): Promise<Person[]> {
  const { data, error } = await supabaseAdmin
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .eq('circle', circle)
    .order('closeness', { ascending: true });

  if (error) return [];
  return data || [];
}

// ============================================================
// Lookup Operations (used by Correspondent)
// ============================================================

/** Find a person by email address */
export async function findPersonByEmail(userId: string, email: string): Promise<Person | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const { data, error } = await supabaseAdmin
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .contains('email', [normalizedEmail])
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

/** Find a person by name (fuzzy) */
export async function findPersonByName(userId: string, name: string): Promise<Person | null> {
  const { data, error } = await supabaseAdmin
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', `%${name}%`)
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

/** Find a person by phone number */
export async function findPersonByPhone(userId: string, phone: string): Promise<Person | null> {
  const digits = phone.replace(/\D/g, '');
  const { data, error } = await supabaseAdmin
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .contains('phone', [digits])
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

// ============================================================
// Care Practice: Nudge Logic
// ============================================================

/** Get people who are overdue for contact based on their cadence */
export async function getPeopleNeedingContact(userId: string): Promise<(Person & { days_overdue: number })[]> {
  const people = await getAllPeople(userId);
  const now = Date.now();
  const overdue: (Person & { days_overdue: number })[] = [];

  for (const person of people) {
    const cadence = person.ideal_cadence || DEFAULT_CADENCE[person.circle];
    const cadenceDays = CADENCE_DAYS[cadence] || 30;
    const nudgeAfterDays = cadenceDays * NUDGE_THRESHOLD;

    if (!person.last_contact) {
      // Never contacted — always overdue
      overdue.push({ ...person, days_overdue: nudgeAfterDays });
      continue;
    }

    const daysSince = (now - new Date(person.last_contact).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > nudgeAfterDays) {
      overdue.push({ ...person, days_overdue: Math.round(daysSince - cadenceDays) });
    }
  }

  // Sort by closeness first (innermost first), then by how overdue
  overdue.sort((a, b) => {
    if (a.closeness !== b.closeness) return a.closeness - b.closeness;
    return b.days_overdue - a.days_overdue;
  });

  return overdue;
}

/** Get upcoming touchpoints in the next N days */
export async function getUpcomingTouchpoints(userId: string, days: number = 14): Promise<Person[]> {
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + days);

  const { data, error } = await supabaseAdmin
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .not('touchpoint_date', 'is', null)
    .gte('touchpoint_date', today.toISOString().split('T')[0])
    .lte('touchpoint_date', future.toISOString().split('T')[0])
    .order('touchpoint_date', { ascending: true });

  if (error) return [];
  return data || [];
}

// ============================================================
// Interaction Log
// ============================================================

export async function logInteraction(
  userId: string,
  data: Omit<InteractionLogEntry, 'id' | 'user_id' | 'created_at'>
): Promise<InteractionLogEntry | null> {
  const { data: entry, error } = await supabaseAdmin
    .from('interaction_log')
    .insert({ user_id: userId, ...data })
    .select()
    .single();

  if (error) {
    console.error('Failed to log interaction:', error);
    return null;
  }

  // Also update last_contact on the person record
  const contactMethod = data.type === 'email_sent' || data.type === 'email_received'
    ? 'email'
    : data.type === 'text'
    ? 'text'
    : data.type === 'call'
    ? 'phone_call'
    : data.type;

  await supabaseAdmin
    .from('people')
    .update({
      last_contact: data.date,
      contact_method: contactMethod,
    })
    .eq('id', data.person_id);

  return entry;
}

export async function getInteractionHistory(
  personId: string,
  limit: number = 20
): Promise<InteractionLogEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('interaction_log')
    .select('*')
    .eq('person_id', personId)
    .order('date', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data || [];
}

// ============================================================
// Relationship Context (for Correspondent drafting)
// ============================================================

/** Build a rich context string about a person for use in draft generation */
export async function buildRelationshipContext(person: Person): Promise<string> {
  const recentInteractions = await getInteractionHistory(person.id, 5);

  let context = `Name: ${person.name}`;
  if (person.nickname) context += ` (${person.nickname})`;
  context += `\nRelationship: ${person.relationship}`;
  context += `\nCircle: ${person.circle} (closeness ${person.closeness}/5)`;

  if (person.communication_style) {
    context += `\nCommunication style: ${person.communication_style}`;
  }

  if (person.care_notes) {
    context += `\nCurrent context: ${person.care_notes}`;
  }

  if (person.occupation) {
    context += `\nOccupation: ${person.occupation}`;
  }

  if (person.interests && person.interests.length > 0) {
    context += `\nInterests: ${person.interests.join(', ')}`;
  }

  if (person.location) {
    context += `\nLocation: ${person.location}`;
  }

  if (person.next_touchpoint) {
    context += `\nUpcoming: ${person.next_touchpoint}`;
    if (person.touchpoint_date) {
      context += ` (${person.touchpoint_date})`;
    }
  }

  if (person.last_contact) {
    const daysSince = Math.floor(
      (Date.now() - new Date(person.last_contact).getTime()) / (1000 * 60 * 60 * 24)
    );
    context += `\nLast contact: ${daysSince} days ago via ${person.contact_method || 'unknown'}`;
  }

  if (recentInteractions.length > 0) {
    context += '\nRecent interactions:';
    for (const interaction of recentInteractions) {
      const date = new Date(interaction.date).toLocaleDateString();
      context += `\n  - ${date}: ${interaction.type}`;
      if (interaction.summary) context += ` — ${interaction.summary}`;
    }
  }

  return context;
}
