-- Add active_countries column to client_settings for multi-country support.
-- When NULL: auto-detect countries from geo performance data.
-- When set: explicit list like ["NL", "DE", "FR"].
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS active_countries jsonb;

-- Example: set active countries for a multi-country client
-- UPDATE client_settings SET active_countries = '["NL", "DE", "BE"]' WHERE client_id = 'gads-xxx';
