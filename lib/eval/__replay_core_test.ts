// Test voor de X3 build-kern (replay-core en comparison-report). Deterministisch, geen LLM:
// de callFn is geinjecteerd. Draaien: npx tsx lib/eval/__replay_core_test.ts

import { replayFixtures, buildRunInputFromReplay, runJudge, type EvalFixtureRecord, type ReplayCallFn, type JudgeCallFn } from "./replay-core";
import { buildScorecard, compareScorecards } from "./scorecard";
import { buildComparisonMarkdown, TopDifferencesSchema } from "./comparison-report";
import type { JudgePass } from "./judge-contract";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const FIXTURES: EvalFixtureRecord[] = [
  { step: 2, payload: { systemPrompt: "sys2", userMessage: "Data: CPA €48, 3400 klikken.", stepName: "Conversie", sopType: "monthly", jsonMode: false } },
  { step: 1, payload: { systemPrompt: "sys1", userMessage: "Data: cost €1200, 25% stijging.", stepName: "Overzicht", sopType: "monthly", jsonMode: false } },
];

const TEST_PRICES = { "model-x": { inputPer1M: 1, outputPer1M: 2 } };

// Een fake die gegronde output geeft, met de stapvolgorde zichtbaar in de tekst.
const goodCall: ReplayCallFn = async ({ user }) => ({
  output: user.includes("CPA") ? "De CPA is €48 en dat is gezond." : "De cost was €1200, een stijging van 25%.",
  model: "model-x",
  promptTokens: 1000,
  completionTokens: 500,
});

