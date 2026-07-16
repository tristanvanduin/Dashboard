// SI3: de standalone periode-evaluatie (de E3-noordster uit de systeem-audit). De maand-SOP
// heeft een eindconclusie per maand; wat ontbrak is de laag die een HELE periode (kwartaal,
// campagne, beurseditie) tegen zijn PLAN afrekent over de tijd. Dit is een aggregator, geen
// nieuwe rekenlaag: hij hergebruikt checkTargetPlausibility (O2) en heeft een seam naar de
// H1-evaluator (evaluateHypothesisOutcome) zodat de afrekening automatisch scherper wordt
// zodra H1 gewired is, zonder dat deze laag nu nutteloos is.
//
// Drie rekenregels die hier hard zijn:
// (1) Periode-aggregaten delen TOTALEN (som kosten gedeeld door som conversies). Het
//     gemiddelde van maandelijkse CPA's is een andere, verkeerde waarde: dat weegt een
//     maand met 3 conversies even zwaar als een maand met 300.
// (2) De trend kijkt naar de eerste helft tegen de tweede helft van de periode, niet naar
//     de laatste maand. Een periode-evaluatie die op een momentopname leunt is precies wat
//     de audit als gat aanwees.
// (3) Zonder target geen oordeel. De laag beschrijft dan, maar veroordeelt niet.

import { checkTargetPlausibility } from "@/lib/analysis/o2-targets-cost";
import type { HypothesisOutcome } from "@/lib/learning/hypothesis-evaluator";

export const MIN_MONTHS_FOR_TREND = 2;
export const MIN_CONVERSIONS_FOR_VERDICT = 10; // onder dit volume is een CPA- of ROAS-oordeel ruis
export const TREND_MATERIAL = 0.05; // vijf procent verschil tussen de helften is materieel

