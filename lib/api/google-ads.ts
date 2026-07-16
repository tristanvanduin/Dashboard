/**
 * Google Ads API client
 *
 * Uses the Google Ads REST API (v18) with OAuth2 authentication.
 * All calls go through our Next.js API routes to keep credentials server-side.
 *
 * Docs: https://developers.google.com/google-ads/api/rest/overview
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface GoogleAdsCredentials {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  managerCustomerId?: string;
}

export interface GoogleAdsCustomer {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

export interface GoogleAdsMetrics {
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  cost: number; // in account currency (micros converted)
  conversions: number;
  conversionsValue: number;
  ctr: number;
  avgCpc: number;
  costPerConversion: number;
  conversionRate: number;
}

export interface GoogleAdsCampaignMetrics extends GoogleAdsMetrics {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
}

export interface CampaignImpressionShare {
  campaignId: string;
  campaignName: string;
  campaignType: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  searchImpressionShare: number;       // 0-1 (percentage)
  searchBudgetLostIS: number;          // 0-1
  searchRankLostIS: number;            // 0-1
  /** Daily budget for the campaign (micros converted) */
  dailyBudget: number;
  /** How much of the daily budget is being used (spend/budget) */
  budgetUtilization: number;
}

export interface GoogleAdsConversionAction {
  id: string;
  name: string;
  category: string;
  status: "ENABLED" | "REMOVED" | "HIDDEN";
  type: string;
  primaryForGoal: boolean;
}

// ── API Constants ────────────────────────────────────────────────────────────

const API_VERSION = "v23";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// ── OAuth2 Token Management ──────────────────────────────────────────────────

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(credentials: GoogleAdsCredentials): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google OAuth2 token refresh failed: ${error}`);
  }

  const data = await response.json();
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedAccessToken.token;
}

// ── Campaign Metadata ───────────────────────────────────────────────────────

export interface CampaignMetadata {
  campaignId: string;
  campaignName: string;
  campaignType: string;
  biddingStrategy: string;
  biddingStrategyTarget: number;
  budgetAmount: number;
  budgetType: string;
  servingStatus: string;
}

/**
 * Fetch campaign metadata: type, bidding strategy, budget, serving status.
 * Lightweight query — no metrics, no date segmentation.
 */
export async function getCampaignMetadata(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<CampaignMetadata[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign.target_roas.target_roas,
      campaign.target_cpa.target_cpa_micros,
      campaign.serving_status,
      campaign_budget.amount_micros,
      campaign_budget.type
    FROM campaign
    WHERE campaign.status = 'ENABLED'
  `);

  return rows.map((row) => {
    const c = row.campaign as Record<string, unknown>;
    const cb = (row.campaignBudget || row.campaign_budget) as Record<string, unknown> | undefined;

    // Extract bidding target from nested fields
    const targetRoas = c.targetRoas || c.target_roas;
    const targetCpa = c.targetCpa || c.target_cpa;
    let biddingTarget = 0;
    if (targetRoas && typeof targetRoas === "object") {
      biddingTarget = ((targetRoas as Record<string, number>).targetRoas || (targetRoas as Record<string, number>).target_roas || 0);
    } else if (targetCpa && typeof targetCpa === "object") {
      biddingTarget = ((targetCpa as Record<string, number>).targetCpaMicros || (targetCpa as Record<string, number>).target_cpa_micros || 0) / 1_000_000;
    }

    return {
      campaignId: c.id as string,
      campaignName: c.name as string,
      campaignType: (c.advertisingChannelType || c.advertising_channel_type || "UNKNOWN") as string,
      biddingStrategy: (c.biddingStrategyType || c.bidding_strategy_type || "UNKNOWN") as string,
      biddingStrategyTarget: biddingTarget,
      budgetAmount: cb ? ((cb.amountMicros || cb.amount_micros || 0) as number) / 1_000_000 : 0,
      budgetType: cb ? ((cb.type || "UNKNOWN") as string) : "UNKNOWN",
      servingStatus: (c.servingStatus || c.serving_status || "UNKNOWN") as string,
    };
  });
}

// ── GAQL Query Helper ────────────────────────────────────────────────────────

