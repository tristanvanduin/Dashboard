import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getAccountMetricsByMonth,
  getAccountMetricsByWeek,
  getCampaignMetricsByMonth,
  getCampaignImpressionShare,
  getConversionActions,
  getAccountStructure,
  getWastefulSearchTerms,
  getAdGroupPerformance,
  getProductGroupPerformance,
  getChangeHistory,
  type GoogleAdsCredentials,
} from "@/lib/api/google-ads";
import {
  googleAdsMonthlyToApiData,
  googleAdsWeeklyToApiData,
  buildClientDataFromApi,
  type YearDataInput,
} from "@/lib/api/adapter";

function getCredentials(): GoogleAdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
}

/**
 * Fetch all dashboard data for a single Google Ads client account.
 * Returns monthly + weekly data for 2024, 2025, and 2026 (YTD),
 * plus campaign-level data for the current year.
 *
 * Query params:
 *   customerId - Google Ads customer ID (no dashes)
 */
export async function GET(request: NextRequest) {
  const credentials = getCredentials();
  if (!credentials) {
    return Response.json({ error: "Google Ads API not configured" }, { status: 500 });
  }

  const customerId = request.nextUrl.searchParams.get("customerId");
  if (!customerId) {
    return Response.json({ error: "customerId is required" }, { status: 400 });
  }

  // Optional: filter by specific conversion action IDs
  const convActionIdsParam = request.nextUrl.searchParams.get("conversionActionIds");
  const convActionIds = convActionIdsParam ? convActionIdsParam.split(",").filter(Boolean) : undefined;

  try {
    // ── Determine year range dynamically ──────────────────────────────
    const currentYear = new Date().getFullYear();
    const MAX_HISTORY_YEARS = 5;
    const firstHistoricalYear = currentYear - MAX_HISTORY_YEARS;

    // Fetch ALL historical data in 2 bulk calls (one date range) instead of per-year.
    // This reduces API calls from 10+ to just 2 for all history.
    const [
      allHistoricalMonthlyRaw,
      allHistoricalWeeklyRaw,
      currentYearMonthlyRaw,
      currentYearWeeklyRaw,
      campaignsPrevYearRaw,
      campaignsCurrentYearRaw,
      impressionShareRaw,
      conversionActionsRaw,
      accountStructureRaw,
      wastefulSearchTermsRaw,
      adGroupPerformanceRaw,
      productGroupPerformanceRaw,
      changeHistoryRaw,
    ] = await Promise.all([
      getAccountMetricsByMonth(credentials, customerId, `${firstHistoricalYear}-01-01`, `${currentYear - 1}-12-31`, convActionIds),
      getAccountMetricsByWeek(credentials, customerId, `${firstHistoricalYear}-01-01`, `${currentYear - 1}-12-31`),
      getAccountMetricsByMonth(credentials, customerId, `${currentYear}-01-01`, `${currentYear}-12-31`, convActionIds),
      getAccountMetricsByWeek(credentials, customerId, `${currentYear}-01-01`, `${currentYear}-12-31`),
      getCampaignMetricsByMonth(credentials, customerId, `${currentYear - 1}-01-01`, `${currentYear - 1}-12-31`),
      getCampaignMetricsByMonth(credentials, customerId, `${currentYear}-01-01`, `${currentYear}-12-31`),
      getCampaignImpressionShare(credentials, customerId,
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        new Date().toISOString().split("T")[0]
      ),
      getConversionActions(credentials, customerId),
      getAccountStructure(credentials, customerId),
      getWastefulSearchTerms(credentials, customerId),
      getAdGroupPerformance(credentials, customerId),
      getProductGroupPerformance(credentials, customerId),
      getChangeHistory(credentials, customerId),
    ]);

    // Split bulk historical data into per-year buckets
    const allHistoricalMonthly = googleAdsMonthlyToApiData(allHistoricalMonthlyRaw);
    const allHistoricalWeekly = googleAdsWeeklyToApiData(allHistoricalWeeklyRaw);

    // Google Ads returns segments.month as "YYYY-MM-01", parseMonth extracts month number.
    // We need year info too — extract from the raw date strings.
    const parseYear = (dateStr: string): number => parseInt(dateStr.split("-")[0], 10);

    // Group monthly data by year
    const monthlyByYear = new Map<number, typeof allHistoricalMonthly>();
    for (let i = 0; i < allHistoricalMonthlyRaw.length; i++) {
      const year = parseYear(allHistoricalMonthlyRaw[i].date);
      if (!monthlyByYear.has(year)) monthlyByYear.set(year, []);
      monthlyByYear.get(year)!.push(allHistoricalMonthly[i]);
    }

    // Group weekly data by year
    const weeklyByYear = new Map<number, typeof allHistoricalWeekly>();
    for (let i = 0; i < allHistoricalWeeklyRaw.length; i++) {
      const year = parseYear(allHistoricalWeeklyRaw[i].date);
      if (!weeklyByYear.has(year)) weeklyByYear.set(year, []);
      weeklyByYear.get(year)!.push(allHistoricalWeekly[i]);
    }

    // Build per-year data, filter out empty years
    const historicalYearsData: YearDataInput[] = [];
    for (let y = firstHistoricalYear; y < currentYear; y++) {
      const monthly = monthlyByYear.get(y) ?? [];
      const weekly = weeklyByYear.get(y) ?? [];
      if (monthly.some((m) => m.conversions > 0 || m.adSpend > 0)) {
        historicalYearsData.push({ year: y, monthly, weekly });
      }
    }

    const currentYearMonthly = googleAdsMonthlyToApiData(currentYearMonthlyRaw);
    const currentYearWeekly = googleAdsWeeklyToApiData(currentYearWeeklyRaw);

    // Determine realized months: only count COMPLETE months
    const now = new Date();
    const currentMonthNum = now.getFullYear() === currentYear ? now.getMonth() + 1 : 13;
    const monthsWithData = currentYearMonthly.map((m) => m.month).filter((m) => m < currentMonthNum);
    const realizedThroughMonth = monthsWithData.length > 0
      ? Math.max(...monthsWithData)
      : 0;

    // Default target: 10% growth over most recent full year
    const lastFullYear = historicalYearsData.length > 0
      ? historicalYearsData[historicalYearsData.length - 1]
      : null;
    const prevConv = lastFullYear?.monthly.reduce((s, m) => s + m.conversions, 0) ?? 0;
    const prevRev = lastFullYear?.monthly.reduce((s, m) => s + m.revenue, 0) ?? 0;
    const prevSpend = lastFullYear?.monthly.reduce((s, m) => s + m.adSpend, 0) ?? 0;

    const targetCurrentYear = {
      conversions: Math.round(prevConv * 1.10),
      revenue: Math.round(prevRev * 1.10),
      adSpend: Math.round(prevSpend * 1.05),
    };

    // Campaign data — includes all statuses (ENABLED, PAUSED, REMOVED)
    // so historical performance of paused/removed campaigns is preserved
    const mapCampaign = (c: (typeof campaignsCurrentYearRaw)[number]) => ({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      campaignStatus: c.campaignStatus,
      month: c.date,
      conversions: Math.round(c.conversions),
      revenue: Math.round(c.conversionsValue),
      adSpend: Math.round(c.cost),
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
      avgCpc: c.avgCpc,
      conversionRate: c.conversionRate,
    });

    const campaigns = campaignsCurrentYearRaw.map(mapCampaign);
    const campaignsHistorical = campaignsPrevYearRaw.map(mapCampaign);

    // Impression share data for budget expansion analysis
    const impressionShare = impressionShareRaw.map((is) => ({
      campaignId: is.campaignId,
      campaignName: is.campaignName,
      campaignType: is.campaignType,
      cost: Math.round(is.cost),
      conversions: Math.round(is.conversions),
      searchImpressionShare: is.searchImpressionShare,
      searchBudgetLostIS: is.searchBudgetLostIS,
      searchRankLostIS: is.searchRankLostIS,
      dailyBudget: Math.round(is.dailyBudget),
      budgetUtilization: parseFloat(is.budgetUtilization.toFixed(2)),
    }));

    // Conversion actions for the settings panel
    const conversionActions = conversionActionsRaw
      .filter((ca) => ca.status !== "REMOVED")
      .map((ca) => ({
        id: ca.id,
        name: ca.name,
        category: ca.category,
        status: ca.status,
        type: ca.type,
        primaryForGoal: ca.primaryForGoal,
      }));

    // ── Country data from pre-aggregated Supabase tables (with fallbacks) ──
    let campaignCountryMap: Record<string, string> = {};
    /** Per campaign: all countries with their spend share (e.g., { "NL": 0.8, "BE": 0.2 }) */
    let campaignCountryShares: Record<string, Record<string, number>> = {};
    let detectedCountries: string[] = [];
    let countryMonthlyData: Array<{
      countryCode: string; month: string;
      impressions: number; clicks: number; cost: number;
      conversions: number; conversionsValue: number;
      ctr: number; avgCpc: number; costPerConversion: number;
      conversionRate: number; roas: number;
      campaignCount: number; spendShare: number;
    }> = [];
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (sbUrl && sbKey) {
      try {
        const sb = createClient(sbUrl, sbKey);
        const clientId = `gads-${customerId}`;
        const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        // Try pre-aggregated country tables first
        const [{ data: dominantData }, { data: cmData }] = await Promise.all([
          sb.from("ads_campaign_country_monthly")
            .select("campaign_name, country_code, cost")
            .eq("client_id", clientId)
            .gte("month", sixMonthsAgo)
            .gt("cost", 0),
          sb.from("ads_country_monthly")
            .select("country_code, month, impressions, clicks, cost, conversions, conversions_value, ctr, avg_cpc, cost_per_conversion, conversion_rate, roas, campaign_count, spend_share")
            .eq("client_id", clientId)
            .order("month", { ascending: true }),
        ]);

        // Helper: build campaignCountryMap + campaignCountryShares from rows
        function buildCountryMaps(rows: Array<{ campaign_name: unknown; country_code: unknown; cost: unknown }>) {
          const campSpend = new Map<string, Map<string, number>>();
          for (const row of rows) {
            const camp = row.campaign_name as string;
            const cc = (row.country_code as string ?? "").toUpperCase();
            if (!camp || !cc) continue;
            if (!campSpend.has(camp)) campSpend.set(camp, new Map());
            const cm = campSpend.get(camp)!;
            cm.set(cc, (cm.get(cc) ?? 0) + Number(row.cost ?? 0));
          }
          for (const [camp, cm] of campSpend) {
            const totalSpend = Array.from(cm.values()).reduce((s, v) => s + v, 0);
            let maxCode = "";
            let maxSpend = 0;
            const shares: Record<string, number> = {};
            for (const [cc, spend] of cm) {
              shares[cc] = totalSpend > 0 ? parseFloat((spend / totalSpend).toFixed(4)) : 0;
              if (spend > maxSpend) { maxCode = cc; maxSpend = spend; }
            }
            if (maxCode) campaignCountryMap[camp] = maxCode;
            campaignCountryShares[camp] = shares;
          }
        }

        // Build from pre-aggregated data
        if (dominantData && dominantData.length > 0) {
          buildCountryMaps(dominantData);
        }

        // Fallback: if pre-aggregated tables are empty, try raw geo data
        if (Object.keys(campaignCountryMap).length === 0) {
          const { data: geoData } = await sb
            .from("ads_geo_performance_monthly")
            .select("campaign_name, country_code, cost")
            .eq("client_id", clientId)
            .gte("month", sixMonthsAgo)
            .gt("cost", 0);

          if (geoData && geoData.length > 0) {
            buildCountryMaps(geoData);
          }
        }

        // Debug: log what data was found
        console.log(`[country-data] client=${clientId} dominantRows=${dominantData?.length ?? 0} countryMonthlyRows=${cmData?.length ?? 0} campaignCountryMapSize=${Object.keys(campaignCountryMap).length}`);

        // Build country monthly data + detected countries
        if (cmData && cmData.length > 0) {
          countryMonthlyData = cmData.map((r) => ({
            countryCode: r.country_code as string,
            month: r.month as string,
            impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0),
            cost: Number(r.cost ?? 0),
            conversions: Number(r.conversions ?? 0),
            conversionsValue: Number(r.conversions_value ?? 0),
            ctr: Number(r.ctr ?? 0),
            avgCpc: Number(r.avg_cpc ?? 0),
            costPerConversion: Number(r.cost_per_conversion ?? 0),
            conversionRate: Number(r.conversion_rate ?? 0),
            roas: Number(r.roas ?? 0),
            campaignCount: Number(r.campaign_count ?? 0),
            spendShare: Number(r.spend_share ?? 0),
          }));

          const countryTotals = new Map<string, number>();
          for (const r of countryMonthlyData) {
            countryTotals.set(r.countryCode, (countryTotals.get(r.countryCode) ?? 0) + r.cost);
          }
          detectedCountries = Array.from(countryTotals.entries())
            .filter(([, spend]) => spend > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([cc]) => cc);
        }

        // Final fallback for detectedCountries: derive from campaignCountryMap
        if (detectedCountries.length === 0 && Object.keys(campaignCountryMap).length > 0) {
          const countryTotals = new Map<string, number>();
          for (const cc of Object.values(campaignCountryMap)) {
            countryTotals.set(cc, (countryTotals.get(cc) ?? 0) + 1);
          }
          detectedCountries = Array.from(countryTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([cc]) => cc);
        }
      } catch { /* country data optional */ }
    }

    // Last resort: detect countries from campaign names if still empty
    if (detectedCountries.length === 0) {
      const { detectCountriesFromCampaigns } = await import("@/lib/countries");
      const allCampaignNames = [
        ...campaignsCurrentYearRaw.map((c) => c.campaignName),
        ...campaignsPrevYearRaw.map((c) => c.campaignName),
      ];
      const fromNames = detectCountriesFromCampaigns(allCampaignNames);
      if (fromNames.length > 0) {
        detectedCountries = fromNames;
        // Also build campaignCountryMap from names if still empty
        if (Object.keys(campaignCountryMap).length === 0) {
          const { detectCountryFromName } = await import("@/lib/countries");
          for (const name of new Set(allCampaignNames)) {
            const cc = detectCountryFromName(name);
            if (cc) {
              campaignCountryMap[name] = cc;
              campaignCountryShares[name] = { [cc]: 1 };
            }
          }
        }
      }
    }

    return Response.json({
      customerId,
      currentYear,
      realizedThroughMonth,
      targetCurrentYear,
      historicalYears: historicalYearsData,
      currentYearMonthly,
      currentYearWeekly,
      campaigns,
      campaignsHistorical,
      impressionShare,
      conversionActions,
      accountStructure: accountStructureRaw,
      wastefulSearchTerms: wastefulSearchTermsRaw,
      campaignCountryMap,
      campaignCountryShares,
      detectedCountries,
      countryMonthlyData,
      adGroupBleeders: adGroupPerformanceRaw.filter((ag) => ag.conversions === 0 && ag.cost > 10),
      adGroupPerformance: adGroupPerformanceRaw.slice(0, 50),
      productBleeders: productGroupPerformanceRaw.filter((p) => p.cost > 10 && (p.conversions === 0 || p.conversionsValue < p.cost)),
      productPerformance: productGroupPerformanceRaw.slice(0, 50),
      changeHistory: changeHistoryRaw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
