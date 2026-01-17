// Database Types
export interface EnergyAllocation {
  id: string;
  user_id: string;
  week_start: string;
  allocation_type: 'planned' | 'actual';
  colleagues_pct: number;
  airbnb_pct: number;
  forest_pct: number;
  personal_pct: number;
  other_pct: number;
  notes?: string;
  created_at: string;
}

export interface DailyEnergy {
  id: string;
  user_id: string;
  log_date: string;
  colleagues_pct: number;
  airbnb_pct: number;
  forest_pct: number;
  personal_pct: number;
  other_pct: number;
  narrative?: string;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  state: 'active' | 'glacier' | 'compost';
  domain?: 'colleagues' | 'airbnb' | 'forest' | 'personal' | 'other';
  description?: string;
  revival_doc?: string;
  learnings?: string;
  state_changed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Integration {
  id: string;
  user_id: string;
  source: 'voice_memo' | 'conversation' | 'manual';
  content: string;
  transcript?: string;
  tags?: string[];
  audio_url?: string;
  created_at: string;
}

export interface Relationship {
  id: string;
  user_id: string;
  name: string;
  tier: 1 | 2 | 3;
  email?: string;
  last_contact_date?: string;
  next_contact_date?: string;
  context_note?: string;
  created_at: string;
  updated_at: string;
}

export interface Decision {
  id: string;
  user_id: string;
  type: 'forcing_function' | 'active_decision' | 'decision_criteria';
  title: string;
  description?: string;
  deadline?: string;
  status: 'active' | 'decided' | 'deferred';
  decision_outcome?: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  messages: Message[];
  context_snapshot?: ContextSnapshot;
  created_at: string;
  updated_at: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface WeeklyNonNegotiable {
  id: string;
  user_id: string;
  week_start: string;
  domain: string;
  task: string;
  completed: boolean;
  created_at: string;
}

export interface NotificationPreference {
  user_id: string;
  email?: string;
  phone?: string;
  sunday_ops_review_time: string;
  relationship_nudges_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// Context Types
export interface ContextSnapshot {
  currentWeekEnergy?: EnergyAllocation;
  activeProjects?: Project[];
  relationships?: Relationship[];
  recentIntegrations?: Integration[];
  activeDecisions?: Decision[];
  weeklyNonNegotiables?: WeeklyNonNegotiable[];
}

// API Types
export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface ChatResponse {
  reply: string;
  conversationId: string;
  actions?: Action[];
}

export interface Action {
  type: 'log_energy' | 'update_project' | 'log_insight' | 'update_relationship' | 'set_non_negotiable';
  data: any;
}

export interface VoiceUploadResponse {
  transcript: string;
  insights: string[];
  integrationId: string;
}

export interface EnergyLogRequest {
  date: string;
  narrative: string;
}

export interface EnergyLogResponse {
  parsed: EnergyBreakdown;
  logged: boolean;
}

export interface EnergyBreakdown {
  colleagues_pct: number;
  airbnb_pct: number;
  forest_pct: number;
  personal_pct: number;
  other_pct: number;
}

export interface NotificationRequest {
  type: 'ops_review' | 'relationship_nudge';
  recipients: string[];
}

export interface NotificationResponse {
  sent: boolean;
}

// Pattern Detection Types
export interface MonthlyPattern {
  energyTrends: {
    domain: string;
    averageAllocation: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  }[];
  projectVelocity: {
    stateChanges: number;
    completions: number;
  };
  relationshipHealth: {
    tier1Maintained: boolean;
    tier2Maintained: boolean;
    avgContactFrequency: number;
  };
  decisionMovement: {
    activeDecisions: number;
    decidedThisMonth: number;
    deferredThisMonth: number;
  };
  recommendations: string[];
}