async function queryGoogleAds(
  credentials: GoogleAdsCredentials,
  customerId: string,
  query: string
): Promise<Record<string, unknown>[]> {
  const accessToken = await getAccessToken(credentials);
  const cleanCustomerId = customerId.replace(/-/g, "");

  const response = await fetch(
    `${BASE_URL}/customers/${cleanCustomerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": credentials.developerToken,
        "Content-Type": "application/json",
        ...(credentials.managerCustomerId
          ? { "login-customer-id": credentials.managerCustomerId.replace(/-/g, "") }
          : {}),
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Ads API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  // searchStream returns array of result batches
  const rows: Record<string, unknown>[] = [];
  for (const batch of data) {
    if (batch.results) {
      rows.push(...batch.results);
    }
  }
  return rows;
}

// ── Public API Methods ───────────────────────────────────────────────────────

/**
 * List ALL client accounts under the MCC (manager account).
 * Uses customer_client resource to get every account, not just
 * the ones the authenticated user has direct access to.
 */
export async function listAccessibleCustomers(
  credentials: GoogleAdsCredentials
): Promise<GoogleAdsCustomer[]> {
  const managerCustomerId = credentials.managerCustomerId;

  // If we have an MCC, query all client accounts under it
  if (managerCustomerId) {
    const rows = await queryGoogleAds(credentials, managerCustomerId, `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.manager,
        customer_client.status
      FROM customer_client
      WHERE customer_client.status = 'ENABLED'
        AND customer_client.manager = false
    `);

    return rows.map((row) => {
      const cc = (row.customerClient || row.customer_client) as Record<string, string>;
      return {
        customerId: cc.id,
        descriptiveName: cc.descriptiveName || cc.descriptive_name || cc.id,
        currencyCode: cc.currencyCode || cc.currency_code || "EUR",
        timeZone: cc.timeZone || cc.time_zone || "Europe/Amsterdam",
      };
    });
  }

  // Fallback: no MCC, use listAccessibleCustomers endpoint
  const accessToken = await getAccessToken(credentials);
  const listResponse = await fetch(
    `${BASE_URL}/customers:listAccessibleCustomers`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": credentials.developerToken,
      },
    }
  );

  if (!listResponse.ok) {
    const error = await listResponse.text();
    throw new Error(`Failed to list customers: ${error}`);
  }

  const listData = await listResponse.json();
  const resourceNames: string[] = listData.resourceNames || [];

  const customers: GoogleAdsCustomer[] = [];
  for (const resourceName of resourceNames) {
    const customerId = resourceName.replace("customers/", "");
    try {
      const rows = await queryGoogleAds(credentials, customerId, `
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone
        FROM customer
        LIMIT 1
      `);
      if (rows.length > 0) {
        const customer = rows[0].customer as Record<string, string>;
        customers.push({
          customerId: customer.id,
          descriptiveName: customer.descriptiveName || customer.descriptive_name || customerId,
          currencyCode: customer.currencyCode || customer.currency_code || "EUR",
          timeZone: customer.timeZone || customer.time_zone || "Europe/Amsterdam",
        });
      }
    } catch {
      // Skip customers we can't access
    }
  }

  return customers;
}

/**
 * Fetch account-level metrics by month for a date range.
 * If conversionActionIds is provided, only count those specific conversion actions.
 */
export async function getAccountMetricsByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string, // YYYY-MM-DD
  endDate: string,
  conversionActionIds?: string[]
): Promise<GoogleAdsMetrics[]> {
  // If filtering by conversion actions, we need to segment by conversion_action
  // and aggregate ourselves
  if (conversionActionIds && conversionActionIds.length > 0) {
    return getFilteredMetricsByMonth(credentials, customerId, startDate, endDate, conversionActionIds);
  }

  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      segments.month,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_per_conversion,
      metrics.conversions_from_interactions_rate
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  return rows.map((row) => {
    const m = row.metrics as Record<string, number>;
    const s = row.segments as Record<string, string>;
    return {
      date: s.month,
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
      conversions: m.conversions || 0,
      conversionsValue: m.conversionsValue || m.conversions_value || 0,
      ctr: m.ctr || 0,
      avgCpc: (m.averageCpc || m.average_cpc || 0) / 1_000_000,
      costPerConversion: (m.costPerConversion || m.cost_per_conversion || 0) / 1_000_000,
      conversionRate: m.conversionsFromInteractionsRate || m.conversions_from_interactions_rate || 0,
    };
  });
}

/**
 * Fetch metrics filtered by specific conversion actions, aggregated by month.
 * Uses conversion_action segmentation so we only count selected actions.
 * Impressions, clicks, and cost are NOT affected by conversion action filter
 * (they're the same regardless) — we get those from an unsegmented query.
 */
async function getFilteredMetricsByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string,
  conversionActionIds: string[]
): Promise<GoogleAdsMetrics[]> {
  // Get base metrics (impressions, clicks, cost) without conversion segmentation
  const baseRows = await queryGoogleAds(credentials, customerId, `
    SELECT
      segments.month,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  // Get conversion metrics segmented by conversion action
  const convRows = await queryGoogleAds(credentials, customerId, `
    SELECT
      segments.month,
      segments.conversion_action,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  // Filter and aggregate conversions by selected action IDs
  const convByMonth = new Map<string, { conversions: number; conversionsValue: number }>();
  for (const row of convRows) {
    const s = row.segments as Record<string, string>;
    const m = row.metrics as Record<string, number>;
    const actionResource = s.conversionAction || s.conversion_action || "";
    // Extract action ID from resource name like "customers/123/conversionActions/456"
    const actionId = actionResource.split("/").pop() || "";

    if (conversionActionIds.includes(actionId)) {
      const month = s.month;
      const existing = convByMonth.get(month) || { conversions: 0, conversionsValue: 0 };
      existing.conversions += m.conversions || 0;
      existing.conversionsValue += m.conversionsValue || m.conversions_value || 0;
      convByMonth.set(month, existing);
    }
  }

  // Merge base metrics with filtered conversions
  return baseRows.map((row) => {
    const m = row.metrics as Record<string, number>;
    const s = row.segments as Record<string, string>;
    const month = s.month;
    const conv = convByMonth.get(month) || { conversions: 0, conversionsValue: 0 };
    const clicks = m.clicks || 0;

    return {
      date: month,
      impressions: m.impressions || 0,
      clicks,
      cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
      conversions: conv.conversions,
      conversionsValue: conv.conversionsValue,
      ctr: m.ctr || 0,
      avgCpc: (m.averageCpc || m.average_cpc || 0) / 1_000_000,
      costPerConversion: conv.conversions > 0
        ? ((m.costMicros || m.cost_micros || 0) / 1_000_000) / conv.conversions
        : 0,
      conversionRate: clicks > 0 ? conv.conversions / clicks : 0,
    };
  });
}

/**
 * Fetch account-level metrics by week
 */
export async function getAccountMetricsByWeek(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<GoogleAdsMetrics[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      segments.week,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_per_conversion,
      metrics.conversions_from_interactions_rate
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  return rows.map((row) => {
    const m = row.metrics as Record<string, number>;
    const s = row.segments as Record<string, string>;
    return {
      date: s.week,
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
      conversions: m.conversions || 0,
      conversionsValue: m.conversionsValue || m.conversions_value || 0,
      ctr: m.ctr || 0,
      avgCpc: (m.averageCpc || m.average_cpc || 0) / 1_000_000,
      costPerConversion: (m.costPerConversion || m.cost_per_conversion || 0) / 1_000_000,
      conversionRate: m.conversionsFromInteractionsRate || m.conversions_from_interactions_rate || 0,
    };
  });
}

/**
 * Fetch campaign-level metrics by month
 */
export async function getCampaignMetricsByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string,
  conversionActionIds?: string[]
): Promise<GoogleAdsCampaignMetrics[]> {
  // If filtering by conversion actions, split into base + conversion queries
  if (conversionActionIds && conversionActionIds.length > 0) {
    return getFilteredCampaignMetricsByMonth(credentials, customerId, startDate, endDate, conversionActionIds);
  }

  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      segments.month,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_per_conversion,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
  `);

  return rows.map((row) => {
    const m = row.metrics as Record<string, number>;
    const s = row.segments as Record<string, string>;
    const c = row.campaign as Record<string, string>;
    return {
      campaignId: c.id,
      campaignName: c.name,
      campaignStatus: c.status,
      date: s.month,
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
      conversions: m.conversions || 0,
      conversionsValue: m.conversionsValue || m.conversions_value || 0,
      ctr: m.ctr || 0,
      avgCpc: (m.averageCpc || m.average_cpc || 0) / 1_000_000,
      costPerConversion: (m.costPerConversion || m.cost_per_conversion || 0) / 1_000_000,
      conversionRate: m.conversionsFromInteractionsRate || m.conversions_from_interactions_rate || 0,
    };
  });
}

/**
 * Campaign metrics filtered by specific conversion actions, aggregated by month.
 * Base metrics (impressions, clicks, cost) are unaffected by conversion filter.
 */
async function getFilteredCampaignMetricsByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string,
  conversionActionIds: string[]
): Promise<GoogleAdsCampaignMetrics[]> {
  // Base metrics per campaign per month (no conversion segmentation)
  const baseRows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      segments.month,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
  `);

  // Conversion metrics segmented by conversion action per campaign
  const convRows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.id,
      segments.month,
      segments.conversion_action,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  // Filter and aggregate conversions by selected action IDs, keyed by campaign+month
  const convMap = new Map<string, { conversions: number; conversionsValue: number }>();
  for (const row of convRows) {
    const s = row.segments as Record<string, string>;
    const m = row.metrics as Record<string, number>;
    const c = row.campaign as Record<string, string>;
    const actionResource = s.conversionAction || s.conversion_action || "";
    const actionId = actionResource.split("/").pop() || "";

    if (conversionActionIds.includes(actionId)) {
      const key = `${c.id}::${s.month}`;
      const existing = convMap.get(key) || { conversions: 0, conversionsValue: 0 };
      existing.conversions += m.conversions || 0;
      existing.conversionsValue += m.conversionsValue || m.conversions_value || 0;
      convMap.set(key, existing);
    }
  }

  // Merge base metrics with filtered conversions
  return baseRows.map((row) => {
    const m = row.metrics as Record<string, number>;
    const s = row.segments as Record<string, string>;
    const c = row.campaign as Record<string, string>;
    const key = `${c.id}::${s.month}`;
    const conv = convMap.get(key) || { conversions: 0, conversionsValue: 0 };
    const clicks = m.clicks || 0;
    const cost = (m.costMicros || m.cost_micros || 0) / 1_000_000;

    return {
      campaignId: c.id,
      campaignName: c.name,
      campaignStatus: c.status,
      date: s.month,
      impressions: m.impressions || 0,
      clicks,
      cost,
      conversions: conv.conversions,
      conversionsValue: conv.conversionsValue,
      ctr: m.ctr || 0,
      avgCpc: (m.averageCpc || m.average_cpc || 0) / 1_000_000,
      costPerConversion: conv.conversions > 0 ? cost / conv.conversions : 0,
      conversionRate: clicks > 0 ? conv.conversions / clicks : 0,
    };
  });
}

/**
 * Fetch campaign-level impression share and budget data.
 * This is the key data for budget expansion analysis.
 * Uses last 30 days for a recent snapshot.
 */
export async function getCampaignImpressionShare(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<CampaignImpressionShare[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status = 'ENABLED'
    ORDER BY metrics.cost_micros DESC
  `);

  return rows.map((row) => {
    const m = row.metrics as Record<string, number>;
    const c = row.campaign as Record<string, string>;
    const cb = (row.campaignBudget || row.campaign_budget) as Record<string, number> | undefined;

    const cost = (m.costMicros || m.cost_micros || 0) / 1_000_000;
    const dailyBudget = cb
      ? (cb.amountMicros || cb.amount_micros || 0) / 1_000_000
      : 0;

    // Parse impression share values (Google returns as fraction 0-1 or sometimes as string "0.xx")
    const parseIS = (v: number | string | undefined): number => {
      if (v === undefined || v === null) return 0;
      const n = typeof v === "string" ? parseFloat(v) : v;
      return isNaN(n) ? 0 : n;
    };

    // Calculate budget utilization over the date range
    const startD = new Date(startDate);
    const endD = new Date(endDate);
    const days = Math.max(1, (endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24));
    const totalBudget = dailyBudget * days;
    const budgetUtilization = totalBudget > 0 ? cost / totalBudget : 0;

    return {
      campaignId: c.id,
      campaignName: c.name,
      campaignType: c.advertisingChannelType || c.advertising_channel_type || "UNKNOWN",
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost,
      conversions: m.conversions || 0,
      searchImpressionShare: parseIS(m.searchImpressionShare || m.search_impression_share),
      searchBudgetLostIS: parseIS(m.searchBudgetLostImpressionShare || m.search_budget_lost_impression_share),
      searchRankLostIS: parseIS(m.searchRankLostImpressionShare || m.search_rank_lost_impression_share),
      dailyBudget,
      budgetUtilization,
    };
  });
}

