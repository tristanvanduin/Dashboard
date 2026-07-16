// Test voor de H1-hypothese-parser. Deterministisch, geen IO.
// Draaien: npx tsx lib/learning/__hypothesis_parser_test.ts

import { parseHypothesis, normalizeMetric, parseWindowDays, extractThreshold, extractRelativeThreshold, resolvePredicate } from "./hypothesis-parser";
import { evaluateHypothesisOutcome } from "./hypothesis-evaluator";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Metric-normalisatie ──
assert(normalizeMetric("CPA") === "cpa" && normalizeMetric("kosten per acquisitie") === "cpa", "CPA wordt herkend in beide talen");
assert(normalizeMetric("ROAS") === "roas" && normalizeMetric("doorklikratio") === "ctr" && normalizeMetric("impressie-aandeel") === "impression_share", "de aliassen dekken de Nederlandse termen");
assert(normalizeMetric("conversies") === "conversions" && normalizeMetric("omzet") === "conversions_value", "conversies en omzet mappen naar de canonieke sleutels");
assert(normalizeMetric("de vibe van de campagne") === null && normalizeMetric(null) === null, "een onbekende of lege metric levert null, geen gok");

// ── De drempel: procent is relatief, bedrag is absoluut ──
assert(extractRelativeThreshold("CPA daalt met 15%", "decrease") === 0.15, "een percentage wordt een RELATIEVE fractie, apart van het predicaat");
assert(extractRelativeThreshold("CPA daalt met 7,5%", "decrease") === 0.075, "de komma-notatie werkt");
assert(extractThreshold("CPA onder €25", "below") === 25, "een bedrag bij een absolute grens is de waarde zelf en gaat wel direct het predicaat in");
assert(extractThreshold("CPA daalt met 15%", "decrease") === undefined, "een percentage komt NOOIT als absolute drempel in het predicaat: de evaluator zou 0,15 als vijftien cent lezen");
assert(extractRelativeThreshold("CPA onder €25", "below") === undefined, "bij een absolute grens bestaat er geen relatieve eis");

// ── De vensters ──
assert(parseWindowDays("4 weken") === 28 && parseWindowDays("30 dagen") === 30 && parseWindowDays("2 maanden") === 60, "weken, dagen en maanden vertalen naar dagen");
assert(parseWindowDays("een maand") === 30, "de geschreven vorm werkt ook");
assert(parseWindowDays("Q2") === null && parseWindowDays(null) === null, "een kwartaal- of leeg label levert null; de evaluator gebruikt dan zijn eigen verloopregel");

// ── De kern: richting en voorrang ──
const daling = parseHypothesis({ expectedResult: "De CPA daalt met 15% binnen het venster", measurementMetric: "cpa", timeframe: "4 weken" });
assert(daling.ok && daling.parsed.predicate.direction === "decrease" && daling.parsed.windowDays === 28, "een relatieve daling met percentage en venster parseert volledig");
assert(daling.ok && daling.parsed.predicate.threshold === undefined && daling.parsed.relativeThreshold === 0.15, "de relatieve eis reist APART mee; het predicaat draagt hem niet als absolute magnitude");

// ── De unit-val: resolvePredicate zet de relatieve eis om met de baseline ──
if (daling.ok) {
  const opgelost = resolvePredicate(daling.parsed, { cpa: 20 });
  assert(opgelost.threshold === 3, "15 procent van een baseline-CPA van 20 is een absolute magnitude van 3, precies wat de evaluator verwacht");
  assert(resolvePredicate(daling.parsed, {}).threshold === undefined, "zonder baseline blijft het predicaat drempelloos in plaats van fout");
  assert(resolvePredicate(daling.parsed, { cpa: 0 }).threshold === undefined, "een baseline van nul levert geen deling of gefingeerde drempel");
}

