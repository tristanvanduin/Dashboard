-- ============================================================================
-- 3 nieuwe tabellen: campaign metadata, account YoY, campaign YoY
-- Run in Supabase SQL Editor
-- ============================================================================

-- 1. Campaign Metadata
CREATE TABLE IF NOT EXISTS ads_campaign_metadata (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  campaign_type text,
  bidding_strategy text,
  bidding_strategy_target numeric,
  budget_amount numeric,
  budget_type text,
  serving_status text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (client_id, campaign_id)
);

ALTER TABLE ads_campaign_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_campaign_metadata
  FOR ALL USING (true) WITH CHECK (true);

-- 2. Account YoY
CREATE TABLE IF NOT EXISTS ads_account_yoy (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  impressions_yoy_pct numeric,
  clicks_yoy_pct numeric,
  cost_yoy_pct numeric,
  conversions_yoy_pct numeric,
  conversions_value_yoy_pct numeric,
  ctr_yoy_pct numeric,
  avg_cpc_yoy_pct numeric,
  conversion_rate_yoy_pct numeric,
  roas_yoy_pct numeric,
  cost_per_conversion_yoy_pct numeric,
  UNIQUE (client_id, month)
);

ALTER TABLE ads_account_yoy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_account_yoy
  FOR ALL USING (true) WITH CHECK (true);

-- 3. Campaign YoY
CREATE TABLE IF NOT EXISTS ads_campaign_yoy (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  month date NOT NULL,
  conversions_yoy_pct numeric,
  conversions_value_yoy_pct numeric,
  cost_yoy_pct numeric,
  roas_yoy_pct numeric,
  cost_per_conversion_yoy_pct numeric,
  UNIQUE (client_id, campaign_id, month)
);

ALTER TABLE ads_campaign_yoy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_campaign_yoy
  FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_acm_client ON ads_campaign_metadata(client_id);
CREATE INDEX IF NOT EXISTS idx_aay_client ON ads_account_yoy(client_id);
CREATE INDEX IF NOT EXISTS idx_acy_client ON ads_campaign_yoy(client_id);

-- ============================================================================
-- Bereken Account YoY vanuit bestaande ads_account_monthly data
-- ============================================================================

INSERT INTO ads_account_yoy (
  client_id, month,
  impressions_yoy_pct, clicks_yoy_pct, cost_yoy_pct,
  conversions_yoy_pct, conversions_value_yoy_pct,
  ctr_yoy_pct, avg_cpc_yoy_pct, conversion_rate_yoy_pct,
  roas_yoy_pct, cost_per_conversion_yoy_pct
)
SELECT
  cur.client_id,
  cur.month,
  CASE WHEN prev.impressions > 0 THEN round(((cur.impressions - prev.impressions)::numeric / prev.impressions) * 100, 1) END,
  CASE WHEN prev.clicks > 0 THEN round(((cur.clicks - prev.clicks)::numeric / prev.clicks) * 100, 1) END,
  CASE WHEN prev.cost > 0 THEN round(((cur.cost - prev.cost) / prev.cost) * 100, 1) END,
  CASE WHEN prev.conversions > 0 THEN round(((cur.conversions - prev.conversions) / prev.conversions) * 100, 1) END,
  CASE WHEN prev.conversions_value > 0 THEN round(((cur.conversions_value - prev.conversions_value) / prev.conversions_value) * 100, 1) END,
  CASE WHEN prev.ctr > 0 THEN round(((cur.ctr - prev.ctr) / prev.ctr) * 100, 1) END,
  CASE WHEN prev.avg_cpc > 0 THEN round(((cur.avg_cpc - prev.avg_cpc) / prev.avg_cpc) * 100, 1) END,
  CASE WHEN prev.conversion_rate > 0 THEN round(((cur.conversion_rate - prev.conversion_rate) / prev.conversion_rate) * 100, 1) END,
  CASE WHEN prev.roas > 0 THEN round(((cur.roas - prev.roas) / prev.roas) * 100, 1) END,
  CASE WHEN prev.cost_per_conversion > 0 THEN round(((cur.cost_per_conversion - prev.cost_per_conversion) / prev.cost_per_conversion) * 100, 1) END
FROM ads_account_monthly cur
JOIN ads_account_monthly prev
  ON cur.client_id = prev.client_id
  AND prev.month = (cur.month - interval '12 months')::date
ON CONFLICT (client_id, month)
DO UPDATE SET
  impressions_yoy_pct = EXCLUDED.impressions_yoy_pct,
  clicks_yoy_pct = EXCLUDED.clicks_yoy_pct,
  cost_yoy_pct = EXCLUDED.cost_yoy_pct,
  conversions_yoy_pct = EXCLUDED.conversions_yoy_pct,
  conversions_value_yoy_pct = EXCLUDED.conversions_value_yoy_pct,
  ctr_yoy_pct = EXCLUDED.ctr_yoy_pct,
  avg_cpc_yoy_pct = EXCLUDED.avg_cpc_yoy_pct,
  conversion_rate_yoy_pct = EXCLUDED.conversion_rate_yoy_pct,
  roas_yoy_pct = EXCLUDED.roas_yoy_pct,
  cost_per_conversion_yoy_pct = EXCLUDED.cost_per_conversion_yoy_pct;

-- ============================================================================
-- Bereken Campaign YoY vanuit bestaande ads_campaign_monthly data
-- ============================================================================

INSERT INTO ads_campaign_yoy (
  client_id, campaign_id, campaign_name, month,
  conversions_yoy_pct, conversions_value_yoy_pct,
  cost_yoy_pct, roas_yoy_pct, cost_per_conversion_yoy_pct
)
SELECT
  cur.client_id,
  cur.campaign_id,
  cur.campaign_name,
  cur.month,
  CASE WHEN prev.conversions > 0 THEN round(((cur.conversions - prev.conversions) / prev.conversions) * 100, 1) END,
  CASE WHEN prev.conversions_value > 0 THEN round(((cur.conversions_value - prev.conversions_value) / prev.conversions_value) * 100, 1) END,
  CASE WHEN prev.cost > 0 THEN round(((cur.cost - prev.cost) / prev.cost) * 100, 1) END,
  CASE WHEN prev.roas > 0 THEN round(((cur.roas - prev.roas) / prev.roas) * 100, 1) END,
  CASE WHEN prev.cost_per_conversion > 0 THEN round(((cur.cost_per_conversion - prev.cost_per_conversion) / prev.cost_per_conversion) * 100, 1) END
FROM ads_campaign_monthly cur
JOIN ads_campaign_monthly prev
  ON cur.client_id = prev.client_id
  AND cur.campaign_id = prev.campaign_id
  AND prev.month = (cur.month - interval '12 months')::date
ON CONFLICT (client_id, campaign_id, month)
DO UPDATE SET
  campaign_name = EXCLUDED.campaign_name,
  conversions_yoy_pct = EXCLUDED.conversions_yoy_pct,
  conversions_value_yoy_pct = EXCLUDED.conversions_value_yoy_pct,
  cost_yoy_pct = EXCLUDED.cost_yoy_pct,
  roas_yoy_pct = EXCLUDED.roas_yoy_pct,
  cost_per_conversion_yoy_pct = EXCLUDED.cost_per_conversion_yoy_pct;
