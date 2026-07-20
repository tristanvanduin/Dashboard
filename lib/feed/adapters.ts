// Pure adapters: bestaande brondata → FeedItem. Geen IO. Geen analyse-/drempelwijziging —
// de adapters LEZEN bestaande velden (severity, ice_total, status, due_date, change_pct) en
// vertalen ze naar de presentatie-band. Rood blijft bewust schaars: analyse-findings gaan
// nooit rood; rood is voorbehouden aan operationeel-tijdkritisch en overdue taken.

import { channelOfSource, channelOfSopType, type InsightChannel } from "@/lib/insights/channel-of";
import type { FeedItem, FeedChannel, FeedSeverity, ImpactDirection } from "./feed-item";
import { isOverdue } from "./feed-item";

const asChannel = (c: InsightChannel): FeedChannel => c; // zelfde union

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null));
const str = (v: unknown): string => (v == null ? "" : String(v));
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const nowIso = (): string => new Date().toISOString();

function base(partial: Partial<FeedItem> & { id: string; clientId: string; clientName: string; source: FeedItem["source"]; severity: FeedSeverity; type: FeedItem["type"]; title: string }): FeedItem {
  const clientUrl = `/client/${partial.clientId}`;
  return {
    channel: "google",
    status: "new",
    ownerId: null, ownerName: null, ownerIsMock: false,
    explanation: "",
    impactValue: null, impactLabel: "", impactType: "estimated", impactDirection: "neutral",
    primaryAction: { kind: "view", label: "Bekijk" },
    secondaryActions: [{ kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
    createdAt: nowIso(), updatedAt: nowIso(),
    dueAt: null, snoozedUntil: null, snoozeReason: null,
    resolvedAt: null, autoResolved: false, resolutionReason: null,
    iceScore: null, clientUrl, actionUrl: clientUrl, isMock: false,
    ...partial,
  };
}

// ── sop_insights → signaal/issue ──────────────────────────────────────────
// Nooit rood: een analyse-finding is geen operationele brand. action_required + hoge severity
// → beslissing; anders → volgt.
export interface InsightRow {
  id: string; client_id: string; sop_type: string | null; insight_type: string | null;
  title: string; description: string | null; severity: string | null; affected_entity: string | null;
  metric: string | null; change_pct: number | null; action_required: boolean | null; created_at: string | null;
}
export function insightToFeedItem(row: InsightRow, clientName: string): FeedItem {
  const sev = str(row.severity);
  const decision = (row.action_required === true) && (sev === "critical" || sev === "high");
  const isIssueType = row.insight_type === "risk" || row.insight_type === "anomaly";
  const change = num(row.change_pct);
  const dir: ImpactDirection = change == null ? "neutral" : change < 0 ? "risk" : "gain";
  return base({
    id: `signal:${row.client_id}:${row.id}`,
    clientId: row.client_id, clientName,
    source: "signal",
    channel: asChannel(channelOfSopType(row.sop_type)),
    severity: decision ? "decision" : "watch",
    type: isIssueType ? "issue" : "signal",
    title: clip(str(row.title) || str(row.affected_entity) || "Signaal", 90),
    explanation: clip(str(row.description), 160),
    impactType: "estimated",
    impactDirection: dir,
    impactLabel: change != null ? `${str(row.metric) || "afwijking"} ${change > 0 ? "+" : ""}${change}%` : "richtinggevend signaal",
    createdAt: row.created_at ?? nowIso(),
    primaryAction: { kind: "view", label: "Bekijk" },
    secondaryActions: [{ kind: "investigate", label: "Onderzoek" }, { kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
  });
}

// ── sop_recommendations → beslissing (ICE) ────────────────────────────────
export interface RecommendationRow {
  id: string; client_id: string; sop_type: string | null; hypothesis: string | null;
  expected_result: string | null; ice_total: number | null; status: string | null; created_at?: string | null;
}
export function recommendationToFeedItem(row: RecommendationRow, clientName: string): FeedItem {
  return base({
    id: `recommendation:${row.client_id}:${row.id}`,
    clientId: row.client_id, clientName,
    source: "recommendation",
    channel: asChannel(channelOfSopType(row.sop_type)),
    severity: "decision",
    type: "decision",
    title: clip(str(row.hypothesis) || "Aanbeveling", 90),
    explanation: clip(str(row.expected_result), 160),
    iceScore: num(row.ice_total),
    impactType: "estimated", impactDirection: "gain",
    impactLabel: row.expected_result ? clip(`verwacht: ${str(row.expected_result)}`, 70) : "verwacht positief effect",
    createdAt: row.created_at ?? nowIso(),
    primaryAction: { kind: "approve", label: "Keur goed" },
    secondaryActions: [{ kind: "investigate", label: "Onderzoek" }, { kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
  });
}

// ── sprint_hypotheses (pending) → wachtende goedkeuring ────────────────────
export interface HypothesisRow {
  id: string; client_id: string; source: string | null; hypothesis: string | null;
  expected_result: string | null; rationale: string | null; ice_total: number | null; status: string | null; created_at: string | null;
}
export function hypothesisToFeedItem(row: HypothesisRow, clientName: string): FeedItem {
  return base({
    id: `queue:${row.client_id}:${row.id}`,
    clientId: row.client_id, clientName,
    source: "queue",
    channel: asChannel(channelOfSource(row.source)),
    severity: "decision",
    type: "decision",
    status: "awaiting_approval",
    title: clip(str(row.hypothesis) || "Voorstel in wachtrij", 90),
    explanation: clip(str(row.expected_result) || str(row.rationale), 160),
    iceScore: num(row.ice_total),
    impactType: "estimated", impactDirection: "gain",
    impactLabel: row.expected_result ? clip(`verwacht: ${str(row.expected_result)}`, 70) : "wacht op goedkeuring",
    createdAt: row.created_at ?? nowIso(),
    primaryAction: { kind: "approve", label: "Bekijk wachtrij" },
    secondaryActions: [{ kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
  });
}

// ── sop_tasks → taak ──────────────────────────────────────────────────────
// Overdue of vandaag = rood (tijdkritisch); hoge prioriteit = beslissing; rest = volgt.
export interface TaskRow {
  id: string; client_id: string; title: string | null; description: string | null;
  priority: string | null; due_date: string | null; status: string | null;
}
export function taskToFeedItem(row: TaskRow, clientName: string, now: Date): FeedItem {
  const overdue = isOverdue(row.due_date, now);
  const high = row.priority === "critical" || row.priority === "high";
  const severity: FeedSeverity = overdue ? "critical" : high ? "decision" : "watch";
  return base({
    id: `task:${row.client_id}:${row.id}`,
    clientId: row.client_id, clientName,
    source: "task",
    severity,
    type: "task",
    title: clip(str(row.title) || "Taak", 90),
    explanation: clip(str(row.description), 160),
    dueAt: row.due_date,
    impactType: "estimated", impactDirection: "neutral",
    impactLabel: overdue ? "deadline verlopen" : row.due_date ? `deadline ${row.due_date}` : "geen deadline",
    createdAt: nowIso(),
    primaryAction: { kind: "resolve", label: "Afronden" },
    secondaryActions: [{ kind: "view", label: "Bekijk" }, { kind: "snooze", label: "Snooze" }],
  });
}

// ── overview-endpoint → operationele signalen (echt, cross-client in 1 call) ──
export interface OverviewLike {
  error?: string;
  yoy?: { convChange: number | null } | null;
}
// YoY-drempel voor "substantiële afwijking" — PRESENTATIE-grens voor de feed, staat los van de
// analyse. Bewust gelijk aan de bestaande meldingen-bel (‑20%) zodat niets van gedrag verschuift.
export const FEED_YOY_DROP_PCT = -20;

export function overviewToFeedItems(clientId: string, clientName: string, ov: OverviewLike): FeedItem[] {
  const out: FeedItem[] = [];
  if (ov.error) {
    out.push(base({
      id: `signal:${clientId}:sync-error`,
      clientId, clientName, source: "signal",
      severity: "critical", type: "issue",
      title: "Data ophalen mislukt",
      explanation: clip(str(ov.error), 160),
      impactType: "measured", impactDirection: "risk",
      impactLabel: "sync/tracking mislukt — geen verse cijfers",
      primaryAction: { kind: "view", label: "Bekijk" },
      secondaryActions: [{ kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
    }));
  }
  const yoy = ov.yoy?.convChange;
  if (typeof yoy === "number" && Number.isFinite(yoy) && yoy <= FEED_YOY_DROP_PCT) {
    out.push(base({
      id: `signal:${clientId}:yoy-drop`,
      clientId, clientName, source: "signal",
      severity: "decision", type: "signal",
      title: "Conversies fors onder vorig jaar",
      explanation: `Conversies YoY ${Math.round(yoy)}% — substantiële afwijking, onderzoek de oorzaak.`,
      impactType: "estimated", impactDirection: "risk",
      impactLabel: `YoY ${Math.round(yoy)}%`,
      primaryAction: { kind: "investigate", label: "Onderzoek" },
      secondaryActions: [{ kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
    }));
  }
  return out;
}
