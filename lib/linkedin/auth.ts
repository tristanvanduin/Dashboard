// =====================================================================
// STATUS: LIVE-ONGETEST EN GATED OP MDP-APPROVAL. De OAuth-refresh-flow volgt de
// LinkedIn-docs maar is pas tegen een echte app en token te verifieren. De token-opslag
// hoort exact het Google-secret-patroon te volgen; dat is hier geabstraheerd via SecretStore
// zodat de aanroeper de bestaande Google-secret-implementatie aansluit.
// =====================================================================
//
// OAuth 2.0 three-legged met refresh tokens van circa 60 dagen. Zonder een refresh-cron sterft
// de sync stilletjes, dus ensureFreshToken ververst ruim voor expiratie en zet de connectie op
// status expired met een duidelijke melding als de refresh faalt.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

const log = logger.child("linkedin-auth");
const OAUTH_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

// De geheime velden achter de token_ref / refresh_token_ref op linkedin_connections. De
// implementatie sluit aan op het bestaande Google-secret-patroon (geen platte tokens in de DB).
export interface SecretStore {
  load(ref: string): Promise<string | null>;
  store(ref: string, value: string): Promise<void>;
}

export interface LinkedInOAuthConfig {
  clientId: string;
  clientSecret: string;
}

interface RefreshResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

// LIVE-ONGETEST. Wisselt een refresh token in voor een nieuw access token. LinkedIn geeft
// soms ook een geroteerd refresh token terug; geef dat door zodat de aanroeper het opslaat.
export async function refreshAccessToken(
  refreshToken: string,
  config: LinkedInOAuthConfig
): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string; refreshExpiresIn?: number } | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as RefreshResponse;
  if (!res.ok || !json.access_token) {
    log.error("Token-refresh faalde:", json.error_description ?? json.error ?? res.status);
    return null;
  }
  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? 0,
    refreshToken: json.refresh_token,
    refreshExpiresIn: json.refresh_token_expires_in,
  };
}

interface ConnectionRow {
  client_id: string;
  token_ref: string | null;
  refresh_token_ref: string | null;
  token_expires_at: string | null;
  refresh_expires_at: string | null;
  status: string | null;
}

// Hoeveel dagen voor expiratie we proactief verversen. Ruim binnen het attributievenster.
const REFRESH_THRESHOLD_DAYS = 5;

function needsRefresh(tokenExpiresAt: string | null, now: Date): boolean {
  if (!tokenExpiresAt) return true;
  const expiry = new Date(tokenExpiresAt).getTime();
  const thresholdMs = REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  return expiry - now.getTime() <= thresholdMs;
}

// LIVE-ONGETEST. Levert een geldig access token voor een client en ververst proactief als het
// binnen de drempel valt. Bij een gefaalde refresh wordt de connectie op expired gezet met een
// duidelijke melding, zodat het probleem zichtbaar is en de sync niet stilletjes sterft.
export async function ensureFreshToken(
  supabase: SupabaseClient,
  clientId: string,
  secrets: SecretStore,
  config: LinkedInOAuthConfig,
  now: Date = new Date()
): Promise<string | null> {
  const { data, error } = await supabase
    .from("linkedin_connections")
    .select("client_id, token_ref, refresh_token_ref, token_expires_at, refresh_expires_at, status")
    .eq("client_id", clientId)
    .single();
  if (error || !data) {
    log.error("Geen LinkedIn-connectie voor client", clientId);
    return null;
  }
  const conn = data as ConnectionRow;

  if (!needsRefresh(conn.token_expires_at, now)) {
    return conn.token_ref ? secrets.load(conn.token_ref) : null;
  }

  if (!conn.refresh_token_ref) {
    await markExpired(supabase, clientId, "Geen refresh_token_ref aanwezig");
    return null;
  }
  const refreshToken = await secrets.load(conn.refresh_token_ref);
  if (!refreshToken) {
    await markExpired(supabase, clientId, "Refresh token niet gevonden in de secret store");
    return null;
  }

  const refreshed = await refreshAccessToken(refreshToken, config);
  if (!refreshed) {
    await markExpired(supabase, clientId, "Token-refresh bij LinkedIn faalde");
    return null;
  }

  // Sla het nieuwe access token (en eventueel geroteerde refresh token) op via dezelfde refs.
  if (conn.token_ref) await secrets.store(conn.token_ref, refreshed.accessToken);
  if (refreshed.refreshToken && conn.refresh_token_ref) {
    await secrets.store(conn.refresh_token_ref, refreshed.refreshToken);
  }
  const tokenExpiresAt = new Date(now.getTime() + refreshed.expiresIn * 1000).toISOString();
  const refreshExpiresAt = refreshed.refreshExpiresIn
    ? new Date(now.getTime() + refreshed.refreshExpiresIn * 1000).toISOString()
    : conn.refresh_expires_at;
  await supabase
    .from("linkedin_connections")
    .update({ token_expires_at: tokenExpiresAt, refresh_expires_at: refreshExpiresAt, status: "active", last_error: null, updated_at: now.toISOString() })
    .eq("client_id", clientId);

  return refreshed.accessToken;
}

async function markExpired(supabase: SupabaseClient, clientId: string, reason: string): Promise<void> {
  log.error("LinkedIn-connectie expired voor", clientId, reason);
  await supabase
    .from("linkedin_connections")
    .update({ status: "expired", last_error: reason, updated_at: new Date().toISOString() })
    .eq("client_id", clientId);
}

// LIVE-ONGETEST. De dagelijkse cron-check: ververst proactief alle connecties die binnen de
// drempel vallen. Bedoeld om vanuit een scheduler te draaien (O3), zodat tokens nooit stilletjes
// verlopen. Geeft per client terug of er een geldig token is.
export async function refreshDueConnections(
  supabase: SupabaseClient,
  secrets: SecretStore,
  config: LinkedInOAuthConfig,
  now: Date = new Date()
): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from("linkedin_connections")
    .select("client_id, token_expires_at")
    .neq("status", "expired");
  if (error || !data) {
    log.error("Kon connecties niet laden voor de refresh-cron");
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const row of data as { client_id: string; token_expires_at: string | null }[]) {
    if (!needsRefresh(row.token_expires_at, now)) {
      result[row.client_id] = true;
      continue;
    }
    const token = await ensureFreshToken(supabase, row.client_id, secrets, config, now);
    result[row.client_id] = token != null;
  }
  return result;
}
