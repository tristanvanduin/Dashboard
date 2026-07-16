/**
 * Meta (Facebook) Ads API client
 *
 * Uses the Marketing API v21.0 with long-lived access tokens.
 * All calls go through our Next.js API routes to keep tokens server-side.
 *
 * Docs: https://developers.facebook.com/docs/marketing-apis
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface MetaAdsCredentials {
  accessToken: string;
  appId?: string;
  appSecret?: string;
}

export interface MetaAdAccount {
  id: string; // act_XXXXX format
  name: string;
  currency: string;
  timezone: string;
  accountStatus: number;
}

export interface MetaAdsMetrics {
  dateStart: string; // YYYY-MM-DD
  dateStop: string;
  impressions: number;
  clicks: number;
  spend: number;
  actions: MetaAction[];
  actionValues: MetaActionValue[];
  ctr: number;
  cpc: number;
  cpm: number;
}

export interface MetaAction {
  actionType: string;
  value: number;
}

export interface MetaActionValue {
  actionType: string;
  value: number;
}

export interface MetaCampaignMetrics extends MetaAdsMetrics {
  campaignId: string;
  campaignName: string;
  objective: string;
  status: string;
}

export interface MetaConversionEvent {
  actionType: string;
  name: string;
  count: number;
}

// Parsed metrics (after extracting conversions from actions array)
export interface MetaParsedMetrics {
  dateStart: string;
  dateStop: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversionsValue: number;
  ctr: number;
  cpc: number;
  costPerConversion: number;
  roas: number;
}

// ── API Constants ────────────────────────────────────────────────────────────

const API_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

// Standard conversion action types to count
const CONVERSION_ACTIONS = [
  "offsite_conversion.fb_pixel_purchase",
  "offsite_conversion.fb_pixel_lead",
  "offsite_conversion.fb_pixel_complete_registration",
  "purchase",
  "lead",
  "complete_registration",
  "omni_purchase",
  "onsite_conversion.messaging_conversation_started_7d",
];

const CONVERSION_VALUE_ACTIONS = [
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
  "omni_purchase",
];

// ── Helper: Fetch with error handling ────────────────────────────────────────

async function metaFetch(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${separator}access_token=${accessToken}`;

  const response = await fetch(fullUrl);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    const msg = (error as { error?: { message?: string } }).error?.message || response.statusText;
    throw new Error(`Meta Ads API error (${response.status}): ${msg}`);
  }

  return response.json();
}

// ── Helper: Parse actions into conversions ───────────────────────────────────

function parseConversions(actions?: MetaAction[]): number {
  if (!actions) return 0;
  return actions
    .filter((a) => CONVERSION_ACTIONS.includes(a.actionType))
    .reduce((sum, a) => sum + Number(a.value), 0);
}

function parseConversionValue(actionValues?: MetaActionValue[]): number {
  if (!actionValues) return 0;
  return actionValues
    .filter((a) => CONVERSION_VALUE_ACTIONS.includes(a.actionType))
    .reduce((sum, a) => sum + Number(a.value), 0);
}

function parseMetrics(raw: MetaAdsMetrics): MetaParsedMetrics {
  const conversions = parseConversions(raw.actions);
  const conversionsValue = parseConversionValue(raw.actionValues);
  const spend = Number(raw.spend) || 0;

  return {
    dateStart: raw.dateStart,
    dateStop: raw.dateStop,
    impressions: Number(raw.impressions) || 0,
    clicks: Number(raw.clicks) || 0,
    spend,
    conversions,
    conversionsValue,
    ctr: Number(raw.ctr) || 0,
    cpc: Number(raw.cpc) || 0,
    costPerConversion: conversions > 0 ? spend / conversions : 0,
    roas: spend > 0 ? conversionsValue / spend : 0,
  };
}

// ── Public API Methods ───────────────────────────────────────────────────────

/**
 * Test connection and list accessible ad accounts
 */
