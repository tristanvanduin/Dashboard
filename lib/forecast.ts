/**
 * Forecast engine v3
 *
 * Methodology:
 *
 * 1. EXPECTED per month = gewogen gemiddelde van dezelfde maand over voorgaande jaren
 *    - 3 jaar beschikbaar: 50% vorig jaar, 30% jaar daarvoor, 20% twee jaar daarvoor
 *    - 2 jaar: 65% / 35%
 *    - 1 jaar: 100%
 *    - Maanden zonder data worden overgeslagen (niet als 0 geteld)
 *
 * 2. PERFORMANCE FACTOR per metric (conversions, revenue, adSpend elk apart)
 *    - Per gerealiseerde maand: ratio = realized / expected
 *    - Gewogen gemiddelde: recentste maand weegt 2x zo zwaar als eerste
 *    - Dit vangt trend op (stijgend vs dalend)
 *
 * 3. SPEND-ADJUSTED EFFICIENCY
 *    - Als spend 85% van verwacht is maar conversies 90%: efficiency = 90/85 = 105.9%
 *    - Forecast conversies = expected_conv × spend_factor × efficiency_factor
 *    - Dit scheidt budget-effect van campagne-prestatie
 *
 * 4. BUDGET RECOMMENDATION
 *    - Als we achterlopen op target: bereken hoeveel extra spend nodig is
 *    - Op basis van huidige CPA efficiency
 *
 * 5. WEEKLY granularity
 *    - Gerealiseerde weken als individuele datapunten
 *    - Prognose verdeeld over weken op basis van historisch weekpatroon
 */

import {
  ClientHistoricalData,
  MonthlyRecord,
  WeeklyRecord,
  REALIZED_THROUGH_MONTH,
} from "./types";

export const MONTH_LABELS = [
  "Jan", "Feb", "Mrt", "Apr", "Mei", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dec",
];

export type ForecastMetric = "conversions" | "revenue" | "roas" | "cpa";
type CoreMetric = "conversions" | "revenue" | "adSpend";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeeklyPoint {
  month: number;
  week: number;
  label: string;         // "W1 Jan", "W2 Jan", etc.
  expected: number;
  realized: number | null;
  forecast: number | null;
}

export interface ForecastPoint {
  month: number;
  monthLabel: string;
  expected: number;
  realized: number | null;
  forecast: number | null;
  monthRatio: number;
}

export interface ForecastKPI {
  annualTarget: number;
  ytdRealized: number;
  ytdExpected: number;
  adjustedAnnual: number;
  diffPct: number;
  performanceRatio: number;
  monthlyRatios: number[];
  /** The weighted performance factor used for projections */
  projectionFactor: number;
  /** Ondergrens van de jaarprognose (adjustedAnnual − onzekerheid). */
  forecastLow: number;
  /** Bovengrens van de jaarprognose (adjustedAnnual + onzekerheid). */
  forecastHigh: number;
  /** Bandbreedte als fractie van de puntprognose; hoger = onzekerder. */
  forecastSpreadPct: number;
}

/**
 * Onzekerheidsband op de jaarprognose. De gerealiseerde maanden laten zien hoe volatiel de
 * account presteert t.o.v. verwacht (de spreiding van realized/expected); die volatiliteit
 * projecteren we op de nog te realiseren maanden. Zonder deze band suggereert één getal een
 * valse precisie. Puur en los getest.
 * @param realizedRatios de realized/expected-ratio per al gerealiseerde maand
 * @param futureExpectedSum som van de verwachte waarde over de nog te projecteren maanden
 * @param adjustedAnnual de puntprognose voor het jaar
 */
export function computeConfidenceBand(realizedRatios: number[], futureExpectedSum: number, adjustedAnnual: number): { low: number; high: number; spreadPct: number } {
  if (realizedRatios.length < 2 || futureExpectedSum <= 0 || adjustedAnnual <= 0) {
    // Te weinig historie voor een betekenisvolle spreiding: geen band (0-breedte).
    return { low: adjustedAnnual, high: adjustedAnnual, spreadPct: 0 };
  }
  const mean = realizedRatios.reduce((s, r) => s + r, 0) / realizedRatios.length;
  const variance = realizedRatios.reduce((s, r) => s + (r - mean) ** 2, 0) / realizedRatios.length;
  const stdev = Math.sqrt(variance);
  // De onzekerheid zit alleen op de toekomst; het gerealiseerde deel staat vast.
  const halfBand = stdev * futureExpectedSum;
  const low = Math.max(0, Math.round(adjustedAnnual - halfBand));
  const high = Math.round(adjustedAnnual + halfBand);
  return { low, high, spreadPct: Math.round((halfBand / adjustedAnnual) * 1000) / 10 };
}

export interface BudgetRecommendation {
  /** Are we behind target? */
  behindTarget: boolean;
  /** Gap in conversions to close */
  conversionGap: number;
  /** Current realized CPA */
  currentCpa: number;
  /** Extra spend needed to close the gap */
  extraSpendNeeded: number;
  /** Required monthly spend for remaining months to hit target */
  requiredMonthlySpend: number;
  /** Current planned monthly spend */
  currentMonthlySpend: number;
  /** % increase in spend needed */
  spendIncreasePct: number;
  /** CPA-doel (voor de mix/efficiëntie-reconciliatie); null als niet ingesteld. */
  cpaTarget: number | null;
  /**
   * true als de achterstand primair een EFFICIËNTIE-kwestie is, geen budgetkwestie: het account
   * ligt achter op doel én de huidige CPA ligt materieel boven het CPA-doel. Meer budget koopt dan
   * dure conversies; eerst herverdelen/CVR verbeteren is de juiste zet. Voorkomt dat de tool
   * zichzelf tegenspreekt ("+X% budget" terwijl efficiency de bottleneck is).
   */
  efficiencyBottleneck: boolean;
}

