-- ============================================================================
-- Sync tracking tables
-- Run in Supabase SQL Editor
-- ============================================================================

-- 1. Sync runs — logs every sync execution
CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  google_ads_customer_id text,
  sync_type text NOT NULL DEFAULT 'manual',      -- manual, scheduled, pre_analysis, backfill
  status text NOT NULL DEFAULT 'running',         -- running, success, partial, failed
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  -- Dataset results
  datasets_attempted integer DEFAULT 0,
  datasets_succeeded integer DEFAULT 0,
  datasets_failed integer DEFAULT 0,
  total_rows_written integer DEFAULT 0,
  -- Details
  dataset_results jsonb,                          -- per-dataset row counts and status
  date_range_start text,
  date_range_end text,
  error_summary text,
  -- Metadata
  triggered_by text DEFAULT 'api'                 -- api, cli, cron
);

ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON sync_runs
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sync_runs_client
  ON sync_runs (client_id, started_at DESC);

-- 2. Client sync status — aggregated freshness view per client
CREATE TABLE IF NOT EXISTS client_sync_status (
  client_id text PRIMARY KEY,
  last_sync_at timestamptz,
  last_sync_status text,                          -- success, partial, failed
  last_sync_run_id uuid,
  last_successful_sync_at timestamptz,
  datasets_available integer DEFAULT 0,
  datasets_total integer DEFAULT 18,
  freshness_status text DEFAULT 'unknown',        -- fresh, stale, missing, partial
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE client_sync_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON client_sync_status
  FOR ALL USING (true) WITH CHECK (true);
