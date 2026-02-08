import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  EnergyAllocation,
  DailyEnergy,
  Project,
  Integration,
  Relationship,
  Decision,
  Conversation,
  WeeklyNonNegotiable,
  NotificationPreference,
  ContextSnapshot,
} from '@/types';

// Lazy-initialized clients to avoid build-time crashes when env vars are missing
let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

// Client-side Supabase client
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabase) {
      _supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
    }
    return (_supabase as any)[prop];
  },
});

// Server-side Supabase client with service role (bypasses RLS)
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabaseAdmin) {
      _supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
    }
    return (_supabaseAdmin as any)[prop];
  },
});

// Helper to get current week start (Monday)
export function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

// Get context snapshot for Claude
export async function getContextSnapshot(userId: string): Promise<ContextSnapshot> {
  const weekStart = getCurrentWeekStart();

  // Fetch current week energy allocation
  const { data: currentWeekEnergy } = await supabaseAdmin
    .from('energy_allocations')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .eq('allocation_type', 'planned')
    .single();

  // Fetch active projects
  const { data: activeProjects } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .eq('state', 'active')
    .order('updated_at', { ascending: false });

  // Fetch relationships needing contact
  const { data: relationships } = await supabaseAdmin
    .from('relationships')
    .select('*')
    .eq('user_id', userId)
    .order('tier', { ascending: true });

  // Fetch recent integrations (last 10)
  const { data: recentIntegrations } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  // Fetch active decisions
  const { data: activeDecisions } = await supabaseAdmin
    .from('decisions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('deadline', { ascending: true });

  // Fetch weekly non-negotiables
  const { data: weeklyNonNegotiables } = await supabaseAdmin
    .from('weekly_nonnegotiables')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart);

  return {
    currentWeekEnergy: currentWeekEnergy || undefined,
    activeProjects: activeProjects || [],
    relationships: relationships || [],
    recentIntegrations: recentIntegrations || [],
    activeDecisions: activeDecisions || [],
    weeklyNonNegotiables: weeklyNonNegotiables || [],
  };
}

// Get relationships needing contact
export async function getRelationshipsNeedingContact(userId: string): Promise<Relationship[]> {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setDate(today.getDate() - 14);

  const { data: relationships } = await supabaseAdmin
    .from('relationships')
    .select('*')
    .eq('user_id', userId)
    .or(
      `and(tier.eq.1,last_contact_date.lt.${sevenDaysAgo.toISOString().split('T')[0]}),` +
      `and(tier.eq.2,last_contact_date.lt.${fourteenDaysAgo.toISOString().split('T')[0]})`
    );

  return relationships || [];
}

// Get weekly energy summary (planned vs actual)
export async function getWeeklyEnergySummary(userId: string, weekStart: string) {
  // Get planned allocation
  const { data: planned } = await supabaseAdmin
    .from('energy_allocations')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .eq('allocation_type', 'planned')
    .single();

  // Get daily energy logs for the week
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const { data: dailyLogs } = await supabaseAdmin
    .from('daily_energy')
    .select('*')
    .eq('user_id', userId)
    .gte('log_date', weekStart)
    .lte('log_date', weekEnd.toISOString().split('T')[0]);

  // Calculate average actual allocation
  let actual = {
    colleagues_pct: 0,
    airbnb_pct: 0,
    forest_pct: 0,
    personal_pct: 0,
    other_pct: 0,
  };

  if (dailyLogs && dailyLogs.length > 0) {
    const sum = dailyLogs.reduce(
      (acc, log) => ({
        colleagues_pct: acc.colleagues_pct + (log.colleagues_pct || 0),
        airbnb_pct: acc.airbnb_pct + (log.airbnb_pct || 0),
        forest_pct: acc.forest_pct + (log.forest_pct || 0),
        personal_pct: acc.personal_pct + (log.personal_pct || 0),
        other_pct: acc.other_pct + (log.other_pct || 0),
      }),
      actual
    );

    actual = {
      colleagues_pct: Math.round(sum.colleagues_pct / dailyLogs.length),
      airbnb_pct: Math.round(sum.airbnb_pct / dailyLogs.length),
      forest_pct: Math.round(sum.forest_pct / dailyLogs.length),
      personal_pct: Math.round(sum.personal_pct / dailyLogs.length),
      other_pct: Math.round(sum.other_pct / dailyLogs.length),
    };
  }

  return {
    planned,
    actual,
    dailyLogsCount: dailyLogs?.length || 0,
  };
}

// Get next forcing function or decision deadline
export async function getNextDeadline(userId: string): Promise<Decision | null> {
  const today = new Date().toISOString().split('T')[0];

  const { data } = await supabaseAdmin
    .from('decisions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gte('deadline', today)
    .order('deadline', { ascending: true })
    .limit(1)
    .single();

  return data || null;
}

// Database operations
export const db = {
  // Energy operations
  async logDailyEnergy(userId: string, data: Omit<DailyEnergy, 'id' | 'user_id' | 'created_at'>) {
    return supabaseAdmin.from('daily_energy').insert({
      user_id: userId,
      ...data,
    });
  },

  async createEnergyAllocation(userId: string, data: Omit<EnergyAllocation, 'id' | 'user_id' | 'created_at'>) {
    return supabaseAdmin.from('energy_allocations').insert({
      user_id: userId,
      ...data,
    });
  },

  // Project operations
  async updateProjectState(projectId: string, state: Project['state']) {
    return supabaseAdmin
      .from('projects')
      .update({ state, state_changed_at: new Date().toISOString() })
      .eq('id', projectId);
  },

  async createProject(userId: string, data: Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>) {
    return supabaseAdmin.from('projects').insert({
      user_id: userId,
      ...data,
    });
  },

  // Integration operations
  async createIntegration(userId: string, data: Omit<Integration, 'id' | 'user_id' | 'created_at'>) {
    return supabaseAdmin.from('integrations').insert({
      user_id: userId,
      ...data,
    }).select();
  },

  // Relationship operations
  async updateRelationshipContact(relationshipId: string, contactDate: string) {
    return supabaseAdmin
      .from('relationships')
      .update({ last_contact_date: contactDate })
      .eq('id', relationshipId);
  },

  // Decision operations
  async createDecision(userId: string, data: Omit<Decision, 'id' | 'user_id' | 'created_at' | 'updated_at'>) {
    return supabaseAdmin.from('decisions').insert({
      user_id: userId,
      ...data,
    });
  },

  // Conversation operations
  async saveConversation(userId: string, data: Omit<Conversation, 'id' | 'user_id' | 'created_at' | 'updated_at'>) {
    return supabaseAdmin.from('conversations').insert({
      user_id: userId,
      ...data,
    }).select();
  },

  async updateConversation(conversationId: string, messages: any[], contextSnapshot: any) {
    return supabaseAdmin
      .from('conversations')
      .update({ messages, context_snapshot: contextSnapshot })
      .eq('id', conversationId);
  },

  // Non-negotiables operations
  async createNonNegotiable(userId: string, data: Omit<WeeklyNonNegotiable, 'id' | 'user_id' | 'created_at'>) {
    return supabaseAdmin.from('weekly_nonnegotiables').insert({
      user_id: userId,
      ...data,
    });
  },

  async markNonNegotiableComplete(id: string) {
    return supabaseAdmin
      .from('weekly_nonnegotiables')
      .update({ completed: true })
      .eq('id', id);
  },
};
