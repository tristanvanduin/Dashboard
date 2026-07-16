-- ============================================================================
-- COUNTRY-LEVEL AGGREGATION TABLES
--
-- Pre-aggregated data per land zodat het dashboard, rapportages, AI search
-- analyse en SOPs allemaal snel per-land data kunnen ophalen.
--
-- Tabellen:
--   1. ads_country_monthly          — Account-niveau totalen per land per maand
--   2. ads_country_weekly           — Account-niveau totalen per land per week
--   3. ads_campaign_country_monthly — Campagne-niveau per land per maand
--   4. ads_country_yoy              — Year-over-year percentages per land
--   5. ads_country_impression_share — Impression share proxy per land per maand
--
-- Bron: ads_geo_performance_monthly (aggregatie op country_code niveau)
--
-- Run in Supabase SQL Editor.
-- ============================================================================


-- ============================================================================
-- 1. COUNTRY MONTHLY — Account-totalen per land per maand
--
-- Grain: client_id / country_code / month
-- Gebruik: dashboard metric cards, performance chart, monthly overview,
--          rapportage samenvattingen, SOP account-niveau per land
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_country_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  country_code text NOT NULL,                  -- ISO: NL, DE, BE, FR, etc.
  month date NOT NULL,                         -- first day of month (YYYY-MM-01)
  -- volume metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  -- calculated metrics
  ctr numeric DEFAULT 0,                       -- clicks / impressions
  avg_cpc numeric DEFAULT 0,                   -- cost / clicks
  cost_per_conversion numeric DEFAULT 0,       -- cost / conversions (CPA)
  conversion_rate numeric DEFAULT 0,           -- conversions / clicks
  roas numeric DEFAULT 0,                      -- conversions_value / cost
  -- context: hoeveel campagnes zijn actief in dit land deze maand
  campaign_count integer DEFAULT 0,
  -- share of total account spend for this month
  spend_share numeric DEFAULT 0,               -- this country cost / total account cost
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, country_code, month)
);

ALTER TABLE ads_country_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_country_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_country_monthly_client
  ON ads_country_monthly (client_id, month);
CREATE INDEX IF NOT EXISTS idx_country_monthly_country
  ON ads_country_monthly (client_id, country_code, month);


-- ============================================================================
-- 2. COUNTRY WEEKLY — Account-totalen per land per week
--
-- Grain: client_id / country_code / week_start
-- Gebruik: pacing monitor per land, weekly trend analysis, intra-maand
--          vergelijking, real-time dashboard
--
-- NB: Vereist dat getGeoPerformanceByWeek wordt toegevoegd aan de sync.
--     Tot die tijd kan deze tabel gevuld worden vanuit een separate API call
--     of via een maand→week schatting.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_country_weekly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  country_code text NOT NULL,
  week_start date NOT NULL,                    -- Monday of the week (ISO week)
  -- volume metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  -- calculated metrics
  ctr numeric DEFAULT 0,
  avg_cpc numeric DEFAULT 0,
  cost_per_conversion numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  roas numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, country_code, week_start)
);

ALTER TABLE ads_country_weekly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_country_weekly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_country_weekly_client
  ON ads_country_weekly (client_id, week_start);
CREATE INDEX IF NOT EXISTS idx_country_weekly_country
  ON ads_country_weekly (client_id, country_code, week_start);


-- ============================================================================
-- 3. CAMPAIGN COUNTRY MONTHLY — Campagne-niveau per land per maand
--
-- Grain: client_id / campaign_id / country_code / month
-- Gebruik: campagne tabel met land filter, SOP campagne-attributie,
--          AI search analyse (search terms → campagne → land),
--          rapportage campagne breakdown per land
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_campaign_country_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  country_code text NOT NULL,
  month date NOT NULL,
  -- volume metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  -- calculated metrics
  ctr numeric DEFAULT 0,
  avg_cpc numeric DEFAULT 0,
  cost_per_conversion numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  roas numeric DEFAULT 0,
  -- share: wat % van deze campagne gaat naar dit land
  campaign_spend_share numeric DEFAULT 0,      -- cost in this country / total campaign cost
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, campaign_id, country_code, month)
);

ALTER TABLE ads_campaign_country_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_campaign_country_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_campaign_country_client
  ON ads_campaign_country_monthly (client_id, month);
CREATE INDEX IF NOT EXISTS idx_campaign_country_country
  ON ads_campaign_country_monthly (client_id, country_code, month);
CREATE INDEX IF NOT EXISTS idx_campaign_country_campaign
  ON ads_campaign_country_monthly (client_id, campaign_id, month);


