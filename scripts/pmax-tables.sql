-- ============================================================================
-- PMAX Intelligence Tables
-- Run in Supabase SQL Editor
-- ============================================================================

-- 1. PMAX Asset-level Performance
-- Source: asset_group_asset resource
-- Grain: client_id / asset_group_id / asset_id / month
CREATE TABLE IF NOT EXISTS ads_pmax_asset_performance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  asset_group_id text NOT NULL,
  asset_group_name text NOT NULL,
  asset_id text NOT NULL,
  asset_type text,                    -- TEXT, IMAGE, YOUTUBE_VIDEO, MEDIA_BUNDLE, etc.
  asset_text text,                    -- headline/description text if TEXT type
  asset_url text,                     -- image/video URL if available
  performance_label text,             -- BEST, GOOD, LOW, LEARNING, PENDING, UNSPECIFIED
  -- metrics (where available)
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, asset_group_id, asset_id, month)
);

ALTER TABLE ads_pmax_asset_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON ads_pmax_asset_performance FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_pmax_asset_client_month ON ads_pmax_asset_performance (client_id, month);

-- 2. PMAX Asset Group x Network Breakdown
-- Source: asset_group + segments.ad_network_type
-- Grain: client_id / asset_group_id / network_type / month
CREATE TABLE IF NOT EXISTS ads_pmax_network_breakdown (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  asset_group_id text NOT NULL,
  asset_group_name text NOT NULL,
  network_type text NOT NULL,         -- SEARCH, CONTENT, YOUTUBE_WATCH, MIXED, etc.
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  synced_at timestamptz DEFAULT now()
);

ALTER TABLE ads_pmax_network_breakdown ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON ads_pmax_network_breakdown FOR ALL USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmax_network_unique
  ON ads_pmax_network_breakdown (client_id, asset_group_id, network_type, month);
CREATE INDEX IF NOT EXISTS idx_pmax_network_client_month ON ads_pmax_network_breakdown (client_id, month);

-- 3. PMAX Placement Performance
-- Source: group_placement_view
-- Grain: client_id / asset_group_id / placement / month
CREATE TABLE IF NOT EXISTS ads_pmax_placements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text,
  campaign_name text,
  asset_group_id text,
  placement text NOT NULL,            -- URL or app package name
  placement_type text,                -- WEBSITE, YOUTUBE_VIDEO, YOUTUBE_CHANNEL, MOBILE_APP, etc.
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  synced_at timestamptz DEFAULT now()
);

ALTER TABLE ads_pmax_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON ads_pmax_placements FOR ALL USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmax_placements_unique
  ON ads_pmax_placements (client_id, COALESCE(asset_group_id, '__none__'), placement, month);
CREATE INDEX IF NOT EXISTS idx_pmax_placements_client_month ON ads_pmax_placements (client_id, month);

-- 4. PMAX Search Categories / Themes
-- Source: campaign_search_term_insight
-- Grain: client_id / campaign_id / category_label / month
CREATE TABLE IF NOT EXISTS ads_pmax_search_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  month date NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  category_label text NOT NULL,       -- search category from Google
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  synced_at timestamptz DEFAULT now()
);

ALTER TABLE ads_pmax_search_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON ads_pmax_search_categories FOR ALL USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmax_search_cat_unique
  ON ads_pmax_search_categories (client_id, campaign_id, category_label, month);
CREATE INDEX IF NOT EXISTS idx_pmax_search_cat_client_month ON ads_pmax_search_categories (client_id, month);
