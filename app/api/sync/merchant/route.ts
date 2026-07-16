import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";

export const maxDuration = 300;

function getCredentials(): GoogleAdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!developerToken || !clientId || !clientSecret || !refreshToken) return null;
  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const credentials = getCredentials();
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id }" }, { status: 400 });
  }

  const result = await syncMerchantProductSnapshots({
    supabase,
    clientId,
    credentials,
    forceRefresh: true,
  });

  return Response.json({
    clientId,
    tracker: result.tracker,
    message: result.message,
    productCount: result.products.length,
  });
}