const grens = parseHypothesis({ expectedResult: "De CPA blijft onder €25", measurementMetric: "cpa", timeframe: "4 weken" });
assert(grens.ok && grens.parsed.predicate.direction === "below" && grens.parsed.predicate.threshold === 25, "een absolute grens wint van de relatieve richting: onder 25 is een grens, geen daling");

const stijging = parseHypothesis({ expectedResult: "De ROAS stijgt naar een hoger niveau", measurementMetric: "roas", timeframe: "2 weken" });
assert(stijging.ok && stijging.parsed.predicate.direction === "increase" && stijging.parsed.predicate.threshold === undefined, "een richting zonder getal levert een predicaat zonder drempel: elke beweging telt");

const stabiel = parseHypothesis({ expectedResult: "De CPA blijft stabiel", measurementMetric: "cpa", timeframe: "4 weken" });
assert(stabiel.ok && stabiel.parsed.predicate.direction === "stable", "stabiel wordt herkend als eigen richting");

// De metric mag uit de verwachting komen als het veld leeg is.
const uitTekst = parseHypothesis({ expectedResult: "De ROAS stijgt met 20%", measurementMetric: null, timeframe: null });
assert(uitTekst.ok && uitTekst.parsed.predicate.metric === "roas", "zonder metric-veld leest de parser hem uit de verwachting");

// ── BIJ TWIJFEL NIETS: de drie weigeringen ──
const geenMetric = parseHypothesis({ expectedResult: "Het wordt allemaal beter", measurementMetric: "sfeer", timeframe: "4 weken" });
assert(!geenMetric.ok && geenMetric.reason.includes("meetmetric is niet herkend"), "een onbekende metric weigert met een reden in plaats van te gokken");

const geenRichting = parseHypothesis({ expectedResult: "De CPA wordt geevalueerd", measurementMetric: "cpa", timeframe: "4 weken" });
assert(!geenRichting.ok && geenRichting.reason.includes("richting is niet af te leiden"), "zonder richting geen predicaat: elk verdict zou een gok zijn");

const grensZonderWaarde = parseHypothesis({ expectedResult: "De CPA blijft onder het target", measurementMetric: "cpa", timeframe: "4 weken" });
assert(!grensZonderWaarde.ok && grensZonderWaarde.reason.includes("vereist een waarde"), "een absolute grens zonder getal weigert");

assert(!parseHypothesis({ expectedResult: "", measurementMetric: "cpa", timeframe: "4 weken" }).ok, "een lege verwachting levert niets te toetsen");

// ── De ketentest: parser naar evaluator ──
if (daling.ok) {
  const predicaat = resolvePredicate(daling.parsed, { cpa: 20 }); // de echte keten: parse, resolve, evaluate
  const gehaald = evaluateHypothesisOutcome({
    successPredicates: [predicaat],
    guardrailPredicates: [],
    baseline: { cpa: 20 },
    measured: { cpa: 16 }, // min 20 procent, ruim voorbij de 15 procent-eis
    windowImpressions: 50000,
    entityActive: true,
    ageInDays: 28,
  });
  assert(gehaald.verdict === "accepted", "de keten werkt: een geparseerd predicaat levert via de echte evaluator een accepted-verdict");

  const gemist = evaluateHypothesisOutcome({
    successPredicates: [predicaat],
    guardrailPredicates: [],
    baseline: { cpa: 20 },
    measured: { cpa: 19.5 }, // min 0,5 absoluut, ver onder de vereiste magnitude van 3
    windowImpressions: 50000,
    entityActive: true,
    ageInDays: 28,
  });
  assert(gemist.verdict === "rejected", "een beweging onder de drempel wordt terecht afgewezen");

  const geenData = evaluateHypothesisOutcome({
    successPredicates: [predicaat],
    guardrailPredicates: [],
    baseline: {},
    measured: {},
    windowImpressions: 50000,
    entityActive: true,
    ageInDays: 10,
  });
  assert(geenData.verdict === "unmeasurable", "zonder baseline blijft het oordeel eerlijk onmeetbaar");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
