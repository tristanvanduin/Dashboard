/**
 * Unified data adapter
 *
 * Maps Google Ads and Meta Ads API responses into the dashboard's
 * ClientHistoricalData format so the forecast engine, charts, and
 * insights work unchanged regardless of data source.
 */

import type { MonthlyRecord, WeeklyRecord, ClientHistoricalData, ClientAnnualData } from "../types";
import type { GoogleAdsMetrics } from "./google-ads";
import type { MetaParsedMetrics } from "./meta-ads";

// ── Types ────────────────────────────────────────────────────────────────────

export type DataSource = "google-ads" | "meta-ads" | "combined";

export interface ApiMonthlyData {
  month: number; // 1-12
  conversions: number;
  revenue: number;
  adSpend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
}

export interface ApiWeeklyData {
  week: number; // 1-5 within month
  month: number;
  conversions: number;
  revenue: number;
  adSpend: number;
}

// ── Google Ads → Dashboard Format ────────────────────────────────────────────

function parseMonth(dateStr: string): number {
  // Google Ads returns YYYY-MM-DD (first of month) or YYYY-MM
  const parts = dateStr.split("-");
  return parseInt(parts[1], 10);
}

export function googleAdsMonthlyToApiData(
  metrics: GoogleAdsMetrics[]
): ApiMonthlyData[] {
  return metrics.map((m) => ({
    month: parseMonth(m.date),
    conversions: Math.round(m.conversions),
    revenue: Math.round(m.conversionsValue),
    adSpend: Math.round(m.cost),
    impressions: m.impressions,
    clicks: m.clicks,
    ctr: m.ctr,
    avgCpc: m.avgCpc,
    conversionRate: m.conversionRate,
  }));
}

export function googleAdsWeeklyToApiData(
  metrics: GoogleAdsMetrics[]
): ApiWeeklyData[] {
  // Group by month, assign week number within each month
  const byMonth = new Map<number, GoogleAdsMetrics[]>();
  for (const m of metrics) {
    const month = parseMonth(m.date);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(m);
  }

  const result: ApiWeeklyData[] = [];
  for (const [month, weekMetrics] of byMonth) {
    weekMetrics.forEach((wm, i) => {
      result.push({
        week: i + 1,
        month,
        conversions: Math.round(wm.conversions),
        revenue: Math.round(wm.conversionsValue),
        adSpend: Math.round(wm.cost),
      });
    });
  }
  return result;
}

// ── Meta Ads → Dashboard Format ──────────────────────────────────────────────

function metaParseMonth(dateStr: string): number {
  const parts = dateStr.split("-");
  return parseInt(parts[1], 10);
}

export function metaAdsMonthlyToApiData(
  metrics: MetaParsedMetrics[]
): ApiMonthlyData[] {
  return metrics.map((m) => ({
    month: metaParseMonth(m.dateStart),
    conversions: Math.round(m.conversions),
    revenue: Math.round(m.conversionsValue),
    adSpend: Math.round(m.spend),
    impressions: m.impressions,
    clicks: m.clicks,
    ctr: m.ctr,
    avgCpc: m.cpc,
    conversionRate: m.conversions > 0 && m.clicks > 0 ? m.conversions / m.clicks : 0,
  }));
}

export function metaAdsWeeklyToApiData(
  metrics: MetaParsedMetrics[]
): ApiWeeklyData[] {
  const byMonth = new Map<number, MetaParsedMetrics[]>();
  for (const m of metrics) {
    const month = metaParseMonth(m.dateStart);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(m);
  }

  const result: ApiWeeklyData[] = [];
  for (const [month, weekMetrics] of byMonth) {
    weekMetrics.forEach((wm, i) => {
      result.push({
        week: i + 1,
        month,
        conversions: Math.round(wm.conversions),
        revenue: Math.round(wm.conversionsValue),
        adSpend: Math.round(wm.spend),
      });
    });
  }
  return result;
}

// ── Combine Google Ads + Meta Ads ────────────────────────────────────────────

export function combineApiData(
  googleMonthly: ApiMonthlyData[],
  metaMonthly: ApiMonthlyData[]
): ApiMonthlyData[] {
  const combined = new Map<number, ApiMonthlyData>();

  // Start with Google Ads data
  for (const gm of googleMonthly) {
    combined.set(gm.month, { ...gm });
  }

  // Add Meta data on top
  for (const mm of metaMonthly) {
    const existing = combined.get(mm.month);
    if (existing) {
      existing.conversions += mm.conversions;
      existing.revenue += mm.revenue;
      existing.adSpend += mm.adSpend;
      existing.impressions += mm.impressions;
      existing.clicks += mm.clicks;
      // Recalculate rates
      existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
      existing.avgCpc = existing.clicks > 0 ? existing.adSpend / existing.clicks : 0;
      existing.conversionRate = existing.clicks > 0 ? existing.conversions / existing.clicks : 0;
    } else {
      combined.set(mm.month, { ...mm });
    }
  }

  return Array.from(combined.values()).sort((a, b) => a.month - b.month);
}

