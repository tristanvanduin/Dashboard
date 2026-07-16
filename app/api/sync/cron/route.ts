import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncClient, type SyncResult } from "@/lib/sync/orchestrator";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";

/**
 * GET /api/sync/cron — Nightly scheduled sync for all active clients.
 *
 * Secured with CRON_SECRET header to prevent unauthorized access.
 * Designed to be called by:
 * - Vercel Cron Jobs (vercel.json)
 * - External cron service (e.g., cron-job.org)
 * - Supabase Edge Functions
 *
 * Syncs all Google Ads-connected clients sequentially to avoid
 * rate limit issues with the Google Ads API.
 */

export const maxDuration = 300; // 5 minutes max

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

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

export async function GET(request: NextRequest) {
  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const credentials = getCredentials();
  if (!credentials) return Response.json({ error: "Google Ads credentials niet geconfigureerd" }, { status: 500 });

  // Get all Google Ads-connected clients from app_settings
  const { data: settingsRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "api_clients")
    .maybeSingle();

  if (!settingsRow?.value || !Array.isArray(settingsRow.value)) {
    return Response.json({ error: "Geen clients geconfigureerd" }, { status: 404 });
  }

  const clients = (settingsRow.value as Array<{ id: string; name?: string; googleAdsCustomerId?: string }>)
    .filter((c) => c.googleAdsCustomerId);

  if (clients.length === 0) {
    return Response.json({ error: "Geen clients met Google Ads koppeling" }, { status: 404 });
  }

  // Sync clients sequentially (rate limit friendly)
  const results: Array<{ clientId: string; status: string; rows: number; error?: string }> = [];
  let succeeded = 0;
  let failed = 0;

  for (const client of clients) {
    try {
      const result: SyncResult = await syncClient({
        supabase,
        credentials,
        clientId: client.id,
        customerId: client.googleAdsCustomerId!,
        syncType: "scheduled",
        triggeredBy: "cron",
      });

      await syncMerchantProductSnapshots({
        supabase,
        clientId: client.id,
        credentials,
      });

      results.push({
        clientId: client.id,
        status: result.status,
        rows: result.totalRowsWritten,
      });

      if (result.status === "success" || result.status === "partial") {
        succeeded++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      results.push({
        clientId: client.id,
        status: "failed",
        rows: 0,
        error: err instanceof Error ? err.message : "Onbekende fout",
      });
    }
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    totalClients: clients.length,
    succeeded,
    failed,
    results,
  });
}
