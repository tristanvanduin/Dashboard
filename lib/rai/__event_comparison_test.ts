// Test voor de RAI-comparison-laag (R1). Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__event_comparison_test.ts

import { selectPoints, availableGeoClones, previousEditionFor, weekOverWeekTempo, buildEventComparison, type RaiEdition, type RaiDataPoint } from "./event-comparison";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Beurs "ISE" met twee geo-clones (Amsterdam jaarlijks, Barcelona tweejaarlijks).
const editions: RaiEdition[] = [
  { editionId: "ise-ams-2024", fairId: "ise", geoClone: "amsterdam", cadence: "annual", campaignStartDate: "2024-03-01", fairStartDate: "2024-04-15", fairEndDate: "2024-04-17" },
  { editionId: "ise-ams-2025", fairId: "ise", geoClone: "amsterdam", cadence: "annual", campaignStartDate: "2025-03-01", fairStartDate: "2025-04-15", fairEndDate: "2025-04-17" },
  { editionId: "ise-ams-2026", fairId: "ise", geoClone: "amsterdam", cadence: "annual", campaignStartDate: "2026-03-01", fairStartDate: "2026-04-15", fairEndDate: "2026-04-17" },
  { editionId: "ise-bcn-2024", fairId: "ise", geoClone: "barcelona", cadence: "biennial", campaignStartDate: "2024-03-01", fairStartDate: "2024-04-16", fairEndDate: "2024-04-18" },
  { editionId: "ise-bcn-2026", fairId: "ise", geoClone: "barcelona", cadence: "biennial", campaignStartDate: "2026-03-01", fairStartDate: "2026-04-16", fairEndDate: "2026-04-18" },
];

// ── Cadans-bewuste vorige editie ──
// Amsterdam 2026 (jaarlijks): vorige is 2025.
const prevAms = previousEditionFor(editions, "ise-ams-2026");
assert(prevAms.edition?.editionId === "ise-ams-2025", "jaarlijkse beurs pakt de editie van vorig jaar");
assert(prevAms.gapDays === 365 && prevAms.cadenceMatches, "de gap is een jaar en past bij de jaarlijkse cadans");
// Barcelona 2026 (tweejaarlijks): vorige is 2024, NIET aannemen dat er een 2025 is.
const prevBcn = previousEditionFor(editions, "ise-bcn-2026");
assert(prevBcn.edition?.editionId === "ise-bcn-2024", "tweejaarlijkse beurs pakt de editie van twee jaar terug");
assert(prevBcn.gapDays === 730 && prevBcn.cadenceMatches, "de gap is twee jaar en past bij de tweejaarlijkse cadans");
// Amsterdam 2024: geen eerdere editie.
assert(previousEditionFor(editions, "ise-ams-2024").edition === null, "de eerste editie heeft geen voorganger");
// Geo-clones worden niet door elkaar gehaald: Barcelona pakt geen Amsterdam-editie.
assert(prevBcn.edition?.geoClone === "barcelona", "de vorige editie komt uit dezelfde geo-clone");

// ── Geo-clone plus stream filter ──
const points: RaiDataPoint[] = [
  { date: "2026-03-31", value: 30, geoClone: "amsterdam", stream: "registraties", editionId: "ise-ams-2026" },
  { date: "2026-03-31", value: 5, geoClone: "amsterdam", stream: "exposanten", editionId: "ise-ams-2026" },
  { date: "2026-03-31", value: 12, geoClone: "barcelona", stream: "registraties", editionId: "ise-bcn-2026" },
  { date: "2026-03-31", value: 99, geoClone: "amsterdam", stream: "onbekend", editionId: "ise-ams-2026" },
];
assert(selectPoints(points, { geoClone: "amsterdam", stream: "registraties" }).length === 1, "de filter isoleert een geo-clone en stream");
assert(selectPoints(points, { geoClone: "amsterdam" }).length === 3, "filteren op alleen geo-clone houdt alle streams van die clone");
assert(selectPoints(points, { stream: "onbekend" })[0].value === 99, "ongetagde stream is apart selecteerbaar, niet stil bij een stream");
assert(availableGeoClones(points).join(",") === "amsterdam,barcelona", "de beschikbare geo-clones voor de filter-opties");

// ── Week-over-week tempo ──
const ams2026 = editions.find((e) => e.editionId === "ise-ams-2026")!;
// Punten op verschillende weken-tot-beurs. Beurs 15 april 2026.
const wowPoints: RaiDataPoint[] = [
  { date: "2026-03-18", value: 10, geoClone: "amsterdam", stream: "registraties", editionId: "ise-ams-2026" }, // D-28, week 4
  { date: "2026-03-25", value: 20, geoClone: "amsterdam", stream: "registraties", editionId: "ise-ams-2026" }, // D-21, week 3
  { date: "2026-04-01", value: 40, geoClone: "amsterdam", stream: "registraties", editionId: "ise-ams-2026" }, // D-14, week 2
];
// Vandaag 8 april (D-7, week 1). Complete weken zijn 2, 3, 4. Meest recent = week 2 (40), ervoor week 3 (20).
const wow = weekOverWeekTempo(wowPoints, ams2026, "2026-04-08");
assert(wow.recentWeek?.weeksToFair === 2 && wow.recentWeek?.increment === 40, "de meest recente complete week is week 2 met 40");
assert(wow.priorWeek?.weeksToFair === 3 && wow.priorWeek?.increment === 20, "de week ervoor is week 3 met 20");
assert(wow.wowDeltaPct !== null && Math.abs(wow.wowDeltaPct - 1.0) < 1e-9, "week-over-week is plus 100 procent (40 versus 20)");

// De lopende week wordt uitgesloten: op D-14 (week 2, nog lopend) is week 2 geen complete week.
const wowLopend = weekOverWeekTempo(wowPoints, ams2026, "2026-04-01");
assert(wowLopend.recentWeek?.weeksToFair === 3, "op D-14 is week 2 nog lopend, dus week 3 is de meest recente complete week");

// ── Samengestelde event-comparison per aftakking ──
const cmp = buildEventComparison({
  allPoints: [
    ...wowPoints,
    { date: "2025-03-25", value: 15, geoClone: "amsterdam", stream: "registraties", editionId: "ise-ams-2025" }, // D-21 vorig jaar
    { date: "2025-03-18", value: 10, geoClone: "amsterdam", stream: "registraties", editionId: "ise-ams-2025" }, // D-28 vorig jaar
  ],
  editions,
  currentEditionId: "ise-ams-2026",
  geoClone: "amsterdam",
  stream: "registraties",
  asOfDate: "2026-03-25", // D-21
});
assert(cmp.editionOverEdition.comparable, "de editie-over-editie is vergelijkbaar (zelfde venster)");
assert(cmp.previousEditionGapDays === 365, "de vorige editie ligt een jaar terug");
// Tot D-21 dit jaar: 10 (D-28) plus 20 (D-21) = 30. Vorig jaar tot D-21: 10 plus 15 = 25.
assert(cmp.editionOverEdition.currentCumulative === 30 && cmp.editionOverEdition.previousCumulativeAtSameDaysOut === 25, "editie-over-editie cumulatief tot D-21 klopt voor beide jaren");
assert(cmp.stream === "registraties" && cmp.geoClone === "amsterdam", "de vergelijking is gescoped op de juiste aftakking en stream");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