export function combineWeeklyData(
  googleWeekly: ApiWeeklyData[],
  metaWeekly: ApiWeeklyData[]
): ApiWeeklyData[] {
  const combined = new Map<string, ApiWeeklyData>();

  for (const gw of googleWeekly) {
    const key = `${gw.month}-${gw.week}`;
    combined.set(key, { ...gw });
  }

  for (const mw of metaWeekly) {
    const key = `${mw.month}-${mw.week}`;
    const existing = combined.get(key);
    if (existing) {
      existing.conversions += mw.conversions;
      existing.revenue += mw.revenue;
      existing.adSpend += mw.adSpend;
    } else {
      combined.set(key, { ...mw });
    }
  }

  return Array.from(combined.values()).sort((a, b) =>
    a.month !== b.month ? a.month - b.month : a.week - b.week
  );
}

// ── Convert to Dashboard's ClientHistoricalData format ───────────────────────

function apiDataToMonthlyRecords(
  monthlyData: ApiMonthlyData[],
  weeklyData: ApiWeeklyData[],
  realizedThroughMonth?: number
): (MonthlyRecord | null)[] {
  const records: (MonthlyRecord | null)[] = [];

  for (let m = 1; m <= 12; m++) {
    if (realizedThroughMonth !== undefined && m > realizedThroughMonth) {
      records.push(null);
      continue;
    }

    const monthData = monthlyData.find((d) => d.month === m);
    const monthWeeks = weeklyData
      .filter((w) => w.month === m)
      .map((w): WeeklyRecord => ({
        week: w.week,
        month: m,
        conversions: w.conversions,
        revenue: w.revenue,
        adSpend: w.adSpend,
      }));

    if (monthData) {
      // If we have no weekly data, generate even splits
      const weeks = monthWeeks.length > 0
        ? monthWeeks
        : generateEvenWeeks(m, monthData.conversions, monthData.revenue, monthData.adSpend);

      records.push({
        month: m,
        conversions: monthData.conversions,
        revenue: monthData.revenue,
        adSpend: monthData.adSpend,
        weeks,
      });
    } else if (realizedThroughMonth === undefined) {
      // Historical year with no data for this month — fill with zeros
      records.push({
        month: m,
        conversions: 0,
        revenue: 0,
        adSpend: 0,
        weeks: generateEvenWeeks(m, 0, 0, 0),
      });
    } else {
      // Current year, future month — null means "not yet realized"
      records.push(null);
    }
  }

  return records;
}

function generateEvenWeeks(
  month: number,
  conversions: number,
  revenue: number,
  adSpend: number
): WeeklyRecord[] {
  const nWeeks = [1, 3, 5, 7, 8, 10, 12].includes(month) ? 5 : 4;
  const weeks: WeeklyRecord[] = [];

  for (let w = 1; w <= nWeeks; w++) {
    weeks.push({
      week: w,
      month,
      conversions: Math.round(conversions / nWeeks),
      revenue: Math.round(revenue / nWeeks),
      adSpend: Math.round(adSpend / nWeeks),
    });
  }

  // Fix rounding on last week
  const last = weeks[nWeeks - 1];
  last.conversions += conversions - weeks.reduce((s, w) => s + w.conversions, 0);
  last.revenue += revenue - weeks.reduce((s, w) => s + w.revenue, 0);
  last.adSpend += adSpend - weeks.reduce((s, w) => s + w.adSpend, 0);

  return weeks;
}

/** Input for a single historical year */
export interface YearDataInput {
  year: number;
  monthly: ApiMonthlyData[];
  weekly: ApiWeeklyData[];
}

/**
 * Build ClientHistoricalData from API data.
 * Supports N historical years — more data = better forecasts.
 */
export function buildClientDataFromApi(
  clientId: string,
  historicalYearsInput: YearDataInput[],
  currentYearMonthly: ApiMonthlyData[],
  currentYearWeekly: ApiWeeklyData[],
  targetCurrentYear: ClientAnnualData,
  currentYear: number,
  realizedThroughMonth: number
): ClientHistoricalData {
  const historicalYears: Record<number, MonthlyRecord[]> = {};
  for (const { year, monthly, weekly } of historicalYearsInput) {
    historicalYears[year] = apiDataToMonthlyRecords(monthly, weekly) as MonthlyRecord[];
  }

  return {
    clientId,
    targetCurrentYear,
    historicalYears,
    currentYearData: apiDataToMonthlyRecords(currentYearMonthly, currentYearWeekly, realizedThroughMonth),
    currentYear,
  };
}

/**
 * @deprecated Use buildClientDataFromApi with YearDataInput[] instead.
 * Kept for backwards compatibility during migration.
 */
export function buildClientDataFromApiLegacy(
  clientId: string,
  data2024Monthly: ApiMonthlyData[],
  data2024Weekly: ApiWeeklyData[],
  data2025Monthly: ApiMonthlyData[],
  data2025Weekly: ApiWeeklyData[],
  data2026Monthly: ApiMonthlyData[],
  data2026Weekly: ApiWeeklyData[],
  target2026: ClientAnnualData,
  realizedThroughMonth: number
): ClientHistoricalData {
  return buildClientDataFromApi(
    clientId,
    [
      { year: 2024, monthly: data2024Monthly, weekly: data2024Weekly },
      { year: 2025, monthly: data2025Monthly, weekly: data2025Weekly },
    ],
    data2026Monthly,
    data2026Weekly,
    target2026,
    2026,
    realizedThroughMonth,
  );
}
