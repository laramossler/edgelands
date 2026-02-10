-- Evening Debrief Schema
-- Run this in your Supabase SQL editor

-- Debrief entries (one per day)
CREATE TABLE IF NOT EXISTS debrief_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  date DATE NOT NULL,
  raw_entry TEXT NOT NULL,
  categories JSONB DEFAULT '[]',
  energy_reading JSONB DEFAULT '{}',
  chronicler_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, date)
);

-- Index for fast lookups by user and date
CREATE INDEX IF NOT EXISTS idx_debrief_entries_user_date
  ON debrief_entries(user_id, date DESC);

-- Add unique constraint on daily_energy for upsert support (if not exists)
DO $$ BEGIN
  ALTER TABLE daily_energy ADD CONSTRAINT daily_energy_user_date_unique UNIQUE (user_id, log_date);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
