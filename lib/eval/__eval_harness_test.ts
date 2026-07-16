// Test voor het X3 eval-harnas (output-checks, scorecard, judge-contract). Deterministisch.
// Draaien: npx tsx lib/eval/__eval_harness_test.ts

import { checkGrounding, checkStructure, checkPurity, checkSanitization, runOutputChecks } from "./output-checks";
import { buildScorecard, compareScorecards, estimateEvalCost, type EvalRunInput } from "./scorecard";
import { JudgePassSchema, mergeJudgePasses, judgeStability, buildJudgePrompt, JUDGE_PROMPT_VERSION, type JudgePass } from "./judge-contract";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const GROUNDING = "De CPA steeg 25 procent naar €48. De cost was €1200 bij 3400 klikken.";

// ── Output-checks: grounding ──
assert(checkGrounding("De CPA steeg 25% en dat vraagt actie.", GROUNDING).passed, "een gegrond percentage passeert de grounding-check");
const ongegrond = checkGrounding("Verlaag de CPA met 40% richting €30.", GROUNDING);
assert(!ongegrond.passed && ongegrond.issues.length === 2, "een verzonnen percentage en bedrag geven twee concrete issues");
assert(ongegrond.issues[0].includes("40"), "het issue benoemt het ongegronde cijfer");

// ── Output-checks: structuur ──
assert(checkStructure("## Analyse\n## SOP Coverage Appendix\n", ["SOP Coverage Appendix"]).passed, "een aanwezige verplichte sectie passeert");
const mist = checkStructure("## Analyse\n", ["SOP Coverage Appendix", "Samenvatting"]);
assert(!mist.passed && mist.issues.length === 2 && mist.issues[0].includes("SOP Coverage Appendix"), "elke ontbrekende sectie is een eigen, benoemd issue");

// ── Output-checks: purity ──
assert(checkPurity("Als de CPA boven de 50 komt, verlaag dan het bod.").passed, "een enkele conditie is toegestaan");
const dubbel = checkPurity("Als de CPA stijgt en als het volume daalt, pauzeer de campagne. Verder prima.");
assert(!dubbel.passed && dubbel.issues[0].includes("2 conditiewoorden"), "twee condities in een zin is een purity-fout met de zin als bewijs");
assert(checkPurity("Als X. Indien Y.").passed, "condities in aparte zinnen zijn geen dubbele conditie");

// ── Output-checks: sanitization ──
assert(checkSanitization("Schone tekst met een gewoon - minteken.").passed, "schone tekst passeert");
const vies = checkSanitization("Tekst met een em\u2014dash en mojibake Ã©n â€œquotesâ€.");
assert(!vies.passed && vies.issues.some((i) => i.includes("em-dash")) && vies.issues.some((i) => i.includes("mojibake")), "em-dash en mojibake worden elk benoemd");

// ── runOutputChecks bundelt de vier ──
const bundel = runOutputChecks({ outputText: "## SOP Coverage Appendix\nDe CPA steeg 25%.", groundingText: GROUNDING, requiredSections: ["SOP Coverage Appendix"] });
assert(bundel.length === 4 && bundel.every((c) => c.passed), "een schone output passeert alle vier de checks");

// ── Scorecard ──
function runInput(overrides: Partial<EvalRunInput> = {}): EvalRunInput {
  return {
    model: "gemini-flash", fixtureSet: "minismus-2026-05",
    gatePassed: true,
    errorsByCategory: { schema: 1, grounding: 2 },
    warningsByCategory: { stijl: 3 },
    repairCount: 1,
    finalActions: ["Verlaag bod campagne X", "verlaag  bod campagne x", "Voeg negative toe"],
    durationMs: 120000,
    totalCostEur: null, costPartial: false,
    outputText: "## SOP Coverage Appendix\nDe CPA steeg 25%.",
    groundingText: GROUNDING,
    requiredSections: ["SOP Coverage Appendix"],
    ...overrides,
  };
}
const kaart = buildScorecard(runInput());
assert(kaart.totalErrors === 3 && kaart.totalWarnings === 3, "errors en warnings worden per categorie opgeteld");
assert(kaart.uniqueActionCount === 2 && kaart.totalActionCount === 3, "handelingen worden genormaliseerd uniek geteld (hoofdletters en dubbele spaties)");
assert(kaart.totalCostEur === null && kaart.costNote !== null && kaart.costNote.includes("MODEL_PRICES"), "lege prijzen geven een expliciete kosten-notitie, geen stil gat");
assert(kaart.outputChecksPassed === 4, "de kwaliteitshelft telt de geslaagde output-checks");

