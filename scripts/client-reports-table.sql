-- Client Reports table for storing generated and editable monthly reports
CREATE TABLE IF NOT EXISTS client_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  report_date DATE NOT NULL,
  report_month INTEGER NOT NULL CHECK (report_month BETWEEN 1 AND 12),
  report_year INTEGER NOT NULL,
  title TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_used TEXT,
  tokens_used INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'sent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by client
CREATE INDEX IF NOT EXISTS idx_client_reports_client_date
  ON client_reports (client_id, report_date DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_client_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_reports_updated_at ON client_reports;
CREATE TRIGGER trg_client_reports_updated_at
  BEFORE UPDATE ON client_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_client_reports_updated_at();
