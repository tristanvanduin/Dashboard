/**
 * Test: current-year tracking break should NOT destroy the forecast.
 *
 * Run with: npx tsx lib/__tests__/forecast-fallbacks.test.ts
 */
import { computeForecast } from "../forecast";
import type { ClientHistoricalData, MonthlyRecord } from "../types";

function makeMonth(month: number, conv: number, rev: number, spend: number): MonthlyRecord {
  const weeks = Array.from({ length: 4 }, (_, i) => ({
    week: i + 1,
    month,
    conversions: Math.round(conv / 4),
    revenue: Math.round(rev / 4),
    adSpend: Math.round(spend / 4),
  }));
  return { month, conversions: conv, revenue: rev, adSpend: spend, weeks };
}

function makeYear(base: { conv: number; rev: number; spend: number }): MonthlyRecord[] {
  return Array.from({ length: 12 }, (_, i) =>
    makeMonth(i + 1, base.conv, base.rev, base.spend)
  );
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`  ✓ ${msg}`);
    passed++;
  }
}

// ── Test 1: Tracking break in current year ──────────────────────────────
console.log("\n▸ Test 1: Tracking break in March should not destroy forecast");
{
  const data: ClientHistoricalData = {
    clientId: "test-tracking-break",
    targetCurrentYear: { conversions: 5000, revenue: 750000, adSpend: 120000 },
    historicalYears: {
      2024: makeYear({ conv: 350, rev: 52500, spend: 8500 }),
      2025: makeYear({ conv: 400, rev: 60000, spend: 10000 }),
    },
    currentYearData: [
      makeMonth(1, 420, 63000, 10500),   // Jan: healthy
      makeMonth(2, 410, 61500, 10200),   // Feb: healthy
      makeMonth(3, 12, 1800, 10000),     // Mar: TRACKING BREAK
      null, null, null, null, null, null, null, null, null,
    ],
    currentYear: 2026,
  };

  const result = computeForecast(data);
  const convForecast = result.conversions.kpi.adjustedAnnual;
  const factor = result.conversions.kpi.projectionFactor;

  console.log(`  Annual conversions forecast: ${convForecast} (target: 5000)`);
  console.log(`  Performance factor: ${factor.toFixed(3)}`);

  assert(convForecast > 3000, `Forecast ${convForecast} should be > 3000 (not catastrophically low)`);
  assert(factor > 0.7, `Factor ${factor.toFixed(3)} should be > 0.7 (not dragged down by bad month)`);
  assert(factor < 1.5, `Factor ${factor.toFixed(3)} should be < 1.5 (not unreasonably high)`);
}

// ── Test 2: Completely empty historical data ────────────────────────────
console.log("\n▸ Test 2: No historical data at all");
{
  const data: ClientHistoricalData = {
    clientId: "test-no-history",
    targetCurrentYear: { conversions: 1000, revenue: 150000, adSpend: 30000 },
    historicalYears: {
      2024: makeYear({ conv: 0, rev: 0, spend: 0 }),
      2025: makeYear({ conv: 0, rev: 0, spend: 0 }),
    },
    currentYearData: [null, null, null, null, null, null, null, null, null, null, null, null],
    currentYear: 2026,
  };

  const result = computeForecast(data);

  assert(
    result.conversions.kpi.adjustedAnnual > 0,
    `Forecast ${result.conversions.kpi.adjustedAnnual} should be > 0`
  );
  assert(
    isFinite(result.conversions.kpi.adjustedAnnual),
    "Conversions forecast should be finite"
  );
  assert(isFinite(result.revenue.kpi.adjustedAnnual), "Revenue forecast should be finite");
  assert(isFinite(result.roas.kpi.adjustedAnnual), "ROAS forecast should be finite");
}

// ── Test 3: Zero targets with historical data ───────────────────────────
console.log("\n▸ Test 3: Zero targets → should derive from history");
{
  const data: ClientHistoricalData = {
    clientId: "test-zero-target",
    targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
    historicalYears: {
      2024: makeYear({ conv: 300, rev: 45000, spend: 8000 }),
      2025: makeYear({ conv: 350, rev: 52500, spend: 9000 }),
    },
    currentYearData: [
      makeMonth(1, 360, 54000, 9200),
      null, null, null, null, null, null, null, null, null, null, null,
    ],
    currentYear: 2026,
  };

  const result = computeForecast(data);

  assert(
    result.conversions.kpi.annualTarget > 0,
    `Target ${result.conversions.kpi.annualTarget} should be derived from history (> 0)`
  );
  assert(isFinite(result.conversions.kpi.adjustedAnnual), "Forecast should be finite");
}

// ── Test 4: NaN and negative values ─────────────────────────────────────
console.log("\n▸ Test 4: NaN, Infinity, and negative values in data");
{
  const badYear: MonthlyRecord[] = Array.from({ length: 12 }, (_, i) =>
    makeMonth(i + 1, i === 3 ? NaN : 300, i === 5 ? -5000 : 45000, i === 7 ? Infinity : 8000)
  );

  const data: ClientHistoricalData = {
    clientId: "test-bad-values",
    targetCurrentYear: { conversions: 4000, revenue: 600000, adSpend: 100000 },
    historicalYears: {
      2024: badYear,
      2025: makeYear({ conv: 350, rev: 52500, spend: 9000 }),
    },
    currentYearData: [
      makeMonth(1, 370, 55000, 9500),
      null, null, null, null, null, null, null, null, null, null, null,
    ],
    currentYear: 2026,
  };

  const result = computeForecast(data);

  assert(isFinite(result.conversions.kpi.adjustedAnnual), "Conversions should be finite");
  assert(isFinite(result.revenue.kpi.adjustedAnnual), "Revenue should be finite");
  assert(isFinite(result.cpa.kpi.adjustedAnnual), "CPA should be finite");
  assert(isFinite(result.roas.kpi.adjustedAnnual), "ROAS should be finite");
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
