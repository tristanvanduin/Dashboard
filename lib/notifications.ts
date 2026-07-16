// W1.3 (O3, 5d): alerting naar Slack. De pure kern (payload-bouw, dedupe-beslissing) is
// los getest; notify() is LIVE-ONGETEST (webhook plus alerts_log vergen de echte
// omgeving en migratie 004). Ontwerpprincipes uit de spec: compact bericht (klant,
// kanaal, type, kernfeit, link), dedupe per (client_id, event_type) met een venster van
// 6 uur BEHALVE analysis_completed en analysis_blocked (dat is het nieuws), zonder
// webhook alleen loggen, en een alert-fout mag nooit een run of sync breken.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AlertEventType =
  | "sync_failed"
  | "sync_recovered"
  | "analysis_completed"
  | "analysis_blocked"
  | "run_failed_final"
  | "cron_skipped_data_incomplete"
  | "token_expiring"
  | "data_health_fail"
  | "backup_failed"
  | "backup_restore_ok"
  | "backup_restore_failed";

export interface AlertEvent {
  type: AlertEventType;
  clientId?: string | null;
  channel?: string | null; // google_ads, meta_ads of linkedin_ads
  kernfeit: string; // een zin met het nieuws
  link?: string | null;
}

// De uitzonderingen op dedupe: deze zijn het nieuws en gaan altijd door.
const ALWAYS_SEND: ReadonlySet<AlertEventType> = new Set(["analysis_completed", "analysis_blocked"]);

export const DEDUPE_WINDOW_HOURS = 6;

export function dedupeKey(event: AlertEvent): string {
  return `${event.clientId ?? "-"}:${event.type}`;
}

// Puur: mag dit event nu verstuurd worden, gegeven de laatste verzending met dezelfde key?
export function shouldSendAlert(event: AlertEvent, lastSentAt: Date | null, now: Date): boolean {
  if (ALWAYS_SEND.has(event.type)) return true;
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= DEDUPE_WINDOW_HOURS * 3_600_000;
}

const KOP: Record<AlertEventType, string> = {
  sync_failed: "Sync mislukt",
  sync_recovered: "Sync hersteld",
  analysis_completed: "Analyse afgerond",
  analysis_blocked: "Analyse geblokkeerd door de quality gate",
  run_failed_final: "Run definitief mislukt",
  cron_skipped_data_incomplete: "Maandrun overgeslagen: data incompleet",
  token_expiring: "Token verloopt binnenkort",
  data_health_fail: "Data-health-check faalt",
  backup_failed: "Backup mislukt",
  backup_restore_ok: "Restore-test geslaagd",
  backup_restore_failed: "Restore-test mislukt",
};

// Puur: het compacte Slack-bericht.
export function buildSlackPayload(event: AlertEvent): { text: string } {
  const delen = [
    `*${KOP[event.type]}*`,
    event.clientId ? `klant: ${event.clientId}` : null,
    event.channel ? `kanaal: ${event.channel}` : null,
    event.kernfeit,
    event.link ? `<${event.link}|open>` : null,
  ].filter(Boolean);
  return { text: delen.join(" | ") };
}

// =====================================================================
// LIVE-ONGETEST: de dedupe-lookup, de webhook-call en de alerts_log-insert vergen de
// echte omgeving. Fire-and-forget bij ontwerp: elke fout wordt gelogd en genegeerd.
// =====================================================================
export async function notify(
  supabase: SupabaseClient | null,
  event: AlertEvent,
  now: Date = new Date()
): Promise<void> {
  try {
    let lastSentAt: Date | null = null;
    if (supabase) {
      const { data } = await supabase
        .from("alerts_log")
        .select("sent_at")
        .eq("dedupe_key", dedupeKey(event))
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.sent_at) lastSentAt = new Date(String(data.sent_at));
    }
    if (!shouldSendAlert(event, lastSentAt, now)) return;

    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (!webhook) {
      console.log("[alert]", buildSlackPayload(event).text);
    } else {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSlackPayload(event)),
      });
    }

    if (supabase) {
      await supabase.from("alerts_log").insert({
        client_id: event.clientId ?? null,
        event_type: event.type,
        dedupe_key: dedupeKey(event),
      });
    }
  } catch (error) {
    console.error("[alert] versturen faalde (genegeerd):", error);
  }
}