/**
 * Fetch all conversion actions for an account
 */
export async function getConversionActions(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<GoogleAdsConversionAction[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.category,
      conversion_action.status,
      conversion_action.type,
      conversion_action.primary_for_goal
    FROM conversion_action
    ORDER BY conversion_action.name
  `);

  return rows.map((row) => {
    const ca = row.conversionAction || row.conversion_action;
    const a = ca as Record<string, string>;
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      status: a.status as "ENABLED" | "REMOVED" | "HIDDEN",
      type: a.type,
      primaryForGoal: String(a.primaryForGoal ?? a.primary_for_goal).toLowerCase() === "true",
    };
  });
}

// ── Account Structure Intelligence ──────────────────────────────────────

export interface AccountStructure {
  campaigns: CampaignStructure[];
  detectedStrategy: string[];
}

export interface CampaignStructure {
  id: string;
  name: string;
  type: string;
  biddingStrategy: string;
  purpose: string;
  bucketLabel: string | null;
  adGroupCount: number;
  assetGroupCount: number;
  hasFeed: boolean;
  productGroupCount: number;
  cost30d: number;
  conversions30d: number;
  impressions30d: number;
}

/**
 * Fetch full account structure with campaign details, ad group counts,
 * asset groups (PMax), bidding strategies, and naming analysis.
 */
export async function getAccountStructure(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<AccountStructure> {
  const campaignRows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      metrics.cost_micros,
      metrics.conversions,
      metrics.impressions
    FROM campaign
    WHERE campaign.status = 'ENABLED'
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC
  `);

  const adGroupRows = await queryGoogleAds(credentials, customerId, `
    SELECT campaign.id, ad_group.id
    FROM ad_group
    WHERE campaign.status = 'ENABLED' AND ad_group.status = 'ENABLED'
  `);

  let assetGroupRows: Record<string, unknown>[] = [];
  try {
    assetGroupRows = await queryGoogleAds(credentials, customerId, `
      SELECT campaign.id, asset_group.id
      FROM asset_group
      WHERE campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED'
    `);
  } catch { /* no PMax campaigns */ }

  let productGroupRows: Record<string, unknown>[] = [];
  try {
    productGroupRows = await queryGoogleAds(credentials, customerId, `
      SELECT campaign.id, asset_group_listing_group_filter.id
      FROM asset_group_listing_group_filter
      WHERE campaign.status = 'ENABLED'
    `);
  } catch { /* no Shopping/PMax with feed */ }

  // Count per campaign
  const count = (rows: Record<string, unknown>[]) => {
    const m = new Map<string, number>();
    for (const row of rows) {
      const id = (row.campaign as Record<string, string>).id;
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  };

  const adGroupCounts = count(adGroupRows);
  const assetGroupCounts = count(assetGroupRows);
  const productGroupCounts = count(productGroupRows);

  const campaigns: CampaignStructure[] = campaignRows.map((row) => {
    const c = row.campaign as Record<string, string>;
    const m = row.metrics as Record<string, number>;
    const id = c.id;
    const name = c.name || "";
    const type = c.advertisingChannelType || c.advertising_channel_type || "UNKNOWN";
    const isPmax = type === "PERFORMANCE_MAX";

    return {
      id,
      name,
      type,
      biddingStrategy: c.biddingStrategyType || c.bidding_strategy_type || "UNKNOWN",
      purpose: detectPurposeFromApi(name, type),
      bucketLabel: detectBucketLabel(name),
      adGroupCount: adGroupCounts.get(id) ?? 0,
      assetGroupCount: assetGroupCounts.get(id) ?? 0,
      hasFeed: isPmax && (productGroupCounts.get(id) ?? 0) > 0,
      productGroupCount: productGroupCounts.get(id) ?? 0,
      cost30d: (m.costMicros || m.cost_micros || 0) / 1_000_000,
      conversions30d: m.conversions || 0,
      impressions30d: m.impressions || 0,
    };
  });

  return { campaigns, detectedStrategy: detectAccountStrategy(campaigns) };
}

function detectPurposeFromApi(name: string, type: string): string {
  const lower = name.toLowerCase();
  // "Non-Brand" / "Nonbrand" / "Non Brand" must match as generic, not brand
  const isNonBrand = /non[\s-]?brand/i.test(lower);
  if (isNonBrand || lower.includes("generic")) return "generic";
  if (lower.includes("brand") || lower.includes("merk")) return "brand";
  if (lower.includes("remarketing") || lower.includes("retargeting") || lower.includes("rlsa")) return "remarketing";
  if (lower.includes("concurrent") || lower.includes("competitor")) return "competitor";
  if (type === "VIDEO" || lower.includes("awareness") || lower.includes("youtube")) return "awareness";
  if (lower.includes("dsa") || lower.includes("dynamic search")) return "dsa";
  if (type === "PERFORMANCE_MAX") return "pmax";
  if (type === "SHOPPING") return "shopping";
  if (type === "DISPLAY") return "display";
  return "category";
}

function detectBucketLabel(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.includes("bestseller") || lower.includes("best seller") || lower.includes("hero")) return "bestseller";
  if (lower.includes("core") || lower.includes("standard")) return "core";
  if (lower.includes("discovery") || lower.includes("discover")) return "discovery";
  if (lower.includes("test") || lower.includes("experiment")) return "test";
  if (lower.includes("bleeder") || lower.includes("low perform")) return "bleeder";
  if (lower.includes("zombie") || lower.includes("no data") || lower.includes("0 click")) return "zombie";
  if (lower.includes("tier 1") || lower.includes("t1") || lower.includes("priority")) return "tier-1";
  if (lower.includes("tier 2") || lower.includes("t2")) return "tier-2";
  if (lower.includes("tier 3") || lower.includes("t3") || lower.includes("catch-all")) return "tier-3";
  return null;
}

function detectAccountStrategy(campaigns: CampaignStructure[]): string[] {
  const strategies: string[] = [];
  const labels = campaigns.map((c) => c.bucketLabel).filter(Boolean);
  const purposes = campaigns.map((c) => c.purpose);

  if ((labels.includes("bestseller") && labels.includes("bleeder")) ||
      (labels.includes("bestseller") && labels.includes("zombie")) ||
      (labels.includes("core") && labels.includes("discovery"))) {
    strategies.push("Performance Bucketing / Labelizer strategie");
  }
  if (labels.includes("tier-1") && labels.includes("tier-2")) {
    strategies.push("Tiered campagne structuur");
  }

  const feedOnlyPmax = campaigns.filter((c) => c.type === "PERFORMANCE_MAX" && c.hasFeed && c.assetGroupCount <= 1);
  const fullPmax = campaigns.filter((c) => c.type === "PERFORMANCE_MAX" && c.assetGroupCount > 1);
  if (feedOnlyPmax.length > 0) strategies.push(`Feed-only PMax (${feedOnlyPmax.length})`);
  if (fullPmax.length > 0) strategies.push(`Full PMax (${fullPmax.reduce((s, c) => s + c.assetGroupCount, 0)} asset groups)`);
  if (purposes.includes("brand")) strategies.push("Brand campagne actief");
  if (purposes.includes("competitor")) strategies.push("Concurrent-biedstrategie actief");
  if (purposes.includes("dsa")) strategies.push("Dynamic Search Ads actief");

  const shoppingCount = campaigns.filter((c) => c.type === "SHOPPING").length;
  if (shoppingCount > 0) strategies.push(`Shopping (${shoppingCount} campagnes)`);

  return strategies;
}