export interface PeriodMonthRow {
  month: string; // YYYY-MM
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export interface PeriodHypothesis {
  id: string;
  hypothesis: string;
  measurementMetric: string | null;
  status: string | null; // proposed | accepted | rejected | ...
  createdAt: string | null;
  acceptedAt: string | null;
}

export interface PeriodEvaluationInput {
  periodLabel: string; // "Q2 2026", "GreenTech 2026", vrij label
  months: PeriodMonthRow[];
  targets: { cpaTarget?: number | null; roasTarget?: number | null };
  hypotheses: PeriodHypothesis[];
  // De seam naar H1: zodra de evaluator gewired is levert de route hier de uitkomsten aan.
  // Zonder deze map rekent SI3 de hypotheses niet af en zegt dat er eerlijk bij.
  outcomes?: Record<string, HypothesisOutcome>;
}

export type TargetVerdict = "gehaald" | "gemist" | "geen_target" | "te_weinig_volume";

export interface TargetRealisation {
  metric: "cpa" | "roas";
  target: number | null;
  realised: number | null;
  deltaPct: number | null; // relatief ten opzichte van het target
  verdict: TargetVerdict;
  detail: string;
}

export type TrendVerdict = "verbeterd" | "verslechterd" | "stabiel" | "niet_bepaalbaar";

export interface PeriodTrend {
  metric: "cpa" | "roas";
  firstHalf: number | null;
  secondHalf: number | null;
  verdict: TrendVerdict;
  detail: string;
}

export interface HypothesisSettlement {
  total: number;
  accepted: number;
  settled: number; // met een H1-uitkomst
  verdicts: Record<string, number>; // accepted, rejected, unmeasurable, expired
  unsettledReason: string | null; // gevuld zolang H1 niet gewired is
}

export interface PeriodEvaluation {
  periodLabel: string;
  monthCount: number;
  totals: { cost: number; conversions: number; conversionsValue: number; cpa: number | null; roas: number | null };
  targetRealisation: TargetRealisation[];
  trends: PeriodTrend[];
  hypotheses: HypothesisSettlement;
  targetPlausibility: string[]; // achteraf: was het target uberhaupt realistisch
  summary: string;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

// Regel 1: aggregaten uit totalen, nooit uit gemiddelde maandwaarden.
function aggregate(months: PeriodMonthRow[]): { cost: number; conversions: number; conversionsValue: number; cpa: number | null; roas: number | null } {
  const cost = sum(months.map((m) => m.cost));
  const conversions = sum(months.map((m) => m.conversions));
  const conversionsValue = sum(months.map((m) => m.conversionsValue));
  return {
    cost,
    conversions,
    conversionsValue,
    cpa: conversions > 0 ? cost / conversions : null,
    roas: cost > 0 ? conversionsValue / cost : null,
  };
}

function realisationFor(metric: "cpa" | "roas", target: number | null | undefined, realised: number | null, conversions: number): TargetRealisation {
  if (!(typeof target === "number" && target > 0)) {
    return { metric, target: null, realised, deltaPct: null, verdict: "geen_target", detail: `geen ${metric.toUpperCase()}-target vastgelegd, dus geen oordeel; de realisatie was ${realised == null ? "niet te berekenen" : realised.toFixed(2)}` };
  }
  if (realised == null) {
    return { metric, target, realised: null, deltaPct: null, verdict: "te_weinig_volume", detail: `de ${metric.toUpperCase()} is niet te berekenen over deze periode` };
  }
  if (conversions < MIN_CONVERSIONS_FOR_VERDICT) {
    return { metric, target, realised, deltaPct: null, verdict: "te_weinig_volume", detail: `${conversions} conversies over de hele periode is te weinig voor een betrouwbaar ${metric.toUpperCase()}-oordeel (drempel ${MIN_CONVERSIONS_FOR_VERDICT})` };
  }
  const deltaPct = (realised - target) / target;
  // Bij CPA is lager beter, bij ROAS hoger.
  const gehaald = metric === "cpa" ? realised <= target : realised >= target;
  return {
    metric,
    target,
    realised,
    deltaPct,
    verdict: gehaald ? "gehaald" : "gemist",
    detail: `${metric.toUpperCase()} ${realised.toFixed(2)} tegen target ${target.toFixed(2)} (${deltaPct >= 0 ? "plus" : "min"} ${Math.abs(deltaPct * 100).toFixed(1)} procent); ${gehaald ? "gehaald" : "niet gehaald"} over de hele periode`,
  };
}

// Regel 2: de trend splitst de periode in twee helften. Bij een oneven aantal maanden valt
// de middelste maand in de tweede helft (de recentere kant weegt dan iets zwaarder, wat
// voor een eindevaluatie de juiste kant is).
function trendFor(metric: "cpa" | "roas", months: PeriodMonthRow[]): PeriodTrend {
  if (months.length < MIN_MONTHS_FOR_TREND) {
    return { metric, firstHalf: null, secondHalf: null, verdict: "niet_bepaalbaar", detail: `${months.length} maand(en) is te kort voor een trend (minimaal ${MIN_MONTHS_FOR_TREND})` };
  }
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const split = Math.floor(sorted.length / 2);
  const first = aggregate(sorted.slice(0, split));
  const second = aggregate(sorted.slice(split));
  const a = metric === "cpa" ? first.cpa : first.roas;
  const b = metric === "cpa" ? second.cpa : second.roas;
  if (a == null || b == null || a === 0) {
    return { metric, firstHalf: a, secondHalf: b, verdict: "niet_bepaalbaar", detail: `de ${metric.toUpperCase()} is in minstens een helft niet te berekenen` };
  }
  const relDelta = (b - a) / a;
  const beter = metric === "cpa" ? relDelta <= -TREND_MATERIAL : relDelta >= TREND_MATERIAL;
  const slechter = metric === "cpa" ? relDelta >= TREND_MATERIAL : relDelta <= -TREND_MATERIAL;
  const verdict: TrendVerdict = beter ? "verbeterd" : slechter ? "verslechterd" : "stabiel";
  return {
    metric,
    firstHalf: a,
    secondHalf: b,
    verdict,
    detail: `${metric.toUpperCase()} ging van ${a.toFixed(2)} in de eerste helft naar ${b.toFixed(2)} in de tweede (${relDelta >= 0 ? "plus" : "min"} ${Math.abs(relDelta * 100).toFixed(1)} procent): ${verdict}`,
  };
}

// De hypothese-afrekening. Zonder H1-uitkomsten telt SI3 eerlijk wat er beloofd is en zegt
// erbij dat de afrekening zelf nog niet bestaat, in plaats van een oordeel te fingeren.
function settleHypotheses(input: PeriodEvaluationInput): HypothesisSettlement {
  const total = input.hypotheses.length;
  const accepted = input.hypotheses.filter((h) => (h.status ?? "").toLowerCase() === "accepted").length;
  const verdicts: Record<string, number> = {};
  let settled = 0;
  for (const h of input.hypotheses) {
    const outcome = input.outcomes?.[h.id];
    if (!outcome) continue;
    settled += 1;
    verdicts[outcome.verdict] = (verdicts[outcome.verdict] ?? 0) + 1;
  }
  return {
    total,
    accepted,
    settled,
    verdicts,
    unsettledReason:
      settled < accepted
        ? `${accepted - settled} van de ${accepted} geaccepteerde hypotheses zijn niet afgerekend: de H1-evaluator is nog niet gekoppeld, dus er is geen automatisch oordeel over wat de belofte heeft opgeleverd`
        : null,
  };
}

export function buildPeriodEvaluation(input: PeriodEvaluationInput): PeriodEvaluation {
  const months = [...input.months].sort((a, b) => a.month.localeCompare(b.month));
  const totals = aggregate(months);

  const targetRealisation = [
    realisationFor("cpa", input.targets.cpaTarget, totals.cpa, totals.conversions),
    realisationFor("roas", input.targets.roasTarget, totals.roas, totals.conversions),
  ];
  const trends = [trendFor("cpa", months), trendFor("roas", months)];
  const hypotheses = settleHypotheses(input);

  // Achteraf-check: was het target uberhaupt realistisch? Hergebruikt de O2-kern op de
  // laatste twee maanden van de periode.
  const targetPlausibility: string[] = [];
  const lastTwo = months.slice(-2);
  if (lastTwo.length === 2) {
    const cpaOf = (m: PeriodMonthRow) => (m.conversions > 0 ? m.cost / m.conversions : 0);
    const roasOf = (m: PeriodMonthRow) => (m.cost > 0 ? m.conversionsValue / m.cost : 0);
    if (typeof input.targets.cpaTarget === "number") {
      const check = checkTargetPlausibility("cpa", input.targets.cpaTarget, [cpaOf(lastTwo[0]), cpaOf(lastTwo[1])]);
      if (check.implausible && check.detail) targetPlausibility.push(check.detail);
    }
    if (typeof input.targets.roasTarget === "number") {
      const check = checkTargetPlausibility("roas", input.targets.roasTarget, [roasOf(lastTwo[0]), roasOf(lastTwo[1])]);
      if (check.implausible && check.detail) targetPlausibility.push(check.detail);
    }
  }

  const gehaald = targetRealisation.filter((t) => t.verdict === "gehaald").length;
  const gemist = targetRealisation.filter((t) => t.verdict === "gemist").length;
  const summary =
    months.length === 0
      ? `${input.periodLabel}: geen maanddata, geen evaluatie mogelijk.`
      : `${input.periodLabel}: ${months.length} maanden, ${totals.conversions} conversies op ${totals.cost.toFixed(0)} kosten. ${gehaald} target(s) gehaald, ${gemist} gemist${gemist + gehaald === 0 ? " (geen targets vastgelegd)" : ""}. ${hypotheses.total} hypotheses waarvan ${hypotheses.accepted} geaccepteerd en ${hypotheses.settled} afgerekend.`;

  return { periodLabel: input.periodLabel, monthCount: months.length, totals, targetRealisation, trends, hypotheses, targetPlausibility, summary };
}

// De prompt-sectie: dezelfde vorm als de A-track-sectie, zodat de evaluatie-route hem
// deterministisch kan voeden aan een LLM die uitsluitend formuleert.
export function renderPeriodEvaluationSection(evaluation: PeriodEvaluation): string {
  const lines: string[] = [];
  lines.push("## Periode-evaluatie: plan tegen realisatie");
  lines.push("");
  lines.push(evaluation.summary);
  lines.push("");
  lines.push("### Targetrealisatie over de hele periode");
  for (const t of evaluation.targetRealisation) lines.push(`- [${t.verdict}] ${t.detail}`);
  lines.push("");
  lines.push("### Trend binnen de periode (eerste helft tegen tweede helft)");
  for (const t of evaluation.trends) lines.push(`- [${t.verdict}] ${t.detail}`);
  lines.push("");
  lines.push("### Hypotheses");
  lines.push(`- ${evaluation.hypotheses.total} opgesteld, ${evaluation.hypotheses.accepted} geaccepteerd, ${evaluation.hypotheses.settled} afgerekend`);
  for (const [verdict, count] of Object.entries(evaluation.hypotheses.verdicts)) lines.push(`- ${verdict}: ${count}`);
  if (evaluation.hypotheses.unsettledReason) lines.push(`- LET OP: ${evaluation.hypotheses.unsettledReason}`);
  if (evaluation.targetPlausibility.length > 0) {
    lines.push("");
    lines.push("### Was het target realistisch");
    for (const detail of evaluation.targetPlausibility) lines.push(`- ${detail}`);
  }
  lines.push("");
  lines.push("De cijfers hierboven zijn deterministisch berekend uit de maanddata. Neem ze letterlijk over; herbereken niets en claim geen zekerheid boven de labels.");
  return lines.join("\n");
}
