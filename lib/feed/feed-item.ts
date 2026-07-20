// FeedItem — het datamodel van de "Vandaag"-triagefeed (Fase 1).
//
// Kernprincipes (afgesproken scope):
//  - De feed LEEST bestaande brondata (sop_insights, sop_recommendations, sprint_hypotheses,
//    sop_tasks, de overview-endpoint). Hij verandert GEEN analyse, forecast of drempels.
//  - TYPE (wat is het) en STATUS (waar in de workflow) zijn twee losse assen.
//  - Bronstatus is leidend; feed_item_state legt er alleen UI/workflow-state overheen
//    (snooze, toewijzing, handmatige status). Automatische oplossing uit de data gaat
//    ALTIJD boven een handmatige status.
//  - De band-classificatie hieronder is PRESENTATIE: ze leest bestaande severity/type/status
//    en introduceert geen nieuwe analyse-drempel. Rood blijft bewust schaars.

export type FeedSeverity = "critical" | "decision" | "watch"; // de drie urgentiebanden
export type FeedType = "signal" | "decision" | "task" | "issue";
export type FeedStatus = "new" | "in_progress" | "awaiting_approval" | "snoozed" | "resolved";
export type ImpactType = "measured" | "estimated";
export type ImpactDirection = "risk" | "gain" | "neutral";
export type FeedSource = "signal" | "queue" | "task" | "tracking" | "pacing" | "recommendation" | "manual";
export type FeedChannel = "google" | "meta" | "linkedin" | "cross";

export interface FeedActionRef {
  kind: "view" | "investigate" | "snooze" | "assign" | "resolve" | "approve" | "open";
  label: string;
}

export interface FeedItem {
  id: string;                 // stabiele sleutel: `${source}:${clientId}:${naturalId}`
  clientId: string;
  clientName: string;
  channel: FeedChannel;
  severity: FeedSeverity;     // = de band
  type: FeedType;
  status: FeedStatus;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsMock: boolean;       // true als de eigenaar uit de Fase-1 mock-map komt
  title: string;
  explanation: string;
  impactValue: number | null; // euro of aantal; null als niet betrouwbaar af te leiden
  impactLabel: string;        // mensleesbaar ("€430 waste sinds gisteren")
  impactType: ImpactType;     // measured | estimated — nooit estimated als measured verkopen
  impactDirection: ImpactDirection;
  primaryAction: FeedActionRef;
  secondaryActions: FeedActionRef[];
  source: FeedSource;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  snoozedUntil: string | null;
  snoozeReason: string | null;
  resolvedAt: string | null;
  autoResolved: boolean;
  resolutionReason: string | null;
  iceScore: number | null;
  clientUrl: string;
  actionUrl: string;
  isMock: boolean;            // true voor volledig synthetische demo-kaarten (Fase 1)
}

// De rij zoals opgeslagen in feed_item_state (puur UI/workflow-state, geen brondata).
export interface FeedStateRow {
  item_key: string;
  client_id: string;
  source: string;
  assigned_owner: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
  feed_status: string | null;
  updated_by: string | null;
  updated_at: string | null;
  created_at?: string | null;
}

// "Nieuw sinds gisteren": venster voor de delta-teller (presentatie, geen analyse-drempel).
export const NEW_SINCE_HOURS = 24;

const ISO = (d: Date): string => d.toISOString();

export function isOverdue(dueAt: string | null, now: Date): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() <= now.getTime();
}

export function isNewSince(createdAt: string, now: Date, hours = NEW_SINCE_HOURS): boolean {
  return now.getTime() - new Date(createdAt).getTime() <= hours * 3_600_000;
}