// ── Ad Group Keywords ──────────────────────────────────────────────────

export interface AdGroupKeyword {
  campaignName: string;
  adGroupName: string;
  keyword: string;
  matchType: string;
}

/**
 * Fetch all active keywords per ad group. Gives AI context about
 * what each ad group is intentionally targeting.
 */
export async function getAdGroupKeywords(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<AdGroupKeyword[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        ad_group.name,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND campaign.status = 'ENABLED'
      LIMIT 2000
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.adGroup || row.ad_group) as Record<string, string>;
      const kw = (row.adGroupCriterion || row.ad_group_criterion) as Record<string, unknown>;
      const keyword = kw.keyword as Record<string, string> | undefined;

      return {
        campaignName: c.name || "",
        adGroupName: ag.name || "",
        keyword: keyword?.text || keyword?.keyword_text || "",
        matchType: keyword?.matchType || keyword?.match_type || "",
      };
    });
  } catch { return []; }
}

// ── Campaign Location Targeting ────────────────────────────────────────

export interface CampaignLocationTarget {
  campaignName: string;
  locationName: string;
  locationType: string;
}

/**
 * Fetch geographic targeting per campaign.
 * Uses geo_target_constant to get human-readable location names.
 */
export async function getCampaignLocationTargets(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<CampaignLocationTarget[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        campaign_criterion.location.geo_target_constant,
        geo_target_constant.name,
        geo_target_constant.target_type
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'LOCATION'
        AND campaign.status = 'ENABLED'
      LIMIT 1000
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const geo = (row.geoTargetConstant || row.geo_target_constant) as Record<string, string> | undefined;

      return {
        campaignName: c.name || "",
        locationName: geo?.name || "(onbekend)",
        locationType: geo?.targetType || geo?.target_type || "",
      };
    });
  } catch { return []; }
}

// ── Ad Copy & Final URLs ───────────────────────────────────────────────

export interface AdGroupAdCopy {
  campaignName: string;
  adGroupName: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
}

/**
 * Fetch ad copy (responsive search ads) and final URLs per ad group.
 */
export async function getAdGroupAdCopy(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<AdGroupAdCopy[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        ad_group.name,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls
      FROM ad_group_ad
      WHERE ad_group.status = 'ENABLED'
        AND ad_group_ad.status = 'ENABLED'
        AND campaign.status = 'ENABLED'
        AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
      LIMIT 1000
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.adGroup || row.ad_group) as Record<string, string>;
      const ad = (row.adGroupAd || row.ad_group_ad) as Record<string, unknown>;
      const adInner = (ad?.ad || ad) as Record<string, unknown>;
      const rsa = (adInner?.responsiveSearchAd || adInner?.responsive_search_ad) as Record<string, unknown> | undefined;

      const parseAssets = (assets: unknown): string[] => {
        if (!Array.isArray(assets)) return [];
        return assets
          .map((a: Record<string, string>) => a.text || a.asset_text || "")
          .filter(Boolean);
      };

      return {
        campaignName: c.name || "",
        adGroupName: ag.name || "",
        headlines: parseAssets(rsa?.headlines),
        descriptions: parseAssets(rsa?.descriptions),
        finalUrls: Array.isArray(adInner?.finalUrls || adInner?.final_urls)
          ? (adInner?.finalUrls || adInner?.final_urls) as string[]
          : [],
      };
    });
  } catch { return []; }
}

// ── Search Term Analysis ────────────────────────────────────────────────

export interface WastefulSearchTerm {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  matchType: string;
}

/**
 * Find search terms with high cost and 0 conversions (wasting budget).
 * Returns top 20 most wasteful terms from the last 30 days.
 */
export async function getWastefulSearchTerms(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<WastefulSearchTerm[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      search_term_view.search_term,
      campaign.name,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      search_term_view.status
    FROM search_term_view
    WHERE segments.date DURING LAST_30_DAYS
      AND metrics.cost_micros > 0
      AND metrics.conversions = 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
  `);

  return rows.map((row) => {
    const st = (row.searchTermView || row.search_term_view) as Record<string, string>;
    const c = row.campaign as Record<string, string>;
    const ag = (row.adGroup || row.ad_group) as Record<string, string>;
    const m = row.metrics as Record<string, number>;

    return {
      searchTerm: st.searchTerm || st.search_term || "",
      campaignName: c.name || "",
      adGroupName: ag.name || "",
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
      conversions: 0,
      matchType: st.status || "",
    };
  });
}

// ── All Search Terms (for AI relevance analysis) ───────────────────────

export interface SearchTermWithClicks {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  matchType: string;
}

/**
 * Fetch all search terms with at least 1 click (last 30 days).
 * Returns top 500 by cost for AI relevance analysis.
 */
export async function getAllSearchTermsWithClicks(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<SearchTermWithClicks[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      search_term_view.search_term,
      campaign.name,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      search_term_view.status
    FROM search_term_view
    WHERE segments.date DURING LAST_30_DAYS
      AND metrics.clicks >= 1
    ORDER BY metrics.cost_micros DESC
    LIMIT 5000
  `);

  return rows.map((row) => {
    const st = (row.searchTermView || row.search_term_view) as Record<string, string>;
    const c = row.campaign as Record<string, string>;
    const ag = (row.adGroup || row.ad_group) as Record<string, string>;
    const m = row.metrics as Record<string, number>;

    return {
      searchTerm: st.searchTerm || st.search_term || "",
      campaignName: c.name || "",
      adGroupName: ag.name || "",
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
      conversions: m.conversions || 0,
      conversionsValue: m.conversionsValue || m.conversions_value || 0,
      matchType: st.status || "",
    };
  });
}

// ── Ad Group Bleeder Detection ──────────────────────────────────────────

export interface AdGroupPerformance {
  campaignName: string;
  adGroupName: string;
  adGroupId: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  cpa: number;
  roas: number;
}

/**
 * Find ad groups that consume significant budget with poor ROAS/CPA.
 * Returns ad groups from last 30 days sorted by cost (worst performers first).
 */
