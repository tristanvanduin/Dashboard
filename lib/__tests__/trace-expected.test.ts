/**
 * Trace the exact expected value calculation for a client with limited historical data.
 *
 * Scenario from Google Ads screenshot:
 * - 2024: No data (client didn't exist)
 * - 2025: ~1,013 total conversions, mostly in second half of year
 * - Jan 2025: 2 conv, Feb: 0, Mar: 5, Apr: 3, May: 8, Jun: 12
 * - Jul: 50, Aug: 80, Sep: 120, Oct: 180, Nov: 250, Dec: 303
 * - Target 2026: 3,699 (user-set)
 * - 2026 realized: Jan 270, Feb 183, Mar 168
 *
 * Question: How does the forecast engine compute "expected" for January?
 * And does a 241% ratio make sense?
 *
 * Run: npx tsx lib/__tests__/trace-expected.test.ts
 */
import { computeForecast } from "../forecast";
import type { ClientHistoricalData, MonthlyRecord } from "../types";

function makeMonth(month: number, conv: number, rev: number, spend: number): MonthlyRecord {
  const weeks = Array.from({ length: 4 }, (_, i) => ({
    week: i + 1, month,
    conversions: Math.round(conv / 4),
    revenue: Math.round(rev / 4),
    adSpend: Math.round(spend / 4),
  }));
  return { month, conversions: conv, revenue: rev, adSpend: spend, weeks };
}

// 2024: No data
const data2024: MonthlyRecord[] = Array.from({ length: 12 }, (_, i) =>
  makeMonth(i + 1, 0, 0, 0)
);

// 2025: Sparse start, ramping up (matches Google Ads screenshot pattern)
const data2025: MonthlyRecord[] = [
  makeMonth(1, 2, 300, 150),       // Jan: just 2 conversions
  makeMonth(2, 0, 0, 80),          // Feb: nothing
  makeMonth(3, 5, 750, 200),       // Mar: barely anything
  makeMonth(4, 3, 450, 180),
  makeMonth(5, 8, 1200, 350),
  makeMonth(6, 12, 1800, 500),
  makeMonth(7, 50, 7500, 1500),    // Starting to pick up
  makeMonth(8, 80, 12000, 2200),
  makeMonth(9, 120, 18000, 3000),
  makeMonth(10, 180, 27000, 4500),
  makeMonth(11, 250, 37500, 5500),
  makeMonth(12, 303, 45450, 6000),  // Total: ~1013 conv
];

const clientData: ClientHistoricalData = {
  clientId: "trace-test",
  targetCurrentYear: { conversions: 3699, revenue: 555000, adSpend: 90000 },
  historicalYears: {
    2024: data2024,
    2025: data2025,
  },
  currentYearData: [
    makeMonth(1, 270, 40500, 7000),   // Jan: 270 conversions
    makeMonth(2, 183, 27450, 6800),   // Feb: 183 conversions
    makeMonth(3, 168, 25200, 7200),   // Mar: 168 conversions
    null, null, null, null, null, null, null, null, null,
  ],
  currentYear: 2026,
};

const result = computeForecast(clientData);

console.log("═══════════════════════════════════════════════════");
console.log("DATA MATURITY");
console.log("═══════════════════════════════════════════════════");
console.log("  isScaling:", result.dataMaturity.isScaling);
console.log("  isMature:", result.dataMaturity.isMature);
console.log("  totalActiveMonths:", result.dataMaturity.totalActiveMonths);
console.log("  recentEfficiency:", result.dataMaturity.recentEfficiency.toFixed(1), "conv/€1000");
console.log("  efficiencyTrend:", result.dataMaturity.efficiencyTrend.toFixed(3));

console.log("\n═══════════════════════════════════════════════════");
console.log("CONVERSIONS — MONTHLY EXPECTED vs REALIZED");
console.log("═══════════════════════════════════════════════════");
console.log("  Month | Expected | Realized/Forecast | Ratio");
console.log("  ------+----------+-------------------+------");

for (const pt of result.conversions.points) {
  const value = pt.realized ?? pt.forecast ?? 0;
  const type = pt.realized !== null ? "REAL" : "FORE";
  console.log(
    `  ${pt.monthLabel.padEnd(4)} | ${String(pt.expected).padStart(8)} | ${String(value).padStart(5)} (${type})       | ${(pt.monthRatio * 100).toFixed(0)}%`
  );
}

console.log("\n  Annual target:", result.conversions.kpi.annualTarget);
console.log("  Adjusted annual:", result.conversions.kpi.adjustedAnnual);
console.log("  projectionFactor:", result.conversions.kpi.projectionFactor.toFixed(3));
console.log("  YTD realized:", result.conversions.kpi.ytdRealized);
console.log("  YTD expected:", result.conversions.kpi.ytdExpected);

console.log("\n═══════════════════════════════════════════════════");
console.log("AD SPEND — MONTHLY EXPECTED vs REALIZED");
console.log("═══════════════════════════════════════════════════");
for (const pt of result.adSpend.points) {
  const value = pt.realized ?? pt.forecast ?? 0;
  const type = pt.realized !== null ? "REAL" : "FORE";
  console.log(
    `  ${pt.monthLabel.padEnd(4)} | ${String(pt.expected).padStart(8)} | ${String(value).padStart(7)} (${type})     | ${(pt.monthRatio * 100).toFixed(0)}%`
  );
}

console.log("\n═══════════════════════════════════════════════════");
console.log("ANALYSIS: Does this make sense?");
console.log("═══════════════════════════════════════════════════");

const janExpected = result.conversions.points[0].expected;
const janRealized = result.conversions.points[0].realized;
const janRatio = result.conversions.points[0].monthRatio;

console.log(`\n  Jan expected: ${janExpected}`);
console.log(`  Jan realized: ${janRealized}`);
console.log(`  Jan ratio: ${(janRatio * 100).toFixed(1)}%`);

if (janExpected < 20) {
  console.log("\n  ⚠️  PROBLEM: January expected is unrealistically low!");
  console.log("  The engine is using Jan 2025 (2 conv) as the basis,");
  console.log("  but the client was barely active then. This creates");
  console.log("  inflated ratios that don't reflect real performance.");
}

const totalExpected = result.conversions.points.reduce((s, p) => s + p.expected, 0);
console.log(`\n  Sum of monthly expected: ${totalExpected} (should ≈ target ${clientData.targetCurrentYear.conversions})`);

// Check distribution: are expected values wildly uneven?
const expectedValues = result.conversions.points.map(p => p.expected);
const maxExp = Math.max(...expectedValues);
const minExp = Math.min(...expectedValues);
console.log(`  Expected range: ${minExp} – ${maxExp} (${(maxExp/Math.max(minExp,1)).toFixed(1)}x spread)`);

if (maxExp / Math.max(minExp, 1) > 10) {
  console.log("  ⚠️  PROBLEM: Extremely uneven distribution of expected values!");
  console.log("  Some months have very low expected (from sparse history),");
  console.log("  creating meaningless ratios.");
}
