export {};
// Verificatie: de mode-guard in buildFallbackStrategy verwijdert duplicaat-routes
// voor een vaste-mode cluster (search_budget_cap) dat over meerdere modes wordt gemapt.
// Draaien: npx tsx lib/analysis/__fallback_mode_test.ts

type Mode = "containment" | "recovery" | "validation";
type Strategy = { mode: Mode; action: string };

const BUDGET_ACTION = "Vergroot het budgetvenster van Campagne X alleen op rendabele uren";

// OUDE buildFallbackStrategy voor search_budget_cap: negeert de mode, retourneert altijd recovery.
function oldFallback(mode: Mode): Strategy | null {
  // (mode wordt genegeerd, exact de bug)
  return { mode: "recovery", action: BUDGET_ACTION };
}

// NIEUWE buildFallbackStrategy voor search_budget_cap: alleen voor de matchende mode.
function newFallback(mode: Mode): Strategy | null {
  if (mode !== "recovery") return null; // de toegevoegde guard
  return { mode: "recovery", action: BUDGET_ACTION };
}

// Replica van call-site 1 (regel 1346): map over modes, filter Boolean.
function callsiteMapFilter(fallback: (m: Mode) => Strategy | null, modes: Mode[]): Strategy[] {
  return modes.map(fallback).filter(Boolean) as Strategy[];
}

// Replica van call-site 2 (regel 2790): strategyByMode Map, set per mode als niet-null.
function callsiteByModeMap(fallback: (m: Mode) => Strategy | null, modes: Mode[]): Strategy[] {
  const byMode = new Map<Mode, Strategy>();
  for (const m of modes) {
    const s = fallback(m);
    if (s) byMode.set(m, s);
  }
  return Array.from(byMode.values());
}

function distinctActions(strategies: Strategy[]): number {
  return new Set(strategies.map((s) => s.action)).size;
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
}

// search_budget_cap is dual-route-eligible, dus de caller mapt over deze twee.
const dualModes: Mode[] = ["containment", "recovery"];

console.log("\n1. Call-site 1 (map + filter): de oude code geeft 2 identieke routes, de nieuwe 1");
{
  const oud = callsiteMapFilter(oldFallback, dualModes);
  const nieuw = callsiteMapFilter(newFallback, dualModes);
  console.log(`     oud: ${oud.length} strategieën, ${distinctActions(oud)} uniek | nieuw: ${nieuw.length} strategieën, ${distinctActions(nieuw)} uniek`);
  check("oud: 2 strategieën maar slechts 1 uniek (duplicaat-route)", oud.length === 2 && distinctActions(oud) === 1);
  check("nieuw: precies 1 strategie", nieuw.length === 1, `was ${nieuw.length}`);
  check("nieuw: geen duplicaat", distinctActions(nieuw) === nieuw.length);
}

console.log("\n2. Call-site 2 (strategyByMode Map): de oude code zet dezelfde actie onder twee mode-keys");
{
  const oud = callsiteByModeMap(oldFallback, dualModes);
  const nieuw = callsiteByModeMap(newFallback, dualModes);
  console.log(`     oud: ${oud.length} strategieën, ${distinctActions(oud)} uniek | nieuw: ${nieuw.length} strategieën, ${distinctActions(nieuw)} uniek`);
  check("oud: 2 map-entries met identieke actie (duplicaat onder containment- en recovery-key)", oud.length === 2 && distinctActions(oud) === 1);
  check("nieuw: 1 entry (containment-fallback was null en werd niet gezet)", nieuw.length === 1, `was ${nieuw.length}`);
}

console.log("\n3. De juiste strategie blijft behouden voor zijn eigen mode");
{
  const nieuw = callsiteMapFilter(newFallback, dualModes);
  check("de overgebleven strategie is de recovery-strategie", nieuw[0]?.mode === "recovery" && nieuw[0]?.action === BUDGET_ACTION);
}

console.log("\n4. Met alleen de recovery-mode (single-route cluster) blijft gedrag identiek");
{
  const oud = callsiteMapFilter(oldFallback, ["recovery"]);
  const nieuw = callsiteMapFilter(newFallback, ["recovery"]);
  check("oud en nieuw geven beide 1 recovery-strategie", oud.length === 1 && nieuw.length === 1 && oud[0].action === nieuw[0].action);
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald`);
console.log("Kernpunt: een vaste-mode cluster levert nu zijn strategie alleen voor de matchende mode, dus mappen over modes geeft geen identieke duplicaat-routes meer.\n");
if (failed > 0) process.exit(1);