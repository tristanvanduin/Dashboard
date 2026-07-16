/**
 * Backfill script — fetches 13 months of Google Ads data for every
 * client in Supabase and writes it to the corresponding tables.
 *
 * Prerequisites:
 *   1. Run scripts/backfill-schema.sql in the Supabase SQL Editor
 *   2. Ensure .env.local has all Google Ads + Supabase credentials
 *
 * Usage:
 *   npx tsx scripts/backfill-google-ads.ts
 *
 * Optional flags:
 *   --dry-run       Log what would happen without writing to Supabase
 *   --client=<id>   Only backfill a single client (by client id)
 */

import * as fs from "fs";
import * as path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getAccountMetricsByMonth,
  getAccountMetricsByWeek,
  getCampaignMetricsByMonth,
  getCampaignImpressionShareByMonth,
  getAdGroupPerformanceByMonth,
  getWastefulSearchTermsByMonth,
  getChangeHistory,
  getCampaignMetadata,
  getKeywordPerformanceByMonth,
  getSearchTermsByMonth,
  getProductPerformanceByMonth,
  getDevicePerformanceByMonth,
  getGeoPerformanceByMonth,
  getNetworkPerformanceByMonth,
  getCreativePerformanceByMonth,
  getAssetGroupPerformanceByMonth,
  getAudiencePerformanceByMonth,
  getAdSchedulePerformance,
  type GoogleAdsCredentials,
} from "../lib/api/google-ads";

// ── Load .env.local ─────────────────────────────────────────────────────────

function loadEnv(): void {
  const envPath = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local niet gevonden. Zorg dat het bestand bestaat.");
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

// ── Config & Clients ────────────────────────────────────────────────────────

interface Client {
  id: string;
  name: string;
  googleAdsCustomerId?: string;
  source: "demo" | "google-ads" | "meta-ads";
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SINGLE_CLIENT = args.find((a) => a.startsWith("--client="))?.split("=")[1];

function getCredentials(): GoogleAdsCredentials {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    console.error("❌ Google Ads credentials ontbreken in .env.local");
    process.exit(1);
  }

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
}

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("❌ Supabase URL of service role key ontbreekt in .env.local");
    process.exit(1);
  }

  return createClient(url, serviceKey);
}

// ── Dedup helper ───────────────────────────────────────────────────────────

/**
 * Deduplicate rows by a composite key before upserting.
 * When duplicates exist, keeps the last occurrence (which typically has the most data).
 * This prevents "ON CONFLICT DO UPDATE command cannot affect row a second time" errors.
 */
function dedup(rows: Record<string, unknown>[], keyColumns: string[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = keyColumns.map((c) => String(row[c] ?? "")).join("|||");
    seen.set(key, row);
  }
  return Array.from(seen.values());
}

// ── Date helpers ────────────────────────────────────────────────────────────

function getDateRange13Months(): { startDate: string; endDate: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setMonth(start.getMonth() - 13);
  start.setDate(1); // first day of that month

  return {
    startDate: fmt(start),
    endDate: fmt(end),
  };
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

// ── Upsert helpers ──────────────────────────────────────────────────────────

async function upsertBatch(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  conflictColumns: string
): Promise<number> {
  if (rows.length === 0) return 0;

  // Supabase upsert in chunks of 500
  const CHUNK = 500;
  let written = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict: conflictColumns, ignoreDuplicates: false });

    if (error) {
      console.error(`  ⚠️  Fout bij ${table} (chunk ${i / CHUNK + 1}):`, error.message);
    } else {
      written += chunk.length;
    }
  }

  return written;
}

/**
 * Delete existing rows for a client, then insert fresh data.
 * Used for tables without a unique constraint suitable for upsert.
 */