// ── Vergelijking ──
const kaartB = buildScorecard(runInput({ model: "claude-sonnet", errorsByCategory: { schema: 0 }, repairCount: 0, durationMs: 180000, outputText: "## SOP Coverage Appendix\nVerlaag de CPA met 40%." }));
const cmp = compareScorecards(kaart, kaartB);
assert(cmp.metrics.find((m) => m.metric === "errors")!.winner === "b", "minder errors wint op de errors-meting");
assert(cmp.metrics.find((m) => m.metric === "duur_ms")!.winner === "a", "kortere duur wint op de duur-meting");
assert(cmp.metrics.find((m) => m.metric === "kosten_eur")!.winner === "niet_bepaalbaar", "zonder prijzen is kosten expliciet niet bepaalbaar, geen stille gelijkstand");
assert(cmp.metrics.find((m) => m.metric === "output_checks_geslaagd")!.winner === "a", "de kandidaat met het verzonnen cijfer verliest de output-checks-meting");
assert(cmp.summary.aWins >= 2 && cmp.summary.undecided === 1, "de samenvatting telt winsten en onbeslisbare metingen");

// ── Kosten-rem ──
const rem = estimateEvalCost({ fixtureSets: 3, models: 2, callsPerRun: 20, avgCostPerCallEur: null });
assert(rem.totalCalls === 120 && rem.estimatedCostEur === null && rem.note!.includes("MODEL_PRICES"), "de kosten-rem propageert null eerlijk met de reden");
assert(estimateEvalCost({ fixtureSets: 3, models: 2, callsPerRun: 20, avgCostPerCallEur: 0.02 }).estimatedCostEur === 2.4, "met een prijs rekent de rem de schatting uit");

// ── Judge-contract: schema weigert scores zonder citaat (de no-go) ──
function pass(score: number, citation = "De CPA steeg 25%."): JudgePass {
  const dim = { score, citations: [citation], motivation: "onderbouwing" };
  return { sop_dekking: dim, inzicht_waarom: dim, actionability: dim, leesbaarheid: dim };
}
assert(JudgePassSchema.safeParse(pass(7)).success, "een geldige pass met citaten parseert");
const zonderCitaat = { ...pass(7), sop_dekking: { score: 7, citations: [], motivation: "x" } };
assert(!JudgePassSchema.safeParse(zonderCitaat).success, "een score zonder citaat is ongeldig (spec-no-go hard in het schema)");
assert(!JudgePassSchema.safeParse({ ...pass(7), leesbaarheid: { score: 11, citations: ["c"], motivation: "x" } }).success, "een score boven 10 is ongeldig");

// ── Judge: middeling en stabiliteit ──
const merged = mergeJudgePasses(pass(7), pass(8, "Ander citaat."));
assert(merged.scores.sop_dekking === 7.5, "twee passes middelen naar 7,5");
assert(merged.citations.sop_dekking.length === 2, "citaten van beide passes worden uniek samengevoegd");
const stabiel = judgeStability(pass(7), pass(7.5));
assert(stabiel.stable && stabiel.meanDelta === 0.5, "een half punt verschil is stabiel");
const instabiel = judgeStability(pass(5), pass(8));
assert(!instabiel.stable && instabiel.meanDelta === 3, "drie punten gemiddeld verschil is instabiel en blokkeert het oordeel");

// ── Judge-prompt: versievast en met de regels erin ──
const prompt = buildJudgePrompt({ deliverable: "rapport", benchmark: "benchmark" });
assert(prompt.version === JUDGE_PROMPT_VERSION, "de judge-prompt draagt zijn versie");
assert(prompt.system.includes("citaat") && prompt.system.includes("0 tot 10"), "de systeemprompt eist citaten en de schaal");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
