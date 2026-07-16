-- ============================================================================
-- Second Opinion tables
-- Run in Supabase SQL Editor
-- ============================================================================

-- 1. Second Opinion runs — stores each audit execution
CREATE TABLE IF NOT EXISTS second_opinion_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  mode text NOT NULL DEFAULT 'quick',           -- 'quick' (shortlist) or 'full' (longlist)
  status text NOT NULL DEFAULT 'pending',       -- pending, running, completed, failed
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  results jsonb,                                -- array of AuditRowResult
  section_summaries jsonb,                      -- array of SectionSummary
  pdf_storage_path text,                        -- path in Supabase Storage
  file_id uuid,                                 -- FK to client_files if PDF saved
  error text
);

ALTER TABLE second_opinion_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON second_opinion_runs
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_so_runs_client
  ON second_opinion_runs (client_id, created_at DESC);
