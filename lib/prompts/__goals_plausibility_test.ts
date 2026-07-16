// Test voor de additieve plausibiliteits-flag in buildGoalsSection (O2 4c, prompt-kant).
// Deterministisch, geen IO. Draaien: npx tsx lib/prompts/__goals_plausibility_test.ts

import { buildGoalsSection } from "./sop-prompts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const baseConfig = {
  cpaTarget: 40,
  roasTarget: 0,
  revenueMode: "absolute" as const,
  conversionsMode: "absolute" as const,
  revenueAbsolute: 0,
  revenueGrowthPct: 0,
  conversionsAbsolute: 120,
  conversionsGrowthPct: 0,
  accountType: "ecommerce_cpa" as const,
};

// Zonder flag: geen LET OP-regel (byte-identiek gedrag)
const zonder = buildGoalsSection(baseConfig);
assert(!zonder.includes("LET OP"), "zonder flag geen LET OP-regel");
assert(zonder.includes("CPA target: \u20ac40"), "de gewone CPA-target-regel staat er wel");

// Met de flag gezet: de herijkings-regel verschijnt met het detail
const met = buildGoalsSection({
  ...baseConfig,
  plausibility: { target_implausible: true, detail: "target 10, realisatie 137 en 124 in de laatste twee maanden" },
});
assert(met.includes("LET OP"), "met flag verschijnt de LET OP-regel");
assert(met.includes("target-herijking"), "de regel stuurt naar target-herijking");
assert(met.includes("137") && met.includes("124"), "het detail met de cijfers staat erin");
assert(met.includes("lees het niet als performance"), "de regel waarschuwt tegen procenten-theater");

// Flag expliciet false: geen LET OP-regel
const uit = buildGoalsSection({ ...baseConfig, plausibility: { target_implausible: false } });
assert(!uit.includes("LET OP"), "flag false geeft geen LET OP-regel");

// De flag zonder detail werkt ook (geen kapotte string)
const zonderDetail = buildGoalsSection({ ...baseConfig, plausibility: { target_implausible: true } });
assert(zonderDetail.includes("LET OP") && !zonderDetail.includes("()"), "flag zonder detail geeft geen lege haakjes");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
