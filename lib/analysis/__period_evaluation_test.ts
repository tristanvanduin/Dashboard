// Test voor de SI3 periode-evaluatie. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__period_evaluation_test.ts

import {
  buildPeriodEvaluation,
  renderPeriodEvaluationSection,
  MIN_CONVERSIONS_FOR_VERDICT,
  type PeriodEvaluationInput,
  type PeriodMonthRow,
} from "./period-evaluation";
import { checkSanitization } from "@/lib/eval/output-checks";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function maand(month: string, cost: number, conversions: number, conversionsValue = 0): PeriodMonthRow {
  return { month, cost, conversions, conversionsValue };
}

function basis(over: Partial<PeriodEvaluationInput> = {}): PeriodEvaluationInput {
  return {
    periodLabel: "Q2 2026",
    months: [maand("2026-04", 1000, 50, 4000), maand("2026-05", 1000, 50, 4000), maand("2026-06", 1000, 50, 4000)],
    targets: { cpaTarget: 25, roasTarget: 3 },
    hypotheses: [],
    ...over,
  };
}

// ── Regel 1: aggregaten uit TOTALEN, niet uit gemiddelde maandwaarden ──
// April: 900 kosten op 3 conversies is CPA 300. Mei plus juni: 100 kosten op 97 conversies.
// Het gemiddelde van de maand-CPA's zou rond de 100 liggen; de eerlijke periode-CPA is 10.
const scheef = buildPeriodEvaluation(basis({
  months: [maand("2026-04", 900, 3), maand("2026-05", 50, 48), maand("2026-06", 50, 49)],
  targets: { cpaTarget: 25 },
}));
assert(scheef.totals.cpa === 10, "de periode-CPA deelt totalen (1000 gedeeld door 100 is 10), niet het gemiddelde van maand-CPA's");
assert(scheef.targetRealisation.find((t) => t.metric === "cpa")!.verdict === "gehaald", "met de correcte aggregatie is het CPA-target gehaald; het maandgemiddelde had hier onterecht gemist gezegd");

// ── Regel 3: richting-asymmetrie ──
const gemist = buildPeriodEvaluation(basis({ targets: { cpaTarget: 15, roasTarget: 5 } }));
assert(gemist.targetRealisation.find((t) => t.metric === "cpa")!.verdict === "gemist", "CPA 20 tegen target 15 is gemist: bij CPA is lager beter");
assert(gemist.targetRealisation.find((t) => t.metric === "roas")!.verdict === "gemist", "ROAS 4 tegen target 5 is gemist: bij ROAS is hoger beter");
const gehaald = buildPeriodEvaluation(basis({ targets: { cpaTarget: 25, roasTarget: 3 } }));
assert(gehaald.targetRealisation.every((t) => t.verdict === "gehaald"), "CPA 20 onder target 25 en ROAS 4 boven target 3 zijn beide gehaald");
assert(gehaald.targetRealisation.find((t) => t.metric === "cpa")!.deltaPct === -0.2, "de delta is relatief ten opzichte van het target");

// ── Het eerlijke geen-target-pad ──
const zonderTarget = buildPeriodEvaluation(basis({ targets: {} }));
assert(zonderTarget.targetRealisation.every((t) => t.verdict === "geen_target"), "zonder targets geen oordeel");
assert(zonderTarget.targetRealisation[0].detail.includes("geen oordeel") && zonderTarget.targetRealisation[0].realised === 20, "zonder target beschrijft de laag wel de realisatie maar veroordeelt niet");
assert(zonderTarget.summary.includes("geen targets vastgelegd"), "de samenvatting zegt eerlijk dat er niets af te rekenen viel");

// ── Te weinig volume ──
const weinig = buildPeriodEvaluation(basis({ months: [maand("2026-04", 100, 2, 300), maand("2026-05", 100, 3, 300)] }));
assert(weinig.targetRealisation.every((t) => t.verdict === "te_weinig_volume"), `onder ${MIN_CONVERSIONS_FOR_VERDICT} conversies is een CPA- of ROAS-oordeel ruis`);
assert(weinig.targetRealisation[0].detail.includes("5 conversies"), "het volume-pad noemt het echte aantal");