-- ============================================================================
-- 4. COUNTRY YOY — Year-over-year verandering per land
--
-- Grain: client_id / country_code / month
-- Gebruik: rapportage YoY secties, SOP trend analyse, dashboard YoY badges
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_country_yoy (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  country_code text NOT NULL,
  month date NOT NULL,
  -- YoY percentage veranderingen (bijv. +15.3 = 15.3% stijging)
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
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, country_code, month)
);

ALTER TABLE ads_country_yoy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_country_yoy
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_country_yoy_client
  ON ads_country_yoy (client_id, month);
CREATE INDEX IF NOT EXISTS idx_country_yoy_country
  ON ads_country_yoy (client_id, country_code, month);


-- ============================================================================
-- 5. COUNTRY IMPRESSION SHARE — Budget/rank analyse per land
--
-- Grain: client_id / country_code / month
-- Gebruik: SOP impression share shift analyse per land,
--          rapportage budget expansie advies per land,
--          dashboard IS monitor per land
--
-- NB: Google Ads levert IS niet direct per geo. Deze tabel aggregeert
--     IS data van campagnes gewogen naar hun spend-aandeel per land.
--     Waarden zijn GEWOGEN GEMIDDELDEN, geen exacte IS per geo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_country_impression_share (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  country_code text NOT NULL,
  month date NOT NULL,
  -- gewogen gemiddelde impression share metrics
  search_impression_share numeric,             -- 0-1, gewogen naar spend
  search_budget_lost_is numeric,               -- 0-1, gewogen naar spend
  search_rank_lost_is numeric,                 -- 0-1, gewogen naar spend
  -- totaal budget en spend voor dit land
  total_daily_budget numeric DEFAULT 0,        -- som dagbudget van campagnes in dit land
  total_cost numeric DEFAULT 0,                -- werkelijke spend in dit land
  budget_utilization numeric DEFAULT 0,        -- total_cost / (total_daily_budget * days_in_month)
  -- welke campagnes bijdragen
  campaign_count integer DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, country_code, month)
);

ALTER TABLE ads_country_impression_share ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_country_impression_share
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_country_is_client
  ON ads_country_impression_share (client_id, month);


-- ============================================================================
-- POPULATIE QUERIES
--
-- Deze queries vullen de tabellen vanuit bestaande data.
-- Draai na elke sync, of als eenmalige backfill.
-- ============================================================================


-- ─── Vul ads_country_monthly ────────────────────────────────────────────────

INSERT INTO ads_country_monthly (
  client_id, country_code, month,
  impressions, clicks, cost, conversions, conversions_value,
  ctr, avg_cpc, cost_per_conversion, conversion_rate, roas,
  campaign_count, spend_share, synced_at
)
SELECT
  g.client_id,
  g.country_code,
  g.month,
  SUM(g.impressions)::integer,
  SUM(g.clicks)::integer,
  SUM(g.cost),
  SUM(g.conversions),
  SUM(g.conversions_value),
  -- CTR
  CASE WHEN SUM(g.impressions) > 0
    THEN ROUND(SUM(g.clicks)::numeric / SUM(g.impressions), 6)
    ELSE 0 END,
  -- Avg CPC
  CASE WHEN SUM(g.clicks) > 0
    THEN ROUND(SUM(g.cost) / SUM(g.clicks), 4)
    ELSE 0 END,
  -- CPA
  CASE WHEN SUM(g.conversions) > 0
    THEN ROUND(SUM(g.cost) / SUM(g.conversions), 4)
    ELSE 0 END,
  -- Conversion Rate
  CASE WHEN SUM(g.clicks) > 0
    THEN ROUND(SUM(g.conversions) / SUM(g.clicks), 6)
    ELSE 0 END,
  -- ROAS
  CASE WHEN SUM(g.cost) > 0
    THEN ROUND(SUM(g.conversions_value) / SUM(g.cost), 4)
    ELSE 0 END,
  -- Campaign count
  COUNT(DISTINCT g.campaign_id)::integer,
  -- Spend share (berekend via window function)
  CASE WHEN SUM(SUM(g.cost)) OVER (PARTITION BY g.client_id, g.month) > 0
    THEN ROUND(
      SUM(g.cost) / SUM(SUM(g.cost)) OVER (PARTITION BY g.client_id, g.month),
      4
    )
    ELSE 0 END,
  NOW()
