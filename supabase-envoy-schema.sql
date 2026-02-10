-- Envoy Agent Schema
-- Run this in your Supabase SQL editor after the correspondent schema
--
-- The Envoy manages outbound relationship cultivation:
-- candidates, outreach drafts, coffee chats, and newsletter growth.

-- ============================================================
-- ENVOY CANDIDATES
-- People identified for strategic outreach across four pipelines
-- ============================================================

CREATE TABLE envoy_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,

  -- Identity
  name TEXT NOT NULL,
  email TEXT,
  role TEXT,
  organization TEXT,
  location TEXT,

  -- Pipeline & source
  pipeline TEXT NOT NULL CHECK (pipeline IN (
    'design_partner', 'builder', 'creative', 'generous', 'newsletter_growth'
  )),
  source_pool TEXT NOT NULL, -- e.g., "airbnb_network", "newsletter_ecosystem"
  source_detail TEXT,

  -- Connection context
  person_id UUID REFERENCES people(id), -- link if already in People DB
  mutual_connections TEXT[],
  shared_interests TEXT[],
  their_work TEXT,
  why_reach_out TEXT,
  what_you_can_offer TEXT,

  -- Warm path
  warm_path TEXT,
  warm_intro_through UUID REFERENCES people(id),

  -- State
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN (
    'suggested', 'approved', 'sent', 'responded', 'skipped', 'deferred', 'not_now'
  )),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
  outreach_count INTEGER DEFAULT 0,
  last_outreach_at TIMESTAMPTZ,
  last_response_at TIMESTAMPTZ,
  follow_up_after DATE,
  notes TEXT,

  -- Exclusion
  excluded BOOLEAN DEFAULT false,
  excluded_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENVOY OUTREACH
-- Drafted outreach messages for review and sending
-- ============================================================

CREATE TABLE envoy_outreach (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  candidate_id UUID REFERENCES envoy_candidates(id) ON DELETE CASCADE NOT NULL,
  person_id UUID REFERENCES people(id),

  -- Content
  channel TEXT NOT NULL CHECK (channel IN (
    'email', 'intro_request', 'dm', 'in_person_followup', 'handwritten'
  )),
  subject TEXT,
  body TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK (pipeline IN (
    'design_partner', 'builder', 'creative', 'generous', 'newsletter_growth'
  )),

  -- Context used for generation
  candidate_context TEXT,
  relationship_context TEXT,
  voice_notes TEXT,

  -- Queue state
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN (
    'suggested', 'approved', 'sent', 'responded', 'skipped', 'deferred', 'not_now'
  )),
  queue_position INTEGER,

  -- Editing
  edited_body TEXT,
  sent_at TIMESTAMPTZ,
  response_received_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENVOY COFFEE CHATS
-- Weekly coffee chat suggestions, scheduling, and briefs
-- ============================================================

CREATE TABLE envoy_coffee_chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  candidate_id UUID REFERENCES envoy_candidates(id),
  person_id UUID REFERENCES people(id),

  -- Participant
  participant_name TEXT NOT NULL,
  participant_role TEXT,
  participant_org TEXT,

  -- Pipeline & context
  pipeline TEXT NOT NULL CHECK (pipeline IN (
    'design_partner', 'builder', 'creative', 'generous', 'newsletter_growth'
  )),
  why_now TEXT,
  suggested_topics TEXT[],
  your_ask TEXT,

  -- Brief
  brief TEXT,
  last_contact_summary TEXT,

  -- Scheduling
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN (
    'suggested', 'outreach_pending', 'scheduled', 'completed', 'cancelled'
  )),
  suggested_for_week DATE,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Follow-up
  follow_up_drafted BOOLEAN DEFAULT false,
  follow_up_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENVOY NEWSLETTER METRICS
-- Tracking Dispatches subscriber growth and engagement
-- ============================================================

CREATE TABLE envoy_newsletter_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Growth
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  weekly_growth INTEGER DEFAULT 0,
  growth_rate NUMERIC(5, 2) DEFAULT 0,

  -- Engagement
  open_rate NUMERIC(5, 2),
  reply_rate NUMERIC(5, 2),

  -- Source tracking
  source_breakdown JSONB, -- { "design_partner": 5, "builder": 3, ... }
  top_referrers TEXT[],

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENVOY CONFIG
-- Per-user Envoy settings and targets
-- ============================================================