async function replaceBatch(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  clientId: string
): Promise<number> {
  // Always delete old data for this client first
  await supabase.from(table).delete().eq("client_id", clientId);

  if (rows.length === 0) return 0;

  const CHUNK = 500;
  let written = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).insert(chunk);

    if (error) {
      console.error(`  ⚠️  Fout bij ${table} (chunk ${i / CHUNK + 1}):`, error.message);
    } else {
      written += chunk.length;
    }
  }

  return written;
}

// ── Main backfill per client ────────────────────────────────────────────────

async function backfillClient(
  credentials: GoogleAdsCredentials,
  supabase: SupabaseClient,
  client: Client
): Promise<void> {
  const customerId = client.googleAdsCustomerId!;
  const clientId = client.id;
  const { startDate, endDate } = getDateRange13Months();
  const now = new Date().toISOString();

  console.log(`\n── ${client.name} (${customerId}) ──`);
  console.log(`   Periode: ${startDate} → ${endDate}`);

  // Fetch conversion action filter from client_settings
  const { data: settingsData } = await supabase
    .from("client_settings")
    .select("conversion_actions")
    .eq("client_id", clientId)
    .maybeSingle();

  let convActionIds: string[] | undefined;
  if (settingsData?.conversion_actions && Array.isArray(settingsData.conversion_actions)) {
    const included = (settingsData.conversion_actions as Array<{ id: string; includedInDashboard?: boolean }>)
      .filter((a) => a.includedInDashboard)
      .map((a) => a.id);
    if (included.length > 0) {
      convActionIds = included;
      console.log(`   Conversiefilter: ${included.length} actie(s) (includedInDashboard)`);
    }
  }
  if (!convActionIds) {
    console.log(`   Conversiefilter: geen (alle conversies)`);
  }

  // Fetch all data in parallel — core tables + dimensional tables
  const [
    monthlyRaw,
    weeklyRaw,
    campaignsRaw,
    impressionShareRaw,
    adGroupRaw,
    searchTermsRaw,
    changeHistoryRaw,
    campaignMetadataRaw,
    // Dimensional tables
    keywordPerfRaw,
    searchTermsFullRaw,
    productPerfRaw,
    devicePerfRaw,
    geoPerfRaw,
    networkPerfRaw,
    creativePerfRaw,
    assetGroupPerfRaw,
    audiencePerfRaw,
    schedulePerfRaw,
  ] = await Promise.all([
    getAccountMetricsByMonth(credentials, customerId, startDate, endDate, convActionIds),
    getAccountMetricsByWeek(credentials, customerId, startDate, endDate),
    getCampaignMetricsByMonth(credentials, customerId, startDate, endDate, convActionIds),
    getCampaignImpressionShareByMonth(credentials, customerId, startDate, endDate),
    getAdGroupPerformanceByMonth(credentials, customerId, startDate, endDate),
    getWastefulSearchTermsByMonth(credentials, customerId, startDate, endDate),
    getChangeHistory(credentials, customerId),
    getCampaignMetadata(credentials, customerId),
    // Dimensional queries (all gracefully return [] on error)
    getKeywordPerformanceByMonth(credentials, customerId, startDate, endDate),
    getSearchTermsByMonth(credentials, customerId, startDate, endDate),
    getProductPerformanceByMonth(credentials, customerId, startDate, endDate),
    getDevicePerformanceByMonth(credentials, customerId, startDate, endDate),
    getGeoPerformanceByMonth(credentials, customerId, startDate, endDate),
    getNetworkPerformanceByMonth(credentials, customerId, startDate, endDate),
    getCreativePerformanceByMonth(credentials, customerId, startDate, endDate),
    getAssetGroupPerformanceByMonth(credentials, customerId, startDate, endDate),
    getAudiencePerformanceByMonth(credentials, customerId, startDate, endDate),
    getAdSchedulePerformance(credentials, customerId, startDate, endDate),
  ]);

  console.log(`   Opgehaald: ${monthlyRaw.length} maanden, ${weeklyRaw.length} weken, ${campaignsRaw.length} campaign-rows`);
  console.log(`   + ${impressionShareRaw.length} IS, ${adGroupRaw.length} ad groups, ${searchTermsRaw.length} search terms, ${changeHistoryRaw.length} changes, ${campaignMetadataRaw.length} metadata`);
  console.log(`   + dimensioneel: ${keywordPerfRaw.length} keywords, ${searchTermsFullRaw.length} search terms (full), ${productPerfRaw.length} products, ${devicePerfRaw.length} device, ${geoPerfRaw.length} geo, ${networkPerfRaw.length} network, ${creativePerfRaw.length} creatives, ${assetGroupPerfRaw.length} asset groups, ${audiencePerfRaw.length} audiences, ${schedulePerfRaw.length} schedule`);

  if (DRY_RUN) {
    console.log("   [DRY RUN] Niet weggeschreven naar Supabase.");
    return;
  }

  // Helper to compute ROAS
  const roas = (value: number, cost: number) =>
    cost > 0 ? parseFloat((value / cost).toFixed(4)) : 0;

  // 1. ads_account_monthly
  const monthlyRows = monthlyRaw.map((m) => ({
    client_id: clientId,
    month: m.date,
    impressions: m.impressions,
    clicks: m.clicks,
    cost: m.cost,
    conversions: m.conversions,
    conversions_value: m.conversionsValue,
    ctr: m.ctr,
    avg_cpc: m.avgCpc,
    cost_per_conversion: m.costPerConversion,
    conversion_rate: m.conversionRate,
    roas: roas(m.conversionsValue, m.cost),
  }));

  // 2. ads_account_weekly
  const weeklyRows = weeklyRaw.map((m) => ({
    client_id: clientId,
    week_start: m.date,
    impressions: m.impressions,
    clicks: m.clicks,
    cost: m.cost,
    conversions: m.conversions,
    conversions_value: m.conversionsValue,
    ctr: m.ctr,
    avg_cpc: m.avgCpc,
    cost_per_conversion: m.costPerConversion,
    conversion_rate: m.conversionRate,
    roas: roas(m.conversionsValue, m.cost),
  }));

  // 3. ads_campaign_monthly
  const campaignRows = campaignsRaw.map((c) => ({
    client_id: clientId,
    campaign_id: c.campaignId,
    campaign_name: c.campaignName,
    campaign_status: c.campaignStatus,
    month: c.date,
    impressions: c.impressions,
    clicks: c.clicks,
    cost: c.cost,
    conversions: c.conversions,
    conversions_value: c.conversionsValue,
    ctr: c.ctr,
    avg_cpc: c.avgCpc,
    cost_per_conversion: c.costPerConversion,
    conversion_rate: c.conversionRate,
    roas: roas(c.conversionsValue, c.cost),
  }));

  // 4. ads_campaign_impression_share (per maand)
  const isRows = impressionShareRaw.map((is) => ({
    client_id: clientId,
    campaign_id: is.campaignId,
    campaign_name: is.campaignName,
    campaign_type: is.campaignType,
    month: is.date,
    impressions: is.impressions,
    clicks: is.clicks,
    cost: is.cost,
    conversions: is.conversions,
    search_impression_share: is.searchImpressionShare,
    search_budget_lost_is: is.searchBudgetLostIS,
    search_rank_lost_is: is.searchRankLostIS,
    daily_budget: is.dailyBudget,
    budget_utilization: is.budgetUtilization,
  }));

  // 5. ads_adgroup_monthly (per maand)
  const agRows = adGroupRaw.map((ag) => ({
    client_id: clientId,
    campaign_name: ag.campaignName,
    ad_group_id: ag.adGroupId,
    ad_group_name: ag.adGroupName,
    month: ag.date,
    impressions: ag.impressions,
    clicks: ag.clicks,
    cost: ag.cost,
    conversions: ag.conversions,
    conversions_value: ag.conversionsValue,
    cpa: ag.cpa,
    roas: ag.roas,
  }));

  // 6. ads_search_terms_wasteful (per maand)
  const stRows = searchTermsRaw.map((st) => ({
    client_id: clientId,
    week_start: st.date,
    search_term: st.searchTerm,
    campaign_name: st.campaignName,
    ad_group_name: st.adGroupName,
    impressions: st.impressions,
    clicks: st.clicks,
    cost: st.cost,
    term_status: st.status,
  }));

  // 7. ads_change_history
  const chRows = changeHistoryRaw.map((ch) => ({
    client_id: clientId,
    change_datetime: ch.changeDateTime,
    resource_type: ch.resourceType,
    change_resource_name: ch.changeResourceName,
    campaign_name: ch.campaignName,
    change_type: ch.changeType,
    old_value: ch.oldValue,
    new_value: ch.newValue,
    user_email: ch.userEmail,
  }));

  // 8. ads_campaign_metadata
  const metaRows = campaignMetadataRaw.map((cm) => ({
    client_id: clientId,
    campaign_id: cm.campaignId,
    campaign_name: cm.campaignName,
    campaign_type: cm.campaignType,
    bidding_strategy: cm.biddingStrategy,
    bidding_strategy_target: cm.biddingStrategyTarget,
    budget_amount: cm.budgetAmount,
    budget_type: cm.budgetType,
    serving_status: cm.servingStatus,
    updated_at: new Date().toISOString(),
  }));

  // ── Transform dimensional data ────────────────────────────────────────

  const kwRows = keywordPerfRaw.map((k) => ({
    client_id: clientId,
    month: k.date,
    campaign_id: k.campaignId,
    campaign_name: k.campaignName,
    ad_group_id: k.adGroupId,
    ad_group_name: k.adGroupName,
    keyword_id: k.keywordId,
    keyword_text: k.keywordText,
    match_type: k.matchType,
    impressions: k.impressions,
    clicks: k.clicks,
    cost: k.cost,
    conversions: k.conversions,
    conversions_value: k.conversionsValue,
    ctr: k.ctr,
    avg_cpc: k.avgCpc,
    conversion_rate: k.conversionRate,
    cost_per_conversion: k.costPerConversion,
    quality_score: k.qualityScore,
    synced_at: now,
  }));

  const stFullRows = searchTermsFullRaw.map((st) => ({
    client_id: clientId,
    month: st.date,
    campaign_id: st.campaignId,
    campaign_name: st.campaignName,
    ad_group_id: st.adGroupId,
    ad_group_name: st.adGroupName,
    search_term: st.searchTerm,
    match_type: st.matchType,
    impressions: st.impressions,
    clicks: st.clicks,
    cost: st.cost,
    conversions: st.conversions,
    conversions_value: st.conversionsValue,
    ctr: st.clicks > 0 && st.impressions > 0 ? st.clicks / st.impressions : 0,
    conversion_rate: st.clicks > 0 ? st.conversions / st.clicks : 0,
    synced_at: now,
  }));

  const productRows = productPerfRaw.map((p) => ({
    client_id: clientId,
    month: p.date,
    campaign_name: p.campaignName,
    campaign_type: p.campaignType,
    product_title: p.productTitle,
    product_id: p.productId || null,
    impressions: p.impressions,
    clicks: p.clicks,
    cost: p.cost,
    conversions: p.conversions,
    conversions_value: p.conversionsValue,
    ctr: p.impressions > 0 ? p.clicks / p.impressions : 0,
    roas: roas(p.conversionsValue, p.cost),
    cost_per_conversion: p.conversions > 0 ? p.cost / p.conversions : 0,
    synced_at: now,
  }));

  const deviceRows = devicePerfRaw.map((d) => ({
    client_id: clientId,
    month: d.date,
    device: d.device,
    level: d.campaignId ? "campaign" : "account",
    campaign_id: d.campaignId,
    campaign_name: d.campaignName,
    impressions: d.impressions,
    clicks: d.clicks,
    cost: d.cost,
    conversions: d.conversions,
    conversions_value: d.conversionsValue,
    ctr: d.impressions > 0 ? d.clicks / d.impressions : 0,
    avg_cpc: d.clicks > 0 ? d.cost / d.clicks : 0,
    conversion_rate: d.clicks > 0 ? d.conversions / d.clicks : 0,
    cost_per_conversion: d.conversions > 0 ? d.cost / d.conversions : 0,
    synced_at: now,
  }));

  const geoRows = geoPerfRaw.map((g) => ({
    client_id: clientId,
    month: g.date,
    campaign_id: g.campaignId,
    campaign_name: g.campaignName,
    country_code: g.countryCode || null,
    region_name: g.regionName || null,
    city_name: null,
    geo_target_id: g.geoTargetId || null,
    impressions: g.impressions,
    clicks: g.clicks,
    cost: g.cost,
    conversions: g.conversions,
    conversions_value: g.conversionsValue,
    ctr: g.impressions > 0 ? g.clicks / g.impressions : 0,
    conversion_rate: g.clicks > 0 ? g.conversions / g.clicks : 0,
    synced_at: now,
  }));

  const networkRows = networkPerfRaw.map((n) => ({
    client_id: clientId,
    month: n.date,
    network_type: n.networkType,
    campaign_id: n.campaignId,
    campaign_name: n.campaignName,
    impressions: n.impressions,
    clicks: n.clicks,
    cost: n.cost,
    conversions: n.conversions,
    conversions_value: n.conversionsValue,
    ctr: n.impressions > 0 ? n.clicks / n.impressions : 0,
    conversion_rate: n.clicks > 0 ? n.conversions / n.clicks : 0,
    synced_at: now,
  }));

  const creativeRows = creativePerfRaw.map((cr) => ({
    client_id: clientId,
    month: cr.date,
    campaign_id: cr.campaignId,
    campaign_name: cr.campaignName,
    ad_group_id: cr.adGroupId,
    ad_group_name: cr.adGroupName,
    ad_id: cr.adId,
    ad_type: cr.adType,
    headlines: JSON.stringify(cr.headlines),
    descriptions: JSON.stringify(cr.descriptions),
    final_urls: JSON.stringify(cr.finalUrls),
    impressions: cr.impressions,
    clicks: cr.clicks,
    cost: cr.cost,
    conversions: cr.conversions,
    conversions_value: cr.conversionsValue,
    ctr: cr.impressions > 0 ? cr.clicks / cr.impressions : 0,
    conversion_rate: cr.clicks > 0 ? cr.conversions / cr.clicks : 0,
    synced_at: now,
  }));

  const assetGroupRows = assetGroupPerfRaw.map((ag) => ({
    client_id: clientId,
    month: ag.date,
    campaign_id: ag.campaignId,
    campaign_name: ag.campaignName,
    asset_group_id: ag.assetGroupId,
    asset_group_name: ag.assetGroupName,
    asset_group_status: ag.assetGroupStatus,
    impressions: ag.impressions,
    clicks: ag.clicks,
    cost: ag.cost,
    conversions: ag.conversions,
    conversions_value: ag.conversionsValue,
    synced_at: now,
  }));

  const audienceRows = audiencePerfRaw.map((a) => ({
    client_id: clientId,
    month: a.date,
    campaign_id: a.campaignId,
    campaign_name: a.campaignName,
    ad_group_id: a.adGroupId,
    ad_group_name: a.adGroupName,
    audience_id: a.audienceId,
    audience_name: a.audienceName,
    audience_type: null, // not directly available in the view
    impressions: a.impressions,
    clicks: a.clicks,
    cost: a.cost,
    conversions: a.conversions,
    conversions_value: a.conversionsValue,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    conversion_rate: a.clicks > 0 ? a.conversions / a.clicks : 0,
    synced_at: now,
  }));

  const scheduleRows = schedulePerfRaw.map((s) => ({
    client_id: clientId,
    period_start: startDate,
    period_end: endDate,
    campaign_id: s.campaignId,
    campaign_name: s.campaignName,
    day_of_week: s.dayOfWeek,
    hour_of_day: s.hourOfDay,
    impressions: s.impressions,
    clicks: s.clicks,
    cost: s.cost,
    conversions: s.conversions,
    conversions_value: s.conversionsValue,
    synced_at: now,
  }));

  // ── Dedup before upsert (prevents "cannot affect row a second time") ──

  const kwRowsDeduped = dedup(kwRows, ["client_id", "keyword_id", "month"]);
  const stFullDeduped = dedup(stFullRows, ["client_id", "search_term", "campaign_name", "ad_group_name", "month"]);
  const productDeduped = dedup(productRows, ["client_id", "product_title", "campaign_name", "month"]);
  const creativeDeduped = dedup(creativeRows, ["client_id", "ad_id", "month"]);
  const assetGroupDeduped = dedup(assetGroupRows, ["client_id", "asset_group_id", "month"]);

  // ── Write all tables in parallel ────────────────────────────────────

  const results = await Promise.all([
    // Core tables
    upsertBatch(supabase, "ads_account_monthly", monthlyRows, "client_id,month"),
    upsertBatch(supabase, "ads_account_weekly", weeklyRows, "client_id,week_start"),
    upsertBatch(supabase, "ads_campaign_monthly", campaignRows, "client_id,campaign_id,month"),
    upsertBatch(supabase, "ads_campaign_impression_share", isRows, "client_id,campaign_id,month"),
    upsertBatch(supabase, "ads_adgroup_monthly", agRows, "client_id,ad_group_id,month"),
    replaceBatch(supabase, "ads_search_terms_wasteful", dedup(stRows, ["client_id", "week_start", "search_term"]), clientId),
    replaceBatch(supabase, "ads_change_history", chRows, clientId),
    upsertBatch(supabase, "ads_campaign_metadata", metaRows, "client_id,campaign_id"),
    // Dimensional tables (deduped)
    upsertBatch(supabase, "ads_keyword_performance_monthly", kwRowsDeduped, "client_id,keyword_id,month"),
    upsertBatch(supabase, "ads_search_terms_monthly", stFullDeduped, "client_id,search_term,campaign_name,ad_group_name,month"),
    upsertBatch(supabase, "ads_product_performance_monthly", productDeduped, "client_id,product_title,campaign_name,month"),
    replaceBatch(supabase, "ads_device_performance_monthly", deviceRows, clientId),
    replaceBatch(supabase, "ads_geo_performance_monthly", geoRows, clientId),
    replaceBatch(supabase, "ads_network_performance_monthly", networkRows, clientId),
    upsertBatch(supabase, "ads_creative_performance", creativeDeduped, "client_id,ad_id,month"),
    upsertBatch(supabase, "ads_asset_group_performance_monthly", assetGroupDeduped, "client_id,asset_group_id,month"),
    replaceBatch(supabase, "ads_audience_performance_monthly", audienceRows, clientId),
    replaceBatch(supabase, "ads_ad_schedule_performance", scheduleRows, clientId),
  ]);

  const labels = [
    "ads_account_monthly",
    "ads_account_weekly",
    "ads_campaign_monthly",
    "ads_campaign_impression_share",
    "ads_adgroup_monthly",
    "ads_search_terms_wasteful",
    "ads_change_history",
    "ads_campaign_metadata",
    "ads_keyword_performance_monthly",
    "ads_search_terms_monthly",
    "ads_product_performance_monthly",
    "ads_device_performance_monthly",
    "ads_geo_performance_monthly",
    "ads_network_performance_monthly",
    "ads_creative_performance",
    "ads_asset_group_performance_monthly",
    "ads_audience_performance_monthly",
    "ads_ad_schedule_performance",
  ];

  for (let i = 0; i < labels.length; i++) {
    console.log(`   ✅ ${labels[i]}: ${results[i]} rows`);
  }

  // ── Update dimension availability ───────────────────────────────────

  const dimAvailRows = [
    { dimension: "account_monthly", count: monthlyRows.length },
    { dimension: "account_weekly", count: weeklyRows.length },
    { dimension: "campaign_monthly", count: campaignRows.length },
    { dimension: "adgroup_monthly", count: agRows.length },
    { dimension: "impression_share", count: isRows.length },
    { dimension: "search_terms_wasteful", count: stRows.length },
    { dimension: "keyword_performance", count: kwRows.length },
    { dimension: "search_terms_monthly", count: stFullRows.length },
    { dimension: "product_performance", count: productRows.length },
    { dimension: "device_performance", count: deviceRows.length },
    { dimension: "geo_performance", count: geoRows.length },
    { dimension: "network_performance", count: networkRows.length },
    { dimension: "creative_performance", count: creativeRows.length },
    { dimension: "asset_group_performance", count: assetGroupRows.length },
    { dimension: "audience_performance", count: audienceRows.length },
    { dimension: "ad_schedule_performance", count: scheduleRows.length },
    // GA4 dimensions — always mark as unavailable
    { dimension: "engagement_metrics", count: 0, source: "ga4_required" as const, notes: "Requires GA4 integration (not available)" },
    { dimension: "checkout_metrics", count: 0, source: "ga4_required" as const, notes: "Requires GA4 ecommerce events (not available)" },
  ].map((d) => ({
    client_id: clientId,
    dimension: d.dimension,
    is_available: d.count > 0,
    row_count: d.count,
    latest_month: d.count > 0 ? endDate : null,
    earliest_month: d.count > 0 ? startDate : null,
    months_available: d.count > 0 ? 13 : 0,
    is_partial: false,
    data_source: ("source" in d ? d.source : "google_ads") as string,
    notes: "notes" in d ? (d.notes as string) : null,
    synced_at: now,
  }));

  await upsertBatch(supabase, "ads_dimension_availability", dimAvailRows, "client_id,dimension");
  console.log(`   ✅ ads_dimension_availability: ${dimAvailRows.length} dimensions registered`);
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Google Ads Backfill Script ===\n");
  if (DRY_RUN) console.log("🏜️  DRY RUN — er wordt niets weggeschreven.\n");

  const credentials = getCredentials();
  const supabase = getSupabase();

  // 1. Load clients from Supabase app_settings
  console.log("Clients ophalen uit Supabase...");
  const { data: settingsRow, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "api_clients")
    .maybeSingle();

  if (error || !settingsRow?.value) {
    console.error("❌ Kan clients niet ophalen uit app_settings:", error?.message ?? "geen data");
    process.exit(1);
  }

  let clients: Client[] = settingsRow.value as Client[];

  // Filter: alleen google-ads clients met een customer ID
  clients = clients.filter(
    (c) => c.source === "google-ads" && c.googleAdsCustomerId
  );

  if (SINGLE_CLIENT) {
    clients = clients.filter((c) => c.id === SINGLE_CLIENT);
    if (clients.length === 0) {
      console.error(`❌ Client "${SINGLE_CLIENT}" niet gevonden of heeft geen Google Ads koppeling.`);
      process.exit(1);
    }
  }

  console.log(`${clients.length} Google Ads client(s) gevonden.\n`);

  if (clients.length === 0) {
    console.log("Geen clients om te backfillen. Voeg eerst accounts toe via de Settings pagina.");
    process.exit(0);
  }

  // 2. Process clients sequentially (voorkomt API rate limits)
  let success = 0;
  let failed = 0;

  for (const client of clients) {
    try {
      await backfillClient(credentials, supabase, client);
      success++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ ${client.name} mislukt: ${msg}`);
    }
  }

  console.log(`\n=== Klaar ===`);
  console.log(`✅ ${success} client(s) gebackfilld`);
  if (failed > 0) console.log(`❌ ${failed} client(s) mislukt`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
