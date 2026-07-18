-- ============================================================================
-- Expert layers: 5 nieuwe tabellen
-- Run in Supabase SQL Editor
-- ============================================================================

-- ── LAAG 1: Strategische context per klant ──────────────────────────────────

CREATE TABLE IF NOT EXISTS sop_client_context (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  title text NOT NULL,
  description text NOT NULL,
  impact_on_analysis text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sop_client_context ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON sop_client_context;
CREATE POLICY "service_role_all" ON sop_client_context FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "auth_read" ON sop_client_context;
CREATE POLICY "auth_read" ON sop_client_context FOR SELECT USING (auth.role() = 'authenticated');
CREATE INDEX IF NOT EXISTS idx_scc_client ON sop_client_context(client_id);

-- ── LAAG 2: Portfolio analyse ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ads_portfolio_analysis (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  pmax_cost_pct numeric DEFAULT 0,
  search_cost_pct numeric DEFAULT 0,
  shopping_cost_pct numeric DEFAULT 0,
  other_cost_pct numeric DEFAULT 0,
  pmax_conv_pct numeric DEFAULT 0,
  search_conv_pct numeric DEFAULT 0,
  shopping_conv_pct numeric DEFAULT 0,
  other_conv_pct numeric DEFAULT 0,
  budget_concentration_risk boolean DEFAULT false,
  top_campaign_cost_pct numeric DEFAULT 0,
  top_campaign_name text,
  pmax_search_overlap boolean DEFAULT false,
  portfolio_efficiency_score numeric DEFAULT 0,
  portfolio_efficiency_mom_pct numeric,
  created_at timestamptz DEFAULT now(),
  UNIQUE (client_id, month)
);

ALTER TABLE ads_portfolio_analysis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON ads_portfolio_analysis;
CREATE POLICY "service_role_all" ON ads_portfolio_analysis FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "auth_read" ON ads_portfolio_analysis;
CREATE POLICY "auth_read" ON ads_portfolio_analysis FOR SELECT USING (auth.role() = 'authenticated');
CREATE INDEX IF NOT EXISTS idx_apa_client ON ads_portfolio_analysis(client_id);

-- ── LAAG 3: Hypothese tracking ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sop_hypothesis_tracking (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  recommendation_id uuid REFERENCES sop_recommendations(id),
  hypothesis text NOT NULL,
  expected_result text NOT NULL,
  measurement_metric text NOT NULL,
  timeframe text NOT NULL,
  status text DEFAULT 'open',
  implemented_at date,
  measured_at date,
  implementation_notes text,
  measurement_result text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sop_hypothesis_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON sop_hypothesis_tracking;
CREATE POLICY "service_role_all" ON sop_hypothesis_tracking FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "auth_read" ON sop_hypothesis_tracking;
CREATE POLICY "auth_read" ON sop_hypothesis_tracking FOR SELECT USING (auth.role() = 'authenticated');
CREATE INDEX IF NOT EXISTS idx_sht_client ON sop_hypothesis_tracking(client_id);

-- ── LAAG 4: Leading indicators ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ads_leading_indicators (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  week_start date NOT NULL,
  impression_share_wow_pct numeric,
  avg_ctr_wow_pct numeric,
  avg_cpc_wow_pct numeric,
  conversion_rate_wow_pct numeric,
  cost_per_conversion_wow_pct numeric,
  flag_is_dropping boolean DEFAULT false,
  flag_ctr_dropping boolean DEFAULT false,
  flag_cpc_rising boolean DEFAULT false,
  flag_conv_rate_dropping boolean DEFAULT false,
  flag_budget_pressure boolean DEFAULT false,
  flag_quality_pressure boolean DEFAULT false,
  warning_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (client_id, week_start)
);

ALTER TABLE ads_leading_indicators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON ads_leading_indicators;
CREATE POLICY "service_role_all" ON ads_leading_indicators FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "auth_read" ON ads_leading_indicators;
CREATE POLICY "auth_read" ON ads_leading_indicators FOR SELECT USING (auth.role() = 'authenticated');
CREATE INDEX IF NOT EXISTS idx_ali_client ON ads_leading_indicators(client_id);

-- ── LAAG 5: Sectorale benchmarks ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS benchmark_sectors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sector text NOT NULL,
  account_type text NOT NULL,
  metric text NOT NULL,
  low numeric,
  median numeric,
  high numeric,
  top10 numeric,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (sector, account_type, metric)
);

ALTER TABLE benchmark_sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON benchmark_sectors;
CREATE POLICY "service_role_all" ON benchmark_sectors FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "auth_read" ON benchmark_sectors;
CREATE POLICY "auth_read" ON benchmark_sectors FOR SELECT USING (auth.role() = 'authenticated');

-- Seed benchmark data
INSERT INTO benchmark_sectors (sector, account_type, metric, low, median, high, top10) VALUES
  -- Fysiotherapie / Leadgen CPA
  ('fysiotherapie', 'leadgen_cpa', 'ctr', 3.0, 5.5, 8.0, 12.0),
  ('fysiotherapie', 'leadgen_cpa', 'conversion_rate', 2.0, 4.5, 7.0, 10.0),
  ('fysiotherapie', 'leadgen_cpa', 'cpa', 80, 45, 25, 15),
  ('fysiotherapie', 'leadgen_cpa', 'roas', 0.5, 1.5, 3.0, 5.0),
  -- E-commerce general / ROAS
  ('ecommerce_general', 'ecommerce_roas', 'ctr', 0.5, 1.2, 2.5, 4.0),
  ('ecommerce_general', 'ecommerce_roas', 'conversion_rate', 0.8, 1.8, 3.0, 5.0),
  ('ecommerce_general', 'ecommerce_roas', 'cpa', 50, 25, 15, 8),
  ('ecommerce_general', 'ecommerce_roas', 'roas', 1.5, 3.0, 5.0, 8.0),
  -- E-commerce general / CPA
  ('ecommerce_general', 'ecommerce_cpa', 'ctr', 0.5, 1.2, 2.5, 4.0),
  ('ecommerce_general', 'ecommerce_cpa', 'conversion_rate', 0.8, 1.8, 3.0, 5.0),
  ('ecommerce_general', 'ecommerce_cpa', 'cpa', 50, 25, 15, 8),
  ('ecommerce_general', 'ecommerce_cpa', 'roas', 1.5, 3.0, 5.0, 8.0),
  -- B2B Software / Leadgen
  ('b2b_software', 'leadgen_cpa', 'ctr', 1.5, 3.0, 5.0, 8.0),
  ('b2b_software', 'leadgen_cpa', 'conversion_rate', 1.0, 2.5, 5.0, 8.0),
  ('b2b_software', 'leadgen_cpa', 'cpa', 200, 100, 50, 30),
  ('b2b_software', 'leadgen_cpa', 'roas', 0.3, 0.8, 2.0, 4.0),
  -- Leadgen volume
  ('ecommerce_general', 'leadgen_volume', 'ctr', 2.0, 4.0, 7.0, 10.0),
  ('ecommerce_general', 'leadgen_volume', 'conversion_rate', 1.5, 3.5, 6.0, 9.0),
  ('ecommerce_general', 'leadgen_volume', 'cpa', 60, 35, 20, 12),
  ('ecommerce_general', 'leadgen_volume', 'roas', 1.0, 2.0, 4.0, 6.0),
  -- Hybrid
  ('ecommerce_general', 'hybrid', 'ctr', 0.8, 1.5, 3.0, 5.0),
  ('ecommerce_general', 'hybrid', 'conversion_rate', 1.0, 2.0, 3.5, 5.5),
  ('ecommerce_general', 'hybrid', 'cpa', 55, 30, 18, 10),
  ('ecommerce_general', 'hybrid', 'roas', 1.2, 2.5, 4.5, 7.0)
ON CONFLICT (sector, account_type, metric) DO UPDATE SET
  low = EXCLUDED.low, median = EXCLUDED.median,
  high = EXCLUDED.high, top10 = EXCLUDED.top10,
  updated_at = now();