export async function listAdAccounts(
  credentials: MetaAdsCredentials
): Promise<MetaAdAccount[]> {
  const data = await metaFetch(
    `${BASE_URL}/me/adaccounts?fields=id,name,currency,timezone_name,account_status&limit=100`,
    credentials.accessToken
  );

  const accounts = (data.data || []) as Record<string, unknown>[];
  return accounts.map((acc) => ({
    id: acc.id as string,
    name: (acc.name as string) || acc.id as string,
    currency: (acc.currency as string) || "EUR",
    timezone: (acc.timezone_name as string) || "Europe/Amsterdam",
    accountStatus: (acc.account_status as number) || 0,
  }));
}

/**
 * Fetch account-level metrics by month
 */
export async function getAccountMetricsByMonth(
  credentials: MetaAdsCredentials,
  adAccountId: string,
  startDate: string, // YYYY-MM-DD
  endDate: string
): Promise<MetaParsedMetrics[]> {
  const fields = "impressions,clicks,spend,actions,action_values,ctr,cpc,cpm";
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  const data = await metaFetch(
    `${BASE_URL}/${adAccountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&time_increment=monthly&level=account&limit=500`,
    credentials.accessToken
  );

  const rows = (data.data || []) as MetaAdsMetrics[];
  return rows.map(parseMetrics);
}

/**
 * Fetch account-level metrics by week
 */
export async function getAccountMetricsByWeek(
  credentials: MetaAdsCredentials,
  adAccountId: string,
  startDate: string,
  endDate: string
): Promise<MetaParsedMetrics[]> {
  const fields = "impressions,clicks,spend,actions,action_values,ctr,cpc,cpm";
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  // Meta doesn't have "weekly" increment, so we use 7-day windows
  const data = await metaFetch(
    `${BASE_URL}/${adAccountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&time_increment=7&level=account&limit=500`,
    credentials.accessToken
  );

  const rows = (data.data || []) as MetaAdsMetrics[];
  return rows.map(parseMetrics);
}

/**
 * Fetch campaign-level metrics by month
 */
export async function getCampaignMetricsByMonth(
  credentials: MetaAdsCredentials,
  adAccountId: string,
  startDate: string,
  endDate: string
): Promise<(MetaParsedMetrics & { campaignId: string; campaignName: string; objective: string; status: string })[]> {
  const fields = "campaign_id,campaign_name,objective,impressions,clicks,spend,actions,action_values,ctr,cpc,cpm";
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  const data = await metaFetch(
    `${BASE_URL}/${adAccountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&time_increment=monthly&level=campaign&limit=500&filtering=[{"field":"campaign.delivery_info","operator":"IN","value":["active","completed","not_delivering","learning"]}]`,
    credentials.accessToken
  );

  const rows = (data.data || []) as (MetaAdsMetrics & { campaign_id: string; campaign_name: string; objective: string })[];
  return rows.map((row) => ({
    ...parseMetrics(row),
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    objective: row.objective || "",
    status: "ACTIVE",
  }));
}

/**
 * Fetch available conversion events for an ad account
 */
export async function getConversionEvents(
  credentials: MetaAdsCredentials,
  adAccountId: string,
  startDate: string,
  endDate: string
): Promise<MetaConversionEvent[]> {
  const fields = "actions";
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  const data = await metaFetch(
    `${BASE_URL}/${adAccountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&level=account&limit=1`,
    credentials.accessToken
  );

  const rows = (data.data || []) as MetaAdsMetrics[];
  if (rows.length === 0) return [];

  const actions = rows[0].actions || [];
  return actions.map((a) => ({
    actionType: a.actionType,
    name: a.actionType.replace(/_/g, " ").replace("offsite conversion.fb pixel ", ""),
    count: Number(a.value),
  }));
}

/**
 * Exchange short-lived token for long-lived token (valid ~60 days)
 */
export async function exchangeForLongLivedToken(
  credentials: MetaAdsCredentials & { appId: string; appSecret: string }
): Promise<{ accessToken: string; expiresIn: number }> {
  const data = await metaFetch(
    `${BASE_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${credentials.appId}&client_secret=${credentials.appSecret}&fb_exchange_token=${credentials.accessToken}`,
    credentials.accessToken
  );

  return {
    accessToken: data.access_token as string,
    expiresIn: data.expires_in as number,
  };
}
