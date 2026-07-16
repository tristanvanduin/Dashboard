-- ============================================================================
-- Add conversion_lag_days to client_settings
-- Default: 3 days
-- Run in Supabase SQL Editor
-- ============================================================================

ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS conversion_lag_days integer NOT NULL DEFAULT 3;

-- Safety constraint: 0-30 days is reasonable
ALTER TABLE client_settings
  ADD CONSTRAINT conversion_lag_days_range
  CHECK (conversion_lag_days >= 0 AND conversion_lag_days <= 30);
