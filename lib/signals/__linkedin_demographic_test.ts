// Test voor de LinkedIn demografie-segment-efficiëntie-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__linkedin_demographic_test.ts

import { buildLinkedInDemographicSignals, type LinkedInDemographicRow } from "./linkedin-demographic";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const row = (dimension: string, value: string, spend: number, leads: number): LinkedInDemographicRow =>
  ({ dimension, value, spend, leads });

// ── Functie-dimensie: 'sales' draagt veel budget maar dure leads (waste); 'marketing' efficiënt
//    en klein (schaalkans). Totaal 1400 spend / 40 leads => CPL 35. ──
const rows: LinkedInDemographicRow[] = [
  row("functie", "engineering", 800, 30),  // CPL 26.7
  row("functie", "sales", 500, 4),          // CPL 125 (>2×, 36% spend) => waste
  row("functie", "marketing", 100, 6),      // CPL 16.7 (<0.6×, 7% spend) => schaalkans
];
const res = buildLinkedInDemographicSignals(rows);
const waste = res.triggered.find((s) => s.id === "linkedin_demographic_waste_functie");
const scale = res.triggered.find((s) => s.id === "linkedin_demographic_scale_functie");

assert(waste !== undefined && waste!.scope.includes("sales"), "'sales' wordt als dure verspilling gemarkeerd");
assert(waste!.story.includes("CPL") && waste!.story.includes("verspilling"), "het waste-verhaal benoemt CPL en verspilling");
assert(waste!.certainty === "bewezen_binnen_platform" && waste!.category === "budget_pacing", "eigen-platform-rekenkunde, budget-categorie");
assert(scale !== undefined && scale!.scope.includes("marketing") && scale!.certainty === "indicatie", "'marketing' is een schaalkans (indicatie)");

// ── Zero-lead segment met materiële spend = verspilling ──
const zeroRows: LinkedInDemographicRow[] = [
  row("seniority", "senior", 900, 40),
  row("seniority", "entry", 300, 0), // 25% spend, 0 leads => waste
];
const zeroRes = buildLinkedInDemographicSignals(zeroRows);
const zeroWaste = zeroRes.triggered.find((s) => s.id === "linkedin_demographic_waste_seniority");
assert(zeroWaste !== undefined && zeroWaste!.story.includes("zonder leads"), "materiële spend zonder leads is verspilling");

// ── Te weinig leads over de dimensie: geen oordeel ──
const thinRows: LinkedInDemographicRow[] = [
  row("industrie", "software", 200, 3),
  row("industrie", "finance", 200, 2),
];
const thinRes = buildLinkedInDemographicSignals(thinRows);
assert(thinRes.triggered.length === 0, "onder de lead-drempel per dimensie geen segment-oordeel");
assert(thinRes.checked.includes("linkedin_demographic_industrie"), "de dimensie is wel expliciet gecontroleerd");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
