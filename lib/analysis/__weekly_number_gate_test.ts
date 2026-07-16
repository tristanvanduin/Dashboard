// Test voor de W2.5 number-gate (weekly en biweekly). Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__weekly_number_gate_test.ts

import { extractGroundedNumbers, gateUngroundedNumbers, gateItemFields } from "./weekly-number-gate";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Gegronde cijfers extraheren ──
const grounded = extractGroundedNumbers("De CPA is 25 procent gestegen en de cost was €1200 deze week.");
assert(grounded.includes(25) && grounded.includes(1200), "percentages en euro's worden geextraheerd");
assert(!grounded.includes(1), "vensters of losse getallen zonder eenheid tellen niet");

// ── Ongegrond percentage wordt gemarkeerd en geschrapt ──
const g1 = gateUngroundedNumbers("Verlaag de CPA met 40%.", [25, 1200]);
assert(g1.hadUngrounded && g1.ungrounded.includes(40), "40% is niet toegestaan en wordt gemarkeerd");
assert(g1.text.includes("[percentage niet uit data]") && !g1.text.includes("40%"), "het ongegronde cijfer is vervangen");

// ── Gegrond percentage blijft staan ──
const g2 = gateUngroundedNumbers("De stijging van 25% zet door.", [25, 1200]);
assert(!g2.hadUngrounded && g2.text.includes("25%"), "een gegrond percentage blijft ongemoeid");

// ── Ongegrond eurobedrag ──
const g3 = gateUngroundedNumbers("Verhoog het budget met €500.", [25, 1200]);
assert(g3.hadUngrounded && g3.ungrounded.includes(500), "€500 is niet toegestaan");
assert(g3.text.includes("[bedrag niet uit data]") && !g3.text.includes("€500"), "het ongegronde bedrag is vervangen");

// ── Gegrond eurobedrag blijft ──
assert(!gateUngroundedNumbers("De cost van €1200 is hoog.", [25, 1200]).hadUngrounded, "een gegrond bedrag blijft staan");

// ── Vensters tellen niet als cijfer ──
assert(!gateUngroundedNumbers("Evalueer over 1-2 weken.", []).hadUngrounded, "een venster als 1-2 weken is geen ongegrond cijfer");

// ── Meerdere cijfers in een tekst ──
const g4 = gateUngroundedNumbers("Verlaag CPA met 40% en verhoog budget met €500.", [25]);
assert(g4.ungrounded.length === 2 && g4.ungrounded.includes(40) && g4.ungrounded.includes(500), "meerdere ongegronde cijfers worden alle gevangen");

// ── Toepassing op de velden van een aanbeveling ──
const rec = { handeling: "Verlaag CPA", doel: "Verlaag de CPA met 40%", meet_via: "CPA", risico: "Budget €500 lager", getal: 7 };
const res = gateItemFields(rec, ["handeling", "doel", "meet_via", "risico"], [25, 1200]);
assert(res.hadUngrounded && res.ungrounded.includes(40) && res.ungrounded.includes(500), "de gate vindt de ongegronde cijfers in de velden");
assert((res.item.doel as string).includes("[percentage niet uit data]"), "het doelveld is geschoond");
assert((res.item.risico as string).includes("[bedrag niet uit data]"), "het risicoveld is geschoond");
assert(res.item.getal === 7, "niet-string velden blijven ongemoeid");
assert(res.item.handeling === "Verlaag CPA", "een veld zonder cijfer blijft identiek");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