FROM ads_geo_performance_monthly g
WHERE g.country_code IS NOT NULL
GROUP BY g.client_id, g.country_code, g.month
ON CONFLICT (client_id, country_code, month)
DO UPDATE SET
  impressions = EXCLUDED.impressions,
  clicks = EXCLUDED.clicks,
  cost = EXCLUDED.cost,
  conversions = EXCLUDED.conversions,
  conversions_value = EXCLUDED.conversions_value,
  ctr = EXCLUDED.ctr,
  avg_cpc = EXCLUDED.avg_cpc,
  cost_per_conversion = EXCLUDED.cost_per_conversion,
  conversion_rate = EXCLUDED.conversion_rate,
  roas = EXCLUDED.roas,
  campaign_count = EXCLUDED.campaign_count,
  spend_share = EXCLUDED.spend_share,
  synced_at = NOW();


-- ─── Vul ads_campaign_country_monthly ───────────────────────────────────────

INSERT INTO ads_campaign_country_monthly (
  client_id, campaign_id, campaign_name, country_code, month,
  impressions, clicks, cost, conversions, conversions_value,
  ctr, avg_cpc, cost_per_conversion, conversion_rate, roas,
  campaign_spend_share, synced_at
)
SELECT
  g.client_id,
  g.campaign_id,
  -- Pak de meest recente campaign_name
  (ARRAY_AGG(g.campaign_name ORDER BY g.synced_at DESC))[1],
  g.country_code,
  g.month,
  SUM(g.impressions)::integer,
  SUM(g.clicks)::integer,
  SUM(g.cost),
  SUM(g.conversions),
  SUM(g.conversions_value),
  -- CTR
  CASE WHEN SUM(g.impressions) > 0
    THEN ROUND(SUM(g.clicks)::numeric / SUM(g.impressions), 6)
    ELSE 0 END,
  -- Avg CPC
  CASE WHEN SUM(g.clicks) > 0
    THEN ROUND(SUM(g.cost) / SUM(g.clicks), 4)
    ELSE 0 END,
  -- CPA
  CASE WHEN SUM(g.conversions) > 0
    THEN ROUND(SUM(g.cost) / SUM(g.conversions), 4)
    ELSE 0 END,
  -- Conversion Rate
  CASE WHEN SUM(g.clicks) > 0
    THEN ROUND(SUM(g.conversions) / SUM(g.clicks), 6)
    ELSE 0 END,
  -- ROAS
  CASE WHEN SUM(g.cost) > 0
    THEN ROUND(SUM(g.conversions_value) / SUM(g.cost), 4)
    ELSE 0 END,
  -- Campaign spend share (per land vs totaal campagne)
  CASE WHEN SUM(SUM(g.cost)) OVER (PARTITION BY g.client_id, g.campaign_id, g.month) > 0
    THEN ROUND(
      SUM(g.cost) / SUM(SUM(g.cost)) OVER (PARTITION BY g.client_id, g.campaign_id, g.month),
      4
    )
    ELSE 0 END,
  NOW()
FROM ads_geo_performance_monthly g
WHERE g.country_code IS NOT NULL
  AND g.campaign_id IS NOT NULL
GROUP BY g.client_id, g.campaign_id, g.country_code, g.month
ON CONFLICT (client_id, campaign_id, country_code, month)
DO UPDATE SET
  campaign_name = EXCLUDED.campaign_name,
  impressions = EXCLUDED.impressions,
  clicks = EXCLUDED.clicks,
  cost = EXCLUDED.cost,
  conversions = EXCLUDED.conversions,
  conversions_value = EXCLUDED.conversions_value,
  ctr = EXCLUDED.ctr,
  avg_cpc = EXCLUDED.avg_cpc,
  cost_per_conversion = EXCLUDED.cost_per_conversion,
  conversion_rate = EXCLUDED.conversion_rate,
  roas = EXCLUDED.roas,
  campaign_spend_share = EXCLUDED.campaign_spend_share,
  synced_at = NOW();


-- ─── Vul ads_country_yoy ────────────────────────────────────────────────────

