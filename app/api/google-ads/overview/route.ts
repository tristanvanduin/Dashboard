import { NextRequest } from "next/server";
import {
  getAccountMetricsByMonth,
  type GoogleAdsCredentials,
} from "@/lib/api/google-ads";
import { googleAdsMonthlyToApiData } from "@/lib/api/adapter";

function getCredentials(): GoogleAdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!developerToken || !clientId || !clientSecret || !refreshToken) return null;

  return {
    developerToken, clientId, clientSecret, refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
}

/**
 * Fetch overview KPIs for multiple Google Ads accounts in parallel.
 * Query: ?customerIds=123,456,789
 * Returns a lightweight summary per account for the overview table.
 */
export async function GET(request: NextRequest) {
  const credentials = getCredentials();
  if (!credentials) {
    return Response.json({ error: "Not configured" }, { status: 500 });
  }

  const idsParam = request.nextUrl.searchParams.get("customerIds");
  if (!idsParam) {
    return Response.json({ error: "customerIds required" }, { status: 400 });
  }

  const customerIds = idsParam.split(",").filter(Boolean);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const startOfYear = `${currentYear}-01-01`;
  const today = now.toISOString().split("T")[0];

  // Fetch current year data for all accounts in parallel
  const results = await Promise.allSettled(
    customerIds.map(async (customerId) => {
      try {
        const [monthlyRaw, prevYearRaw] = await Promise.all([
          getAccountMetricsByMonth(credentials, customerId, startOfYear, today),
          getAccountMetricsByMonth(credentials, customerId, `${currentYear - 1}-01-01`, `${currentYear - 1}-12-31`),
        ]);

        const monthly = googleAdsMonthlyToApiData(monthlyRaw);
        const prevYear = googleAdsMonthlyToApiData(prevYearRaw);

        // YTD totals (only complete months)
        const completeMonths = monthly.filter((m) => m.month < currentMonth);
        const ytdConv = completeMonths.reduce((s, m) => s + m.conversions, 0);
        const ytdRev = completeMonths.reduce((s, m) => s + m.revenue, 0);
        const ytdSpend = completeMonths.reduce((s, m) => s + m.adSpend, 0);

        // Same period last year
        const prevSamePeriod = prevYear.filter((m) => m.month < currentMonth);
        const prevConv = prevSamePeriod.reduce((s, m) => s + m.conversions, 0);
        const prevRev = prevSamePeriod.reduce((s, m) => s + m.revenue, 0);
        const prevSpend = prevSamePeriod.reduce((s, m) => s + m.adSpend, 0);

        // Last complete month
        const lastMonth = completeMonths[completeMonths.length - 1];
        const prevLastMonth = prevYear.find((m) => m.month === (lastMonth?.month ?? 0));

        return {
          customerId,
          ytd: {
            conversions: ytdConv,
            revenue: ytdRev,
            adSpend: ytdSpend,
            roas: ytdSpend > 0 ? parseFloat((ytdRev / ytdSpend).toFixed(2)) : 0,
            cpa: ytdConv > 0 ? parseFloat((ytdSpend / ytdConv).toFixed(2)) : 0,
          },
          yoy: {
            convChange: prevConv > 0 ? parseFloat((((ytdConv - prevConv) / prevConv) * 100).toFixed(1)) : null,
            revChange: prevRev > 0 ? parseFloat((((ytdRev - prevRev) / prevRev) * 100).toFixed(1)) : null,
            spendChange: prevSpend > 0 ? parseFloat((((ytdSpend - prevSpend) / prevSpend) * 100).toFixed(1)) : null,
          },
          lastMonth: lastMonth ? {
            month: lastMonth.month,
            conversions: lastMonth.conversions,
            revenue: lastMonth.revenue,
            adSpend: lastMonth.adSpend,
            prevYearConv: prevLastMonth?.conversions ?? 0,
          } : null,
          monthlyConversions: monthly.map((m) => m.conversions),
        };
      } catch (err) {
        return { customerId, error: err instanceof Error ? err.message : "Failed" };
      }
    })
  );

  const accounts = results.map((r) =>
    r.status === "fulfilled" ? r.value : { customerId: "unknown", error: "Failed" }
  );

  return Response.json({ accounts });
}
