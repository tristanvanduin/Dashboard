export {};
/**
 * Verify trend score logic using projectionFactor + lastRatio.
 * Run with: npx tsx lib/__tests__/health-trend.test.ts
 */

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeTrend(projectionFactor: number, lastRatio: number): {
  score: number;
  anomalies: string[];
} {
  const anomalies: string[] = [];

  let base: number;
  if (projectionFactor > 1.15) base = 18;
  else if (projectionFactor > 1.05) base = 16;
  else if (projectionFactor > 0.95) base = 12;
  else if (projectionFactor > 0.85) base = 8;
  else if (projectionFactor > 0.75) base = 4;
  else base = 2;

  const modifier = lastRatio >= 1.0 ? 2 : lastRatio >= 0.85 ? 0 : -2;
  const score = clamp(base + modifier, 0, 20);

  if (projectionFactor < 0.80 && lastRatio < 0.80) {
    anomalies.push("Sterke neerwaartse trend");
  } else if (projectionFactor < 0.90 && lastRatio < 0.90) {
    anomalies.push("Dalende trend");
  }

  return { score, anomalies };
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e: any) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

// ── Screenshot scenario: pf ~1.45, last month Mar 93% ──────────────
console.log("\n▸ Screenshot: projectionFactor 1.45, last ratio 0.93");
{
  const r = computeTrend(1.45, 0.93);
  test(`Score should be 18 (got ${r.score})`, () => assert(r.score === 18, `was ${r.score}`));
  test("No anomalies", () => assert(r.anomalies.length === 0, `got: ${r.anomalies}`));
}

// ── Strong overperformer, last month also great ─────────────────────
console.log("\n▸ pf 1.45, last ratio 1.20 (all months above expected)");
{
  const r = computeTrend(1.45, 1.20);
  test(`Score should be 20 (got ${r.score})`, () => assert(r.score === 20, `was ${r.score}`));
}

// ── On target, stable ───────────────────────────────────────────────
console.log("\n▸ pf 1.0, last ratio 1.02 (exactly on target)");
{
  const r = computeTrend(1.0, 1.02);
  test(`Score should be 14 (got ${r.score})`, () => assert(r.score === 14, `was ${r.score}`));
}

// ── Slightly declining, last month below ────────────────────────────
console.log("\n▸ pf 0.90, last ratio 0.85 (mild decline)");
{
  const r = computeTrend(0.90, 0.85);
  test(`Score should be 8 (got ${r.score})`, () => assert(r.score === 8, `was ${r.score}`));
}

// ── Severe decline ──────────────────────────────────────────────────
console.log("\n▸ pf 0.65, last ratio 0.55 (severe underperformance)");
{
  const r = computeTrend(0.65, 0.55);
  test(`Score should be 0 (got ${r.score})`, () => assert(r.score === 0, `was ${r.score}`));
  test("Critical anomaly fired", () => assert(r.anomalies.includes("Sterke neerwaartse trend"), `got: ${r.anomalies}`));
}

// ── Moderate decline ────────────────────────────────────────────────
console.log("\n▸ pf 0.88, last ratio 0.82 (moderate decline, warning zone)");
{
  const r = computeTrend(0.88, 0.82);
  test(`Score should be 6 (got ${r.score})`, () => assert(r.score === 6, `was ${r.score}`));
  test("Warning anomaly fired", () => assert(r.anomalies.includes("Dalende trend"), `got: ${r.anomalies}`));
}

// ── Recovering from bad ─────────────────────────────────────────────
console.log("\n▸ pf 0.80, last ratio 1.05 (last month turned around)");
{
  const r = computeTrend(0.80, 1.05);
  test(`Score should be 6 (got ${r.score})`, () => assert(r.score === 6, `was ${r.score}`));
  test("No anomaly (last month is good)", () => assert(r.anomalies.length === 0, `got: ${r.anomalies}`));
}

// ── Summary ─────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);