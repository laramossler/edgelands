-- Envoy Newsletter Growth Pipeline Migration
-- Run this AFTER the initial envoy schema has been applied.
-- Adds 'newsletter_growth' as a fifth pipeline type.

-- ============================================================
-- ADD newsletter_growth TO PIPELINE CHECK CONSTRAINTS
-- ============================================================

-- envoy_candidates: drop and recreate pipeline constraint
ALTER TABLE envoy_candidates DROP CONSTRAINT IF EXISTS envoy_candidates_pipeline_check;
ALTER TABLE envoy_candidates ADD CONSTRAINT envoy_candidates_pipeline_check
  CHECK (pipeline IN ('design_partner', 'builder', 'creative', 'generous', 'newsletter_growth'));

-- envoy_outreach: drop and recreate pipeline constraint
ALTER TABLE envoy_outreach DROP CONSTRAINT IF EXISTS envoy_outreach_pipeline_check;
ALTER TABLE envoy_outreach ADD CONSTRAINT envoy_outreach_pipeline_check
  CHECK (pipeline IN ('design_partner', 'builder', 'creative', 'generous', 'newsletter_growth'));

-- envoy_coffee_chats: drop and recreate pipeline constraint
ALTER TABLE envoy_coffee_chats DROP CONSTRAINT IF EXISTS envoy_coffee_chats_pipeline_check;
ALTER TABLE envoy_coffee_chats ADD CONSTRAINT envoy_coffee_chats_pipeline_check
  CHECK (pipeline IN ('design_partner', 'builder', 'creative', 'generous', 'newsletter_growth'));

-- ============================================================
-- ADD newsletter_growth CONFIG FIELDS
-- ============================================================

ALTER TABLE envoy_config ADD COLUMN IF NOT EXISTS newsletter_growth_weekly_target INTEGER DEFAULT 3;
