// Pure mapping van een getypeerde rij naar de snake_case kolommen van de linkedin_*_daily
// en linkedin_demographic_daily tabellen. Los testbaar, geen I/O. Spiegelt het Meta-patroon;
// conversion_value is ENKELVOUD.

import type { LinkedInDailyRow, LinkedInDemographicRow } from "./types";

// Mapt een dagrij naar een linkedin_account_daily / linkedin_campaign_daily /
// linkedin_creative_daily rij. De tabel volgt uit het sync-niveau, niet uit de rij.
export function linkedinDailyToDbRow(row: LinkedInDailyRow, clientId: string): Record<string, unknown> {
  return {
    client_id: clientId,
    date: row.date,
    entity_urn: row.entityUrn,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    ctr: row.ctr,
    cpc: row.cpc,
    cpm: row.cpm,
    landing_page_clicks: row.landingPageClicks,
    one_click_lead_form_opens: row.oneClickLeadFormOpens,
    one_click_leads: row.oneClickLeads,
    external_website_conversions: row.externalWebsiteConversions,
    post_click_conversions: row.postClickConversions,
    conversion_value: row.conversionValue,
    cpl: row.cpl,
    form_completion_rate: row.formCompletionRate,
    video_starts: row.videoStarts,
    video_views: row.videoViews,
    video_completions: row.videoCompletions,
    video_completion_rate: row.videoCompletionRate,
    total_engagements: row.totalEngagements,
    follows: row.follows,
    reactions: row.reactions,
    comments: row.comments,
    shares: row.shares,
    updated_at: new Date().toISOString(),
  };
}

// Mapt een demografie-segmentrij (of de TOTAL-samenvattingsrij) naar een
// linkedin_demographic_daily rij. LONG format: een rij per segment per dag.
export function linkedinDemographicToDbRow(row: LinkedInDemographicRow, clientId: string): Record<string, unknown> {
  return {
    client_id: clientId,
    date: row.date,
    level: row.level,
    entity_urn: row.entityUrn,
    pivot_type: row.pivotType,
    pivot_value_urn: row.pivotValueUrn,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    leads: row.leads,
    conversions: row.conversions,
    coverage_pct: row.coveragePct,
    updated_at: new Date().toISOString(),
  };
}

// Composite-key kolommen voor de upsert onConflict, exact gelijk aan de unique-constraints
// in de migratie. Zelfde upsert-patroon als de Meta- en Google-orchestrators.
export const LINKEDIN_DAILY_CONFLICT = "client_id,date,entity_urn";
export const LINKEDIN_DEMOGRAPHIC_CONFLICT = "client_id,date,level,entity_urn,pivot_type,pivot_value_urn";
