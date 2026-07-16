-- ============================================================================
-- Shared generation progress tables
-- Safe to re-run in Supabase SQL Editor
-- ============================================================================

CREATE TABLE IF NOT EXISTS generation_jobs (
  job_id UUID PRIMARY KEY,
  client_id TEXT,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'monthly_sop',
    'biweekly_sop',
    'weekly_sop',
    'second_opinion',
    'report_generation',
    'pdf_generation'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  current_phase TEXT,
  current_phase_label TEXT,
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  partial_output_exists BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS job_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS current_phase TEXT,
  ADD COLUMN IF NOT EXISTS current_phase_label TEXT,
  ADD COLUMN IF NOT EXISTS progress_pct INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS step_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_steps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS partial_output_exists BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS generation_job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES generation_jobs(job_id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  phase_label TEXT NOT NULL,
  phase_order INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  details TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, phase_key)
);

ALTER TABLE generation_job_events
  ADD COLUMN IF NOT EXISTS job_type TEXT,
  ADD COLUMN IF NOT EXISTS phase_key TEXT,
  ADD COLUMN IF NOT EXISTS phase_label TEXT,
  ADD COLUMN IF NOT EXISTS phase_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS details TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_generation_jobs_client_updated
  ON generation_jobs (client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_updated
  ON generation_jobs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_job_events_job_order
  ON generation_job_events (job_id, phase_order ASC);

CREATE OR REPLACE FUNCTION update_generation_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generation_jobs_updated_at ON generation_jobs;
CREATE TRIGGER trg_generation_jobs_updated_at
  BEFORE UPDATE ON generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_jobs_updated_at();

CREATE OR REPLACE FUNCTION update_generation_job_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generation_job_events_updated_at ON generation_job_events;
CREATE TRIGGER trg_generation_job_events_updated_at
  BEFORE UPDATE ON generation_job_events
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_job_events_updated_at();

ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_job_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated generation_jobs" ON generation_jobs;
CREATE POLICY "Allow all for authenticated generation_jobs"
  ON generation_jobs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for authenticated generation_job_events" ON generation_job_events;
CREATE POLICY "Allow all for authenticated generation_job_events"
  ON generation_job_events FOR ALL USING (true) WITH CHECK (true);
