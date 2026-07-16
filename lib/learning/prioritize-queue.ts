// =====================================================================
// STATUS: GEBOUWD EN GETEST, MAAR NOG NIET GEWIRED (code-review must-fix 3).
// prioritizeQueue wordt nog niet aangeroepen. Activeren vereist een consument die de pending wachtrij ophaalt, deze functie aanroept en het plan toont. Neem niet aan dat prioritering live is.
// =====================================================================
// ============================================================
// E5: decision- en prioriteitenlaag (pure kern)
// ------------------------------------------------------------
// Maakt van de convergentie-gevoede hypothese-wachtrij (sprint_hypotheses, nu
// gevoed door monthly, weekly, biweekly, second-opinion en zoekterm) een
// geprioriteerd plan. Rangschikt op ICE en splitst met een sprintcapaciteit in
// wat in de eerstvolgende sprint past en wat naar de backlog gaat.
//
// Dit is de keystone die de siloed analyses tot een plan maakt in plaats van
// losse voorstellen. Puur en deterministisch; de persistentie, de owner-routing
// (T1) en de UI zijn aparte lagen erbovenop.
// ============================================================

export interface QueueHypothesis {
  id?: string;
  hypothesis: string;
  source: string | null;
  iceImpact: number;
  iceConfidence: number;
  iceEase: number;
  iceTotal: number;
}

export interface PrioritizedItem extends QueueHypothesis {
  rank: number;
  score: number;
  placement: "sprint" | "backlog";
}

export interface PrioritizeOptions {
  sprintCapacity?: number; // hoeveel items in de eerstvolgende sprint passen
}

const DEFAULT_SPRINT_CAPACITY = 5;

/**
 * Rangschikt de wachtrij op ICE-score (aflopend) en wijst sprint of backlog toe.
 * Tie-breaks, eerlijk en stabiel: hogere impact, dan confidence, dan ease, en bij
 * een volledige gelijkstand de oorspronkelijke invoervolgorde (geen willekeur).
 */
export function prioritizeQueue(
  hypotheses: QueueHypothesis[],
  options: PrioritizeOptions = {}
): PrioritizedItem[] {
  const capacity = options.sprintCapacity != null && options.sprintCapacity >= 0
    ? options.sprintCapacity
    : DEFAULT_SPRINT_CAPACITY;

  const indexed = hypotheses.map((h, i) => ({ h, i }));
  indexed.sort((a, b) => {
    const byTotal = b.h.iceTotal - a.h.iceTotal;
    if (byTotal !== 0) return byTotal;
    const byImpact = b.h.iceImpact - a.h.iceImpact;
    if (byImpact !== 0) return byImpact;
    const byConf = b.h.iceConfidence - a.h.iceConfidence;
    if (byConf !== 0) return byConf;
    const byEase = b.h.iceEase - a.h.iceEase;
    if (byEase !== 0) return byEase;
    return a.i - b.i; // stabiele volgorde bij volledige gelijkstand
  });

  return indexed.map(({ h }, idx) => {
    const rank = idx + 1;
    return {
      ...h,
      rank,
      score: h.iceTotal,
      placement: rank <= capacity ? "sprint" : "backlog",
    };
  });
}

/**
 * Compacte samenvatting van het plan: hoeveel in de sprint, hoeveel naar de
 * backlog, en de spreiding per bron (zodat zichtbaar is of een kanaal of audit
 * de wachtrij domineert).
 */
export function summarizePlan(items: PrioritizedItem[]): {
  sprintCount: number;
  backlogCount: number;
  bySource: Record<string, number>;
} {
  const bySource: Record<string, number> = {};
  let sprintCount = 0;
  let backlogCount = 0;
  for (const it of items) {
    if (it.placement === "sprint") sprintCount++;
    else backlogCount++;
    const src = it.source ?? "onbekend";
    bySource[src] = (bySource[src] ?? 0) + 1;
  }
  return { sprintCount, backlogCount, bySource };
}