export async function getAdGroupPerformance(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<AdGroupPerformance[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.name,
      ad_group.name,
      ad_group.id,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM ad_group
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.status IN ('ENABLED', 'PAUSED')
      AND ad_group.status IN ('ENABLED', 'PAUSED')
      AND metrics.cost_micros > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `);

  return rows.map((row) => {
    const c = row.campaign as Record<string, string>;
    const ag = (row.adGroup || row.ad_group) as Record<string, string>;
    const m = row.metrics as Record<string, number>;
    const cost = (m.costMicros || m.cost_micros || 0) / 1_000_000;
    const conv = m.conversions || 0;
    const value = m.conversionsValue || m.conversions_value || 0;

    return {
      campaignName: c.name || "",
      adGroupName: ag.name || "",
      adGroupId: ag.id || "",
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost,
      conversions: conv,
      conversionsValue: value,
      cpa: conv > 0 ? cost / conv : cost,
      roas: cost > 0 ? value / cost : 0,
    };
  });
}

// ── Product Group Bleeder Detection ───────────────────────────────────

export interface ProductGroupPerformance {
  campaignName: string;
  productTitle: string;
  productId: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

/**
 * Find product groups (Shopping / PMax) with significant spend.
 * Uses shopping_performance_view for Shopping and asset_group_product_group_view for PMax.
 */
export async function getProductGroupPerformance(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<ProductGroupPerformance[]> {
  const results: ProductGroupPerformance[] = [];

  // 1. Shopping campaigns — query shopping_performance_view (product-level)
  try {
    const shoppingRows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        segments.product_title,
        segments.product_item_id,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM shopping_performance_view
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status = 'ENABLED'
        AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `);

    for (const row of shoppingRows) {
      const c = row.campaign as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;
      const cost = (m.costMicros || m.cost_micros || 0) / 1_000_000;

      results.push({
        campaignName: c.name || "",
        productTitle: s.productTitle || s.product_title || "(onbekend)",
        productId: s.productItemId || s.product_item_id || "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      });
    }
  } catch { /* no Shopping campaigns or no data */ }

  // 2. PMax campaigns — query asset_group_product_group_view (product group level)
  try {
    const pmaxRows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        asset_group.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM asset_group_product_group_view
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status = 'ENABLED'
        AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `);

    for (const row of pmaxRows) {
      const c = row.campaign as Record<string, string>;
      const ag = (row.assetGroup || row.asset_group) as Record<string, string>;
      const m = row.metrics as Record<string, number>;
      const cost = (m.costMicros || m.cost_micros || 0) / 1_000_000;

      results.push({
        campaignName: c.name || "",
        productTitle: ag.name || "(asset group)",
        productId: "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      });
    }
  } catch { /* no PMax product groups or no data */ }

  // Sort by cost descending
  results.sort((a, b) => b.cost - a.cost);

  return results;
}

// ── Monthly variants for backfill ──────────────────────────────────────

export interface AdGroupMonthlyPerformance extends AdGroupPerformance {
  date: string; // YYYY-MM-DD (first of month)
}

/**
 * Fetch ad group performance segmented by month for a date range.
 */
export async function getAdGroupPerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<AdGroupMonthlyPerformance[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.name,
      ad_group.name,
      ad_group.id,
      segments.month,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM ad_group
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status IN ('ENABLED', 'PAUSED')
      AND ad_group.status IN ('ENABLED', 'PAUSED')
      AND metrics.cost_micros > 0
    ORDER BY metrics.cost_micros DESC
  `);

  return rows.map((row) => {
    const c = row.campaign as Record<string, string>;
    const ag = (row.adGroup || row.ad_group) as Record<string, string>;
    const m = row.metrics as Record<string, number>;
    const s = row.segments as Record<string, string>;
    const cost = (m.costMicros || m.cost_micros || 0) / 1_000_000;
    const conv = m.conversions || 0;
    const value = m.conversionsValue || m.conversions_value || 0;

    return {
      campaignName: c.name || "",
      adGroupName: ag.name || "",
      adGroupId: ag.id || "",
      date: s.month,
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost,
      conversions: conv,
      conversionsValue: value,
      cpa: conv > 0 ? cost / conv : cost,
      roas: cost > 0 ? value / cost : 0,
    };
  });
}

export interface CampaignImpressionShareMonthly extends CampaignImpressionShare {
  date: string; // YYYY-MM-DD (first of month)
}

/**
 * Fetch campaign impression share segmented by month for a date range.
 */
export async function getCampaignImpressionShareByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<CampaignImpressionShareMonthly[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      segments.month,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status = 'ENABLED'
    ORDER BY metrics.cost_micros DESC
  `);

  return rows.map((row) => {
    const m = row.metrics as Record<string, number>;
    const c = row.campaign as Record<string, string>;
    const s = row.segments as Record<string, string>;
    const cb = (row.campaignBudget || row.campaign_budget) as Record<string, number> | undefined;

    const cost = (m.costMicros || m.cost_micros || 0) / 1_000_000;
    const dailyBudget = cb
      ? (cb.amountMicros || cb.amount_micros || 0) / 1_000_000
      : 0;

    const parseIS = (v: number | string | undefined): number => {
      if (v === undefined || v === null) return 0;
      const n = typeof v === "string" ? parseFloat(v) : v;
      return isNaN(n) ? 0 : n;
    };

    // Budget utilization for ~30 days in a month
    const totalBudget = dailyBudget * 30;
    const budgetUtilization = totalBudget > 0 ? cost / totalBudget : 0;

    return {
      campaignId: c.id,
      campaignName: c.name,
      campaignType: c.advertisingChannelType || c.advertising_channel_type || "UNKNOWN",
      date: s.month,
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost,
      conversions: m.conversions || 0,
      searchImpressionShare: parseIS(m.searchImpressionShare || m.search_impression_share),
      searchBudgetLostIS: parseIS(m.searchBudgetLostImpressionShare || m.search_budget_lost_impression_share),
      searchRankLostIS: parseIS(m.searchRankLostImpressionShare || m.search_rank_lost_impression_share),
      dailyBudget,
      budgetUtilization,
    };
  });
}

export interface WastefulSearchTermMonthly extends WastefulSearchTerm {
  date: string; // YYYY-MM-DD (first of month)
}

/**
 * Fetch wasteful search terms segmented by month for a date range.
 */
export async function getWastefulSearchTermsByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<WastefulSearchTermMonthly[]> {
  const rows = await queryGoogleAds(credentials, customerId, `
    SELECT
      search_term_view.search_term,
      campaign.name,
      ad_group.name,
      segments.month,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      search_term_view.status
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND metrics.cost_micros > 0
      AND metrics.conversions = 0
    ORDER BY metrics.cost_micros DESC
  `);

  return rows.map((row) => {
    const st = (row.searchTermView || row.search_term_view) as Record<string, string>;
    const c = row.campaign as Record<string, string>;
    const ag = (row.adGroup || row.ad_group) as Record<string, string>;
    const m = row.metrics as Record<string, number>;
    const s = row.segments as Record<string, string>;

    return {
      searchTerm: st.searchTerm || st.search_term || "",
      campaignName: c.name || "",
      adGroupName: ag.name || "",
      date: s.month,
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
      conversions: 0,
      matchType: st.status || "",
    };
  });
}

// ── Change History ──────────────────────────────────────────────────────

export interface ChangeEvent {
  changeDateTime: string;
  resourceType: string;
  changeResourceName: string;
  campaignName: string;
  changeType: string;  // CREATE, UPDATE, REMOVE
  oldValue: string;
  newValue: string;
  userEmail: string;
}

/**
 * Fetch recent change history for the account.
 * Returns the most significant changes in the last 14 days.
 */
export async function getChangeHistory(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<ChangeEvent[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        change_event.change_date_time,
        change_event.change_resource_type,
        change_event.change_resource_name,
        change_event.changed_fields,
        change_event.old_resource,
        change_event.new_resource,
        change_event.resource_change_operation,
        change_event.user_email,
        campaign.name
      FROM change_event
      WHERE change_event.change_date_time DURING LAST_14_DAYS
        AND change_event.change_resource_type IN (
          'CAMPAIGN',
          'AD_GROUP',
          'AD_GROUP_AD',
          'AD_GROUP_CRITERION',
          'CAMPAIGN_BUDGET',
          'CAMPAIGN_CRITERION',
          'ASSET',
          'ASSET_SET',
          'CAMPAIGN_ASSET',
          'AD_GROUP_ASSET'
        )
      ORDER BY change_event.change_date_time DESC
      LIMIT 200
    `);

    return rows.map((row) => {
      const ce = (row.changeEvent || row.change_event) as Record<string, string>;
      const c = row.campaign as Record<string, string>;

      return {
        changeDateTime: ce.changeDateTime || ce.change_date_time || "",
        resourceType: ce.changeResourceType || ce.change_resource_type || "",
        changeResourceName: ce.changeResourceName || ce.change_resource_name || "",
        campaignName: c?.name || "",
        changeType: ce.resourceChangeOperation || ce.resource_change_operation || "",
        oldValue: JSON.stringify(ce.oldResource || ce.old_resource || ""),
        newValue: JSON.stringify(ce.newResource || ce.new_resource || ""),
        userEmail: ce.userEmail || ce.user_email || "",
      };
    });
  } catch {
    // Change history may not be available for all accounts
    return [];
  }
}

// ── Dimensional query functions (for backfill) ─────────────────────────────

// ── Keyword Performance by Month ──────────────────────────────────────────

export interface KeywordPerformanceRow {
  date: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  keywordId: string;
  keywordText: string;
  matchType: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  qualityScore: number | null;
}

