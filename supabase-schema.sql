-- Edgelands Database Schema
-- Run this in your Supabase SQL editor to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Energy allocations (weekly planning + daily actuals)
CREATE TABLE energy_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  week_start DATE NOT NULL,
  allocation_type TEXT NOT NULL CHECK (allocation_type IN ('planned', 'actual')),
  colleagues_pct INTEGER CHECK (colleagues_pct >= 0 AND colleagues_pct <= 100),
  airbnb_pct INTEGER CHECK (airbnb_pct >= 0 AND airbnb_pct <= 100),
  forest_pct INTEGER CHECK (forest_pct >= 0 AND forest_pct <= 100),
  personal_pct INTEGER CHECK (personal_pct >= 0 AND personal_pct <= 100),
  other_pct INTEGER CHECK (other_pct >= 0 AND other_pct <= 100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily energy logs (quick check-ins)
CREATE TABLE daily_energy (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  log_date DATE NOT NULL,
  colleagues_pct INTEGER CHECK (colleagues_pct >= 0 AND colleagues_pct <= 100),
  airbnb_pct INTEGER CHECK (airbnb_pct >= 0 AND airbnb_pct <= 100),
  forest_pct INTEGER CHECK (forest_pct >= 0 AND forest_pct <= 100),
  personal_pct INTEGER CHECK (personal_pct >= 0 AND personal_pct <= 100),
  other_pct INTEGER CHECK (other_pct >= 0 AND other_pct <= 100),
  narrative TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects (Active/Glacier/Compost)
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'glacier', 'compost')),
  domain TEXT CHECK (domain IN ('colleagues', 'airbnb', 'forest', 'personal', 'other')),
  description TEXT,
  revival_doc TEXT,
  learnings TEXT,
  state_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integrations (voice memos, insights, cross-pollinations)
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('voice_memo', 'conversation', 'manual')),
  content TEXT NOT NULL,
  transcript TEXT,
  tags TEXT[],
  audio_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relationships
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
  email TEXT,
  last_contact_date DATE,
  next_contact_date DATE,
  context_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Decisions & Forcing Functions
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('forcing_function', 'active_decision', 'decision_criteria')),
  title TEXT NOT NULL,
  description TEXT,
  deadline DATE,
  status TEXT CHECK (status IN ('active', 'decided', 'deferred')),
  decision_outcome TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations (chat history with Claude)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  messages JSONB NOT NULL,
  context_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weekly non-negotiables
CREATE TABLE weekly_nonnegotiables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  week_start DATE NOT NULL,
  domain TEXT NOT NULL,
  task TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification preferences
CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users,
  email TEXT,
  phone TEXT,
  sunday_ops_review_time TIME DEFAULT '18:00:00',
  relationship_nudges_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_energy_allocations_user_week ON energy_allocations(user_id, week_start);
CREATE INDEX idx_daily_energy_user_date ON daily_energy(user_id, log_date);
CREATE INDEX idx_projects_user_state ON projects(user_id, state);
CREATE INDEX idx_relationships_user_tier ON relationships(user_id, tier);
CREATE INDEX idx_decisions_user_status ON decisions(user_id, status);
CREATE INDEX idx_integrations_user_created ON integrations(user_id, created_at DESC);

-- Row Level Security Policies
ALTER TABLE energy_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_energy ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_nonnegotiables ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only access their own data
CREATE POLICY "Users can view own energy allocations" ON energy_allocations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own energy allocations" ON energy_allocations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own energy allocations" ON energy_allocations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own daily energy" ON daily_energy
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own daily energy" ON daily_energy
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own daily energy" ON daily_energy
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own projects" ON projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own projects" ON projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects" ON projects
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own integrations" ON integrations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own integrations" ON integrations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own relationships" ON relationships
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own relationships" ON relationships
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own relationships" ON relationships
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own decisions" ON decisions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own decisions" ON decisions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own decisions" ON decisions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own conversations" ON conversations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own conversations" ON conversations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own conversations" ON conversations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own weekly non-negotiables" ON weekly_nonnegotiables
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own weekly non-negotiables" ON weekly_nonnegotiables
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own weekly non-negotiables" ON weekly_nonnegotiables
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own notification preferences" ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notification preferences" ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notification preferences" ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_relationships_updated_at BEFORE UPDATE ON relationships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_decisions_updated_at BEFORE UPDATE ON decisions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
