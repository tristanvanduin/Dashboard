// =====================================================================
// STATUS: GEBOUWD EN GETEST, MAAR NOG NIET GEWIRED (code-review must-fix 3).
// De evaluator wordt nog niet aangeroepen. Activeren vereist de persist bij run-afronding plus de evaluator-job op de O3-cron plus de daily-tabellen. Neem niet aan dat de lerende loop live is.
// =====================================================================
// ============================================================
// H1: hypothese-evaluator, de deterministische kern
// ------------------------------------------------------------
// Velt na het meetvenster een verdict over een hypothese door elk success- en
// guardrail-predicaat tegen de baseline te toetsen, en bepaalt of de actie
// aantoonbaar is uitgevoerd. Volledig deterministisch, geen LLM.
//
// No-go's uit de spec, hier afgedwongen:
// - Geen causaliteitsclaims: we meten of de metrics binnen het venster conform
//   de verwachting bewogen, niet of de actie dat veroorzaakte.
// - Geen evaluatie zonder baseline.
// - Het verdict wordt altijd SAMEN met de uitvoeringsstatus gerapporteerd, want
//   "verworpen maar niet uitgevoerd" is een andere les dan "uitgevoerd en verworpen".
// ============================================================

const MIN_WINDOW_IMPRESSIONS = 100; // onder dit volume is een oordeel niet betrouwbaar
const EXPIRY_DAYS = 45; // open en onmeetbaar ouder dan dit verloopt
const STABLE_BAND = 0.05; // standaard band voor richting "stable" (5 procent van baseline)

export type PredicateDirection = "increase" | "decrease" | "above" | "below" | "stable";

export interface Predicate {
  metric: string;
  direction: PredicateDirection;
  threshold?: number; // above/below: absolute grens; increase/decrease: minimale magnitude (optioneel); stable: band-fractie
}

export type Verdict = "accepted" | "rejected" | "unmeasurable" | "expired";
export type ExecutionStatus = "detected" | "not_executed" | "unknown";

export interface MetricJudgment {
  metric: string;
  kind: "success" | "guardrail";
  baseline: number | null;
  measured: number | null;
  delta: number | null;
  predicate: string; // leesbare omschrijving
  met: boolean | null; // null = niet te evalueren (metric of grens ontbreekt)
}

export interface HypothesisOutcome {
  verdict: Verdict;
  reason?: string;
  metrics: MetricJudgment[];
}

export interface EvaluateInput {
  successPredicates: Predicate[];
  guardrailPredicates: Predicate[];
  baseline: Record<string, number>;
  measured: Record<string, number>;
  windowImpressions: number;
  entityActive: boolean;
  ageInDays: number;
}

function describe(p: Predicate): string {
  const t = p.threshold;
  switch (p.direction) {
    case "increase": return t != null ? `${p.metric} stijgt met minimaal ${t}` : `${p.metric} stijgt`;
    case "decrease": return t != null ? `${p.metric} daalt met minimaal ${t}` : `${p.metric} daalt`;
    case "above": return `${p.metric} boven ${t}`;
    case "below": return `${p.metric} onder ${t}`;
    case "stable": return `${p.metric} stabiel`;
  }
}

// Evalueert een predicaat. met=null als de metric of een vereiste grens ontbreekt.
function judge(p: Predicate, kind: "success" | "guardrail", baseline: Record<string, number>, measured: Record<string, number>): MetricJudgment {
  const b = baseline[p.metric];
  const m = measured[p.metric];
  const haveB = typeof b === "number" && Number.isFinite(b);
  const haveM = typeof m === "number" && Number.isFinite(m);
  const delta = haveB && haveM ? m - b : null;
  const base: MetricJudgment = {
    metric: p.metric, kind,
    baseline: haveB ? b : null,
    measured: haveM ? m : null,
    delta,
    predicate: describe(p),
    met: null,
  };

  if (p.direction === "above" || p.direction === "below") {
    if (!haveM || p.threshold == null) return base; // absolute grens vereist een gemeten waarde en een drempel
    base.met = p.direction === "above" ? m >= p.threshold : m <= p.threshold;
    return base;
  }

  // increase/decrease/stable zijn relatief aan de baseline
  if (!haveB || !haveM) return base;
  if (p.direction === "increase") {
    base.met = p.threshold != null ? (m - b) >= p.threshold : m > b;
  } else if (p.direction === "decrease") {
    base.met = p.threshold != null ? (b - m) >= p.threshold : m < b;
  } else { // stable
    const band = p.threshold != null ? p.threshold : Math.abs(b) * STABLE_BAND;
    base.met = Math.abs(m - b) <= band;
  }
  return base;
}