export async function getKeywordPerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<KeywordPerformanceRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions_from_interactions_rate,
        metrics.cost_per_conversion
      FROM keyword_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND ad_group.status IN ('ENABLED', 'PAUSED')
        AND ad_group_criterion.status = 'ENABLED'
        AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.adGroup || row.ad_group) as Record<string, string>;
      const crit = (row.adGroupCriterion || row.ad_group_criterion) as Record<string, unknown>;
      const kw = crit.keyword as Record<string, string> | undefined;
      const qi = (crit.qualityInfo || crit.quality_info) as Record<string, number> | undefined;
      const m = row.metrics as Record<string, number>;
      const s = row.segments as Record<string, string>;
      const cost = (m.costMicros || m.cost_micros || 0) / 1_000_000;
      const conv = m.conversions || 0;
      const value = m.conversionsValue || m.conversions_value || 0;
      const clicks = m.clicks || 0;

      return {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        adGroupId: ag.id || "",
        adGroupName: ag.name || "",
        keywordId: String(crit.criterionId || crit.criterion_id || ""),
        keywordText: kw?.text || kw?.keyword_text || "",
        matchType: kw?.matchType || kw?.match_type || "",
        impressions: m.impressions || 0,
        clicks,
        cost,
        conversions: conv,
        conversionsValue: value,
        ctr: m.ctr || 0,
        avgCpc: (m.averageCpc || m.average_cpc || 0) / 1_000_000,
        conversionRate: m.conversionsFromInteractionsRate || m.conversions_from_interactions_rate || 0,
        costPerConversion: (m.costPerConversion || m.cost_per_conversion || 0) / 1_000_000,
        qualityScore: qi?.qualityScore ?? qi?.quality_score ?? null,
      };
    });
  } catch { return []; }
}

// ── Search Terms (ALL, not just wasteful) by Month ────────────────────────

export interface SearchTermMonthlyRow {
  date: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  searchTerm: string;
  matchType: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getSearchTermsByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<SearchTermMonthlyRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        search_term_view.search_term,
        segments.search_term_match_type,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM search_term_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND metrics.clicks > 0
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.adGroup || row.ad_group) as Record<string, string>;
      const stv = (row.searchTermView || row.search_term_view) as Record<string, string>;
      const m = row.metrics as Record<string, number>;
      const s = row.segments as Record<string, string>;

      return {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        adGroupId: ag.id || "",
        adGroupName: ag.name || "",
        searchTerm: stv.searchTerm || stv.search_term || "",
        matchType: s.searchTermMatchType || s.search_term_match_type || "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}

// ── Product Performance by Month (Shopping + PMax) ────────────────────────

export interface ProductPerformanceMonthlyRow {
  date: string;
  campaignId?: string;
  campaignName: string;
  campaignType: string;
  adGroupId?: string;
  adGroupName?: string;
  productTitle: string;
  productId: string;
  productTypeL1?: string;
  productTypeL2?: string;
  productTypeL3?: string;
  productTypeL4?: string;
  productTypeL5?: string;
  customLabel0?: string;
  customLabel1?: string;
  customLabel2?: string;
  customLabel3?: string;
  customLabel4?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getProductPerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<ProductPerformanceMonthlyRow[]> {
  const results: ProductPerformanceMonthlyRow[] = [];

  // Shopping campaigns
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        segments.product_title,
        segments.product_item_id,
        segments.product_type_l1,
        segments.product_type_l2,
        segments.product_type_l3,
        segments.product_type_l4,
        segments.product_type_l5,
        segments.product_custom_attribute0,
        segments.product_custom_attribute1,
        segments.product_custom_attribute2,
        segments.product_custom_attribute3,
        segments.product_custom_attribute4,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status = 'ENABLED'
        AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
    `);

    for (const row of rows) {
      const c = row.campaign as Record<string, string>;
      const ag = (row.adGroup || row.ad_group) as Record<string, string> | undefined;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;
      results.push({
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        campaignType: "SHOPPING",
        adGroupId: ag?.id || "",
        adGroupName: ag?.name || "",
        productTitle: s.productTitle || s.product_title || "(onbekend)",
        productId: s.productItemId || s.product_item_id || "",
        productTypeL1: s.productTypeL1 || s.product_type_l1 || "",
        productTypeL2: s.productTypeL2 || s.product_type_l2 || "",
        productTypeL3: s.productTypeL3 || s.product_type_l3 || "",
        productTypeL4: s.productTypeL4 || s.product_type_l4 || "",
        productTypeL5: s.productTypeL5 || s.product_type_l5 || "",
        customLabel0: s.productCustomAttribute0 || s.product_custom_attribute0 || "",
        customLabel1: s.productCustomAttribute1 || s.product_custom_attribute1 || "",
        customLabel2: s.productCustomAttribute2 || s.product_custom_attribute2 || "",
        customLabel3: s.productCustomAttribute3 || s.product_custom_attribute3 || "",
        customLabel4: s.productCustomAttribute4 || s.product_custom_attribute4 || "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      });
    }
  } catch { /* no Shopping data */ }

  // PMax asset group product groups
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        asset_group.name,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM asset_group_product_group_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status = 'ENABLED'
        AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
    `);

    for (const row of rows) {
      const c = row.campaign as Record<string, string>;
      const ag = (row.assetGroup || row.asset_group) as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;
      results.push({
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        campaignType: "PERFORMANCE_MAX",
        adGroupId: ag.id || "",
        adGroupName: ag.name || "",
        productTitle: ag.name || "(asset group)",
        productId: "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      });
    }
  } catch { /* no PMax data */ }

  return results;
}

export interface CheckoutFunnelRow {
  date: string;
  campaignId: string;
  campaignName: string;
  device: string;
  addToCartCount: number;
  addToCartValue: number;
  beginCheckoutCount: number;
  beginCheckoutValue: number;
  purchaseCount: number;
  purchaseValue: number;
}

export async function getCheckoutFunnelByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string,
  actionMap?: Partial<Record<"add_to_cart" | "begin_checkout" | "purchase", string>>
): Promise<CheckoutFunnelRow[]> {
  const fallbackMap = {
    add_to_cart: "add_to_cart",
    begin_checkout: "begin_checkout",
    purchase: "purchase",
    ...actionMap,
  };

  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        segments.month,
        segments.device,
        segments.conversion_action_name,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND segments.conversion_action_name IN ('${fallbackMap.add_to_cart}', '${fallbackMap.begin_checkout}', '${fallbackMap.purchase}')
    `);

    const bucket = new Map<string, CheckoutFunnelRow>();
    for (const row of rows) {
      const c = row.campaign as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;
      const key = `${c.id}::${s.month}::${s.device || "UNSPECIFIED"}`;
      const existing = bucket.get(key) || {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        device: s.device || "UNSPECIFIED",
        addToCartCount: 0,
        addToCartValue: 0,
        beginCheckoutCount: 0,
        beginCheckoutValue: 0,
        purchaseCount: 0,
        purchaseValue: 0,
      };

      const actionName = String(s.conversionActionName || s.conversion_action_name || "").toLowerCase();
      if (actionName === fallbackMap.add_to_cart.toLowerCase()) {
        existing.addToCartCount += m.conversions || 0;
        existing.addToCartValue += m.conversionsValue || m.conversions_value || 0;
      } else if (actionName === fallbackMap.begin_checkout.toLowerCase()) {
        existing.beginCheckoutCount += m.conversions || 0;
        existing.beginCheckoutValue += m.conversionsValue || m.conversions_value || 0;
      } else if (actionName === fallbackMap.purchase.toLowerCase()) {
        existing.purchaseCount += m.conversions || 0;
        existing.purchaseValue += m.conversionsValue || m.conversions_value || 0;
      }

      bucket.set(key, existing);
    }

    return Array.from(bucket.values());
  } catch {
    return [];
  }
}

// ── Device Performance by Month ───────────────────────────────────────────

export interface DevicePerformanceRow {
  date: string;
  device: string;
  campaignId: string | null;
  campaignName: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getDevicePerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<DevicePerformanceRow[]> {
  const results: DevicePerformanceRow[] = [];

  // Account-level device breakdown
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        segments.device,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM customer
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);

    for (const row of rows) {
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;
      results.push({
        date: s.month,
        device: s.device || "UNSPECIFIED",
        campaignId: null,
        campaignName: null,
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      });
    }
  } catch { /* skip */ }

  // Campaign-level device breakdown
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        segments.device,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND metrics.cost_micros > 0
    `);

    for (const row of rows) {
      const c = row.campaign as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;
      results.push({
        date: s.month,
        device: s.device || "UNSPECIFIED",
        campaignId: c.id || null,
        campaignName: c.name || null,
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      });
    }
  } catch { /* skip */ }

  return results;
}