INSERT INTO ads_country_yoy (
  client_id, country_code, month,
  impressions_yoy_pct, clicks_yoy_pct, cost_yoy_pct,
  conversions_yoy_pct, conversions_value_yoy_pct,
  ctr_yoy_pct, avg_cpc_yoy_pct, conversion_rate_yoy_pct,
  roas_yoy_pct, cost_per_conversion_yoy_pct,
  synced_at
)
SELECT
  cur.client_id,
  cur.country_code,
  cur.month,
  CASE WHEN prev.impressions > 0
    THEN ROUND(((cur.impressions - prev.impressions)::numeric / prev.impressions) * 100, 1)
    END,
  CASE WHEN prev.clicks > 0
    THEN ROUND(((cur.clicks - prev.clicks)::numeric / prev.clicks) * 100, 1)
    END,
  CASE WHEN prev.cost > 0
    THEN ROUND(((cur.cost - prev.cost) / prev.cost) * 100, 1)
    END,
  CASE WHEN prev.conversions > 0
    THEN ROUND(((cur.conversions - prev.conversions) / prev.conversions) * 100, 1)
    END,
  CASE WHEN prev.conversions_value > 0
    THEN ROUND(((cur.conversions_value - prev.conversions_value) / prev.conversions_value) * 100, 1)
    END,
  CASE WHEN prev.ctr > 0
    THEN ROUND(((cur.ctr - prev.ctr) / prev.ctr) * 100, 1)
    END,
  CASE WHEN prev.avg_cpc > 0
    THEN ROUND(((cur.avg_cpc - prev.avg_cpc) / prev.avg_cpc) * 100, 1)
    END,
  CASE WHEN prev.conversion_rate > 0
    THEN ROUND(((cur.conversion_rate - prev.conversion_rate) / prev.conversion_rate) * 100, 1)
    END,
  CASE WHEN prev.roas > 0
    THEN ROUND(((cur.roas - prev.roas) / prev.roas) * 100, 1)
    END,
  CASE WHEN prev.cost_per_conversion > 0
    THEN ROUND(((cur.cost_per_conversion - prev.cost_per_conversion) / prev.cost_per_conversion) * 100, 1)
    END,
  NOW()
FROM ads_country_monthly cur
JOIN ads_country_monthly prev
  ON cur.client_id = prev.client_id
  AND cur.country_code = prev.country_code
  AND prev.month = (cur.month - INTERVAL '12 months')::date
ON CONFLICT (client_id, country_code, month)
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
  cost_per_conversion_yoy_pct = EXCLUDED.cost_per_conversion_yoy_pct,
  synced_at = NOW();


-- ─── Vul ads_country_impression_share ───────────────────────────────────────
-- Gewogen gemiddelde IS op basis van campagne spend-aandeel per land.
-- Alleen Search campagnes (waar IS beschikbaar is).

INSERT INTO ads_country_impression_share (
  client_id, country_code, month,
  search_impression_share, search_budget_lost_is, search_rank_lost_is,
  total_daily_budget, total_cost, budget_utilization,
  campaign_count, synced_at
)
SELECT
  ccm.client_id,
  ccm.country_code,
  ccm.month,
  -- Gewogen gemiddelde IS (gewicht = campagne spend in dit land)
  CASE WHEN SUM(ccm.cost) > 0 THEN ROUND(
    SUM(cis.search_impression_share * ccm.cost) / SUM(ccm.cost),
    4
  ) END,
  CASE WHEN SUM(ccm.cost) > 0 THEN ROUND(
    SUM(cis.search_budget_lost_is * ccm.cost) / SUM(ccm.cost),
    4
  ) END,
  CASE WHEN SUM(ccm.cost) > 0 THEN ROUND(
    SUM(cis.search_rank_lost_is * ccm.cost) / SUM(ccm.cost),
    4
  ) END,
  -- Budget: opgeschaald naar land-aandeel van campagne budget
  SUM(COALESCE(cis.daily_budget, 0) * ccm.campaign_spend_share),
  SUM(ccm.cost),
  -- Budget utilization: spend / (budget * ~30 dagen)
  CASE WHEN SUM(COALESCE(cis.daily_budget, 0) * ccm.campaign_spend_share) > 0
    THEN ROUND(
      SUM(ccm.cost) / (SUM(COALESCE(cis.daily_budget, 0) * ccm.campaign_spend_share) * 30),
      4
    )
    ELSE 0 END,
  COUNT(DISTINCT ccm.campaign_id)::integer,
  NOW()
FROM ads_campaign_country_monthly ccm
JOIN ads_campaign_impression_share cis
  ON ccm.client_id = cis.client_id
  AND ccm.campaign_id = cis.campaign_id
  AND ccm.month = cis.month
WHERE cis.search_impression_share IS NOT NULL
GROUP BY ccm.client_id, ccm.country_code, ccm.month
ON CONFLICT (client_id, country_code, month)
DO UPDATE SET
  search_impression_share = EXCLUDED.search_impression_share,
  search_budget_lost_is = EXCLUDED.search_budget_lost_is,
  search_rank_lost_is = EXCLUDED.search_rank_lost_is,
  total_daily_budget = EXCLUDED.total_daily_budget,
  total_cost = EXCLUDED.total_cost,
  budget_utilization = EXCLUDED.budget_utilization,
  campaign_count = EXCLUDED.campaign_count,
  synced_at = NOW();


-- ============================================================================
-- HANDIGE VIEWS VOOR SNEL OPVRAGEN
-- ============================================================================


