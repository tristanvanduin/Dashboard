import { NextRequest } from "next/server";
import {
  listAdAccounts,
  getAccountMetricsByMonth,
  getAccountMetricsByWeek,
  getCampaignMetricsByMonth,
  getConversionEvents,
  type MetaAdsCredentials,
} from "@/lib/api/meta-ads";

function getCredentials(): MetaAdsCredentials | null {
  const accessToken = process.env.META_ADS_ACCESS_TOKEN;

  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    appId: process.env.META_ADS_APP_ID,
    appSecret: process.env.META_ADS_APP_SECRET,
  };
}

export async function GET(request: NextRequest) {
  const credentials = getCredentials();
  if (!credentials) {
    return Response.json(
      { error: "Meta Ads API credentials not configured", connected: false },
      { status: 200 }
    );
  }

  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action");
  const adAccountId = searchParams.get("adAccountId") || "";
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";

  try {
    switch (action) {
      case "status":
        return Response.json({ connected: true });

      case "accounts":
        const accounts = await listAdAccounts(credentials);
        return Response.json({ connected: true, accounts });

      case "account-monthly":
        const monthly = await getAccountMetricsByMonth(credentials, adAccountId, startDate, endDate);
        return Response.json({ data: monthly });

      case "account-weekly":
        const weekly = await getAccountMetricsByWeek(credentials, adAccountId, startDate, endDate);
        return Response.json({ data: weekly });

      case "campaigns":
        const campaigns = await getCampaignMetricsByMonth(credentials, adAccountId, startDate, endDate);
        return Response.json({ data: campaigns });

      case "conversion-events":
        const events = await getConversionEvents(credentials, adAccountId, startDate, endDate);
        return Response.json({ data: events });

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message, connected: false }, { status: 500 });
  }
}