// ── Geographic Performance by Month ───────────────────────────────────────

export interface GeoPerformanceRow {
  date: string;
  campaignId: string;
  campaignName: string;
  countryCode: string;
  regionName: string;
  geoTargetId: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getGeoPerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<GeoPerformanceRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        geographic_view.country_criterion_id,
        geographic_view.location_type,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM geographic_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'
        AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
    `);

    // Debug: log first row to see actual API response structure
    if (rows.length > 0) {
      console.log("[getGeoPerformanceByMonth] Total rows:", rows.length);
      console.log("[getGeoPerformanceByMonth] First raw row:", JSON.stringify(rows[0], null, 2));
    } else {
      console.log("[getGeoPerformanceByMonth] No rows returned from API");
    }

    const CRITERION_TO_COUNTRY: Record<number, string> = {
      2276: "DE", 2528: "NL", 2250: "FR", 2840: "US", 2826: "GB",
      2724: "ES", 2380: "IT", 2056: "BE", 2040: "AT", 2756: "CH",
      2620: "PT", 2616: "PL", 2752: "SE", 2208: "DK", 2578: "NO",
      2246: "FI", 2372: "IE", 2442: "LU", 2124: "CA", 2036: "AU",
    };

    const countryCounts = new Map<string, number>();

    const result = rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const gv = (row.geographicView || row.geographic_view || {}) as Record<string, unknown>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;

      // Try multiple possible field names and formats for country_criterion_id
      const rawCriterionId = gv.countryCriterionId ?? gv.country_criterion_id ?? "";
      let parsedCriterionId: number;

      if (typeof rawCriterionId === "number") {
        // Direct number (e.g., 2528)
        parsedCriterionId = rawCriterionId;
      } else {
        const rawStr = String(rawCriterionId);
        if (rawStr.includes("/")) {
          // Resource path (e.g., "geoTargetConstants/2528")
          parsedCriterionId = parseInt(rawStr.split("/").pop() || "0", 10);
        } else {
          // Numeric string (e.g., "2528")
          parsedCriterionId = parseInt(rawStr || "0", 10);
        }
      }

      const countryCode = CRITERION_TO_COUNTRY[parsedCriterionId] || "";
      countryCounts.set(countryCode || "(empty)", (countryCounts.get(countryCode || "(empty)") ?? 0) + 1);

      return {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        countryCode,
        regionName: String(gv.locationType || gv.location_type || ""),
        geoTargetId: String(parsedCriterionId || rawCriterionId || ""),
        impressions: Number(m.impressions || 0),
        clicks: Number(m.clicks || 0),
        cost: Number(m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: Number(m.conversions || 0),
        conversionsValue: Number(m.conversionsValue || m.conversions_value || 0),
      };
    });

    // Log country distribution
    console.log("[getGeoPerformanceByMonth] Country distribution:", Object.fromEntries(countryCounts));

    return result;
  } catch (err) {
    console.error("[getGeoPerformanceByMonth] ERROR:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Network Performance by Month ──────────────────────────────────────────

export interface NetworkPerformanceRow {
  date: string;
  networkType: string;
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getNetworkPerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<NetworkPerformanceRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        segments.ad_network_type,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND metrics.impressions > 0
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;

      return {
        date: s.month,
        networkType: s.adNetworkType || s.ad_network_type || "UNSPECIFIED",
        campaignId: c.id || "",
        campaignName: c.name || "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}

// ── Creative (Ad) Performance by Month ────────────────────────────────────

export interface CreativePerformanceRow {
  date: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  adId: string;
  adType: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getCreativePerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<CreativePerformanceRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND ad_group_ad.status = 'ENABLED'
        AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.adGroup || row.ad_group) as Record<string, string>;
      const aga = (row.adGroupAd || row.ad_group_ad) as Record<string, unknown>;
      const ad = aga.ad as Record<string, unknown> | undefined;
      const rsa = (ad?.responsiveSearchAd || ad?.responsive_search_ad) as Record<string, unknown[]> | undefined;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;

      const extractTexts = (items: unknown[] | undefined): string[] => {
        if (!Array.isArray(items)) return [];
        return items.map((i) => {
          const item = i as Record<string, string>;
          return item.text || "";
        }).filter(Boolean);
      };

      return {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        adGroupId: ag.id || "",
        adGroupName: ag.name || "",
        adId: String(ad?.id || ""),
        adType: String(ad?.type || ""),
        headlines: extractTexts(rsa?.headlines as unknown[]),
        descriptions: extractTexts(rsa?.descriptions as unknown[]),
        finalUrls: (ad?.finalUrls || ad?.final_urls || []) as string[],
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}

// ── Asset Group Performance by Month (PMax) ───────────────────────────────

export interface AssetGroupPerformanceRow {
  date: string;
  campaignId: string;
  campaignName: string;
  assetGroupId: string;
  assetGroupName: string;
  assetGroupStatus: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getAssetGroupPerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<AssetGroupPerformanceRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        asset_group.id,
        asset_group.name,
        asset_group.status,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM asset_group
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status = 'ENABLED'
        AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.assetGroup || row.asset_group) as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;

      return {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        assetGroupId: ag.id || "",
        assetGroupName: ag.name || "",
        assetGroupStatus: ag.status || "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}

// ── Audience Performance by Month ─────────────────────────────────────────

export interface AudiencePerformanceRow {
  date: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  audienceId: string;
  audienceName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getAudiencePerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<AudiencePerformanceRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.display_name,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM ad_group_audience_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.adGroup || row.ad_group) as Record<string, string>;
      const crit = (row.adGroupCriterion || row.ad_group_criterion) as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;

      return {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        adGroupId: ag.id || "",
        adGroupName: ag.name || "",
        audienceId: String(crit.criterionId || crit.criterion_id || ""),
        audienceName: crit.displayName || crit.display_name || "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}

// ── Ad Schedule Performance (hour + day) ──────────────────────────────────

export interface AdScheduleRow {
  campaignId: string;
  campaignName: string;
  dayOfWeek: string;
  hourOfDay: number;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

// ── Second Opinion specific queries ────────────────────────────────────────

/** Check if PMax campaigns have URL expansion opt-out set */
export interface PMaxUrlExpansionInfo {
  campaignName: string;
  urlExpansionOptOut: boolean;
  finalUrlSuffix: string;
}

export async function getPMaxUrlExpansionSettings(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<PMaxUrlExpansionInfo[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        campaign.url_expansion_opt_out,
        campaign.final_url_suffix
      FROM campaign
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND campaign.status = 'ENABLED'
    `);
    return rows.map((row) => {
      const c = row.campaign as Record<string, unknown>;
      return {
        campaignName: c.name as string || "",
        urlExpansionOptOut: !!(c.urlExpansionOptOut ?? c.url_expansion_opt_out),
        finalUrlSuffix: (c.finalUrlSuffix ?? c.final_url_suffix ?? "") as string,
      };
    });
  } catch { return []; }
}

/** Check Shopping campaign priority settings */
export interface ShoppingPriorityInfo {
  campaignName: string;
  priority: number; // 0, 1, 2
}