-- ─── View: Actieve landen per client met spend ranking ──────────────────────

CREATE OR REPLACE VIEW v_client_active_countries AS
SELECT
  client_id,
  country_code,
  SUM(cost) AS total_spend,
  SUM(conversions) AS total_conversions,
  SUM(conversions_value) AS total_revenue,
  COUNT(DISTINCT month) AS months_active,
  MIN(month) AS first_month,
  MAX(month) AS last_month,
  RANK() OVER (PARTITION BY client_id ORDER BY SUM(cost) DESC) AS spend_rank
FROM ads_country_monthly
WHERE cost > 0
GROUP BY client_id, country_code;


-- ─── View: Dominante land per campagne (meeste spend) ───────────────────────
-- Vervangt de huidige campaignCountryMap logica in de API route

CREATE OR REPLACE VIEW v_campaign_dominant_country AS
SELECT DISTINCT ON (client_id, campaign_id)
  client_id,
  campaign_id,
  campaign_name,
  country_code AS dominant_country,
  cost AS country_cost,
  campaign_spend_share
FROM ads_campaign_country_monthly
WHERE month >= (CURRENT_DATE - INTERVAL '6 months')::date
ORDER BY client_id, campaign_id, cost DESC;


-- ─── View: Land-niveau maandoverzicht (voor rapportage) ────────────────────

CREATE OR REPLACE VIEW v_country_monthly_report AS
SELECT
  cm.client_id,
  cm.country_code,
  cm.month,
  cm.impressions,
  cm.clicks,
  cm.cost,
  cm.conversions,
  cm.conversions_value,
  cm.ctr,
  cm.avg_cpc,
  cm.cost_per_conversion,
  cm.conversion_rate,
  cm.roas,
  cm.campaign_count,
  cm.spend_share,
  -- YoY erbij
  yoy.impressions_yoy_pct,
  yoy.clicks_yoy_pct,
  yoy.cost_yoy_pct,
  yoy.conversions_yoy_pct,
  yoy.conversions_value_yoy_pct,
  yoy.roas_yoy_pct,
  yoy.cost_per_conversion_yoy_pct,
  -- IS erbij
  cis.search_impression_share,
  cis.search_budget_lost_is,
  cis.search_rank_lost_is,
  cis.total_daily_budget,
  cis.budget_utilization
FROM ads_country_monthly cm
LEFT JOIN ads_country_yoy yoy
  ON cm.client_id = yoy.client_id
  AND cm.country_code = yoy.country_code
  AND cm.month = yoy.month
LEFT JOIN ads_country_impression_share cis
  ON cm.client_id = cis.client_id
  AND cm.country_code = cis.country_code
  AND cm.month = cis.month;


-- ============================================================================
-- REGISTER IN DIMENSION AVAILABILITY
-- ============================================================================

INSERT INTO ads_dimension_availability (client_id, dimension, is_available, data_source, notes)
SELECT DISTINCT
  client_id,
  'country_monthly',
  true,
  'google_ads',
  'Aggregated from geo_performance_monthly by country_code'
FROM ads_country_monthly
ON CONFLICT (client_id, dimension) DO UPDATE SET
  is_available = true,
  row_count = (SELECT COUNT(*) FROM ads_country_monthly WHERE client_id = EXCLUDED.client_id),
  synced_at = NOW();


-- ============================================================================
-- NOTES
--
-- Populatie volgorde na elke sync:
--   1. ads_geo_performance_monthly (al in orchestrator)
--   2. ads_campaign_country_monthly (aggregatie uit geo data)
--   3. ads_country_monthly (aggregatie uit geo data)
--   4. ads_country_yoy (self-join op ads_country_monthly)
--   5. ads_country_impression_share (join campaign_country + impression_share)
--
-- Voor search term analyse per land:
--   JOIN ads_search_terms_monthly st
--     ON ads_campaign_country_monthly ccm
--     WHERE ccm.campaign_spend_share > 0.5  -- campagne is >50% in dit land
--   Of gebruik v_campaign_dominant_country voor 1-op-1 mapping.
--
-- Voor weekly data per land:
--   ads_country_weekly table is klaar — vereist toevoeging van
--   getGeoPerformanceByWeek() in lib/api/google-ads.ts met
--   segments.week in plaats van segments.month.
--
-- Impression share per land is een SCHATTING:
--   Google Ads levert IS niet per geo. De waarden zijn gewogen
--   gemiddelden op basis van campagne spend-aandeel per land.
--   Bij campagnes die maar 1 land targeten is dit exact.
--   Bij multi-country campagnes is het een proxy.
-- ============================================================================
