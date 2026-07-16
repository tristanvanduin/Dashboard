// Pure mapping van een getypeerde dagrij naar de snake_case kolommen van de
// meta_*_daily en meta_breakdown_daily tabellen. Los testbaar, geen I/O.

import type { MetaDailyRow } from "./types";

// Mapt een dagrij naar een meta_*_daily rij. includeRankings voegt de drie ad-level
// ranking-kolommen toe (alleen voor meta_ad_daily).
export function metaDailyToDbRow(
  row: MetaDailyRow,
  clientId: string,
  options: { includeRankings?: boolean } = {}
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    client_id: clientId,
    date: row.date,
    entity_id: row.entityId,
    impressions: row.impressions,
    reach: row.reach,
    frequency: row.frequency,
    clicks_all: row.clicksAll,
    link_clicks: row.linkClicks,
    spend: row.spend,
    cpm: row.cpm,
    cpc_link: row.cpcLink,
    ctr_link: row.ctrLink,
    conversions: row.conversions,
    conversion_value: row.conversionValue,
    purchase_roas: row.purchaseRoas,
    cpa: row.cpa,
    roas: row.roas,
    leads: row.leads,
    add_to_cart: row.addToCart,
    initiate_checkout: row.initiateCheckout,
    landing_page_views: row.landingPageViews,
    video_3s_views: row.video3sViews,
    video_thruplay: row.videoThruplay,
    video_p25: row.videoP25,
    video_p50: row.videoP50,
    video_p75: row.videoP75,
    video_p100: row.videoP100,
    post_engagement: row.postEngagement,
    hook_rate: row.hookRate,
    hold_rate: row.holdRate,
    updated_at: new Date().toISOString(),
  };
  if (options.includeRankings) {
    base.quality_ranking = row.qualityRanking;
    base.engagement_rate_ranking = row.engagementRateRanking;
    base.conversion_rate_ranking = row.conversionRateRanking;
  }
  return base;
}

// Mapt een breakdown-dagrij naar een meta_breakdown_daily rij (subset metrieken). De
// breakdown-dimensie (type en waarde) komt uit de gevraagde breakdown, niet uit de rij.
export function metaBreakdownToDbRow(
  row: MetaDailyRow,
  clientId: string,
  meta: { level: string; entityId: string; breakdownType: string; breakdownValue: string }
): Record<string, unknown> {
  return {
    client_id: clientId,
    date: row.date,
    level: meta.level,
    entity_id: meta.entityId,
    breakdown_type: meta.breakdownType,
    breakdown_value: meta.breakdownValue,
    impressions: row.impressions,
    clicks_all: row.clicksAll,
    link_clicks: row.linkClicks,
    spend: row.spend,
    conversions: row.conversions,
    conversion_value: row.conversionValue,
    video_3s_views: row.video3sViews,
    video_thruplay: row.videoThruplay,
    updated_at: new Date().toISOString(),
  };
}

// Composite-key kolommen voor de upsert onConflict, exact gelijk aan de unique-constraints
// in scripts/migrations/007_meta.sql. Zelfde upsert-patroon als de Google-orchestrator.
export const META_DAILY_CONFLICT = "client_id,date,entity_id";
export const META_BREAKDOWN_CONFLICT = "client_id,date,level,entity_id,breakdown_type,breakdown_value";
