// Test voor de winner-starves-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__google_budget_test.ts

import { detectWinnerStarves, STARVED_BUDGET_LOST, MIN_CONVERSIONS_FOR_CPA, type StarveCampaignInput } from "./google-budget";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function camp(o: Partial<StarveCampaignInput> & { campaignName: string }): StarveCampaignInput {
  return { cost: 1000, prevCost: 1000, conversions: 50, prevConversions: 50, budgetLostIs: 0, ...o };
}

// De norm: drie campagnes op CPA 20, dus de mediaan is 20.
const norm = [
  camp({ campaignName: "Norm A" }),
  camp({ campaignName: "Norm B" }),
  camp({ campaignName: "Norm C" }),
];
// De winnaar: CPA 10 (efficient), 25 procent budget-verlies, spend vlak.
const winnaar = camp({ campaignName: "Winnaar", cost: 1000, conversions: 100, budgetLostIs: 0.25 });
// De groeier: CPA 40 (duur), spend plus 50 procent.
const groeier = camp({ campaignName: "Groeier", cost: 1500, prevCost: 1000, conversions: 37 });

// ── Het volledige patroon ──
const gevonden = detectWinnerStarves([...norm, winnaar, groeier]);
assert(gevonden.triggered.length === 1, "het volledige patroon triggert: een geknepen winnaar naast een duurdere groeier");
const verhaal = gevonden.triggered[0];
assert(verhaal.scope.includes("Winnaar") && verhaal.scope.includes("Groeier"), "de scope noemt beide kanten van de verdringing");
assert(verhaal.story.includes("account-mediaan") && verhaal.story.includes("budgetplafond"), "het verhaal legt de efficientie en de rem uit");
assert(verhaal.story.includes("niet te zien"), "het verhaal is eerlijk over wat het NIET weet: of de campagnes een budget delen blijkt niet uit de data");
assert(verhaal.certainty === "indicatie", "de zekerheid blijft indicatie, want de budgetstructuur en de intentie zijn onbekend");
assert(verhaal.category === "budget_pacing", "de categorie klopt met de bibliotheek");
assert(verhaal.evidence.length === 4, "het bewijs draagt beide CPA's, de budget-rem en de spend-verschuiving");
assert(verhaal.actionDirection.includes("bewuste keuze"), "de actie vraagt of de verschuiving besloten was: dat is de accountability-vraag");

// ── Beide kanten zijn nodig ──
assert(detectWinnerStarves([...norm, winnaar]).triggered.length === 0, "een geknepen winnaar zonder groeier is geen verdringing maar gewoon een budget-advies");
assert(detectWinnerStarves([...norm, groeier]).triggered.length === 0, "een groeier zonder geknepen winnaar is geen verdringing");

// ── De voorwaarden per kant ──
assert(detectWinnerStarves([...norm, camp({ campaignName: "Winnaar", cost: 1000, conversions: 100, budgetLostIs: 0.05 }), groeier]).triggered.length === 0, `onder ${STARVED_BUDGET_LOST} budget-verlies is de winnaar niet geknepen`);
assert(detectWinnerStarves([...norm, camp({ campaignName: "Gegroeid", cost: 2000, prevCost: 1000, conversions: 200, budgetLostIs: 0.25 }), groeier]).triggered.length === 0, "een efficiente campagne die WEL groeide is geen slachtoffer: die kreeg juist geld");
assert(detectWinnerStarves([...norm, winnaar, camp({ campaignName: "Duur maar vlak", cost: 1000, prevCost: 1000, conversions: 25 })]).triggered.length === 0, "een dure campagne die niet groeide nam niets weg");
assert(detectWinnerStarves([...norm, winnaar, camp({ campaignName: "Efficient gegroeid", cost: 1500, prevCost: 1000, conversions: 150 })]).triggered.length === 0, "een groeier die EFFICIENTER is dan de mediaan is geen probleem: daar hoort het geld heen");

// ── De conversie-drempel ──
const ruis = detectWinnerStarves([
  ...norm,
  camp({ campaignName: "Piepklein", cost: 100, conversions: 5, budgetLostIs: 0.9 }), // CPA 20 op 5 conversies
  groeier,
]);
assert(!ruis.triggered.some((t) => t.scope.includes("Piepklein")), `onder ${MIN_CONVERSIONS_FOR_CPA} conversies telt een campagne niet mee: een CPA op 5 conversies is ruis`);

// ── De degradatie ──
assert(detectWinnerStarves([]).triggered.length === 0 && detectWinnerStarves([]).checked.length === 1, "een leeg account degradeert netjes en meldt wel dat er gecontroleerd is");
assert(detectWinnerStarves([winnaar]).triggered.length === 0, "met een campagne is er geen mediaan en geen verdringing");

// ── De keuze bij meerdere kandidaten ──
const meerdere = detectWinnerStarves([
  ...norm,
  camp({ campaignName: "Licht geknepen", cost: 1000, conversions: 100, budgetLostIs: 0.12 }),
  camp({ campaignName: "Zwaar geknepen", cost: 1000, conversions: 100, budgetLostIs: 0.4 }),
  camp({ campaignName: "Kleine groeier", cost: 1200, prevCost: 1000, conversions: 30 }),
  camp({ campaignName: "Grote groeier", cost: 2000, prevCost: 1000, conversions: 40 }),
]);
assert(meerdere.triggered[0].scope === "Zwaar geknepen tegenover Grote groeier", "bij meerdere kandidaten wint de grootste budget-rem tegen de grootste stijging: die verklaren samen het meeste");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
