-- Correspondent Feedback Loop Schema
-- Adds self-improving learning to the Correspondent Agent

-- Track what the user changes in each draft
CREATE TABLE draft_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  draft_id UUID REFERENCES correspondent_drafts(id) ON DELETE CASCADE NOT NULL,
  person_id UUID REFERENCES people(id),
  circle TEXT,
  draft_tier TEXT,

  -- Edit analysis
  was_edited BOOLEAN NOT NULL DEFAULT false,
  original_body TEXT NOT NULL,
  final_body TEXT NOT NULL,
  edit_distance INTEGER, -- levenshtein-style character diff count
  edit_ratio FLOAT, -- 0.0 = no changes, 1.0 = complete rewrite
  edit_types TEXT[], -- tone_softened, tone_firmed, shortened, lengthened, added_context, removed_fluff, corrected_fact, restructured

  -- Outcome
  action_taken TEXT NOT NULL CHECK (action_taken IN ('sent', 'sent_edited', 'skipped', 'deferred')),

  -- AI analysis of the edit
  edit_analysis TEXT, -- Claude's analysis of what changed and why
  learned_preferences TEXT[], -- extracted style rules: "shorter greetings for family", "no exclamation marks for professional"

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Learned style refinements per circle/person
-- These accumulate over time and feed back into draft generation
CREATE TABLE style_refinements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,

  -- Scope: can be circle-wide or person-specific
  circle TEXT, -- null = global refinement
  person_id UUID REFERENCES people(id), -- null = circle-wide refinement

  -- The learned rule
  refinement TEXT NOT NULL, -- e.g. "Keep replies under 3 sentences for family"
  source TEXT NOT NULL DEFAULT 'edit_analysis', -- edit_analysis | manual | pattern_detection
  confidence FLOAT DEFAULT 0.5, -- increases as the pattern is confirmed
  times_confirmed INTEGER DEFAULT 1,
  times_contradicted INTEGER DEFAULT 0,

  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_draft_feedback_user ON draft_feedback(user_id, created_at DESC);
CREATE INDEX idx_draft_feedback_circle ON draft_feedback(user_id, circle);
CREATE INDEX idx_draft_feedback_person ON draft_feedback(person_id);
CREATE INDEX idx_style_refinements_user ON style_refinements(user_id, circle);
CREATE INDEX idx_style_refinements_person ON style_refinements(person_id);
CREATE INDEX idx_style_refinements_active ON style_refinements(user_id, active) WHERE active = true;

-- RLS
ALTER TABLE draft_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE style_refinements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own draft feedback" ON draft_feedback FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own draft feedback" ON draft_feedback FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own style refinements" ON style_refinements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own style refinements" ON style_refinements FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own style refinements" ON style_refinements FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_style_refinements_updated_at BEFORE UPDATE ON style_refinements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add source tracking to voice_samples
ALTER TABLE voice_samples ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'user_sent';
-- source values: user_sent, ai_unedited, ai_edited
ALTER TABLE voice_samples ADD COLUMN IF NOT EXISTS effectiveness_score FLOAT DEFAULT 0.5;
ALTER TABLE voice_samples ADD COLUMN IF NOT EXISTS use_count INTEGER DEFAULT 0;
