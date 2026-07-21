// Test voor de budget-concentratie-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__budget_concentration_test.ts

import { buildBudgetConcentrationSignals, type BudgetEntityRow } from "./budget-concentration";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
const opts = { channelLabel: "Meta", idPrefix: "meta_budget" };
const e = (name: string, spend: number, conversions: number): BudgetEntityRow => ({ name, spend, conversions });

// ── Concentratie in een onderpresteerder: 'Prospecting' draagt 60% maar CPA ver boven gemiddeld ──
// totaal 1000 spend / 25 conv => account-CPA 40. Prospecting 600/8 = 75 (1,9×), 60% share.
const under = buildBudgetConcentrationSignals([
  e("Prospecting", 600, 8),
  e("Retargeting", 250, 12),
  e("Lookalike", 150, 5),
], opts);
const w = under.triggered.find((s) => s.id === "meta_budget_concentratie_onderpresteerder");
assert(w !== undefined, "concentratie in een onderpresteerder wordt gemarkeerd");
assert(w!.scope === "Prospecting" && w!.story.includes("onderpresteerder"), "het verhaal benoemt de entiteit");
assert(w!.certainty === "bewezen_binnen_platform" && w!.category === "budget_pacing", "eigen-platform-rekenkunde, budget-categorie");

// ── Concentratierisico: één entiteit draagt >65% maar presteert prima (geen waste, wel risico) ──
// totaal 1000 / 40 => account-CPA 25. Hero 700/28 = 25 (op gemiddelde), 70% share.
const risk = buildBudgetConcentrationSignals([
  e("Hero", 700, 28),
  e("Support A", 180, 7),
  e("Support B", 120, 5),
], opts);
const r = risk.triggered.find((s) => s.id === "meta_budget_concentratie_risico");
assert(r !== undefined, "een efficiënte maar dominante entiteit is een concentratierisico");
assert(r!.certainty === "indicatie" && r!.story.includes("single-point-of-failure"), "risico is indicatie, geen efficiëntie-claim");
assert(under.triggered.find((s) => s.id === "meta_budget_concentratie_risico") === undefined, "waste en risico sluiten elkaar uit per run");

// ── Gezonde spreiding: geen signaal ──
const healthy = buildBudgetConcentrationSignals([
  e("A", 350, 14), e("B", 340, 13), e("C", 310, 13),
], opts);
assert(healthy.triggered.length === 0, "een gelijkmatige, efficiënte verdeling triggert niets");

// ── Te weinig entiteiten: geen oordeel ──
const few = buildBudgetConcentrationSignals([e("A", 800, 30), e("B", 200, 5)], opts);
assert(few.triggered.length === 0 && few.checked.includes("meta_budget_concentratie"), "onder 3 entiteiten geen concentratie-oordeel, wel gecontroleerd");

// ── Kanaal-label werkt door (LinkedIn) ──
const li = buildBudgetConcentrationSignals([e("Leadgen", 600, 8), e("Nurture", 250, 12), e("Brand", 150, 5)], { channelLabel: "LinkedIn", idPrefix: "linkedin_budget" });
assert(li.triggered[0]?.story.includes("LinkedIn") && li.triggered[0]?.id.startsWith("linkedin_budget"), "de detector is kanaal-agnostisch (LinkedIn-label + id)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
