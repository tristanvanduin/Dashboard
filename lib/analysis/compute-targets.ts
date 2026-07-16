/**
 * Computes monthly expected values for the analysis pipeline,
 * using the same forecast engine as the dashboard frontend.
 *
 * Converts Supabase ads_account_monthly rows into ClientHistoricalData
 * and runs computeForecast() to get the expected values per month.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientHistoricalData, MonthlyRecord, WeeklyRecord } from "../types";
import { computeForecast, type ClientForecast } from "../forecast";

interface AccountRow {
  month: string;         // YYYY-MM-DD
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc: number;
  cost_per_conversion: number;
  conversion_rate: number;
}

interface WeeklyRow {
  week_start: string;
  cost: number;
  conversions: number;
  conversions_value: number;
}

function parseYear(dateStr: string): number {
  return parseInt(dateStr.split("-")[0], 10);
}

function parseMonth(dateStr: string): number {
  return parseInt(dateStr.split("-")[1], 10);
}

function rowToMonthlyRecord(row: AccountRow): MonthlyRecord {
  return {
    month: parseMonth(row.month),
    conversions: Math.round(row.conversions),
    revenue: Math.round(row.conversions_value),
    adSpend: Math.round(row.cost),
    weeks: [], // will be filled below
  };
}

function buildWeeks(weeklyRows: WeeklyRow[], month: number): WeeklyRecord[] {
  const monthWeeks = weeklyRows
    .filter((w) => parseMonth(w.week_start) === month)
    .sort((a, b) => a.week_start.localeCompare(b.week_start));

  return monthWeeks.map((w, i) => ({
    week: i + 1,
    month,
    conversions: Math.round(w.conversions),
    revenue: Math.round(w.conversions_value),
    adSpend: Math.round(w.cost),
  }));
}

/**
 * Fetch account data from Supabase, build ClientHistoricalData,
 * run the forecast engine, and return per-month expected values.
 *
 * Returns the forecast for the last complete month's analysis period.
 */
export async function computeAnalysisTargets(
  supabase: SupabaseClient,
  clientId: string
): Promise<{
  forecast: ClientForecast;
  lastCompleteMonth: number;
  currentYear: number;
  monthlyExpected: { month: number; conversions: number; revenue: number; adSpend: number }[];
} | null> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const lastCompleteMonth = currentMonth - 1 || 12;
  const lastCompleteYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  // Fetch all historical account data (up to 5 years)
  const startYear = currentYear - 5;
  const { data: accountRows } = await supabase
    .from("ads_account_monthly")
    .select("*")
    .eq("client_id", clientId)
    .gte("month", `${startYear}-01-01`)
    .lte("month", `${lastCompleteYear}-${String(lastCompleteMonth).padStart(2, "0")}-01`)
    .order("month");

  if (!accountRows || accountRows.length === 0) return null;

  // Fetch weekly data for current year
  const { data: weeklyRows } = await supabase
    .from("ads_account_weekly")
    .select("*")
    .eq("client_id", clientId)
    .gte("week_start", `${currentYear}-01-01`)
    .order("week_start");

  const weekly = (weeklyRows ?? []) as WeeklyRow[];

  // Fetch KPI targets
  const { data: settings } = await supabase
    .from("client_settings")
    .select("kpi_targets")
    .eq("client_id", clientId)
    .maybeSingle();

  const kpi = (settings?.kpi_targets ?? {}) as Record<string, number>;

  // Group monthly data by year
  const byYear = new Map<number, AccountRow[]>();
  for (const row of accountRows as AccountRow[]) {
    const year = parseYear(row.month);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(row);
  }

  // Build historical years (everything before current year)
  const historicalYears: Record<number, MonthlyRecord[]> = {};
  for (const [year, rows] of byYear) {
    if (year >= currentYear) continue;
    const records: MonthlyRecord[] = [];
    for (let m = 1; m <= 12; m++) {
      const row = rows.find((r) => parseMonth(r.month) === m);
      if (row) {
        const rec = rowToMonthlyRecord(row);
        rec.weeks = buildWeeks(weekly, m);
        records.push(rec);
      } else {
        records.push({ month: m, conversions: 0, revenue: 0, adSpend: 0, weeks: [] });
      }
    }
    historicalYears[year] = records;
  }

  // Build current year data
  const currentYearRows = byYear.get(currentYear) ?? [];
  const currentYearData: (MonthlyRecord | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    if (m > lastCompleteMonth && currentYear === lastCompleteYear) {
      currentYearData.push(null);
      continue;
    }
    const row = currentYearRows.find((r) => parseMonth(r.month) === m);
    if (row) {
      const rec = rowToMonthlyRecord(row);
      rec.weeks = buildWeeks(weekly, m);
      currentYearData.push(rec);
    } else {
      currentYearData.push(null);
    }
  }

  // Compute previous year totals for default target (10% growth)
  const prevYearRows = byYear.get(currentYear - 1) ?? [];
  const prevConv = prevYearRows.reduce((s, r) => s + r.conversions, 0);
  const prevRev = prevYearRows.reduce((s, r) => s + r.conversions_value, 0);
  const prevSpend = prevYearRows.reduce((s, r) => s + r.cost, 0);

  const targetCurrentYear = {
    conversions: kpi.conversionsAbsolute || Math.round(prevConv * 1.1),
    revenue: kpi.revenueAbsolute || Math.round(prevRev * 1.1),
    adSpend: Math.round(prevSpend * 1.05),
  };

  const clientData: ClientHistoricalData = {
    clientId,
    targetCurrentYear,
    historicalYears,
    currentYearData,
    currentYear,
  };

  const forecast = computeForecast(clientData);

  // Extract monthly expected values
  const monthlyExpected = forecast.conversions.points.map((pt, i) => ({
    month: i + 1,
    conversions: Math.round(pt.expected),
    revenue: Math.round(forecast.revenue.points[i].expected),
    adSpend: Math.round(forecast.adSpend.points[i].expected),
  }));

  return { forecast, lastCompleteMonth, currentYear, monthlyExpected };
}
