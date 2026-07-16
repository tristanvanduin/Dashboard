// Test voor de W1.1 O2-wiring (goals-plausibiliteit plus kostenregistratie). Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__o2_wiring_test.ts

import { goalsPlausibilityFromMonthly, channelFromSopType, buildUsageRow, MODEL_PRICES, targetActualsFromMonthly, buildConfiguredTargetsBlock } from "./o2-targets-cost";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function maand(month: string, cost: number, conversions: number, value = 0) {
  return { month, cost, conversions, conversions_value: value };
}

// De bruidsmode-case: CPA-target 10, realisatie 124 en 137 in de laatste twee maanden
const bruidsmode = goalsPlausibilityFromMonthly(
  { cpaTarget: 10 },
  [maand("2026-01", 1000, 100), maand("2026-03", 13700, 100), maand("2026-02", 12400, 100)]
);
assert(bruidsmode?.target_implausible === true, "bruidsmode flagt (twee maanden meer dan 5x)");
assert(!!bruidsmode?.detail && bruidsmode.detail.includes("CPA") && bruidsmode.detail.includes("137") && bruidsmode.detail.includes("124"), "detail bevat metric en beide realisaties");
assert(!!bruidsmode?.detail && /herijking/i.test(bruidsmode.detail), "detail stuurt op herijking");
// De ongesorteerde input hierboven bewijst meteen dat de laatste twee maanden correct gekozen worden (januari telt niet mee)

// Herstel: de laatste maand zit weer op target, de vorige niet: geen flag
const herstel = goalsPlausibilityFromMonthly({ cpaTarget: 10 }, [maand("2026-02", 13700, 100), maand("2026-03", 1200, 100)]);
assert(herstel?.target_implausible === false, "herstel in de laatste maand reset de flag");

// ROAS-lage-kant: target 100, realisatie 15 en 12: flagt ook
const roas = goalsPlausibilityFromMonthly(
  { roasTarget: 100 },
  [maand("2026-02", 1000, 10, 15000), maand("2026-03", 1000, 10, 12000)]
);
assert(roas?.target_implausible === true, "ROAS ver onder target flagt (beide richtingen)");
assert(!!roas?.detail && roas.detail.includes("ROAS"), "ROAS-detail benoemt de metric");

// Geen targets: geen flag, geen null (de aanroeper hoeft niets te doen)
const geen = goalsPlausibilityFromMonthly({}, [maand("2026-02", 1000, 10), maand("2026-03", 1000, 10)]);
assert(geen?.target_implausible === false, "zonder targets geen flag");

// Te weinig maanden: null (geen oordeel mogelijk)
assert(goalsPlausibilityFromMonthly({ cpaTarget: 10 }, [maand("2026-03", 13700, 100)]) === null, "een maand data geeft null");

// Beide targets tegelijk implausible: details gecombineerd
const beide = goalsPlausibilityFromMonthly(
  { cpaTarget: 10, roasTarget: 100 },
  [maand("2026-02", 12400, 100, 1000), maand("2026-03", 13700, 100, 1000)]
);
assert(beide?.target_implausible === true && !!beide.detail && beide.detail.includes("CPA") && beide.detail.includes("ROAS"), "beide targets in een gecombineerd detail");

// channelFromSopType
assert(channelFromSopType("monthly") === "google_ads", "monthly is google_ads");
assert(channelFromSopType("meta_monthly") === "meta_ads", "meta_monthly is meta_ads");
assert(channelFromSopType("linkedin_monthly") === "linkedin_ads", "linkedin_monthly is linkedin_ads");
assert(channelFromSopType("onbekend") === null, "onbekende sopType geeft null");

// buildUsageRow: exact de 003-kolommen
const row = buildUsageRow({
  runKey: "job-1", clientId: "client-9", channel: "google_ads", sopType: "monthly",
  stepLabel: "Account Performance", model: "nep/onbekend-model", promptTokens: 1200, completionTokens: 300,
});
const expected = ["run_key", "client_id", "channel", "sop_type", "step_label", "call_label", "model", "prompt_tokens", "completion_tokens", "cost_eur"];
assert(expected.every((k) => k in row), "usage-rij bevat exact de 003-kolommen");
assert(row.run_key === "job-1" && row.prompt_tokens === 1200 && row.completion_tokens === 300, "usage-waarden overgenomen");
assert(row.cost_eur === null, "onbekend model geeft cost_eur null (partieel totaal expliciet)");

// Een bekend model uit MODEL_PRICES geeft een berekende prijs
const known = Object.keys(MODEL_PRICES)[0];
if (known) {
  const priced = buildUsageRow({ runKey: "job-1", model: known, promptTokens: 1_000_000, completionTokens: 0 });
  assert(typeof priced.cost_eur === "number" && (priced.cost_eur as number) > 0, "bekend model geeft een berekende cost_eur");
}


// ── W1.1c: targetActualsFromMonthly plus buildConfiguredTargetsBlock ──
const actuals = targetActualsFromMonthly([
  maand("2026-01", 999, 1), maand("2026-03", 13700, 100, 2000), maand("2026-02", 12400, 100, 1000),
]);
assert(actuals !== null && actuals.cpa[0] === 137 && actuals.cpa[1] === 124, "actuals: cpa als [laatste, voorlaatste] uit ongesorteerde input");
assert(actuals !== null && actuals.spend[0] === 13700 && actuals.conversion_value[1] === 1000, "actuals: spend en conversiewaarde per maand");
assert(targetActualsFromMonthly([maand("2026-03", 100, 1)]) === null, "actuals: een maand geeft null");

assert(buildConfiguredTargetsBlock({}, actuals) === null, "leeg resolved geeft null (geen gedragswijziging)");
assert(buildConfiguredTargetsBlock({ cpa: 0 }, actuals) === null, "nul-target telt niet als ingesteld");
const blok = buildConfiguredTargetsBlock({ cpa: 10, cpl: 25 }, actuals);
assert(blok !== null && blok.anyImplausible === true, "implausibel CPA-target zet anyImplausible");
assert(blok !== null && blok.text.includes("CPA-target: 10") && blok.text.includes("137 en 124"), "bloktekst bevat target en realisaties");
assert(blok !== null && blok.text.includes("LET OP"), "bloktekst bevat de LET OP-regel");
assert(blok !== null && blok.text.includes("CPL-target: 25") && !blok.text.includes("CPL-target: 25 (realisatie"), "metric zonder actual krijgt een regel zonder toets");
const gezond = buildConfiguredTargetsBlock({ cpa: 130 }, actuals);
assert(gezond !== null && gezond.anyImplausible === false && !gezond.text.includes("LET OP"), "gezond target geeft geen LET OP en geen flag");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
