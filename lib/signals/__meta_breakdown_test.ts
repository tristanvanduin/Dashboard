// Test voor de Meta breakdown-efficiëntie-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__meta_breakdown_test.ts

import { buildMetaBreakdownSignals, type MetaBreakdownRow } from "./meta-breakdown";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const row = (breakdownType: string, breakdownValue: string, spend: number, conversions: number, impressions = 10000, clicks = 200): MetaBreakdownRow =>
  ({ breakdownType, breakdownValue, spend, conversions, impressions, clicks });

// ── Plaatsing-dimensie: audience_network draagt veel spend maar converteert slecht (waste),
//    facebook is efficiënt maar klein (schaalkans). Totaal-CPA ≈ 1400/40 = 35. ──
const rows: MetaBreakdownRow[] = [
  row("publisher_platform", "instagram", 800, 30),          // CPA 26.7 (draagt gros, ok)
  row("publisher_platform", "audience_network", 500, 4),    // CPA 125 (>2× gemiddelde, 36% spend) => waste
  row("publisher_platform", "facebook", 100, 6),            // CPA 16.7 (<0.6× gemiddelde, 7% spend) => schaalkans
];
const res = buildMetaBreakdownSignals(rows);
const waste = res.triggered.find((s) => s.id === "meta_breakdown_waste_publisher_platform");
const scale = res.triggered.find((s) => s.id === "meta_breakdown_scale_publisher_platform");

assert(waste !== undefined, "audience_network wordt als verspilling gemarkeerd");
assert(waste!.scope.includes("audience_network") && waste!.story.includes("verspilling"), "het waste-verhaal benoemt het segment");
assert(waste!.certainty === "bewezen_binnen_platform" && waste!.category === "budget_pacing", "waste is eigen-platform-rekenkunde, budget-categorie");
assert(scale !== undefined && scale!.scope.includes("facebook"), "facebook wordt als schaalkans gemarkeerd");
assert(scale!.certainty === "indicatie", "schaalkans is indicatie (houdt de CPA-voorsprong stand bij meer volume?)");

// ── Zero-conversie met materiële spend = verspilling (oneindige CPA) ──
const zeroRows: MetaBreakdownRow[] = [
  row("device_platform", "mobile", 900, 40),
  row("device_platform", "desktop", 300, 0), // 25% spend, 0 conversies => waste
];
const zeroRes = buildMetaBreakdownSignals(zeroRows);
const zeroWaste = zeroRes.triggered.find((s) => s.id === "meta_breakdown_waste_device_platform");
assert(zeroWaste !== undefined && zeroWaste!.story.includes("zonder conversies"), "een materieel segment zonder conversies is verspilling");

// ── Te weinig conversies over de dimensie: geen oordeel (geen valse precisie) ──
const thinRows: MetaBreakdownRow[] = [
  row("age", "25-34", 200, 3),
  row("age", "35-44", 200, 2),
];
const thinRes = buildMetaBreakdownSignals(thinRows);
assert(thinRes.triggered.length === 0, "onder de conversie-drempel per dimensie geen segment-oordeel");
assert(thinRes.checked.includes("meta_breakdown_age"), "de dimensie is wel expliciet gecontroleerd");

// ── Kleine spend valt onder de drempel: geen ruis ──
const tinyRows: MetaBreakdownRow[] = [
  row("publisher_platform", "instagram", 1000, 40),
  row("publisher_platform", "messenger", 20, 0), // onder BD_MIN_SEGMENT_SPEND
];
const tinyRes = buildMetaBreakdownSignals(tinyRows);
assert(tinyRes.triggered.find((s) => s.id === "meta_breakdown_waste_publisher_platform") === undefined, "een piepklein segment triggert geen waste");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
