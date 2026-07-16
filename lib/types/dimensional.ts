/**
 * TypeScript types for the dimensional data tables.
 * Maps to the Supabase tables created in scripts/dimensional-tables.sql.
 */

// ── Keyword Performance ────────────────────────────────────────────────────

export interface KeywordPerformanceMonthly {
  client_id: string;
  month: string;          // YYYY-MM-DD (first of month)
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  keyword_id: string;
  keyword_text: string;
  match_type: string;     // EXACT, PHRASE, BROAD
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc: number;
  conversion_rate: number;
  cost_per_conversion: number;
  quality_score: number | null;
}

// ── Search Terms Monthly ───────────────────────────────────────────────────

export interface SearchTermMonthly {
  client_id: string;
  month: string;
  campaign_id: string | null;
  campaign_name: string;
  ad_group_id: string | null;
  ad_group_name: string;
  search_term: string;
  match_type: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  conversion_rate: number;
}

// ── Product Performance ────────────────────────────────────────────────────

export interface ProductPerformanceMonthly {
  client_id: string;
  month: string;
  campaign_name: string;
  campaign_type: string | null;  // SHOPPING or PERFORMANCE_MAX
  product_title: string;
  product_id: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  roas: number;
  cost_per_conversion: number;
}

export interface GoogleAdsProductPerformance {
  client_id: string;
  date: string;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  product_item_id: string;
  product_title: string | null;
  product_type_l1: string | null;
  product_type_l2: string | null;
  product_type_l3: string | null;
  product_type_l4: string | null;
  product_type_l5: string | null;
  product_brand: string | null;
  custom_label_0: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  custom_label_4: string | null;
  mc_availability: string | null;
  mc_price: number | null;
  mc_sale_price: number | null;
  mc_condition: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversion_value: number;
}

// ── Device Performance ─────────────────────────────────────────────────────

export type DeviceType = "MOBILE" | "DESKTOP" | "TABLET" | "OTHER";

export interface DevicePerformanceMonthly {
  client_id: string;
  month: string;
  device: DeviceType;
  level: "account" | "campaign";
  campaign_id: string | null;
  campaign_name: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc: number;
  conversion_rate: number;
  cost_per_conversion: number;
}

// ── Geo Performance ────────────────────────────────────────────────────────

export interface GeoPerformanceMonthly {
  client_id: string;
  month: string;
  campaign_id: string | null;
  campaign_name: string | null;
  country_code: string | null;
  region_name: string | null;
  city_name: string | null;
  geo_target_id: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  conversion_rate: number;
}

// ── Network Performance ────────────────────────────────────────────────────

export type NetworkType = "SEARCH" | "CONTENT" | "YOUTUBE_WATCH" | "MIXED" | "UNSPECIFIED";

export interface NetworkPerformanceMonthly {
  client_id: string;
  month: string;
  network_type: NetworkType;
  campaign_id: string | null;
  campaign_name: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  conversion_rate: number;
}

// ── Creative Performance ───────────────────────────────────────────────────

export interface CreativePerformance {
  client_id: string;
  month: string;
  campaign_id: string | null;
  campaign_name: string;
  ad_group_id: string | null;
  ad_group_name: string;
  ad_id: string;
  ad_type: string | null;
  headlines: string[] | null;      // JSON array of headline texts
  descriptions: string[] | null;   // JSON array of description texts
  final_urls: string[] | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  conversion_rate: number;
}

// ── Asset Group Performance (PMax) ─────────────────────────────────────────

export interface AssetGroupPerformanceMonthly {
  client_id: string;
  month: string;
  campaign_id: string;
  campaign_name: string;
  asset_group_id: string;
  asset_group_name: string;
  asset_group_status: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

// ── Audience Performance ───────────────────────────────────────────────────

export interface AudiencePerformanceMonthly {
  client_id: string;
  month: string;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  audience_id: string;
  audience_name: string | null;
  audience_type: string | null;  // AFFINITY, IN_MARKET, CUSTOM, REMARKETING
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  conversion_rate: number;
}

// ── Ad Schedule Performance ────────────────────────────────────────────────

export type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

export interface AdSchedulePerformance {
  client_id: string;
  period_start: string;
  period_end: string;
  campaign_id: string | null;
  campaign_name: string | null;
  day_of_week: DayOfWeek;
  hour_of_day: number;   // 0-23
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

export interface CheckoutFunnelPerformance {
  client_id: string;
  date: string;
  campaign_id: string | null;
  campaign_name: string | null;
  device: string | null;
  sessions: number | null;
  add_to_cart_count: number;
  add_to_cart_value: number;
  begin_checkout_count: number;
  begin_checkout_value: number;
  purchase_count: number;
  purchase_value: number;
  atc_to_checkout_rate: number;
  checkout_to_purchase_rate: number;
  overall_conversion_rate: number;
}

// ── Dimension Availability ─────────────────────────────────────────────────

export type DimensionName =
  | "account_monthly"
  | "account_weekly"
  | "campaign_monthly"
  | "adgroup_monthly"
  | "impression_share"
  | "search_terms_wasteful"
  | "keyword_performance"
  | "search_terms_monthly"
  | "product_performance"
  | "device_performance"
  | "geo_performance"
  | "network_performance"
  | "creative_performance"
  | "asset_group_performance"
  | "audience_performance"
  | "ad_schedule_performance"
  | "engagement_metrics"     // GA4 required — not yet available
  | "checkout_metrics";      // GA4 required — not yet available

export type DataSource = "google_ads" | "ga4_required" | "manual" | "calculated";

export interface DimensionAvailability {
  client_id: string;
  dimension: DimensionName;
  is_available: boolean;
  row_count: number;
  latest_month: string | null;
  earliest_month: string | null;
  months_available: number;
  is_partial: boolean;
  data_source: DataSource;
  notes: string | null;
}

// ── Helper: all dimension table names for backfill ─────────────────────────

export const DIMENSIONAL_TABLES = {
  keyword_performance: "ads_keyword_performance_monthly",
  search_terms_monthly: "ads_search_terms_monthly",
  product_performance: "ads_product_performance_monthly",
  device_performance: "ads_device_performance_monthly",
  geo_performance: "ads_geo_performance_monthly",
  network_performance: "ads_network_performance_monthly",
  creative_performance: "ads_creative_performance",
  asset_group_performance: "ads_asset_group_performance_monthly",
  audience_performance: "ads_audience_performance_monthly",
  ad_schedule_performance: "ads_ad_schedule_performance",
} as const;
