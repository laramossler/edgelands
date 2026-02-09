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
  type: 'log_energy' | 'update_project' | 'create_project' | 'log_insight' | 'update_relationship' | 'set_non_negotiable' | 'create_decision';
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

// ============================================================
// People Database Types
// ============================================================

export type Circle = 'family' | 'neighbor' | 'friend' | 'professional' | 'community' | 'acquaintance';
export type IdealCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'seasonal' | 'as_needed';
export type InteractionType = 'email_sent' | 'email_received' | 'text' | 'call' | 'in_person' | 'letter' | 'gift';
export type Sentiment = 'warm' | 'neutral' | 'tense' | 'celebratory' | 'supportive';

export interface Person {
  id: string;
  user_id: string;

  // Core Identity
  name: string;
  nickname?: string;
  email?: string[];
  phone?: string[];
  address?: string;
  photo?: string;

  // Relationship Mapping
  circle: Circle;
  closeness: 1 | 2 | 3 | 4 | 5;
  relationship: string;
  how_we_met?: string;
  shared_with?: string[];

  // Care Practice
  last_contact?: string;
  contact_method?: string;
  ideal_cadence?: IdealCadence;
  next_touchpoint?: string;
  touchpoint_date?: string;
  care_notes?: string;

  // Personal Context
  birthday?: string;
  location?: string;
  occupation?: string;
  interests?: string[];
  dietary?: string;
  communication_style?: string;
  gift_ideas?: string[];
  notes?: string;

  created_at: string;
  updated_at: string;
}

export interface InteractionLogEntry {
  id: string;
  user_id: string;
  person_id: string;
  date: string;
  type: InteractionType;
  summary?: string;
  sentiment?: Sentiment;
  auto_logged: boolean;
  created_at: string;
}

// ============================================================
// Correspondent Agent Types
// ============================================================

export type MessageChannel = 'email' | 'sms' | 'slack' | 'newsletter' | 'social';
export type DraftTier = 'full_draft' | 'quick_reply' | 'batched_reply' | 'no_reply';
export type DraftStatus = 'pending' | 'approved' | 'edited' | 'sent' | 'skipped' | 'deferred';
export type RunStatus = 'running' | 'completed' | 'failed';

export interface CorrespondentMessage {
  id: string;
  user_id: string;

  // Source
  channel: MessageChannel;
  external_id?: string;
  thread_id?: string;

  // Sender
  sender_email?: string;
  sender_name?: string;
  sender_phone?: string;
  person_id?: string;

  // Content
  subject?: string;
  body: string;
  body_html?: string;
  snippet?: string;
  attachments?: { name: string; mime_type: string; size: number; storage_ref?: string }[];

  // Metadata
  received_at: string;
  is_read: boolean;
  labels?: string[];

  // Processing
  processed: boolean;
  urgency: number;
  importance: number;
  triage_summary?: string;

  created_at: string;
}

export interface CorrespondentDraft {
  id: string;
  user_id: string;
  message_id: string;
  person_id?: string;

  // Draft content
  channel: MessageChannel;
  subject?: string;
  body: string;
  draft_tier: DraftTier;

  // Context
  relationship_context?: string;
  thread_context?: string;
  voice_notes?: string;

  // Queue state
  status: DraftStatus;
  skip_count: number;
  queue_position?: number;

  // Triage
  urgency: number;
  importance: number;

  // Editing
  edited_body?: string;
  sent_at?: string;

  created_at: string;
  updated_at: string;
}

export interface CorrespondentRun {
  id: string;
  user_id: string;
  started_at: string;
  completed_at?: string;
  status: RunStatus;
  messages_ingested: number;
  messages_processed: number;
  drafts_generated: number;
  error?: string;
  created_at: string;
}

export interface VoiceSample {
  id: string;
  user_id: string;
  person_id?: string;
  circle?: string;
  channel: string;
  content: string;
  sent_at?: string;
  created_at: string;
}

export interface CorrespondentConfig {
  user_id: string;

  // Gmail
  gmail_access_token?: string;
  gmail_refresh_token?: string;
  gmail_token_expiry?: string;
  gmail_last_history_id?: string;
  gmail_connected: boolean;

  // Processing
  process_time: string;
  timezone: string;

  // Alerts
  emergency_alerts_enabled: boolean;
  emergency_closeness_threshold: number;

  // Exclusions
  excluded_emails?: string[];
  excluded_names?: string[];

  created_at: string;
  updated_at: string;
}

// Correspondent API Types

export interface QueueItem {
  draft: CorrespondentDraft;
  message: CorrespondentMessage;
  person?: Person;
  context_summary: string;
}

export interface CorrespondentQueueResponse {
  items: QueueItem[];
  total: number;
  pending: number;
  last_run?: CorrespondentRun;
}

export interface DraftActionRequest {
  draft_id: string;
  action: 'send' | 'edit' | 'skip' | 'defer' | 'mute_sender' | 'not_important';
  edited_body?: string;
}

export interface TriageResult {
  urgency: number;
  importance: number;
  draft_tier: DraftTier;
  summary: string;
  reasoning: string;
}

export interface DraftResult {
  body: string;
  subject?: string;
  voice_notes: string;
  confidence: number;
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
