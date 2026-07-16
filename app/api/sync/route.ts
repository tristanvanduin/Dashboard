import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncClient } from "@/lib/sync/orchestrator";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";

export const maxDuration = 120; // 2 minutes for full sync

/**
 * POST /api/sync — trigger a manual sync for a single client.
 * Body: { client_id: string }
 *
 * GET /api/sync?client_id=xxx — get sync status for a client.
 */

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
  return { developerToken, clientId, clientSecret, refreshToken, managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID };
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const credentials = getCredentials();
  if (!credentials) return Response.json({ error: "Google Ads credentials niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  // Look up Google Ads customer ID
  const { data: settingsRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "api_clients")
    .maybeSingle();

  if (!settingsRow?.value || !Array.isArray(settingsRow.value)) {
    return Response.json({ error: "Geen clients geconfigureerd" }, { status: 404 });
  }

  const client = (settingsRow.value as Array<{ id: string; googleAdsCustomerId?: string }>)
    .find((c) => c.id === clientId);

  if (!client?.googleAdsCustomerId) {
    return Response.json({ error: `Client "${clientId}" heeft geen Google Ads koppeling` }, { status: 404 });
  }

  try {
    const result = await syncClient({
      supabase,
      credentials,
      clientId,
      customerId: client.googleAdsCustomerId,
      syncType: "manual",
      triggeredBy: "api",
    });

    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Sync mislukt" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });

  // Get sync status
  const { data: status } = await supabase
    .from("client_sync_status")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  // Get recent runs
  const { data: runs } = await supabase
    .from("sync_runs")
    .select("id, sync_type, status, started_at, finished_at, datasets_succeeded, datasets_failed, total_rows_written, error_summary")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(5);

  return Response.json({
    syncStatus: status ?? { client_id: clientId, freshness_status: "missing", last_sync_at: null },
    recentRuns: runs ?? [],
  });
}
