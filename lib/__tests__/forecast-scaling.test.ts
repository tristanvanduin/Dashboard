/**
 * Test: scaling/limited-data clients should use efficiency-based forecasting.
 * Run with: npx tsx lib/__tests__/forecast-scaling.test.ts
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

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e: any) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

// ── Scenario: Client started mid-2025, scaling up ───────────────────────
console.log("\n▸ Scaling client (started Jul 2025, ramping spend + conversions)");
{
  // 2024: no data
  const emptyYear = Array.from({ length: 12 }, (_, i) =>
    makeMonth(i + 1, 0, 0, 0)
  );

  // 2025: started in July, scaling up. CPA stays around €40-45 (good efficiency)
  const scalingYear: MonthlyRecord[] = [
    makeMonth(1, 0, 0, 0),
    makeMonth(2, 0, 0, 0),
    makeMonth(3, 0, 0, 0),
    makeMonth(4, 0, 0, 0),
    makeMonth(5, 0, 0, 0),
    makeMonth(6, 0, 0, 0),
    makeMonth(7, 10, 1500, 500),     // Just started: 10 conv, €500 spend, CPA=€50
    makeMonth(8, 25, 3750, 1100),    // Scaling: CPA=€44
    makeMonth(9, 45, 6750, 1900),    // More scaling: CPA=€42
    makeMonth(10, 65, 9750, 2800),   // CPA=€43
    makeMonth(11, 80, 12000, 3500),  // CPA=€44
    makeMonth(12, 95, 14250, 4000),  // CPA=€42
  ];

  // 2026 Q1: continuing to scale
  const data: ClientHistoricalData = {
    clientId: "test-scaling",
    targetCurrentYear: { conversions: 2000, revenue: 300000, adSpend: 84000 },
    historicalYears: {
      2024: emptyYear,
      2025: scalingYear,
    },
    currentYearData: [
      makeMonth(1, 110, 16500, 5000),   // Jan: CPA=€45, scale continues
      makeMonth(2, 130, 19500, 5800),   // Feb: CPA=€45
      makeMonth(3, 150, 22500, 6500),   // Mar: CPA=€43
      null, null, null, null, null, null, null, null, null,
    ],
    currentYear: 2026,
  };

  const result = computeForecast(data);

  console.log("  Data maturity:", {
    isScaling: result.dataMaturity.isScaling,
    isMature: result.dataMaturity.isMature,
    totalActiveMonths: result.dataMaturity.totalActiveMonths,
    recentEfficiency: result.dataMaturity.recentEfficiency.toFixed(1),
    efficiencyTrend: result.dataMaturity.efficiencyTrend.toFixed(3),
  });
  console.log("  Conversions forecast:", result.conversions.kpi.adjustedAnnual);
  console.log("  projectionFactor:", result.conversions.kpi.projectionFactor.toFixed(3));

  test("Should detect scaling phase", () =>
    assert(result.dataMaturity.isScaling, "expected isScaling=true")
  );
  // 6 months in 2025 + 3 months in 2026 = 9 active months = exactly at mature threshold
  test("Should be at/near maturity threshold (9 months)", () =>
    assert(result.dataMaturity.totalActiveMonths === 9, `was ${result.dataMaturity.totalActiveMonths}`)
  );
  test("Efficiency trend should be stable/positive (~1.0)", () =>
    assert(result.dataMaturity.efficiencyTrend > 0.85 && result.dataMaturity.efficiencyTrend < 1.25,
      `was ${result.dataMaturity.efficiencyTrend.toFixed(3)}`)
  );
  test("Forecast should be reasonable (not wildly skewed by growth curve)", () => {
    const annual = result.conversions.kpi.adjustedAnnual;
    assert(annual > 1000 && annual < 4000,
      `was ${annual}, expected 1000-4000 range for a scaling client with target 2000`);
  });
  test("Forecast should not be NaN or Infinity", () =>
    assert(isFinite(result.conversions.kpi.adjustedAnnual), "was not finite")
  );
}

// ── Scenario: Mature client (full 2 years of data) ──────────────────────
console.log("\n▸ Mature client (full 2024 + 2025, stable spend)");
{
  const stableYear = (base: number) => Array.from({ length: 12 }, (_, i) =>
    makeMonth(i + 1, base + Math.round(base * 0.1 * Math.sin(i)), base * 150, base * 25)
  );

  const data: ClientHistoricalData = {
    clientId: "test-mature",
    targetCurrentYear: { conversions: 4000, revenue: 600000, adSpend: 100000 },
    historicalYears: {
      2024: stableYear(300),
      2025: stableYear(330),
    },
    currentYearData: [
      makeMonth(1, 340, 51000, 8500),
      makeMonth(2, 350, 52500, 8700),
      makeMonth(3, 360, 54000, 9000),
      null, null, null, null, null, null, null, null, null,
    ],
    currentYear: 2026,
  };

  const result = computeForecast(data);

  console.log("  Data maturity:", {
    isScaling: result.dataMaturity.isScaling,
    isMature: result.dataMaturity.isMature,
    totalActiveMonths: result.dataMaturity.totalActiveMonths,
  });

  test("Should NOT detect scaling (stable spend)", () =>
    assert(!result.dataMaturity.isScaling, "expected isScaling=false")
  );
  test("Should detect mature data", () =>
    assert(result.dataMaturity.isMature, "expected isMature=true")
  );
}

// ── Scenario: Scaling client with declining efficiency ───────────────────
console.log("\n▸ Scaling with worsening CPA (efficiency declining)");
{
  const emptyYear = Array.from({ length: 12 }, (_, i) => makeMonth(i + 1, 0, 0, 0));

  const badScaling: MonthlyRecord[] = [
    ...Array.from({ length: 6 }, (_, i) => makeMonth(i + 1, 0, 0, 0)),
    makeMonth(7, 30, 4500, 900),     // CPA=€30
    makeMonth(8, 35, 5250, 1400),    // CPA=€40
    makeMonth(9, 38, 5700, 2000),    // CPA=€53 — getting worse
    makeMonth(10, 40, 6000, 2800),   // CPA=€70 — much worse
    makeMonth(11, 42, 6300, 3500),   // CPA=€83 — terrible
    makeMonth(12, 44, 6600, 4000),   // CPA=€91
  ];

  const data: ClientHistoricalData = {
    clientId: "test-bad-scaling",
    targetCurrentYear: { conversions: 1500, revenue: 225000, adSpend: 72000 },
    historicalYears: {
      2024: emptyYear,
      2025: badScaling,
    },
    currentYearData: [
      makeMonth(1, 45, 6750, 4500),   // CPA=€100
      makeMonth(2, 46, 6900, 5000),   // CPA=€109
      makeMonth(3, 48, 7200, 5500),   // CPA=€115
      null, null, null, null, null, null, null, null, null,
    ],
    currentYear: 2026,
  };

  const result = computeForecast(data);

  console.log("  Efficiency trend:", result.dataMaturity.efficiencyTrend.toFixed(3));
  console.log("  Recent efficiency:", result.dataMaturity.recentEfficiency.toFixed(1), "conv/€1000");

  test("Should detect scaling", () =>
    assert(result.dataMaturity.isScaling, "expected isScaling=true")
  );
  test("Efficiency trend should be declining (<0.85)", () =>
    assert(result.dataMaturity.efficiencyTrend < 0.85,
      `was ${result.dataMaturity.efficiencyTrend.toFixed(3)}`)
  );
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
