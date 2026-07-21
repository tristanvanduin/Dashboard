// Test voor de weekday-efficiëntie-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__weekday_efficiency_test.ts

import { buildWeekdayEfficiencySignals, type WeekdayRow } from "./weekday-efficiency";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
const opts = { channelLabel: "Meta", idPrefix: "meta_budget" };

// 2026-02-01 is een zondag (getUTCDay 0). Bouw 8 weken data: elke dag €20 spend, 2 conversies,
// behalve zondag: €20 spend maar 0,5 conversie (dure dag).
const rows: WeekdayRow[] = [];
const start = Date.parse("2026-01-04"); // een zondag
for (let i = 0; i < 56; i++) {
  const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
  const wd = new Date(Date.parse(date)).getUTCDay();
  rows.push({ date, spend: 20, conversions: wd === 0 ? 0.5 : 2 });
}
const res = buildWeekdayEfficiencySignals(rows, opts);
const duur = res.triggered.find((s) => s.id === "meta_budget_weekday_duur");
assert(duur !== undefined, "de dure weekdag wordt gemarkeerd");
assert(duur!.scope.includes("zondag") && duur!.story.includes("structureel duur"), "het verhaal benoemt de dag (zondag)");
assert(duur!.certainty === "indicatie" && duur!.category === "budget_pacing", "schema-advies is een indicatie, budget-categorie");

// Gelijkmatige week: geen dure dag.
const flat: WeekdayRow[] = [];
for (let i = 0; i < 56; i++) {
  const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
  flat.push({ date, spend: 20, conversions: 2 });
}
assert(buildWeekdayEfficiencySignals(flat, opts).triggered.length === 0, "een gelijkmatige week triggert niets");

// Te weinig conversies: geen oordeel.
const thin: WeekdayRow[] = [{ date: "2026-01-05", spend: 50, conversions: 2 }, { date: "2026-01-06", spend: 50, conversions: 1 }];
const thinRes = buildWeekdayEfficiencySignals(thin, opts);
assert(thinRes.triggered.length === 0 && thinRes.checked.includes("meta_budget_weekday"), "onder de conversie-drempel geen oordeel, wel gecontroleerd");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