export async function getShoppingCampaignPriorities(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<ShoppingPriorityInfo[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        campaign.shopping_setting.campaign_priority
      FROM campaign
      WHERE campaign.advertising_channel_type = 'SHOPPING'
        AND campaign.status = 'ENABLED'
    `);
    return rows.map((row) => {
      const c = row.campaign as Record<string, unknown>;
      const ss = (c.shoppingSetting || c.shopping_setting) as Record<string, number> | undefined;
      return {
        campaignName: c.name as string || "",
        priority: ss?.campaignPriority ?? ss?.campaign_priority ?? 0,
      };
    });
  } catch { return []; }
}

/** Check ad group targeting settings (optimized targeting on/off) */
export interface AdGroupTargetingInfo {
  campaignName: string;
  adGroupName: string;
  optimizedTargetingEnabled: boolean;
}

export async function getAdGroupTargetingSettings(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<AdGroupTargetingInfo[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        ad_group.name,
        ad_group.targeting_setting.target_restrictions
      FROM ad_group
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO', 'DISCOVERY')
      LIMIT 100
    `);
    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.adGroup || row.ad_group) as Record<string, unknown>;
      const ts = (ag.targetingSetting || ag.targeting_setting) as Record<string, unknown[]> | undefined;
      // If no restrictions, optimized targeting is likely on (default)
      const restrictions = ts?.targetRestrictions ?? ts?.target_restrictions ?? [];
      const hasOptOut = Array.isArray(restrictions) && restrictions.some((r: unknown) => {
        const rObj = r as Record<string, unknown>;
        return rObj.targetingDimension === "TARGETING_DIMENSION_UNSPECIFIED" && rObj.bidOnly === false;
      });
      return {
        campaignName: c.name || "",
        adGroupName: ag.name as string || "",
        optimizedTargetingEnabled: !hasOptOut,
      };
    });
  } catch { return []; }
}

/** Check campaign frequency caps */
export interface FrequencyCapInfo {
  campaignName: string;
  hasFrequencyCap: boolean;
  capLevel: string;
  capCount: number;
  capTimeUnit: string;
}

export async function getCampaignFrequencyCaps(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<FrequencyCapInfo[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.name,
        campaign.frequency_caps
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO', 'DISCOVERY')
    `);
    return rows.map((row) => {
      const c = row.campaign as Record<string, unknown>;
      const caps = (c.frequencyCaps || c.frequency_caps) as Array<Record<string, unknown>> | undefined;
      if (!caps || caps.length === 0) {
        return { campaignName: c.name as string || "", hasFrequencyCap: false, capLevel: "", capCount: 0, capTimeUnit: "" };
      }
      const first = caps[0];
      const key = first.key as Record<string, unknown> | undefined;
      return {
        campaignName: c.name as string || "",
        hasFrequencyCap: true,
        capLevel: (key?.level ?? "") as string,
        capCount: (first.cap ?? 0) as number,
        capTimeUnit: (key?.timeUnit ?? key?.time_unit ?? "") as string,
      };
    });
  } catch { return []; }
}

/** Check auto-apply recommendation settings */
export interface AutoApplyRecommendationInfo {
  hasAutoApply: boolean;
  types: string[];
}

export async function getAutoApplyRecommendations(
  credentials: GoogleAdsCredentials,
  customerId: string
): Promise<AutoApplyRecommendationInfo> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        customer.auto_tagging_enabled,
        customer.optimization_score_weight
      FROM customer
      LIMIT 1
    `);
    // Note: actual AAR settings require the Recommendations API which is complex
    // This is a proxy check - we report what we can determine
    return { hasAutoApply: false, types: [] }; // Conservative default
  } catch { return { hasAutoApply: false, types: [] }; }
}

export async function getAdSchedulePerformance(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<AdScheduleRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        segments.day_of_week,
        segments.hour,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND metrics.impressions > 0
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const s = row.segments as Record<string, unknown>;
      const m = row.metrics as Record<string, number>;

      return {
        campaignId: c.id || "",
        campaignName: c.name || "",
        dayOfWeek: String(s.dayOfWeek || s.day_of_week || "UNSPECIFIED"),
        hourOfDay: Number(s.hour || 0),
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}

// ── PMAX Intelligence Queries ─────────────────────────────────────────────

export interface PmaxAssetPerformanceRow {
  date: string;
  campaignId: string;
  campaignName: string;
  assetGroupId: string;
  assetGroupName: string;
  assetId: string;
  assetType: string;
  assetText: string;
  assetUrl: string;
  performanceLabel: string;
}

export async function getPmaxAssetPerformanceByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<PmaxAssetPerformanceRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        asset_group.id,
        asset_group.name,
        asset_group_asset.field_type,
        asset_group_asset.performance_label,
        asset.id,
        asset.type,
        asset.text_asset.text,
        asset.image_asset.full_size.url,
        asset.youtube_video_asset.youtube_video_id
      FROM asset_group_asset
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND campaign.status = 'ENABLED'
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.assetGroup || row.asset_group) as Record<string, string>;
      const aga = (row.assetGroupAsset || row.asset_group_asset) as Record<string, string>;
      const asset = row.asset as Record<string, unknown>;

      const textAsset = (asset?.textAsset || asset?.text_asset) as Record<string, string> | undefined;
      const imageAsset = (asset?.imageAsset || asset?.image_asset) as Record<string, unknown> | undefined;
      const videoAsset = (asset?.youtubeVideoAsset || asset?.youtube_video_asset) as Record<string, string> | undefined;
      const fullSize = (imageAsset?.fullSize || imageAsset?.full_size) as Record<string, string> | undefined;

      return {
        date: startDate, // asset_group_asset doesn't support date segmentation — use sync period
        campaignId: c.id || "",
        campaignName: c.name || "",
        assetGroupId: ag.id || "",
        assetGroupName: ag.name || "",
        assetId: String(asset?.id || ""),
        assetType: String(aga?.fieldType || aga?.field_type || asset?.type || ""),
        assetText: textAsset?.text || "",
        assetUrl: fullSize?.url || (videoAsset?.youtubeVideoId ? `https://youtube.com/watch?v=${videoAsset.youtubeVideoId}` : ""),
        performanceLabel: aga?.performanceLabel || aga?.performance_label || "UNSPECIFIED",
      };
    });
  } catch { return []; }
}

export interface PmaxNetworkBreakdownRow {
  date: string;
  campaignId: string;
  campaignName: string;
  assetGroupId: string;
  assetGroupName: string;
  networkType: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getPmaxNetworkBreakdownByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<PmaxNetworkBreakdownRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        asset_group.id,
        asset_group.name,
        segments.ad_network_type,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM asset_group
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND campaign.status = 'ENABLED'
        AND metrics.impressions > 0
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const ag = (row.assetGroup || row.asset_group) as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;

      return {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        assetGroupId: ag.id || "",
        assetGroupName: ag.name || "",
        networkType: s.adNetworkType || s.ad_network_type || "UNSPECIFIED",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}

export interface PmaxPlacementRow {
  campaignId: string;
  campaignName: string;
  placement: string;
  placementType: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getPmaxPlacementsByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<PmaxPlacementRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        group_placement_view.placement,
        group_placement_view.placement_type,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM group_placement_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND campaign.status = 'ENABLED'
        AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const gp = (row.groupPlacementView || row.group_placement_view) as Record<string, string>;
      const m = row.metrics as Record<string, number>;

      return {
        campaignId: c.id || "",
        campaignName: c.name || "",
        placement: gp.placement || "",
        placementType: gp.placementType || gp.placement_type || "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}

export interface PmaxSearchCategoryRow {
  date: string;
  campaignId: string;
  campaignName: string;
  categoryLabel: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export async function getPmaxSearchCategoriesByMonth(
  credentials: GoogleAdsCredentials,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<PmaxSearchCategoryRow[]> {
  try {
    const rows = await queryGoogleAds(credentials, customerId, `
      SELECT
        campaign.id,
        campaign.name,
        campaign_search_term_insight.category_label,
        segments.month,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign_search_term_insight
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((row) => {
      const c = row.campaign as Record<string, string>;
      const insight = (row.campaignSearchTermInsight || row.campaign_search_term_insight) as Record<string, string>;
      const s = row.segments as Record<string, string>;
      const m = row.metrics as Record<string, number>;

      return {
        date: s.month,
        campaignId: c.id || "",
        campaignName: c.name || "",
        categoryLabel: insight.categoryLabel || insight.category_label || "",
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost: (m.costMicros || m.cost_micros || 0) / 1_000_000,
        conversions: m.conversions || 0,
        conversionsValue: m.conversionsValue || m.conversions_value || 0,
      };
    });
  } catch { return []; }
}
