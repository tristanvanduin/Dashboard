-- ============================================================================
-- DIMENSIONAL DATA TABLES — Phase 1
--
-- Adds structured dimensional tables for SOP analysis coverage.
-- Run in Supabase SQL Editor.
--
-- Tables created:
--   1.  ads_keyword_performance_monthly    — keyword-level metrics by month
--   2.  ads_search_terms_monthly           — all search terms (not just wasteful) by month
--   3.  ads_product_performance_monthly    — shopping/PMax product metrics by month
--   4.  ads_device_performance_monthly     — device segment (mobile/desktop/tablet) by month
--   5.  ads_geo_performance_monthly        — geographic performance by month
--   6.  ads_network_performance_monthly    — network segment (search/display/youtube) by month
--   7.  ads_creative_performance           — ad copy / RSA headline & description performance
--   8.  ads_asset_group_performance_monthly — PMax asset group metrics by month
--   9.  ads_audience_performance_monthly   — audience segment performance by month
--  10.  ads_ad_schedule_performance        — hour-of-day / day-of-week performance
--  11.  ads_dimension_availability         — tracks which dimensions are available per client
--
-- Design principles:
--   - Naming: ads_{dimension}_{granularity} (consistent with existing ads_* tables)
--   - All tables have: client_id, synced_at, id (uuid pk)
--   - Time-based tables have: month (date, first of month) as standard grain
--   - Upsert keys documented per table
--   - RLS enabled with permissive policy (same pattern as existing tables)
-- ============================================================================


-- ============================================================================
-- 1. KEYWORD PERFORMANCE (monthly)
-- Source: Google Ads keyword_view + segments.month
-- Grain: client_id / keyword_id / month
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_keyword_performance_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,                         -- first day of month (YYYY-MM-01)
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  ad_group_id text NOT NULL,
  ad_group_name text NOT NULL,
  keyword_id text NOT NULL,                    -- criterion_id
  keyword_text text NOT NULL,
  match_type text NOT NULL,                    -- EXACT, PHRASE, BROAD
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  avg_cpc numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  cost_per_conversion numeric DEFAULT 0,
  quality_score integer,                        -- nullable: not always available
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, keyword_id, month)
);

ALTER TABLE ads_keyword_performance_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_keyword_performance_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_keyword_perf_client_month
  ON ads_keyword_performance_monthly (client_id, month);


-- ============================================================================
-- 2. SEARCH TERMS (monthly, ALL terms — not just wasteful)
-- Source: Google Ads search_term_view + segments.month
-- Grain: client_id / search_term / campaign_id / ad_group_id / month
-- Note: extends ads_search_terms_wasteful which only stores 0-conversion terms
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_search_terms_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text,
  campaign_name text NOT NULL,
  ad_group_id text,
  ad_group_name text NOT NULL,
  search_term text NOT NULL,
  match_type text,                              -- how the search term matched
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, search_term, campaign_name, ad_group_name, month)
);

ALTER TABLE ads_search_terms_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_search_terms_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_search_terms_monthly_client_month
  ON ads_search_terms_monthly (client_id, month);


-- ============================================================================
-- 3. PRODUCT PERFORMANCE (monthly)
-- Source: Google Ads shopping_performance_view + asset_group_product_group_view
-- Grain: client_id / product_id / campaign_name / month
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_product_performance_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_name text NOT NULL,
  campaign_type text,                           -- SHOPPING or PERFORMANCE_MAX
  product_title text NOT NULL,
  product_id text,                              -- item_id from Merchant Center (nullable for PMax asset groups)
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  roas numeric DEFAULT 0,
  cost_per_conversion numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, product_title, campaign_name, month)
);

ALTER TABLE ads_product_performance_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_product_performance_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_product_perf_client_month
  ON ads_product_performance_monthly (client_id, month);


-- ============================================================================
-- 4. DEVICE PERFORMANCE (monthly)
-- Source: Google Ads customer resource + segments.device + segments.month
-- Grain: client_id / device / month (account-level)
-- Also: campaign-level device breakdown stored in same table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_device_performance_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  device text NOT NULL,                         -- MOBILE, DESKTOP, TABLET, OTHER
  -- level: 'account' or 'campaign'
  level text NOT NULL DEFAULT 'account',
  campaign_id text,
  campaign_name text,
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  avg_cpc numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  cost_per_conversion numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now()
);

ALTER TABLE ads_device_performance_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_device_performance_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_perf_unique
  ON ads_device_performance_monthly (client_id, device, level, COALESCE(campaign_id, '__none__'), month);

CREATE INDEX IF NOT EXISTS idx_device_perf_client_month
  ON ads_device_performance_monthly (client_id, month);


-- ============================================================================
-- 5. GEO PERFORMANCE (monthly)
-- Source: Google Ads geographic_view + segments.month
-- Grain: client_id / geo_target_constant / campaign_id / month
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_geo_performance_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text,
  campaign_name text,
  country_code text,                            -- e.g. NL, BE, DE
  region_name text,                             -- province/state
  city_name text,                               -- city (nullable)
  geo_target_id text,                           -- Google geo_target_constant ID
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now()
);

ALTER TABLE ads_geo_performance_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_geo_performance_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_perf_unique
  ON ads_geo_performance_monthly (client_id, COALESCE(geo_target_id, '__none__'), COALESCE(campaign_id, '__none__'), month);

CREATE INDEX IF NOT EXISTS idx_geo_perf_client_month
  ON ads_geo_performance_monthly (client_id, month);


-- ============================================================================
-- 6. NETWORK PERFORMANCE (monthly)
-- Source: Google Ads customer/campaign + segments.ad_network_type + segments.month
-- Grain: client_id / network_type / campaign_id / month
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_network_performance_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  network_type text NOT NULL,                   -- SEARCH, CONTENT, YOUTUBE_WATCH, MIXED, etc.
  campaign_id text,
  campaign_name text,
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now()
);

