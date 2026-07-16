// X3 scorecard: de deterministische scorekaart per eval-run (spec sectie 4), volledig
// zonder LLM. De kaart combineert de run-metingen (gates, fouten, repairs, handelingen,
// duur, kosten) met de vier output-checks (output-checks.ts) als kwaliteitshelft. De
// vergelijking van twee kandidaten is expliciet per meting met een vaste richting, zodat
// het rapport nooit impliciet weegt. IO-vrij en los getest; de replay-runner (build-kant)
// voedt dit met echte run-data.

import { runOutputChecks, type EvalCheckResult } from "./output-checks";

export interface EvalRunInput {
  model: string;
  fixtureSet: string;
  gatePassed: boolean; // de eindgate van de pipeline
  errorsByCategory: Record<string, number>;
  warningsByCategory: Record<string, number>;
  repairCount: number;
  finalActions: string[]; // de finale handelingen; uniciteit wordt hier genormaliseerd geteld
  durationMs: number;
  totalCostEur: number | null; // uit O2 sumRunCost; null zolang MODEL_PRICES leeg is
  costPartial: boolean; // O2 markeert een totaal expliciet partieel bij ontbrekende prijzen
  outputText: string; // de finale deliverable
  groundingText: string; // de deterministische pre-compute die het model kreeg
  requiredSections: string[];
}

export interface DeterministicScorecard {
  model: string;
  fixtureSet: string;
  gatePassed: boolean;
  totalErrors: number;
  totalWarnings: number;
  errorsByCategory: Record<string, number>;
  warningsByCategory: Record<string, number>;
  repairCount: number;
  uniqueActionCount: number;
  totalActionCount: number;
  durationMs: number;
  totalCostEur: number | null;
  costNote: string | null; // expliciet waarom kosten ontbreken of partieel zijn
  outputChecks: EvalCheckResult[];
  outputChecksPassed: number; // van de vier
}

function normalizeAction(action: string): string {
  return action.trim().toLowerCase().replace(/\s+/g, " ");
}

function sum(record: Record<string, number>): number {
  return Object.values(record).reduce((a, b) => a + Math.max(b, 0), 0);
}

export function buildScorecard(input: EvalRunInput): DeterministicScorecard {
  const uniqueActions = new Set(input.finalActions.map(normalizeAction).filter((a) => a.length > 0));
  const outputChecks = runOutputChecks({
    outputText: input.outputText,
    groundingText: input.groundingText,
    requiredSections: input.requiredSections,
  });

  const costNote =
    input.totalCostEur == null
      ? "kosten onbekend: MODEL_PRICES is niet gevuld (O2), vul de prijzen voor een kostenoordeel"
      : input.costPartial
        ? "kosten partieel: niet elke call had een ingevulde prijs"
        : null;

  return {
    model: input.model,
    fixtureSet: input.fixtureSet,
    gatePassed: input.gatePassed,
    totalErrors: sum(input.errorsByCategory),
    totalWarnings: sum(input.warningsByCategory),
    errorsByCategory: { ...input.errorsByCategory },
    warningsByCategory: { ...input.warningsByCategory },
    repairCount: input.repairCount,
    uniqueActionCount: uniqueActions.size,
    totalActionCount: input.finalActions.length,
    durationMs: input.durationMs,
    totalCostEur: input.totalCostEur,
    costNote,
    outputChecks,
    outputChecksPassed: outputChecks.filter((c) => c.passed).length,
  };
}

// ── De vergelijking: per meting een winnaar met een vaste, expliciete richting. ──

export type MetricWinner = "a" | "b" | "gelijk" | "niet_bepaalbaar";

export interface MetricComparison {
  metric: string;
  direction: "hoger_is_beter" | "lager_is_beter";
  a: number | boolean | null;
  b: number | boolean | null;
  winner: MetricWinner;
}

export interface ScorecardComparison {
  modelA: string;
  modelB: string;
  fixtureSet: string;
  metrics: MetricComparison[];
  summary: { aWins: number; bWins: number; ties: number; undecided: number };
}

function compareNumeric(a: number | null, b: number | null, direction: "hoger_is_beter" | "lager_is_beter"): MetricWinner {
  if (a == null || b == null) return "niet_bepaalbaar";
  if (a === b) return "gelijk";
  const aBetter = direction === "hoger_is_beter" ? a > b : a < b;
  return aBetter ? "a" : "b";
}

export function compareScorecards(a: DeterministicScorecard, b: DeterministicScorecard): ScorecardComparison {
  const metrics: MetricComparison[] = [
    {
      metric: "gate_geslaagd",
      direction: "hoger_is_beter",
      a: a.gatePassed,
      b: b.gatePassed,
      winner: a.gatePassed === b.gatePassed ? "gelijk" : a.gatePassed ? "a" : "b",
    },
    { metric: "output_checks_geslaagd", direction: "hoger_is_beter", a: a.outputChecksPassed, b: b.outputChecksPassed, winner: compareNumeric(a.outputChecksPassed, b.outputChecksPassed, "hoger_is_beter") },
    { metric: "errors", direction: "lager_is_beter", a: a.totalErrors, b: b.totalErrors, winner: compareNumeric(a.totalErrors, b.totalErrors, "lager_is_beter") },
    { metric: "warnings", direction: "lager_is_beter", a: a.totalWarnings, b: b.totalWarnings, winner: compareNumeric(a.totalWarnings, b.totalWarnings, "lager_is_beter") },
    { metric: "repairs", direction: "lager_is_beter", a: a.repairCount, b: b.repairCount, winner: compareNumeric(a.repairCount, b.repairCount, "lager_is_beter") },
    { metric: "unieke_handelingen", direction: "hoger_is_beter", a: a.uniqueActionCount, b: b.uniqueActionCount, winner: compareNumeric(a.uniqueActionCount, b.uniqueActionCount, "hoger_is_beter") },
    { metric: "duur_ms", direction: "lager_is_beter", a: a.durationMs, b: b.durationMs, winner: compareNumeric(a.durationMs, b.durationMs, "lager_is_beter") },
    { metric: "kosten_eur", direction: "lager_is_beter", a: a.totalCostEur, b: b.totalCostEur, winner: compareNumeric(a.totalCostEur, b.totalCostEur, "lager_is_beter") },
  ];

  const summary = { aWins: 0, bWins: 0, ties: 0, undecided: 0 };
  for (const m of metrics) {
    if (m.winner === "a") summary.aWins += 1;
    else if (m.winner === "b") summary.bWins += 1;
    else if (m.winner === "gelijk") summary.ties += 1;
    else summary.undecided += 1;
  }

  return { modelA: a.model, modelB: b.model, fixtureSet: a.fixtureSet, metrics, summary };
}

// ── De kosten-rem (spec): een volledige eval is een bewuste actie met een geschatte prijs
// vooraf. Eerlijke null-propagatie zolang de prijzen niet gevuld zijn. ──
export function estimateEvalCost(input: {
  fixtureSets: number;
  models: number;
  callsPerRun: number;
  avgCostPerCallEur: number | null;
}): { totalCalls: number; estimatedCostEur: number | null; note: string | null } {
  const totalCalls = Math.max(input.fixtureSets, 0) * Math.max(input.models, 0) * Math.max(input.callsPerRun, 0);
  if (input.avgCostPerCallEur == null) {
    return { totalCalls, estimatedCostEur: null, note: "geen kostenschatting mogelijk: vul MODEL_PRICES (O2) eerst" };
  }
  return { totalCalls, estimatedCostEur: Math.round(totalCalls * input.avgCostPerCallEur * 100) / 100, note: null };
}