// ── Regel 2: de trend splitst de periode, en ziet wat een laatste-maand-blik mist ──
// De laatste maand is de duurste van de tweede helft, maar de tweede helft is als geheel beter.
const verbeterd = buildPeriodEvaluation(basis({
  months: [maand("2026-01", 1000, 20), maand("2026-02", 1000, 20), maand("2026-03", 1000, 50), maand("2026-04", 1000, 40)],
  targets: { cpaTarget: 25 },
}));
const cpaTrend = verbeterd.trends.find((t) => t.metric === "cpa")!;
assert(cpaTrend.verdict === "verbeterd" && cpaTrend.firstHalf === 50 && Math.round(cpaTrend.secondHalf!) === 22, "de trend zet de eerste helft tegen de tweede: CPA van 50 naar 22 is verbeterd");
assert(cpaTrend.detail.includes("eerste helft") && cpaTrend.detail.includes("tweede"), "de trend legt uit welke helften vergeleken zijn");
const verslechterd = buildPeriodEvaluation(basis({ months: [maand("2026-01", 1000, 50), maand("2026-02", 1000, 50), maand("2026-03", 1000, 20), maand("2026-04", 1000, 20)] }));
assert(verslechterd.trends.find((t) => t.metric === "cpa")!.verdict === "verslechterd", "een stijgende CPA over de helften is verslechterd");
assert(buildPeriodEvaluation(basis()).trends.find((t) => t.metric === "cpa")!.verdict === "stabiel", "een vlakke periode is stabiel, niet verbeterd of verslechterd");
assert(buildPeriodEvaluation(basis({ months: [maand("2026-04", 1000, 50)] })).trends.every((t) => t.verdict === "niet_bepaalbaar"), "een periode van een maand levert geen trend");

// ── De ROAS-trend keert de richting om ──
const roasTrend = buildPeriodEvaluation(basis({
  months: [maand("2026-01", 1000, 50, 2000), maand("2026-02", 1000, 50, 2000), maand("2026-03", 1000, 50, 5000), maand("2026-04", 1000, 50, 5000)],
})).trends.find((t) => t.metric === "roas")!;
assert(roasTrend.verdict === "verbeterd" && roasTrend.firstHalf === 2 && roasTrend.secondHalf === 5, "een stijgende ROAS is verbeterd: de richting is omgekeerd aan CPA");

// ── De H1-seam ──
const metHypotheses = basis({
  hypotheses: [
    { id: "h1", hypothesis: "Bod omhoog op merk", measurementMetric: "cpa", status: "accepted", createdAt: "2026-04-01", acceptedAt: "2026-04-02" },
    { id: "h2", hypothesis: "Nieuwe RSA", measurementMetric: "ctr", status: "accepted", createdAt: "2026-04-01", acceptedAt: "2026-04-02" },
    { id: "h3", hypothesis: "Voorstel", measurementMetric: null, status: "proposed", createdAt: "2026-04-01", acceptedAt: null },
  ],
});
const zonderH1 = buildPeriodEvaluation(metHypotheses);
assert(zonderH1.hypotheses.total === 3 && zonderH1.hypotheses.accepted === 2 && zonderH1.hypotheses.settled === 0, "zonder H1-uitkomsten telt SI3 wel de beloftes maar rekent niets af");
assert(zonderH1.hypotheses.unsettledReason!.includes("H1-evaluator is nog niet gekoppeld"), "de laag zegt eerlijk WAAROM er niet afgerekend is in plaats van een oordeel te fingeren");

const metH1 = buildPeriodEvaluation({
  ...metHypotheses,
  outcomes: {
    h1: { verdict: "accepted", metrics: [] },
    h2: { verdict: "rejected", metrics: [] },
  },
});
assert(metH1.hypotheses.settled === 2 && metH1.hypotheses.verdicts.accepted === 1 && metH1.hypotheses.verdicts.rejected === 1, "met H1-uitkomsten rekent de seam de hypotheses af per verdict");
assert(metH1.hypotheses.unsettledReason === null, "als alles afgerekend is verdwijnt de waarschuwing");

// ── De render ──
const sectie = renderPeriodEvaluationSection(zonderH1);
assert(sectie.includes("Periode-evaluatie: plan tegen realisatie") && sectie.includes("Targetrealisatie") && sectie.includes("Trend binnen de periode"), "de sectie draagt de vaste koppen");
assert(sectie.includes("LET OP") && sectie.includes("H1-evaluator"), "de onafgerekende beloftes staan prominent in de sectie");
assert(sectie.includes("herbereken niets"), "de sectie instrueert het model om de deterministische cijfers letterlijk over te nemen");
assert(checkSanitization(sectie).passed, "de sectie is vrij van em-dashes en mojibake");

// ── Lege periode ──
const leeg = buildPeriodEvaluation(basis({ months: [] }));
assert(leeg.monthCount === 0 && leeg.summary.includes("geen maanddata"), "een lege periode degradeert netjes");
assert(leeg.totals.cpa === null && leeg.totals.roas === null, "zonder data geen gefingeerde nullen");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