ALTER TABLE ads_network_performance_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_network_performance_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_network_perf_unique
  ON ads_network_performance_monthly (client_id, network_type, COALESCE(campaign_id, '__none__'), month);

CREATE INDEX IF NOT EXISTS idx_network_perf_client_month
  ON ads_network_performance_monthly (client_id, month);


-- ============================================================================
-- 7. CREATIVE PERFORMANCE (ad-level, snapshot with metrics)
-- Source: Google Ads ad_group_ad + metrics
-- Grain: client_id / ad_id / month
-- Note: stores RSA headline/description text for ad copy analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_creative_performance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text,
  campaign_name text NOT NULL,
  ad_group_id text,
  ad_group_name text NOT NULL,
  ad_id text NOT NULL,
  ad_type text,                                 -- RESPONSIVE_SEARCH_AD, etc.
  headlines jsonb,                              -- array of headline strings
  descriptions jsonb,                           -- array of description strings
  final_urls jsonb,                             -- array of URL strings
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, ad_id, month)
);

ALTER TABLE ads_creative_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_creative_performance
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_creative_perf_client_month
  ON ads_creative_performance (client_id, month);


-- ============================================================================
-- 8. ASSET GROUP PERFORMANCE (PMax, monthly)
-- Source: Google Ads asset_group + metrics + segments.month
-- Grain: client_id / asset_group_id / month
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_asset_group_performance_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  asset_group_id text NOT NULL,
  asset_group_name text NOT NULL,
  asset_group_status text,                      -- ENABLED, PAUSED, REMOVED
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, asset_group_id, month)
);

ALTER TABLE ads_asset_group_performance_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_asset_group_performance_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_asset_group_perf_client_month
  ON ads_asset_group_performance_monthly (client_id, month);


-- ============================================================================
-- 9. AUDIENCE PERFORMANCE (monthly)
-- Source: Google Ads ad_group_audience_view + segments.month
-- Grain: client_id / audience_id / ad_group_id / month
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_audience_performance_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text,
  campaign_name text,
  ad_group_id text,
  ad_group_name text,
  audience_id text NOT NULL,                    -- criterion ID for the audience
  audience_name text,                           -- human-readable name if available
  audience_type text,                           -- AFFINITY, IN_MARKET, CUSTOM, REMARKETING, etc.
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now()
);

ALTER TABLE ads_audience_performance_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_audience_performance_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audience_perf_unique
  ON ads_audience_performance_monthly (client_id, audience_id, COALESCE(ad_group_id, '__none__'), month);

CREATE INDEX IF NOT EXISTS idx_audience_perf_client_month
  ON ads_audience_performance_monthly (client_id, month);


-- ============================================================================
-- 10. AD SCHEDULE PERFORMANCE (aggregated, not monthly — small dataset)
-- Source: Google Ads campaign + segments.hour_of_day + segments.day_of_week
-- Grain: client_id / campaign_id / day_of_week / hour_of_day
-- Note: uses last 30 days aggregate, not monthly series
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_ad_schedule_performance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  period_start date NOT NULL,                   -- start of aggregation period
  period_end date NOT NULL,                     -- end of aggregation period
  campaign_id text,
  campaign_name text,
  day_of_week text NOT NULL,                    -- MONDAY, TUESDAY, etc.
  hour_of_day integer NOT NULL,                 -- 0-23
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  -- metadata
  synced_at timestamptz DEFAULT now()
);

ALTER TABLE ads_ad_schedule_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_ad_schedule_performance
  FOR ALL USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_perf_unique
  ON ads_ad_schedule_performance (client_id, COALESCE(campaign_id, '__none__'), day_of_week, hour_of_day, period_start);

CREATE INDEX IF NOT EXISTS idx_schedule_perf_client
  ON ads_ad_schedule_performance (client_id, period_start);


-- ============================================================================
-- 11. DIMENSION AVAILABILITY
-- Purpose: tracks which dimensional data is available per client and period
-- Used by: analysis engine to know which SOP sections can be supported
--
-- Populated by: backfill script after sync completes
-- Read by: enrichment layer / analysis routes
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_dimension_availability (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  dimension text NOT NULL,                      -- e.g. 'keyword_performance', 'device_performance', etc.
  is_available boolean DEFAULT false,
  row_count integer DEFAULT 0,                  -- how many rows exist for latest period
  latest_month date,                            -- most recent month with data
  earliest_month date,                          -- earliest month with data
  months_available integer DEFAULT 0,           -- total months with data
  is_partial boolean DEFAULT false,             -- true if data may be incomplete
  data_source text DEFAULT 'google_ads',        -- google_ads, ga4, manual, etc.
  notes text,                                   -- e.g. "Quality scores not available for all keywords"
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, dimension)
);

ALTER TABLE ads_dimension_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_dimension_availability
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dim_avail_client
  ON ads_dimension_availability (client_id);


-- ============================================================================
-- NOTES FOR LATER ANALYSIS CODE
--
-- Consuming these tables:
-- 1. Check ads_dimension_availability first to know what's available
-- 2. Join on client_id + month for time-based analysis
-- 3. Link campaign_id/campaign_name to ads_campaign_monthly for context
-- 4. Link ad_group_id to ads_adgroup_monthly where needed
--
-- Dimensions NOT implemented (require GA4):
-- - engagement_metrics (bounce rate, avg session duration, pages/session)
-- - checkout_metrics (add_to_cart, begin_checkout, purchase funnel)
-- These are marked in ads_dimension_availability with data_source='ga4_required'
-- and is_available=false when the availability row is seeded.
-- ============================================================================