CREATE TABLE envoy_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users,

  -- Pipeline targets (weekly)
  design_partner_weekly_target INTEGER DEFAULT 3,
  builder_weekly_target INTEGER DEFAULT 2,
  creative_weekly_target INTEGER DEFAULT 1,
  generous_weekly_target INTEGER DEFAULT 2,

  -- Coffee chat settings
  weekly_coffee_chat_target INTEGER DEFAULT 2,
  coffee_chat_day_preferences TEXT[], -- e.g., ["tuesday", "thursday"]

  -- Newsletter growth
  newsletter_growth_weekly_target INTEGER DEFAULT 3,
  daily_invite_target INTEGER DEFAULT 1,
  monthly_cross_promo_target INTEGER DEFAULT 3,

  -- Follow-up
  follow_up_days INTEGER DEFAULT 7,
  max_follow_ups INTEGER DEFAULT 2,

  -- Exclusions
  excluded_people UUID[], -- person_ids to never contact

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENVOY RUNS
-- Processing pipeline execution records
-- ============================================================

CREATE TABLE envoy_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
    'running', 'completed', 'failed'
  )),
  candidates_identified INTEGER DEFAULT 0,
  outreach_drafted INTEGER DEFAULT 0,
  coffee_chats_suggested INTEGER DEFAULT 0,
  follow_ups_queued INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_envoy_candidates_user_pipeline ON envoy_candidates(user_id, pipeline);
CREATE INDEX idx_envoy_candidates_user_status ON envoy_candidates(user_id, status);
CREATE INDEX idx_envoy_candidates_person ON envoy_candidates(person_id);
CREATE INDEX idx_envoy_candidates_follow_up ON envoy_candidates(user_id, follow_up_after)
  WHERE follow_up_after IS NOT NULL AND status = 'sent';

CREATE INDEX idx_envoy_outreach_user_status ON envoy_outreach(user_id, status);
CREATE INDEX idx_envoy_outreach_queue ON envoy_outreach(user_id, status, queue_position)
  WHERE status = 'suggested';
CREATE INDEX idx_envoy_outreach_candidate ON envoy_outreach(candidate_id);

CREATE INDEX idx_envoy_coffee_chats_user_status ON envoy_coffee_chats(user_id, status);
CREATE INDEX idx_envoy_coffee_chats_week ON envoy_coffee_chats(user_id, suggested_for_week);

CREATE INDEX idx_envoy_newsletter_user ON envoy_newsletter_metrics(user_id, recorded_at DESC);

CREATE INDEX idx_envoy_runs_user ON envoy_runs(user_id, started_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE envoy_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE envoy_outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE envoy_coffee_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE envoy_newsletter_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE envoy_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE envoy_runs ENABLE ROW LEVEL SECURITY;

-- Candidate policies
CREATE POLICY "Users can view own candidates" ON envoy_candidates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own candidates" ON envoy_candidates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own candidates" ON envoy_candidates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own candidates" ON envoy_candidates FOR DELETE USING (auth.uid() = user_id);

-- Outreach policies
CREATE POLICY "Users can view own outreach" ON envoy_outreach FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own outreach" ON envoy_outreach FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own outreach" ON envoy_outreach FOR UPDATE USING (auth.uid() = user_id);

-- Coffee chat policies
CREATE POLICY "Users can view own coffee chats" ON envoy_coffee_chats FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own coffee chats" ON envoy_coffee_chats FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own coffee chats" ON envoy_coffee_chats FOR UPDATE USING (auth.uid() = user_id);

-- Newsletter metrics policies
CREATE POLICY "Users can view own newsletter metrics" ON envoy_newsletter_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own newsletter metrics" ON envoy_newsletter_metrics FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Config policies
CREATE POLICY "Users can view own envoy config" ON envoy_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own envoy config" ON envoy_config FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own envoy config" ON envoy_config FOR UPDATE USING (auth.uid() = user_id);

-- Run policies
CREATE POLICY "Users can view own envoy runs" ON envoy_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own envoy runs" ON envoy_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own envoy runs" ON envoy_runs FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER update_envoy_candidates_updated_at BEFORE UPDATE ON envoy_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_envoy_outreach_updated_at BEFORE UPDATE ON envoy_outreach
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_envoy_coffee_chats_updated_at BEFORE UPDATE ON envoy_coffee_chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_envoy_config_updated_at BEFORE UPDATE ON envoy_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
