// Verificatie van de O2 pure kern.
// Draaien: npx tsx lib/analysis/__o2_targets_cost_test.ts

import { resolveTargets, checkTargetPlausibility, computeCallCost, sumRunCost, type TargetRow } from "./o2-targets-cost";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("resolveTargets");
const rows: TargetRow[] = [
  { channel: "google_ads", metric: "cpa", targetValue: 20, validFrom: "2026-01-01", validTo: null },
  { channel: "google_ads", metric: "cpa", targetValue: 25, validFrom: "2026-03-01", validTo: null },
  { channel: "google_ads", metric: "roas", targetValue: 4, validFrom: "2026-01-01", validTo: "2026-02-28" },
  { channel: "meta_ads", metric: "cpa", targetValue: 99, validFrom: "2026-01-01", validTo: null },
  { channel: "google_ads", metric: "cpl", targetValue: 0, validFrom: "2026-01-01", validTo: null },
];
const feb = resolveTargets(rows, "google_ads", "2026-02-01");
check("feb: cpa is de jan-rij (25 nog niet geldig)", feb.cpa === 20);
check("feb: roas geldig", feb.roas === 4);
const mar = resolveTargets(rows, "google_ads", "2026-03-01");
check("mrt: cpa is de nieuwe rij (laatste valid_from wint)", mar.cpa === 25);
check("mrt: roas vervallen (valid_to gepasseerd)", mar.roas === undefined);
check("channel-filter: meta-target lekt niet naar google", mar.cpa === 25 && !("99" in Object.values(mar)));
check("nul-target weggelaten (geen vergelijking met 0)", mar.cpl === undefined && feb.cpl === undefined);

console.log("\ncheckTargetPlausibility");
check("twee maanden 5x afwijking flagt",
  checkTargetPlausibility("cpa", 10, [137, 124]).implausible === true);
check("flag bevat cijfers",
  (checkTargetPlausibility("cpa", 10, [137, 124]).detail ?? "").includes("137"));
check("een maand afwijking flagt niet",
  checkTargetPlausibility("cpa", 10, [137, 12]).implausible === false);
check("binnen 5x flagt niet",
  checkTargetPlausibility("cpa", 20, [40, 35]).implausible === false);
check("zonder geldig target geen oordeel",
  checkTargetPlausibility("cpa", 0, [137, 124]).implausible === false);

console.log("\nLLM-kosten");
const prices = { "model-a": { inputPer1M: 1.0, outputPer1M: 3.0 } };
check("bekende prijs exact berekend",
  computeCallCost("model-a", 1_000_000, 1_000_000, prices) === 4.0);
check("halve miljoen tokens correct",
  computeCallCost("model-a", 500_000, 0, prices) === 0.5);
check("onbekend model geeft null",
  computeCallCost("model-onbekend", 1_000_000, 1_000_000, prices) === null);

const run = sumRunCost([
  { model: "model-a", promptTokens: 1000, completionTokens: 500, costEur: 0.002 },
  { model: "model-a", promptTokens: 2000, completionTokens: 1000, costEur: 0.005 },
  { model: "onbekend", promptTokens: 800, completionTokens: 200, costEur: null },
]);
check("run-totaal telt alleen geprijsde calls", run.totalEur === 0.007);
check("tokens tellen alle calls", run.tokens === 1500 + 3000 + 1000);
check("aantal calls en unpriced calls correct", run.calls === 3 && run.unpricedCalls === 1);

console.log("\nDatum-hardening");
const malformed = resolveTargets([
  { channel: "google_ads", metric: "cpa", targetValue: 20, validFrom: "niet-een-datum", validTo: null },
  { channel: "google_ads", metric: "roas", targetValue: 4, validFrom: "2026-01-01", validTo: null },
], "google_ads", "2026-03-01");
check("rij met ongeldige from wordt overgeslagen, geldige blijft", malformed.cpa === undefined && malformed.roas === 4);
check("ongeldige maand geeft lege targets", Object.keys(resolveTargets([{ channel: "google_ads", metric: "cpa", targetValue: 20, validFrom: "2026-01-01", validTo: null }], "google_ads", "kapot")).length === 0);
const ymOnly = resolveTargets([{ channel: "google_ads", metric: "cpa", targetValue: 20, validFrom: "2026-01", validTo: null }], "google_ads", "2026-03");
check("YYYY-MM formaat werkt", ymOnly.cpa === 20);

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