async function main() {
  // ── Replay: volgorde, determinisme, checks ──
  const runA = await replayFixtures({ fixtures: FIXTURES, model: "model-x", callFn: goodCall, prices: TEST_PRICES });
  assert(runA.stepResults[0].step === 1 && runA.stepResults[1].step === 2, "fixtures worden op stapnummer gesorteerd afgespeeld");
  assert(runA.allStepsProduced, "alle stappen leverden output: de gate staat op geslaagd");
  assert(runA.stepResults.every((s) => s.checks.find((c) => c.check === "grounding")!.passed), "gegronde outputs passeren de per-stap grounding tegen de eigen userMessage");
  assert(runA.combinedDeliverable.includes("## Stap 1: Overzicht") && runA.combinedDeliverable.includes("## Stap 2: Conversie"), "de gecombineerde deliverable draagt de stap-koppen");
  const runA2 = await replayFixtures({ fixtures: FIXTURES, model: "model-x", callFn: goodCall, prices: TEST_PRICES });
  assert(runA2.combinedDeliverable === runA.combinedDeliverable, "dezelfde fixtures met dezelfde fake geven een identieke deliverable (determinisme)");

  // ── Kosten: geprijsd en ongeprijsd ──
  assert(runA.totalCostEur === Math.round((2 * (1000 / 1e6 * 1 + 500 / 1e6 * 2)) * 10000) / 10000 && !runA.costPartial, "twee geprijsde calls sommeren de kosten exact");
  const runUnpriced = await replayFixtures({ fixtures: FIXTURES, model: "onbekend-model", callFn: async (a) => ({ ...(await goodCall(a)), model: "onbekend-model" }), prices: TEST_PRICES });
  assert(runUnpriced.totalCostEur === null && !runUnpriced.costPartial, "een model zonder prijs geeft null-kosten, geen nul");

  // ── Ongegrond cijfer wordt per stap geteld en telt door in de kaart ──
  const badCall: ReplayCallFn = async () => ({ output: "Verlaag de CPA met 40% richting €30.", model: "model-x", promptTokens: 10, completionTokens: 10 });
  const runBad = await replayFixtures({ fixtures: FIXTURES, model: "model-x", callFn: badCall, prices: TEST_PRICES });
  const badInput = buildRunInputFromReplay({ model: "model-x", fixtureSet: "fs", run: runBad, requiredSections: ["SOP Coverage Appendix"] });
  assert((badInput.errorsByCategory["grounding"] ?? 0) >= 2, "ongegronde cijfers per stap aggregeren naar de grounding-categorie");
  assert((badInput.errorsByCategory["structuur"] ?? 0) === 1, "de ontbrekende verplichte sectie telt als structuurfout op de gecombineerde deliverable");
  const badCard = buildScorecard(badInput);
  assert(badCard.totalErrors >= 3 && badCard.gatePassed, "de scorekaart telt de fouten terwijl de gate (output geleverd) los daarvan staat");

  // ── Lege output: gate faalt ──
  const emptyCall: ReplayCallFn = async ({ user }) => ({ output: user.includes("CPA") ? "" : "iets", model: "model-x", promptTokens: 1, completionTokens: 1 });
  const runEmpty = await replayFixtures({ fixtures: FIXTURES, model: "model-x", callFn: emptyCall, prices: TEST_PRICES });
  assert(!runEmpty.allStepsProduced, "een lege stap-output laat de gate falen");

  // ── Judge: happy path ──
  const validPass = (score: number): string => JSON.stringify({
    sop_dekking: { score, citations: ["De CPA is €48"], motivation: "m" },
    inzicht_waarom: { score, citations: ["c"], motivation: "m" },
    actionability: { score, citations: ["c"], motivation: "m" },
    leesbaarheid: { score, citations: ["c"], motivation: "m" },
  } satisfies JudgePass);
  let judgeCalls = 0;
  const happyJudge: JudgeCallFn = async () => { judgeCalls += 1; return { output: "```json\n" + validPass(7) + "\n```" }; };
  const happy = await runJudge({ callFn: happyJudge, deliverable: "d", benchmark: "b" });
  assert(happy.ok && happy.merged!.scores.sop_dekking === 7 && judgeCalls === 2, "twee geldige passes (met codefences) leveren een gemiddeld oordeel in twee calls");

  // ── Judge: retry-pad (eerst rommel, dan geldig) ──
  let retryCalls = 0;
  const retryJudge: JudgeCallFn = async ({ user }) => {
    retryCalls += 1;
    const isRetry = user.includes("geen geldige JSON");
    return { output: isRetry || retryCalls > 2 ? validPass(6) : "dit is geen json" };
  };
  const retried = await runJudge({ callFn: retryJudge, deliverable: "d", benchmark: "b" });
  assert(retried.ok, "een ongeldige eerste poging wordt met een schema-feedback-retry hersteld (een repair max)");

  // ── Judge: blijvend ongeldig ──
  const brokenJudge: JudgeCallFn = async () => ({ output: "nooit json" });
  const broken = await runJudge({ callFn: brokenJudge, deliverable: "d", benchmark: "b" });
  assert(!broken.ok && broken.reason!.includes("pass A"), "blijvend ongeldige judge-output blokkeert met de reden");

  // ── Judge: stabiliteitsblokkade ──
  let flip = 0;
  const unstableJudge: JudgeCallFn = async () => { flip += 1; return { output: validPass(flip <= 1 ? 4 : 8) }; };
  const unstable = await runJudge({ callFn: unstableJudge, deliverable: "d", benchmark: "b" });
  assert(!unstable.ok && unstable.reason!.includes("geblokkeerd") && unstable.stability!.meanDelta === 4, "vier punten verschil tussen de passes blokkeert het oordeel met de delta in de reden");

  // ── Vergelijkingsrapport ──
  const goodInput = buildRunInputFromReplay({ model: "model-x", fixtureSet: "fs", run: runA, requiredSections: [] });
  const cardA = buildScorecard(goodInput);
  const cardB = buildScorecard({ ...badInput, model: "model-y" });
  const markdown = buildComparisonMarkdown({
    comparison: compareScorecards(cardA, cardB),
    scorecardA: cardA,
    scorecardB: cardB,
    judgeA: happy.merged,
    judgeB: null,
    differences: [{ titel: "Diepte", citaat_a: "De CPA is €48", citaat_b: "Verlaag de CPA", duiding: "A blijft bij de data" }],
  });
  assert(markdown.includes("# Modelvergelijking: model-x tegen model-y"), "het rapport draagt de kandidaten in de titel");
  assert(markdown.includes("| errors |") && markdown.includes("lager is beter"), "de metingen staan in de tabel met de richting expliciet");
  assert(markdown.includes("sop_dekking: 7 van 10") && markdown.includes("Citaat:"), "de judge-sectie toont de score met een citaat");
  assert(markdown.includes("De grootste kwalitatieve verschillen") && markdown.includes("Diepte"), "de verschillen-sectie staat erin");

  // ── TopDifferences-schema: citaten uit beide kandidaten verplicht ──
  assert(!TopDifferencesSchema.safeParse([{ titel: "t", citaat_a: "a", citaat_b: "", duiding: "d" }]).success, "een verschil zonder citaat uit kandidaat B is ongeldig");
  assert(TopDifferencesSchema.safeParse([{ titel: "t", citaat_a: "a", citaat_b: "b", duiding: "d" }]).success, "een volledig onderbouwd verschil parseert");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main();
