// Test voor de netwerk-lek-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__google_network_test.ts

import { detectNetwerkLek, LEAK_MIN_CLICKS, MAX_LEAK_STORIES, type NetworkRow } from "./google-network";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function net(campaignName: string, networkType: string, cost: number, clicks: number, conversions: number): NetworkRow {
  return { campaignName, networkType, cost, clicks, conversions };
}

const geen = new Set<string>();

// Een zoekcampagne die goed converteert op search, maar lekt naar display.
const lek = [
  net("Search NL", "SEARCH", 800, 400, 40), // cvr 0,10
  net("Search NL", "CONTENT", 200, 200, 2), // cvr 0,01, kostenaandeel 20 procent
];

// ── Het volledige patroon ──
const gevonden = detectNetwerkLek(lek, geen);
assert(gevonden.triggered.length === 1, "een zoekcampagne met materiele display-kosten en een veel lagere conversieratio triggert");
const verhaal = gevonden.triggered[0];
assert(verhaal.scope === "Search NL op het display-netwerk", "de scope noemt de campagne en het netwerk in leesbare taal");
assert(verhaal.story.includes("20%") && verhaal.story.toLowerCase().includes("dezelfde advertenties"), "het verhaal draagt het kostenaandeel en legt uit waarom het verschil aan het netwerk ligt");
assert(verhaal.certainty === "bewezen_binnen_platform", "de zekerheid mag hier bewezen zijn: dezelfde advertenties en biedingen op een ander netwerk is een schone vergelijking");
assert(verhaal.actionDirection.includes("Display uit"), "de actie is netwerk-specifiek");
assert(verhaal.evidence[1].prev != null, "het bewijs zet de netwerk-conversieratio naast die van het zoeknetwerk");

// ── PMax wordt bewust overgeslagen ──
const pmaxLek = detectNetwerkLek(
  [net("PMax Alles", "SEARCH", 800, 400, 40), net("PMax Alles", "CONTENT", 200, 200, 2)],
  new Set(["PMax Alles"])
);
assert(pmaxLek.triggered.length === 0, "bij PMax HOORT het verkeer over meerdere netwerken te lopen: die campagnes vallen af");

// ── De drie voorwaarden ──
assert(detectNetwerkLek([net("A", "SEARCH", 900, 400, 40), net("A", "CONTENT", 50, 200, 2)], geen).triggered.length === 0, "onder tien procent kostenaandeel is het geen lek maar een randverschijnsel");
assert(detectNetwerkLek([net("A", "SEARCH", 800, 400, 40), net("A", "CONTENT", 200, LEAK_MIN_CLICKS - 1, 0)], geen).triggered.length === 0, `onder ${LEAK_MIN_CLICKS} klikken is de conversieratio van het netwerk ruis`);
assert(detectNetwerkLek([net("A", "SEARCH", 800, 400, 40), net("A", "CONTENT", 200, 200, 16)], geen).triggered.length === 0, "een conversieratio die maar twintig procent lager ligt is geen lek maar normale variatie");

// ── De maatstaf moet er zijn ──
assert(detectNetwerkLek([net("A", "CONTENT", 200, 200, 2)], geen).triggered.length === 0, "zonder zoeknetwerk in de campagne is er geen maatstaf binnen de campagne");
assert(detectNetwerkLek([net("A", "SEARCH", 800, 400, 0), net("A", "CONTENT", 200, 200, 2)], geen).triggered.length === 0, "converteert het zoeknetwerk zelf niet, dan is dat een ander verhaal dan een netwerk-lek");
assert(detectNetwerkLek([net("A", "SEARCH", 800, LEAK_MIN_CLICKS - 1, 5), net("A", "CONTENT", 200, 200, 2)], geen).triggered.length === 0, "een zoeknetwerk met te weinig klikken is geen betrouwbare maatstaf");

// ── Niet-toewijsbare netwerken ──
assert(detectNetwerkLek([net("A", "SEARCH", 800, 400, 40), net("A", "MIXED", 200, 200, 2)], geen).triggered.length === 0, "MIXED is niet toe te wijzen en dus geen basis voor een verhaal");
assert(detectNetwerkLek([net("A", "SEARCH", 800, 400, 40), net("A", "UNSPECIFIED", 200, 200, 2)], geen).triggered.length === 0, "UNSPECIFIED ook niet");

// ── Zoekpartners krijgen hun eigen advies ──
const partners = detectNetwerkLek([net("B", "SEARCH", 800, 400, 40), net("B", "SEARCH_PARTNERS", 200, 200, 2)], geen);
assert(partners.triggered[0].scope.includes("zoekpartners") && partners.triggered[0].actionDirection.includes("vinkje"), "zoekpartners kennen een andere oplossing dan display en krijgen die ook");

// ── De degradatie en de begrenzing ──
assert(detectNetwerkLek([], geen).triggered.length === 0 && detectNetwerkLek([], geen).checked.length === 1, "een leeg account degradeert netjes en meldt wel dat er gecontroleerd is");
const veel = detectNetwerkLek([
  net("A", "SEARCH", 800, 400, 40), net("A", "CONTENT", 200, 200, 2),
  net("B", "SEARCH", 800, 400, 40), net("B", "CONTENT", 500, 300, 3),
  net("C", "SEARCH", 800, 400, 40), net("C", "CONTENT", 300, 200, 2),
], geen);
assert(veel.triggered.length === MAX_LEAK_STORIES, "de sectie blijft leesbaar: maximaal twee lekken");
assert(veel.triggered[0].scope.startsWith("B"), "het duurste lek staat vooraan");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