export interface ForecastResult {
  metric: ForecastMetric;
  points: ForecastPoint[];
  weeklyPoints: WeeklyPoint[];
  kpi: ForecastKPI;
}

export interface ClientForecast {
  conversions: ForecastResult;
  revenue: ForecastResult;
  adSpend: ForecastResult;
  roas: ForecastResult;
  cpa: ForecastResult;
  budgetRecommendation: BudgetRecommendation;
  /** Data maturity analysis — exposes whether this is a scaling/limited-data client */
  dataMaturity: DataMaturity;
}

// ── Fallback & data quality constants ───────────────────────────────────────

/** Performance factor is clamped to this range to prevent runaway projections */
const PERF_FACTOR_MIN = 0.3;
const PERF_FACTOR_MAX = 3.0;

/** Monthly values that deviate more than this from the median are flagged as outliers */
const OUTLIER_THRESHOLD = 3.0; // 3× median absolute deviation

/** Minimum realized months before we trust the trend (below this, blend toward 1.0) */
const MIN_CONFIDENT_MONTHS = 2;

/** If a month drops below this fraction of the median, it's likely a tracking break */
const TRACKING_BREAK_FLOOR = 0.1; // 10% of median = probable tracking failure

/** Max acceptable YoY swing before we suspect data issues */
const MAX_YOY_SWING = 5.0; // 500% change between years

/**
 * Current-year anomaly detection: if a realized month deviates more than this
 * factor from expected, it's excluded from performance factor calculation.
 * e.g., 0.15 means: if realized < 15% of expected, flag as anomaly.
 */
const CURRENT_YEAR_ANOMALY_FLOOR = 0.15;
const CURRENT_YEAR_ANOMALY_CEIL = 8.0;

/**
 * Minimum FULL YEARS of data to consider "mature".
 * A scaling client with 6 months in 2025 + 3 months in 2026 = 9 months,
 * but none of those are a complete year — the historical pattern is unreliable.
 * We need at least one full calendar year of data to trust month-by-month patterns.
 */
const MATURE_MIN_FULL_YEARS = 1;

/**
 * Maximum acceptable spread (max/min) in expected values.
 * If the spread exceeds this, the monthly distribution is unreliable
 * and we should fall back to efficiency-based or uniform distribution.
 */
const MAX_EXPECTED_SPREAD = 8;

/**
 * If spend increases by more than this factor from first active month to last,
 * the account is considered to be in a scaling phase.
 * e.g., 2.0 means: if last month spend ≥ 2× first month spend → scaling.
 */
const SCALING_SPEND_FACTOR = 2.0;

// ── Data sanitization ──────────────────────────────────────────────────────

/** Sanitize a single numeric value: NaN, Infinity, and negatives become 0 */
function sanitizeValue(v: number): number {
  if (typeof v !== "number" || !isFinite(v) || v < 0) return 0;
  return v;
}

/** Sanitize an entire MonthlyRecord in-place */
function sanitizeMonth(r: MonthlyRecord): MonthlyRecord {
  return {
    ...r,
    conversions: sanitizeValue(r.conversions),
    revenue: sanitizeValue(r.revenue),
    adSpend: sanitizeValue(r.adSpend),
    weeks: r.weeks.map((w) => ({
      ...w,
      conversions: sanitizeValue(w.conversions),
      revenue: sanitizeValue(w.revenue),
      adSpend: sanitizeValue(w.adSpend),
    })),
  };
}

/** Sanitize an entire year of data */
function sanitizeYear(records: MonthlyRecord[]): MonthlyRecord[] {
  return records.map(sanitizeMonth);
}

/** Sanitize current year data (nullable months) */
function sanitizeCurrentYear(records: (MonthlyRecord | null)[]): (MonthlyRecord | null)[] {
  return records.map((r) => (r !== null ? sanitizeMonth(r) : null));
}

// ── Outlier & tracking break detection ─────────────────────────────────────

