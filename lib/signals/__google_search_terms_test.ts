// Test voor de broad-drift-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__google_search_terms_test.ts

import { detectBroadDrift, classifyMatchType, BROAD_MIN_CLICKS, BROAD_SHARE_RISE_PP, type SearchTermRow } from "./google-search-terms";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function term(month: string, matchType: string, cost: number, clicks: number, conversions: number): SearchTermRow {
  return { month, matchType, cost, clicks, conversions };
}

// ── De classificatie ──
assert(classifyMatchType("BROAD") === "broad" && classifyMatchType("broad") === "broad", "BROAD is broad, hoofdletterongevoelig");
assert(classifyMatchType("EXACT") === "gericht" && classifyMatchType("PHRASE") === "gericht", "exact en phrase zijn gericht");
assert(classifyMatchType("NEAR_EXACT") === "gericht" && classifyMatchType("NEAR_PHRASE") === "gericht", "NEAR_EXACT en NEAR_PHRASE zijn close variants van gerichte types, GEEN broad: ze meetellen als broad zou de drift structureel overdrijven");
assert(classifyMatchType("UNKNOWN") === "onbekend" && classifyMatchType("") === "onbekend" && classifyMatchType(null) === "onbekend", "niet toe te wijzen types vallen buiten beide kanten in plaats van gegokt te worden");

// ── Het volledige patroon: aandeel stijgt van 20 naar 40 procent, broad converteert half zo goed ──
const drift = [
  // vorige maand: broad 200 van 1000 kosten is 20 procent
  term("2026-05", "BROAD", 200, 200, 10),
  term("2026-05", "EXACT", 800, 800, 80),
  // huidige maand: broad 400 van 1000 is 40 procent; cvr broad 2,5 procent tegen 10 procent
  term("2026-06", "BROAD", 400, 400, 10),
  term("2026-06", "EXACT", 600, 600, 60),
];
const gevonden = detectBroadDrift({ rows: drift, periodMonth: "2026-06", prevMonth: "2026-05" });
assert(gevonden.triggered.length === 1, "een stijgend broad-aandeel met een achterblijvende conversieratio triggert");
const verhaal = gevonden.triggered[0];
assert(verhaal.story.includes("20%") && verhaal.story.includes("40%"), "het verhaal draagt het aandeel van beide maanden");
assert(verhaal.story.includes("dominante type"), "het verhaal benoemt de nuance: het match-type is het dominante type per term, geen eurogenauwe uitsplitsing");
assert(verhaal.actionDirection.includes("BEDOELD") && verhaal.actionDirection.includes("stuurloos"), "de actie stelt de VRAAG aan de specialist in plaats van broad uit te zetten");
assert(verhaal.certainty === "indicatie", "de zekerheid blijft indicatie: bedoelde prospecting ziet er in de data hetzelfde uit als een lek");
assert(verhaal.category === "zoektermen_intentie", "de categorie klopt met de bibliotheek");
assert(verhaal.evidence[0].prev != null && verhaal.evidence[1].prev != null, "het bewijs zet beide aandelen en beide conversieratio's naast elkaar");

// ── BEIDE voorwaarden zijn nodig ──
const alleenStijging = [
  term("2026-05", "BROAD", 200, 200, 20), term("2026-05", "EXACT", 800, 800, 80),
  term("2026-06", "BROAD", 400, 400, 40), term("2026-06", "EXACT", 600, 600, 60), // broad cvr 10 procent = gelijk
];
assert(detectBroadDrift({ rows: alleenStijging, periodMonth: "2026-06", prevMonth: "2026-05" }).triggered.length === 0, "een stijgend broad-aandeel dat NET ZO GOED converteert is geen drift maar een keuze die werkt");

const alleenSlecht = [
  term("2026-05", "BROAD", 400, 400, 10), term("2026-05", "EXACT", 600, 600, 60),
  term("2026-06", "BROAD", 400, 400, 10), term("2026-06", "EXACT", 600, 600, 60), // aandeel gelijk
];
assert(detectBroadDrift({ rows: alleenSlecht, periodMonth: "2026-06", prevMonth: "2026-05" }).triggered.length === 0, "een broad-aandeel dat slecht converteert maar NIET stijgt is geen DRIFT: dat is een bestaande situatie");

// ── De drempels ──
const kleineStijging = [
  term("2026-05", "BROAD", 300, 300, 5), term("2026-05", "EXACT", 700, 700, 70),
  term("2026-06", "BROAD", 320, 320, 5), term("2026-06", "EXACT", 680, 680, 68), // plus 2 procentpunt
];
assert(detectBroadDrift({ rows: kleineStijging, periodMonth: "2026-06", prevMonth: "2026-05" }).triggered.length === 0, `onder ${BROAD_SHARE_RISE_PP * 100} procentpunt stijging is het ruis`);

const broadKlein = [
  term("2026-05", "BROAD", 50, 20, 1), term("2026-05", "EXACT", 950, 950, 95),
  term("2026-06", "BROAD", 150, 60, 0), term("2026-06", "EXACT", 850, 850, 85),
];
assert(detectBroadDrift({ rows: broadKlein, periodMonth: "2026-06", prevMonth: "2026-05" }).triggered.length === 0, `onder ${BROAD_MIN_CLICKS} klikken op broad is de conversieratio ruis`);

// ── De maatstaf ──
const gerichtConverteertNiet = [
  term("2026-05", "BROAD", 200, 200, 0), term("2026-05", "EXACT", 800, 800, 0),
  term("2026-06", "BROAD", 400, 400, 0), term("2026-06", "EXACT", 600, 600, 0),
];
assert(detectBroadDrift({ rows: gerichtConverteertNiet, periodMonth: "2026-06", prevMonth: "2026-05" }).triggered.length === 0, "converteert de gerichte kant zelf niet, dan is er geen maatstaf en is dit een ander verhaal");

// ── Onbekende types vervuilen de aandelen niet ──
const metOnbekend = detectBroadDrift({
  rows: [...drift, term("2026-06", "UNKNOWN", 5000, 5000, 500)],
  periodMonth: "2026-06",
  prevMonth: "2026-05",
});
assert(metOnbekend.triggered.length === 1 && metOnbekend.triggered[0].story.includes("40%"), "een grote hoeveelheid niet-toewijsbare kosten verandert de aandelen niet: die vallen buiten beide kanten");

// ── De degradaties ──
assert(detectBroadDrift({ rows: [], periodMonth: "2026-06", prevMonth: "2026-05" }).triggered.length === 0, "een leeg account degradeert netjes");
assert(detectBroadDrift({ rows: [], periodMonth: "2026-06", prevMonth: "2026-05" }).checked.length === 1, "en meldt wel dat er gecontroleerd is");
const alleenNu = detectBroadDrift({ rows: [term("2026-06", "BROAD", 400, 400, 10), term("2026-06", "EXACT", 600, 600, 60)], periodMonth: "2026-06", prevMonth: "2026-05" });
assert(alleenNu.triggered.length === 0, "zonder vorige maand is er geen drift te meten, alleen een stand");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