// Legt feed_item_state over een bron-item. Bronstatus is leidend; deze functie voegt alleen
// UI/workflow-state toe. Auto-resolve (item verdwenen uit de bron) wordt in reconcileFeed
// afgehandeld en gaat vóór alles — hier gaat het om items die NOG in de bron staan.
export function applyFeedState(item: FeedItem, state: FeedStateRow | undefined, now: Date): FeedItem {
  if (!state) return item;
  const next: FeedItem = { ...item };

  if (state.assigned_owner) {
    next.ownerName = state.assigned_owner;
    next.ownerId = state.assigned_owner;
    next.ownerIsMock = false; // handmatig toegewezen is echt, geen mock meer
  }

  // Snooze wint van een handmatige status, mits nog actief.
  if (state.snoozed_until && new Date(state.snoozed_until).getTime() > now.getTime()) {
    next.status = "snoozed";
    next.snoozedUntil = state.snoozed_until;
    next.snoozeReason = state.snooze_reason ?? null;
    return next;
  }

  // Handmatige status-overlay (nieuw/in behandeling/wacht op akkoord/opgelost).
  if (state.feed_status && isFeedStatus(state.feed_status)) {
    next.status = state.feed_status;
    if (state.feed_status === "resolved") {
      next.resolvedAt = state.updated_at ?? ISO(now);
      next.autoResolved = false;
      next.resolutionReason = "handmatig afgerond";
    }
  }
  return next;
}

function isFeedStatus(v: string): v is FeedStatus {
  return v === "new" || v === "in_progress" || v === "awaiting_approval" || v === "snoozed" || v === "resolved";
}

export interface ReconcileResult {
  items: FeedItem[];           // actieve items (bron + state), snoozed/resolved eruit gefilterd voor de banden
  snoozed: FeedItem[];         // apart, voor een eventuele "gesnoozed"-weergave
  autoResolvedCount: number;   // items met eerdere state die uit de bron verdwenen = door data opgelost
}

// Verzoent verse bron-items met de opgeslagen feed-state.
//  - State toepassen op items die nog in de bron staan.
//  - Items die WEL in feed_item_state stonden (en actief waren) maar NIET meer in de bron
//    voorkomen: door de data automatisch opgelost. Dat gaat boven elke handmatige status.
export function reconcileFeed(sourceItems: FeedItem[], stateRows: FeedStateRow[], now: Date): ReconcileResult {
  const stateByKey = new Map(stateRows.map((s) => [s.item_key, s]));
  const sourceKeys = new Set(sourceItems.map((i) => i.id));

  const withState = sourceItems.map((i) => applyFeedState(i, stateByKey.get(i.id), now));
  const active = withState.filter((i) => i.status !== "snoozed" && i.status !== "resolved");
  const snoozed = withState.filter((i) => i.status === "snoozed");

  // Auto-resolve: eerder aangeraakte, niet-afgeronde state-rijen die uit de bron verdwenen.
  const autoResolvedCount = stateRows.filter(
    (s) => s.feed_status !== "resolved" && !sourceKeys.has(s.item_key)
  ).length;

  return { items: active, snoozed, autoResolvedCount };
}

// Sortering per band (tweede sorteer-as = impact/ICE).
export function sortBand(items: FeedItem[], band: FeedSeverity): FeedItem[] {
  const risk = (i: FeedItem) => (i.impactDirection === "risk" && i.impactType === "measured" ? (i.impactValue ?? 0) : 0);
  const impactAbs = (i: FeedItem) => (i.impactValue ?? 0);
  const arr = [...items];
  if (band === "critical") {
    // urgentie → gemeten euro-risico → deadline → recency
    arr.sort((a, b) => risk(b) - risk(a) || dueRank(a) - dueRank(b) || ts(b.createdAt) - ts(a.createdAt));
  } else if (band === "decision") {
    // impact → ICE
    arr.sort((a, b) => impactAbs(b) - impactAbs(a) || (b.iceScore ?? 0) - (a.iceScore ?? 0) || ts(b.createdAt) - ts(a.createdAt));
  } else {
    // relevantie & timing = recency
    arr.sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
  }
  return arr;
}

const ts = (s: string): number => new Date(s).getTime();
const dueRank = (i: FeedItem): number => (i.dueAt ? new Date(i.dueAt).getTime() : Number.MAX_SAFE_INTEGER);

// "Risico open (gemeten)": som van gemeten euro-risico van open critical-items. Eerlijk:
// alleen measured én níet-mock telt mee; geschat effect en demo-kaarten worden nooit als feit
// meegeteld. Kan in een verse omgeving 0 zijn — dat is de waarheid, geen bug.
export function measuredRiskOpen(items: FeedItem[]): number {
  return items
    .filter((i) => !i.isMock && i.severity === "critical" && i.impactType === "measured" && i.impactDirection === "risk" && i.impactValue != null)
    .reduce((sum, i) => sum + (i.impactValue ?? 0), 0);
}