/**
 * Velt het verdict over een hypothese. Volgorde van poorten:
 * 1. Entiteit inactief of volume te laag, geen baseline: onmeetbaar (of verlopen bij ouderdom).
 * 2. Een success-metric niet te evalueren: onmeetbaar.
 * 3. Alle success-predicaten gehaald en geen guardrail aantoonbaar geschonden: geaccepteerd.
 * 4. Anders: verworpen.
 */
export function evaluateHypothesisOutcome(input: EvaluateInput): HypothesisOutcome {
  const successJ = input.successPredicates.map((p) => judge(p, "success", input.baseline, input.measured));
  const guardrailJ = input.guardrailPredicates.map((p) => judge(p, "guardrail", input.baseline, input.measured));
  const metrics = [...successJ, ...guardrailJ];

  const expiredIfStuck = (reason: string): HypothesisOutcome =>
    input.ageInDays > EXPIRY_DAYS ? { verdict: "expired", reason: `${reason}, en ouder dan ${EXPIRY_DAYS} dagen`, metrics }
      : { verdict: "unmeasurable", reason, metrics };

  if (!input.entityActive) return expiredIfStuck("entiteit gepauzeerd of niet actief");
  if (input.windowImpressions < MIN_WINDOW_IMPRESSIONS) {
    return expiredIfStuck(`onvoldoende volume (${input.windowImpressions} vertoningen, minimaal ${MIN_WINDOW_IMPRESSIONS})`);
  }

  const unevaluableSuccess = successJ.find((j) => j.met === null);
  if (unevaluableSuccess) {
    return expiredIfStuck(`success-metric niet te meten (${unevaluableSuccess.metric})`);
  }

  const allSuccessMet = successJ.every((j) => j.met === true);
  const guardrailViolated = guardrailJ.some((j) => j.met === false); // alleen aantoonbare schending telt
  const verdict: Verdict = allSuccessMet && !guardrailViolated ? "accepted" : "rejected";
  return { verdict, metrics };
}

// ── Uitvoeringsdetectie ─────────────────────────────────────────────────────

export interface ChangeEvent {
  type: string; // budget, status_paused, bid, keyword_added, keyword_excluded, ...
  entity: string;
  date: string;
  detail?: string;
}

// Interventie-trefwoorden naar change-event-types. Deterministisch.
const INTENT_MAP: { keywords: RegExp; types: string[] }[] = [
  { keywords: /budget|dagbudget/i, types: ["budget"] },
  { keywords: /pauzeer|pauzeren|zet uit|uitzetten|stopzetten|pause/i, types: ["status_paused"] },
  { keywords: /\bbod\b|bieding|bidstrategie|\bbid\b|doel-?cpa|tcpa|troas/i, types: ["bid"] },
  { keywords: /zoekwoord toevoegen|toevoegen als zoekwoord|keyword.*toevoeg/i, types: ["keyword_added"] },
  { keywords: /uitsluiten|uitsluiting|negatief|negative/i, types: ["keyword_excluded"] },
];

function intendedTypes(intervention: string): string[] {
  const out = new Set<string>();
  for (const rule of INTENT_MAP) {
    if (rule.keywords.test(intervention)) rule.types.forEach((t) => out.add(t));
  }
  return [...out];
}

/**
 * Bepaalt of de interventie aantoonbaar is uitgevoerd, door de bedoelde
 * wijziging te matchen tegen change-history-events op dezelfde entiteit.
 * Zonder dekking (bijvoorbeeld LinkedIn) altijd unknown; nooit ten onrechte
 * not_executed als er geen change-history is.
 */
export function detectExecution(
  intervention: string,
  entityName: string,
  changeEvents: ChangeEvent[],
  hasCoverage: boolean
): { status: ExecutionStatus; evidence: string | null } {
  if (!hasCoverage) return { status: "unknown", evidence: null };

  const types = intendedTypes(intervention);
  const sameEntity = changeEvents.filter((e) => e.entity && entityName && e.entity.toLowerCase() === entityName.toLowerCase());

  // Als de interventie geen herkenbaar type heeft, val terug op elke wijziging op de entiteit.
  const match = types.length > 0
    ? sameEntity.find((e) => types.includes(e.type))
    : sameEntity[0];

  if (match) {
    return { status: "detected", evidence: `${match.type} op ${match.entity} (${match.date})` };
  }
  return { status: "not_executed", evidence: null };
}
