// =====================================================================
// STATUS: LIVE-ONGETEST EN GATED OP MDP-APPROVAL. Spiegelt het Google-sync-route-patroon
// (env-credentials, admin-client via service_role, in-memory token-refresh). Pas tegen een
// goedgekeurde app en een echt account te verifieren.
//
// TOKEN-ROTATIE: dit env-pad gebruikt een LinkedIn refresh token uit de omgeving, net als de
// Google-koppeling. LET OP: LinkedIn refresh tokens roteren (circa 60 dagen access, 12 maanden
// refresh), anders dan Google's permanente token. Voor productie-automatisering hoort de
// opgeslagen-token-weg met cron (auth.ts: ensureFreshToken plus refreshDueConnections) gebruikt
// te worden zodra de token-opslagkeuze gemaakt is. Tot dan: de env-token periodiek hernieuwen.
// =====================================================================

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { refreshAccessToken, type LinkedInOAuthConfig } from "@/lib/linkedin/auth";
import {
  syncLinkedinBackfill, syncLinkedinDaily, type LinkedInLevel, type SyncContext,
} from "@/lib/linkedin/sync";
import {
  fetchCampaignGroups, fetchCampaigns, fetchCreatives,
  campaignGroupToDbRow, campaignToDbRow, creativeToDbRow,
} from "@/lib/linkedin/entities";

export const maxDuration = 300; // backfill kan lang duren

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function getCredentials(): (LinkedInOAuthConfig & { refreshToken: string }) | null {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

// In-memory access-token-cache, zelfde idee als de Google-koppeling (60s buffer).
let cachedToken: { token: string; expiresAt: number } | null = null;
async function getAccessToken(creds: LinkedInOAuthConfig & { refreshToken: string }): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const refreshed = await refreshAccessToken(creds.refreshToken, creds);
  if (!refreshed) return null;
  cachedToken = { token: refreshed.accessToken, expiresAt: Date.now() + refreshed.expiresIn * 1000 };
  return refreshed.accessToken;
}

function lastCompleteMonthEnd(now = new Date()): string {
  const currentMonth = now.getUTCMonth() + 1;
  const year = currentMonth === 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = currentMonth === 1 ? 12 : currentMonth - 1;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * POST /api/sync/linkedin — trigger een sync voor een client.
 * Body: { client_id: string, scope?: "backfill" | "daily" }
 *
 * GET /api/sync/linkedin?client_id=xxx — sync-status voor een client.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const creds = getCredentials();
  if (!creds) return Response.json({ error: "LinkedIn credentials niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  let scope: "backfill" | "daily";
  try {
    const body = await request.json();
    clientId = body.client_id;
    scope = body.scope === "backfill" ? "backfill" : "daily";
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: 'Verwacht: { client_id: string, scope?: "backfill" | "daily" }' }, { status: 400 });
  }

  // Het ad-account-URN voor deze client uit de connectie.
  const { data: conn } = await supabase
    .from("linkedin_connections")
    .select("ad_account_urn, status")
    .eq("client_id", clientId)
    .maybeSingle();
  const accountUrn = (conn as { ad_account_urn?: string } | null)?.ad_account_urn;
  if (!accountUrn) {
    return Response.json({ error: `Client "${clientId}" heeft geen LinkedIn-koppeling` }, { status: 404 });
  }

  const accessToken = await getAccessToken(creds);
  if (!accessToken) {
    await supabase.from("linkedin_connections").update({ status: "expired", last_error: "Token-refresh faalde", updated_at: new Date().toISOString() }).eq("client_id", clientId);
    return Response.json({ error: "LinkedIn token-refresh faalde" }, { status: 502 });
  }

  // Log de run-start.
  const { data: runRow } = await supabase
    .from("linkedin_sync_runs")
    .insert({ client_id: clientId, scope, status: "running" })
    .select("id")
    .single();
  const runId = (runRow as { id?: string } | null)?.id;

  try {
    const ctx: SyncContext = { supabase, clientId, accessToken };
    const entityCtx = { accessToken };

    // Entiteiten ophalen en upserten; verzamel de URNs voor de analytics-sync.
    const groups = await fetchCampaignGroups(entityCtx, accountUrn);
    if (groups.length > 0) await supabase.from("linkedin_campaign_groups").upsert(groups.map((g) => campaignGroupToDbRow(g, clientId)), { onConflict: "group_urn" });

    const campaigns = await fetchCampaigns(entityCtx, accountUrn);
    if (campaigns.length > 0) await supabase.from("linkedin_campaigns").upsert(campaigns.map((c) => campaignToDbRow(c, clientId)), { onConflict: "campaign_urn" });
    const campaignUrns = campaigns.map((c) => String(c.id ?? c.urn)).filter(Boolean);

    const creativeUrns: string[] = [];
    for (const campaignUrn of campaignUrns) {
      const creatives = await fetchCreatives(entityCtx, campaignUrn);
      if (creatives.length > 0) {
        await supabase.from("linkedin_creatives").upsert(creatives.map((cr) => creativeToDbRow(cr, clientId)), { onConflict: "creative_urn" });
        creativeUrns.push(...creatives.map((cr) => String(cr.id ?? cr.urn)).filter(Boolean));
      }
    }

    const entitiesByLevel: Record<LinkedInLevel, string[]> = {
      account: [accountUrn],
      campaign: campaignUrns,
      creative: creativeUrns,
    };

    const endDate = lastCompleteMonthEnd();
    const rowsUpserted =
      scope === "backfill"
        ? { backfill: await syncLinkedinBackfill(ctx, endDate, entitiesByLevel) }
        : await syncLinkedinDaily(ctx, endDate, entitiesByLevel);

    if (runId) {
      await supabase.from("linkedin_sync_runs").update({
        finished_at: new Date().toISOString(),
        status: "completed",
        rows_upserted: rowsUpserted,
      }).eq("id", runId);
    }
    await supabase.from("linkedin_connections").update({ last_sync_at: new Date().toISOString(), status: "active", last_error: null, updated_at: new Date().toISOString() }).eq("client_id", clientId);

    return Response.json({ ok: true, client_id: clientId, scope, entities: { campaigns: campaignUrns.length, creatives: creativeUrns.length }, rows_upserted: rowsUpserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync mislukt";
    if (runId) await supabase.from("linkedin_sync_runs").update({ finished_at: new Date().toISOString(), status: "failed", error: message }).eq("id", runId);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });

  const { data: runs } = await supabase
    .from("linkedin_sync_runs")
    .select("id, started_at, finished_at, scope, status, rows_upserted, error")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(5);

  const { data: conn } = await supabase
    .from("linkedin_connections")
    .select("status, last_sync_at, last_error")
    .eq("client_id", clientId)
    .maybeSingle();

  return Response.json({ connection: conn ?? { status: "missing" }, recentRuns: runs ?? [] });
}
