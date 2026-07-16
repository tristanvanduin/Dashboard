// =====================================================================
// W1.4 (Z1): per-klant data-health. GET /api/health/client?clientId=... verzamelt per
// kanaal de metrieken en laat de pure engine (lib/health.ts) er checks van maken. Google
// is volledig gegrond op de bestaande client_sync_status; Meta en LinkedIn worden
// defensief gedetecteerd via hun connections-tabellen (nog niet in productie) en leveren
// pas checks zodra die tabellen bestaan. LIVE-ONGETEST: de queries vergen de echte
// omgeving. De read valt onder viewer-niveau via de O1-middleware zodra die actief is.
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { evaluateChannelHealth, evaluateConversionTrackingQuality, assembleClientHealth, type ChannelHealth, type ChannelHealthInput, type HealthStatus } from "@/lib/health";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId is verplicht" }, { status: 400 });

  const supabase = getClient();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const channels: ChannelHealth[] = [];

  // Google: gegrond op client_sync_status (bestaande waarheid, niet herbouwd), aangevuld met
  // de conversietracking-kwaliteit (hefboom 4): trackingbreuk en config-compleetheid.
  try {
    const [{ data: sync }, { data: convRows }, { data: settings }] = await Promise.all([
      supabase
        .from("client_sync_status")
        .select("last_successful_sync_at, datasets_available, datasets_total")
        .eq("client_id", clientId)
        .maybeSingle(),
      supabase
        .from("ads_account_monthly")
        .select("month, conversions")
        .eq("client_id", clientId)
        .order("month", { ascending: true }),
      supabase.from("client_settings").select("conversion_actions, conversion_lag_days").eq("client_id", clientId).maybeSingle(),
    ]);
    const googleInput: ChannelHealthInput = {
      channel: "google_ads",
      connected: true,
      lastSuccessfulSyncAt: sync?.last_successful_sync_at ?? null,
      datasetsAvailable: sync?.datasets_available ?? null,
      datasetsTotal: sync?.datasets_total ?? null,
    };
    const googleHealth = evaluateChannelHealth(googleInput);

    const actions = Array.isArray(settings?.conversion_actions) ? (settings.conversion_actions as Array<Record<string, unknown>>) : [];
    const convChecks = evaluateConversionTrackingQuality({
      series: (convRows ?? []).map((r) => ({ period: String(r.month), conversions: typeof r.conversions === "number" ? r.conversions : 0 })),
      hasPrimaryAction: actions.some((a) => a.category === "primary"),
      conversionLagConfigured: settings?.conversion_lag_days != null,
      conversionLagDays: settings?.conversion_lag_days ?? null,
      asOfDate: new Date().toISOString().slice(0, 10),
    });

    const allChecks = [...googleHealth.checks, ...convChecks];
    const worstStatus: HealthStatus = allChecks.some((c) => c.status === "fail")
      ? "fail"
      : allChecks.some((c) => c.status === "warn")
        ? "warn"
        : "ok";
    channels.push({ channel: "google_ads", status: worstStatus, checks: allChecks });
  } catch {
    channels.push(evaluateChannelHealth({ channel: "google_ads", connected: true, lastSuccessfulSyncAt: null }));
  }

  // Meta en LinkedIn: connected zodra er een koppeling is. De daily-volume- en
  // coverage-metrieken worden hier toegevoegd zodra de kanaaltabellen in productie staan
  // (uitbreiding conform het extractiepatroon; nu leveren ze connected:false, dus geen ruis).
  for (const [channel, table] of [["meta_ads", "meta_connections"], ["linkedin_ads", "linkedin_connections"]] as const) {
    let connected = false;
    try {
      const { data } = await supabase.from(table).select("client_id").eq("client_id", clientId).maybeSingle();
      connected = Boolean(data);
    } catch {
      connected = false;
    }
    channels.push(evaluateChannelHealth({ channel, connected }));
  }

  return Response.json(assembleClientHealth(clientId, channels));
}