/** Compute median of an array of positive numbers */
function median(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Detect and repair outliers / tracking breaks in a year of data for one metric.
 * - Tracking breaks (sudden drop to near-zero) → replaced with median
 * - Efficiency anomalies (conversions crash but spend stable) → replaced with estimate
 * - Extreme spikes (> OUTLIER_THRESHOLD × MAD) → capped at threshold
 * Returns a repaired copy; original is not mutated.
 */
function repairOutliers(records: MonthlyRecord[], metric: CoreMetric): MonthlyRecord[] {
  const values = records.map((r) => r[metric]);
  const positiveValues = values.filter((v) => v > 0);
  if (positiveValues.length < 3) return records; // not enough data to judge

  const med = median(positiveValues);
  const mad = median(positiveValues.map((v) => Math.abs(v - med))) || med * 0.5;

  // For conversions: also detect efficiency anomalies (conv crashes but spend stable)
  // This catches tracking breaks where conversions don't drop to exactly 0
  let convPerSpendMedian = 0;
  if (metric === "conversions") {
    const efficiencies = records
      .filter((r) => r.conversions > 0 && r.adSpend > 0)
      .map((r) => r.conversions / r.adSpend);
    if (efficiencies.length >= 3) {
      convPerSpendMedian = median(efficiencies);
    }
  }

  return records.map((r) => {
    const v = r[metric];
    if (v === 0) return r; // genuinely no data, don't "repair" zeros

    // Tracking break: value suddenly drops to <10% of median
    if (v > 0 && v < med * TRACKING_BREAK_FLOOR && med > 0) {
      return { ...r, [metric]: Math.round(med) };
    }

    // Efficiency anomaly: conversions dropped disproportionately vs spend
    // If conv/spend ratio is <20% of the median ratio, likely tracking issue
    if (metric === "conversions" && convPerSpendMedian > 0 && r.adSpend > 0) {
      const currentEfficiency = r.conversions / r.adSpend;
      if (currentEfficiency < convPerSpendMedian * 0.2 && r.conversions < med * 0.5) {
        // Estimate what conversions should be based on historical efficiency
        const estimated = Math.round(r.adSpend * convPerSpendMedian);
        return { ...r, conversions: estimated };
      }
    }

    // Extreme spike: more than OUTLIER_THRESHOLD × MAD from median
    if (mad > 0 && Math.abs(v - med) > OUTLIER_THRESHOLD * mad) {
      const capped = v > med
        ? Math.round(med + OUTLIER_THRESHOLD * mad)
        : Math.round(Math.max(med - OUTLIER_THRESHOLD * mad, 0));
      return { ...r, [metric]: capped };
    }

    return r;
  });
}

/**
 * Detect excessive YoY swings that suggest data issues rather than real growth.
 * If year-over-year total changes by more than MAX_YOY_SWING, dampen the newer year
 * toward the older year's level.
 */
function dampenYoYSwing(
  olderYear: MonthlyRecord[],
  newerYear: MonthlyRecord[],
  metric: CoreMetric
): MonthlyRecord[] {
  const olderTotal = olderYear.reduce((s, r) => s + r[metric], 0);
  const newerTotal = newerYear.reduce((s, r) => s + r[metric], 0);

  if (olderTotal === 0 || newerTotal === 0) return newerYear;

  const ratio = newerTotal / olderTotal;
  if (ratio > MAX_YOY_SWING || ratio < 1 / MAX_YOY_SWING) {
    // Dampen: blend newer year 50% toward what a reasonable growth would look like
    const reasonableTotal = ratio > 1
      ? olderTotal * MAX_YOY_SWING
      : olderTotal / MAX_YOY_SWING;
    const scale = (reasonableTotal / newerTotal + 1) / 2; // 50% blend
    return newerYear.map((r) => ({
      ...r,
      [metric]: Math.round(r[metric] * scale),
    }));
  }

  return newerYear;
}

// ── Scaling / limited data detection ───────────────────────────────────────

interface DataMaturity {
  /** Is the account in a scaling phase (spend ramping up)? */
  isScaling: boolean;
  /** Total months with data across all historical years */
  totalActiveMonths: number;
  /** Does the client have mature (≥9 months) historical data? */
  isMature: boolean;
  /** Average efficiency (conversions per €1000 spend) from recent active months */
  recentEfficiency: number;
  /** Efficiency trend: >1 = improving, <1 = declining */
  efficiencyTrend: number;
}

/**
 * Analyze whether a client is in a scaling/growth phase vs having mature data.
 * Combines all available historical years + current year realized data.
 */
function analyzeDataMaturity(
  years: MonthlyRecord[][],
  currentYear: (MonthlyRecord | null)[]
): DataMaturity {
  // Collect all months with spend data, in chronological order
  const allMonths: { conversions: number; adSpend: number }[] = [];
  for (const year of years) {
    for (const m of year) {
      if (m.adSpend > 0) {
        allMonths.push({ conversions: m.conversions, adSpend: m.adSpend });
      }
    }
  }
  for (const m of currentYear) {
    if (m !== null && m.adSpend > 0) {
      allMonths.push({ conversions: m.conversions, adSpend: m.adSpend });
    }
  }

  const totalActiveMonths = allMonths.length;

  // Count full years: a year is "full" if it has ≥10 months with MEANINGFUL data.
  // "Meaningful" = the month's spend is at least 25% of that year's average month.
  // This prevents counting a year where Jan had €80 and Dec had €6000 as "full".
  let fullYears = 0;
  for (const year of years) {
    const activeMonths = year.filter((m) => m.adSpend > 0);
    if (activeMonths.length < 10) continue;
    const avgSpend = activeMonths.reduce((s, m) => s + m.adSpend, 0) / activeMonths.length;
    const meaningfulMonths = activeMonths.filter((m) => m.adSpend >= avgSpend * 0.25).length;
    if (meaningfulMonths >= 10) fullYears++;
  }
  const isMature = fullYears >= MATURE_MIN_FULL_YEARS;

  if (totalActiveMonths < 3) {
    return { isScaling: false, totalActiveMonths, isMature, recentEfficiency: 0, efficiencyTrend: 1 };
  }

  // Detect scaling: is spend on a consistent upward trajectory?
  const firstThird = allMonths.slice(0, Math.ceil(totalActiveMonths / 3));
  const lastThird = allMonths.slice(-Math.ceil(totalActiveMonths / 3));
  const avgSpendFirst = firstThird.reduce((s, m) => s + m.adSpend, 0) / firstThird.length;
  const avgSpendLast = lastThird.reduce((s, m) => s + m.adSpend, 0) / lastThird.length;
  const isScaling = avgSpendFirst > 0 && avgSpendLast / avgSpendFirst >= SCALING_SPEND_FACTOR;

  // Compute efficiency (conversions per €1000 spend) for recent months
  const recentMonths = allMonths.slice(-Math.min(6, totalActiveMonths));
  const recentTotalConv = recentMonths.reduce((s, m) => s + m.conversions, 0);
  const recentTotalSpend = recentMonths.reduce((s, m) => s + m.adSpend, 0);
  const recentEfficiency = recentTotalSpend > 0 ? (recentTotalConv / recentTotalSpend) * 1000 : 0;

  // Efficiency trend: compare first half vs second half of recent months
  const halfIdx = Math.floor(recentMonths.length / 2);
  const firstHalf = recentMonths.slice(0, halfIdx);
  const secondHalf = recentMonths.slice(halfIdx);

  const effFirst = firstHalf.reduce((s, m) => s + m.adSpend, 0) > 0
    ? (firstHalf.reduce((s, m) => s + m.conversions, 0) / firstHalf.reduce((s, m) => s + m.adSpend, 0)) * 1000
    : 0;
  const effSecond = secondHalf.reduce((s, m) => s + m.adSpend, 0) > 0
    ? (secondHalf.reduce((s, m) => s + m.conversions, 0) / secondHalf.reduce((s, m) => s + m.adSpend, 0)) * 1000
    : 0;
  const efficiencyTrend = effFirst > 0 ? effSecond / effFirst : 1;

  return { isScaling, totalActiveMonths, isMature, recentEfficiency, efficiencyTrend };
}

/**
 * For scaling/limited-data clients: build expected values based on efficiency × spend
 * instead of raw historical conversion patterns.
 *
 * Logic: "if we spend X in this month, at our current efficiency rate, we'll get Y conversions"
 * This avoids treating the growth curve as seasonality.
 */
function computeEfficiencyBasedExpected(
  spendExpected: number[],      // expected monthly ad spend
  recentEfficiency: number,     // conversions per €1000 spend
  efficiencyTrend: number       // >1 = improving
): number[] {
  // Slight trend adjustment per month: if efficiency is improving, later months benefit
  return spendExpected.map((spend, m) => {
    // Apply a gradual efficiency trend over the year
    // Month 0 = current efficiency, Month 11 = efficiency × trend
    const monthTrendFactor = 1 + ((efficiencyTrend - 1) * (m / 11));
    const adjustedEfficiency = recentEfficiency * monthTrendFactor;
    return Math.round((spend / 1000) * adjustedEfficiency);
  });
}

// ── Cross-metric consistency checks ────────────────────────────────────────

/**
 * Check for inconsistencies: revenue without conversions, or conversions without revenue.
 * If one metric is zero for a month but the other isn't, we assume tracking issues
 * and zero out both to avoid distorted ratios.
 */
function enforceMetricConsistency(records: MonthlyRecord[]): MonthlyRecord[] {
  return records.map((r) => {
    // Revenue without conversions is suspicious (likely tracking gap)
    if (r.revenue > 0 && r.conversions === 0) {
      return { ...r, revenue: 0 };
    }
    // Conversions without any revenue in an e-commerce context could be valid (leads),
    // so we don't zero that out — but we flag it via the consistency check
    return r;
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Count months with actual data (value > 0) */
function monthsWithData(records: MonthlyRecord[], metric: CoreMetric): number {
  return records.filter((r) => r[metric] > 0).length;
}

/** Get the value for a specific month, or 0 if no data */
function monthValue(records: MonthlyRecord[], monthIdx: number, metric: CoreMetric): number {
  return records[monthIdx]?.[metric] ?? 0;
}

// ── Step 1: Expected per month via weighted year-over-year average ────────

/**
 * Compute expected value per month using weighted average of historical years.
 * Supports N years of data — exponential decay weighting ensures recent years
 * count most, but older years still contribute to seasonal pattern detection.
 *
 * Weighting: most recent year = 50%, then exponentially decaying.
 * 1yr:  [1.00]
 * 2yr:  [0.35, 0.65]
 * 3yr:  [0.15, 0.30, 0.55]
 * 4yr:  [0.08, 0.15, 0.27, 0.50]
 * 5yr:  [0.05, 0.09, 0.16, 0.28, 0.42]
 * ...etc — older data still helps detect seasonal patterns.
 */
function computeMonthlyExpected(
  years: MonthlyRecord[][], // oldest first: [4 years ago, 3 years ago, ..., 1 year ago]
  metric: CoreMetric
): number[] {
  const nYears = years.length;
  if (nYears === 0) return new Array(12).fill(0);

  // Generate exponential weights: each year gets ~1.8× the weight of the year before it
  const DECAY_FACTOR = 1.8;
  const rawWeights = years.map((_, i) => Math.pow(DECAY_FACTOR, i));
  const rawTotal = rawWeights.reduce((s, w) => s + w, 0);
  const yearWeights = rawWeights.map((w) => w / rawTotal);

  const relevantYears = years;

  // Adjust weights based on data completeness per year
  const adjustedWeights = yearWeights.map((baseW, yi) => {
    const nMonths = monthsWithData(relevantYears[yi], metric);
    // Scale: 12 months = full weight, < 4 months = 0 weight
    const completeness = Math.max(0, Math.min(1, (nMonths - 3) / 9));
    return baseW * completeness;
  });

  // Normalize
  const totalW = adjustedWeights.reduce((s, w) => s + w, 0);
  const normWeights = totalW > 0
    ? adjustedWeights.map((w) => w / totalW)
    : adjustedWeights.map(() => 1 / nYears); // fallback: equal weights

  // Compute expected per month
  const expected: number[] = [];
  for (let m = 0; m < 12; m++) {
    let value = 0;
    let usedWeight = 0;

    for (let yi = 0; yi < relevantYears.length; yi++) {
      const mv = monthValue(relevantYears[yi], m, metric);
      if (mv > 0) {
        value += normWeights[yi] * mv;
        usedWeight += normWeights[yi];
      }
    }

    if (usedWeight > 0) {
      // Normalize by the weight actually used (not total weight)
      expected.push(Math.round(value / usedWeight));
    } else {
      // No historical data for this month — return 0, will be filled later
      expected.push(0);
    }
  }

  return expected;
}

// ── Step 2: Performance factor — weighted by recency ─────────────────────

/**
 * Compute a weighted performance factor from realized months.
 * More recent months weigh heavier (exponential: last month = 2x first month).
 * Returns 1.0 if no realized data.
 *
 * CRITICAL: Detects anomalous realized months (likely tracking breaks) and
 * excludes them from the calculation. A single corrupted month would otherwise
 * drag down / inflate the entire forecast for the remaining 9 months.
 */
function computePerformanceFactor(
  realized: (number | null)[],
  expected: number[],
  realizedThroughMonth: number
): number {
  if (realizedThroughMonth === 0) return 1.0;

  // First pass: collect all ratios to detect anomalies
  const allRatios: { m: number; ratio: number }[] = [];
  for (let m = 0; m < realizedThroughMonth; m++) {
    const real = realized[m];
    const exp = expected[m];
    if (real !== null && exp > 0) {
      allRatios.push({ m, ratio: real / exp });
    }
  }

  if (allRatios.length === 0) return 1.0;

  // Detect anomalous months: ratio far outside normal band
  // If we have ≥2 months, use the other months to judge what's "normal"
  const healthyRatios: { ratio: number; weight: number }[] = [];

  if (allRatios.length >= 2) {
    const ratioValues = allRatios.map((r) => r.ratio);
    const medianRatio = median(ratioValues);

    for (const { m, ratio } of allRatios) {
      // Flag: ratio is suspiciously low (tracking break) or high (data spike)
      const isAnomaly =
        (medianRatio > 0 && ratio < medianRatio * CURRENT_YEAR_ANOMALY_FLOOR) ||
        (medianRatio > 0 && ratio > medianRatio * CURRENT_YEAR_ANOMALY_CEIL);

      if (!isAnomaly) {
        const weight = Math.pow(2, m / Math.max(realizedThroughMonth - 1, 1));
        healthyRatios.push({ ratio, weight });
      }
    }
  }

  // If anomaly detection removed ALL months, or we only have 1 month,
  // fall through to using all ratios (clamped later anyway)
  const ratios = healthyRatios.length > 0
    ? healthyRatios
    : allRatios.map(({ m, ratio }) => ({
        ratio,
        weight: Math.pow(2, m / Math.max(realizedThroughMonth - 1, 1)),
      }));

  const totalWeight = ratios.reduce((s, r) => s + r.weight, 0);
  let raw = ratios.reduce((s, r) => s + r.ratio * r.weight, 0) / totalWeight;

  // Blend toward 1.0 when we have too few months to trust the trend
  const effectiveMonths = healthyRatios.length > 0 ? healthyRatios.length : allRatios.length;
  if (effectiveMonths < MIN_CONFIDENT_MONTHS) {
    const confidence = effectiveMonths / MIN_CONFIDENT_MONTHS;
    raw = raw * confidence + 1.0 * (1 - confidence);
  }

  // Clamp to prevent runaway projections from bad data
  return Math.max(PERF_FACTOR_MIN, Math.min(PERF_FACTOR_MAX, raw));
}

// ── Step 3: Weekly distribution from historical data ─────────────────────

function computeWeeklyDistribution(
  years: MonthlyRecord[][],
  monthIdx: number,
  metric: CoreMetric
): number[] {
  // Use most recent year with data for this month's weekly pattern
  for (let yi = years.length - 1; yi >= 0; yi--) {
    const month = years[yi][monthIdx];
    if (month && month[metric] > 0 && month.weeks.length > 0) {
      const total = month.weeks.reduce((s, w) => s + w[metric], 0);
      if (total > 0) {
        return month.weeks.map((w) => w[metric] / total);
      }
    }
  }
  // Fallback: even distribution
  const nWeeks = [0, 2, 4, 6, 7, 9, 11].includes(monthIdx) ? 5 : 4;
  return new Array(nWeeks).fill(1 / nWeeks);
}

function getWeeksInMonth(years: MonthlyRecord[][], monthIdx: number): number {
  // Use most recent year for week count
  for (let yi = years.length - 1; yi >= 0; yi--) {
    if (years[yi][monthIdx]?.weeks.length > 0) {
      return years[yi][monthIdx].weeks.length;
    }
  }
  return [0, 2, 4, 6, 7, 9, 11].includes(monthIdx) ? 5 : 4;
}

// ── Core forecast for a single metric ────────────────────────────────────

function forecastCoreMetric(
  data: ClientHistoricalData,
  metric: CoreMetric,
  annualTarget: number,
  /** If provided, use spend factor to adjust the projection */
  spendFactor?: number,
  /** If provided, use efficiency-based expected for scaling clients */
  efficiencyOverride?: { spendExpected: number[]; maturity: DataMaturity }
): ForecastResult {
  // ── Sanitize all inputs ──────────────────────────────────────────────
  const sortedYearKeys = Object.keys(data.historicalYears)
    .map(Number)
    .sort((a, b) => a - b);

  // Sanitize, repair outliers, enforce consistency for each historical year
  let cleanedYears: MonthlyRecord[][] = sortedYearKeys.map((year) =>
    enforceMetricConsistency(
      repairOutliers(sanitizeYear(data.historicalYears[year]), metric)
    )
  );

  // Dampen unrealistic YoY swings between consecutive years
  for (let i = 1; i < cleanedYears.length; i++) {
    cleanedYears[i] = dampenYoYSwing(cleanedYears[i - 1], cleanedYears[i], metric);
  }

  const data2026 = sanitizeCurrentYear(data.currentYearData);
  const historicalYears = cleanedYears;

  // Determine realized months from actual data
  const realizedThroughMonth = data2026.filter((m) => m !== null).length;

  // Step 1: Expected per month
  // For scaling clients with limited data: use efficiency × spend instead of raw history.
  // This avoids treating a growth curve as seasonality.
  const useEfficiency = efficiencyOverride
    && (metric === "conversions" || metric === "revenue")
    && efficiencyOverride.maturity.isScaling
    && !efficiencyOverride.maturity.isMature
    && efficiencyOverride.maturity.recentEfficiency > 0;

  let scaledExpected: number[];

  if (useEfficiency) {
    // Efficiency-based path: expected = projected spend × efficiency rate
    const effExpected = computeEfficiencyBasedExpected(
      efficiencyOverride!.spendExpected,
      efficiencyOverride!.maturity.recentEfficiency,
      efficiencyOverride!.maturity.efficiencyTrend
    );
    // Scale to target
    const effTotal = effExpected.reduce((s, v) => s + v, 0);
    scaledExpected = effTotal > 0
      ? effExpected.map((v) => Math.round(v * (annualTarget / effTotal)))
      : effExpected.map(() => Math.round(annualTarget / 12));
  } else {
    // Standard path: weighted historical average
    const rawExpected = computeMonthlyExpected(historicalYears, metric);

    // Fill gaps: months with 0 expected
    const realizedValues = data2026
      .filter((m): m is MonthlyRecord => m !== null && m[metric] > 0)
      .map((m) => m[metric]);
    const ytdMonthlyAvg = realizedValues.length > 0
      ? realizedValues.reduce((s, v) => s + v, 0) / realizedValues.length
      : 0;

    const monthlyExpected = rawExpected.map((v) => {
      if (v > 0) return v;
      return Math.round(ytdMonthlyAvg);
    });

    // Scale expected to match the annual target
    const expectedTotal = monthlyExpected.reduce((s, v) => s + v, 0);
    let candidate = expectedTotal > 0
      ? monthlyExpected.map((v) => Math.round(v * (annualTarget / expectedTotal)))
      : monthlyExpected.map(() => Math.round(annualTarget / 12));

    // Safety check: if the distribution is wildly uneven, it means the historical
    // data is too sparse/uneven to create a reliable monthly pattern.
    // Fall back to efficiency-based if available, or uniform distribution.
    const positiveExpected = candidate.filter((v) => v > 0);
    const spread = positiveExpected.length >= 2
      ? Math.max(...positiveExpected) / Math.min(...positiveExpected)
      : 1;

    if (spread > MAX_EXPECTED_SPREAD) {
      if (efficiencyOverride && efficiencyOverride.maturity.recentEfficiency > 0
          && (metric === "conversions" || metric === "revenue")) {
        // Use efficiency-based distribution as fallback
        const effExpected = computeEfficiencyBasedExpected(
          efficiencyOverride.spendExpected,
          efficiencyOverride.maturity.recentEfficiency,
          efficiencyOverride.maturity.efficiencyTrend
        );
        const effTotal = effExpected.reduce((s, v) => s + v, 0);
        candidate = effTotal > 0
          ? effExpected.map((v) => Math.round(v * (annualTarget / effTotal)))
          : candidate.map(() => Math.round(annualTarget / 12));
      } else {
        // No efficiency data available — use uniform distribution
        candidate = candidate.map(() => Math.round(annualTarget / 12));
      }
    }

    scaledExpected = candidate;
  }

  // Step 2: Realized values (with manual override support for tracking breaks)
  const realized: (number | null)[] = data2026.map((r, idx) => {
    if (r === null) return null;
    // Apply conversion overrides if available (only for conversions metric)
    if (metric === "conversions" && data.conversionOverrides) {
      const monthKey = `${data.currentYear}-${String(idx + 1).padStart(2, "0")}`;
      const override = data.conversionOverrides[monthKey];
      if (override !== undefined && override > 0) {
        return override;
      }
    }
    return r[metric];
  });

  // Step 3: Performance factor (weighted, recent months heavier)
  const factor = computePerformanceFactor(realized, scaledExpected, realizedThroughMonth);

  // Adjust factor with spend factor if provided
  // If spend is 85% of expected but conversions are 90%, efficiency = 90/85 = 105.9%
  // Forecast = expected × spend_factor × efficiency
  const efficiencyFactor = spendFactor && spendFactor > 0
    ? factor / spendFactor  // isolate efficiency from budget effect
    : factor;

  // For projections, use: expected × spendFactor × efficiencyFactor
  // which simplifies to: expected × factor (the combined observed ratio)
  // BUT if spend is expected to return to plan, we should use efficiency only
  // We use the combined factor as the default (conservative)
  const projectionFactor = factor;

  // Step 4: Build monthly points
  const monthlyRatios: number[] = [];
  const realizedRatios: number[] = []; // alleen de gerealiseerde maanden, voor de onzekerheidsband
  let futureExpectedSum = 0;           // verwachte waarde over de nog te projecteren maanden
  const points: ForecastPoint[] = [];
  let adjustedAnnual = 0;

  const ytdRealized = realized.slice(0, realizedThroughMonth)
    .reduce<number>((s, v) => s + (v ?? 0), 0);
  const ytdExpected = scaledExpected.slice(0, realizedThroughMonth)
    .reduce<number>((s, v) => s + v, 0);

  for (let m = 0; m < 12; m++) {
    const exp = scaledExpected[m];
    const real = realized[m];

    if (real !== null) {
      const ratio = exp > 0 ? real / exp : 1;
      monthlyRatios.push(ratio);
      realizedRatios.push(ratio);
      adjustedAnnual += real;
      points.push({
        month: m + 1,
        monthLabel: MONTH_LABELS[m],
        expected: exp,
        realized: real,
        forecast: null,
        monthRatio: ratio,
      });
    } else {
      const proj = Math.round(exp * projectionFactor);
      monthlyRatios.push(projectionFactor);
      futureExpectedSum += exp;
      adjustedAnnual += proj;
      points.push({
        month: m + 1,
        monthLabel: MONTH_LABELS[m],
        expected: exp,
        realized: null,
        forecast: proj,
        monthRatio: projectionFactor,
      });
    }
  }

  // Step 5: Build weekly points
  const weeklyPoints: WeeklyPoint[] = [];
  for (let m = 0; m < 12; m++) {
    const weekDist = computeWeeklyDistribution(historicalYears, m, metric);
    const nWeeks = weekDist.length;
    const monthExp = scaledExpected[m];
    const monthRecord = data2026[m];

    for (let w = 0; w < nWeeks; w++) {
      const weekExp = Math.round(monthExp * weekDist[w]);
      const label = `W${w + 1} ${MONTH_LABELS[m]}`;

      if (monthRecord !== null && monthRecord.weeks[w]) {
        // Realized week
        weeklyPoints.push({
          month: m + 1, week: w + 1, label,
          expected: weekExp,
          realized: monthRecord.weeks[w][metric],
          forecast: null,
        });
      } else {
        // Forecast week
        weeklyPoints.push({
          month: m + 1, week: w + 1, label,
          expected: weekExp,
          realized: null,
          forecast: Math.round(weekExp * projectionFactor),
        });
      }
    }
  }

  const diffPct = annualTarget > 0
    ? ((adjustedAnnual - annualTarget) / annualTarget) * 100
    : 0;

  const band = computeConfidenceBand(realizedRatios, futureExpectedSum, adjustedAnnual);

  return {
    metric: metric === "adSpend" ? "cpa" : metric, // placeholder, overridden by caller
    points,
    weeklyPoints,
    kpi: {
      annualTarget,
      ytdRealized,
      ytdExpected,
      adjustedAnnual,
      diffPct,
      performanceRatio: ytdExpected > 0 ? ytdRealized / ytdExpected : 1,
      monthlyRatios,
      projectionFactor,
      forecastLow: band.low,
      forecastHigh: band.high,
      forecastSpreadPct: band.spreadPct,
    },
  };
}

// ── Derived metrics: ROAS and CPA ────────────────────────────────────────

function deriveForecast(
  numerator: ForecastResult,
  denominator: ForecastResult,
  metric: ForecastMetric,
  /** If true, compute num/denom. If false, compute denom/num */
  numOverDenom: boolean
): ForecastResult {
  const points: ForecastPoint[] = numerator.points.map((numPt, i) => {
    const denPt = denominator.points[i];
    const calc = (a: number, b: number) =>
      numOverDenom
        ? (b > 0 ? parseFloat((a / b).toFixed(2)) : 0)
        : (a > 0 ? parseFloat((b / a).toFixed(2)) : 0);

    const exp = calc(numPt.expected, denPt.expected);
    const real = numPt.realized !== null && denPt.realized !== null
      ? calc(numPt.realized, denPt.realized)
      : null;
    const fore = numPt.forecast !== null && denPt.forecast !== null
      ? calc(numPt.forecast, denPt.forecast)
      : null;

    const actual = real ?? fore ?? exp;
    return {
      month: numPt.month,
      monthLabel: numPt.monthLabel,
      expected: exp,
      realized: real,
      forecast: fore,
      monthRatio: exp > 0 ? actual / exp : 1,
    };
  });

  const weeklyPoints: WeeklyPoint[] = numerator.weeklyPoints.map((numWk, i) => {
    const denWk = denominator.weeklyPoints[i];
    if (!denWk) return { ...numWk, expected: 0, realized: null, forecast: null };

    const calc = (a: number, b: number) =>
      numOverDenom
        ? (b > 0 ? parseFloat((a / b).toFixed(2)) : 0)
        : (a > 0 ? parseFloat((b / a).toFixed(2)) : 0);

    return {
      month: numWk.month,
      week: numWk.week,
      label: numWk.label,
      expected: calc(numWk.expected, denWk.expected),
      realized: numWk.realized !== null && denWk.realized !== null
        ? calc(numWk.realized, denWk.realized) : null,
      forecast: numWk.forecast !== null && denWk.forecast !== null
        ? calc(numWk.forecast, denWk.forecast) : null,
    };
  });

  // KPI
  const numKpi = numerator.kpi;
  const denKpi = denominator.kpi;
  const calcKpi = (a: number, b: number) =>
    numOverDenom
      ? (b > 0 ? parseFloat((a / b).toFixed(2)) : 0)
      : (a > 0 ? parseFloat((b / a).toFixed(2)) : 0);

  const target = calcKpi(numKpi.annualTarget, denKpi.annualTarget);
  const adjusted = calcKpi(numKpi.adjustedAnnual, denKpi.adjustedAnnual);

  return {
    metric,
    points,
    weeklyPoints,
    kpi: {
      annualTarget: target,
      ytdRealized: calcKpi(numKpi.ytdRealized, denKpi.ytdRealized),
      ytdExpected: calcKpi(numKpi.ytdExpected, denKpi.ytdExpected),
      adjustedAnnual: adjusted,
      diffPct: target > 0 ? ((adjusted - target) / target) * 100 : 0,
      performanceRatio: numKpi.performanceRatio,
      monthlyRatios: points.map((p) => p.monthRatio),
      projectionFactor: numKpi.projectionFactor,
      // Voor afgeleide ratio-metrics (ROAS/CPA) is een band op een deling misleidend; bewust
      // geen bandbreedte claimen i.p.v. een verzonnen interval propageren.
      forecastLow: adjusted,
      forecastHigh: adjusted,
      forecastSpreadPct: 0,
    },
  };
}

// ── Budget recommendation ────────────────────────────────────────────────

// Vanaf 15% boven het CPA-doel noemen we de efficiëntie materieel te laag om budget op te schalen.
export const CPA_INEFFICIENT_MARGIN = 1.15;

// Reconciliatie-predicaat: is de achterstand een efficiëntie- i.p.v. een budgetkwestie? Achter op
// doel én de CPA materieel boven het doel → meer budget koopt dure conversies; eerst herverdelen.
export function isEfficiencyBottleneck(behindTarget: boolean, currentCpa: number, cpaTarget: number | null): boolean {
  return Boolean(behindTarget && cpaTarget != null && cpaTarget > 0 && currentCpa > cpaTarget * CPA_INEFFICIENT_MARGIN);
}

function computeBudgetRecommendation(
  conversions: ForecastResult,
  adSpend: ForecastResult,
  realizedThroughMonth: number,
  cpaTarget: number | null
): BudgetRecommendation {
  const convTarget = conversions.kpi.annualTarget;
  const convAdjusted = conversions.kpi.adjustedAnnual;
  const behindTarget = convAdjusted < convTarget;
  const conversionGap = Math.max(0, convTarget - convAdjusted);

  // Current CPA based on realized data
  const ytdConv = conversions.kpi.ytdRealized;
  const ytdSpend = adSpend.kpi.ytdRealized;
  // Fallback CPA: if no conversions yet, use target spend / target conversions
  const fallbackCpa = convTarget > 0
    ? adSpend.kpi.annualTarget / convTarget
    : 0;
  const currentCpa = ytdConv > 0 ? ytdSpend / ytdConv : fallbackCpa;

  // Extra spend needed = gap × current CPA
  const extraSpendNeeded = Math.round(conversionGap * sanitizeValue(currentCpa));

  // Remaining months
  const remainingMonths = Math.max(1, 12 - realizedThroughMonth);

  // Current planned monthly spend (from target)
  const currentMonthlySpend = Math.round(adSpend.kpi.annualTarget / 12);

  // Required monthly spend to hit target
  const remainingSpendNeeded = adSpend.kpi.annualTarget - ytdSpend + extraSpendNeeded;
  const requiredMonthlySpend = Math.round(remainingSpendNeeded / remainingMonths);

  const spendIncreasePct = currentMonthlySpend > 0
    ? ((requiredMonthlySpend - currentMonthlySpend) / currentMonthlySpend) * 100
    : 0;

  // Efficiëntie-reconciliatie: achter op doel én de CPA ligt materieel boven het doel → de
  // bottleneck is effectiviteit, niet budget.
  const efficiencyBottleneck = isEfficiencyBottleneck(behindTarget, currentCpa, cpaTarget);

  return {
    behindTarget,
    conversionGap: Math.round(conversionGap),
    currentCpa: parseFloat(currentCpa.toFixed(2)),
    extraSpendNeeded,
    requiredMonthlySpend,
    currentMonthlySpend,
    spendIncreasePct: parseFloat(spendIncreasePct.toFixed(1)),
    cpaTarget: cpaTarget != null && cpaTarget > 0 ? parseFloat(cpaTarget.toFixed(2)) : null,
    efficiencyBottleneck,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

export function computeForecast(data: ClientHistoricalData): ClientForecast {
  const target = data.targetCurrentYear;

  // ── Sanitize targets ────────────────────────────────────────────────
  const safeTarget = {
    conversions: sanitizeValue(target.conversions),
    revenue: sanitizeValue(target.revenue),
    adSpend: sanitizeValue(target.adSpend),
  };

  // Fallback: if target is 0, use most recent historical year as baseline
  const sortedYears = Object.keys(data.historicalYears)
    .map(Number)
    .sort((a, b) => b - a); // most recent first

  const fallbackFromHistory = (metric: CoreMetric) => {
    for (const year of sortedYears) {
      const total = data.historicalYears[year].reduce((s, r) => s + sanitizeValue(r[metric]), 0);
      if (total > 0) return total;
    }
    return 0;
  };

  if (safeTarget.conversions === 0) safeTarget.conversions = fallbackFromHistory("conversions");
  if (safeTarget.revenue === 0) safeTarget.revenue = fallbackFromHistory("revenue");
  if (safeTarget.adSpend === 0) safeTarget.adSpend = fallbackFromHistory("adSpend");

  // Determine realized months
  const realizedThroughMonth = data.currentYearData.filter((m) => m !== null).length;

  // ── Analyze data maturity ───────────────────────────────────────────
  const allHistoricalYears = sortedYears
    .sort((a, b) => a - b) // oldest first
    .map((y) => sanitizeYear(data.historicalYears[y]));

  const maturity = analyzeDataMaturity(
    allHistoricalYears,
    sanitizeCurrentYear(data.currentYearData)
  );

  // Core metrics: conversions, revenue, adSpend (each with their own factor)
  // adSpend is always computed with standard path (no efficiency override for spend itself)
  const adSpendResult = forecastCoreMetric(data, "adSpend", safeTarget.adSpend);

  // Use spend factor to compute spend-adjusted efficiency for conv/revenue
  const spendFactor = adSpendResult.kpi.projectionFactor;

  // Pass efficiency data whenever available — it serves two purposes:
  // 1. PRIMARY path for scaling + immature clients (efficiency IS the forecast)
  // 2. FALLBACK for any client where historical monthly distribution is too uneven
  const efficiencyOverride = maturity.recentEfficiency > 0
    ? { spendExpected: adSpendResult.points.map((p) => p.expected), maturity }
    : undefined;

  const conversions = forecastCoreMetric(data, "conversions", safeTarget.conversions, spendFactor, efficiencyOverride);
  conversions.metric = "conversions";

  const revenue = forecastCoreMetric(data, "revenue", safeTarget.revenue, spendFactor, efficiencyOverride);
  revenue.metric = "revenue";

  const adSpend = adSpendResult;
  adSpend.metric = "cpa"; // Will be used for CPA derivation

  // Derived metrics
  const roas = deriveForecast(revenue, adSpend, "roas", true);   // revenue / adSpend
  const cpa = deriveForecast(adSpend, conversions, "cpa", false); // adSpend / conversions → we want spend/conv

  // Actually CPA = adSpend / conversions, which is denPt / numPt when numOverDenom=false
  // Let me recalculate: CPA needs adSpend in numerator, conversions in denominator
  const cpaResult = deriveForecast(adSpend, conversions, "cpa", true); // adSpend / conversions

  // Budget recommendation
  const budgetRecommendation = computeBudgetRecommendation(conversions, adSpend, realizedThroughMonth, cpaResult.kpi.annualTarget ?? null);

  return {
    conversions,
    revenue,
    adSpend: adSpendResult,
    roas,
    cpa: cpaResult,
    budgetRecommendation,
    dataMaturity: maturity,
  };
}
