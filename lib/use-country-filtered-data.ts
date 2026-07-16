/**
 * Hook that provides country-filtered ClientHistoricalData.
 *
 * When countryFilter is null: returns original account-level data.
 * When countryFilter is set (e.g., "NL"): reads pre-aggregated
 * country data from ads_country_monthly (via API) and builds
 * ClientHistoricalData in the same shape as account-level data.
 *
 * This is more accurate than the old campaign-filtering approach
 * because it uses actual geo-level spend data per country, not
 * campaign-level approximations.
 */

import { useMemo } from "react";
import { useClientHistoricalData, useClientDataState } from "./client-data-provider";
import type { ClientHistoricalData, MonthlyRecord } from "./types";

export function useCountryFilteredData(
  clientId: string,
  countryFilter: string | null
): ClientHistoricalData | null {
  const fullData = useClientHistoricalData(clientId);
  const dataState = useClientDataState();

  return useMemo(() => {
    if (!fullData) return null;
    // No filter → return account-level data as-is
    if (!countryFilter) return fullData;

    const countryMonthlyData = dataState?.countryMonthlyData ?? [];

    // Filter to this country's data
    const countryData = countryMonthlyData.filter((d) => d.countryCode === countryFilter);

    if (countryData.length === 0) {
      return {
        ...fullData,
        currentYearData: Array.from({ length: 12 }, () => null),
        historicalYears: {},
      };
    }

    const currentYear = fullData.currentYear;

    // Determine realized months from the full account data
    const realizedMonths = fullData.currentYearData
      .map((m, i) => (m ? i + 1 : 0))
      .filter((m) => m > 0);
    const maxRealized = realizedMonths.length > 0 ? Math.max(...realizedMonths) : 0;

    // Helper: normalize date strings to "YYYY-MM" for comparison
    // Supabase may return "2026-01-01", "2026-01-01T00:00:00+00:00", etc.
    const toYM = (s: string) => s.slice(0, 7);

    // Build currentYearData from pre-aggregated country data
    const currentYearData: (MonthlyRecord | null)[] = Array.from({ length: 12 }, (_, i) => {
      const monthNum = i + 1;
      if (monthNum > maxRealized) return null; // Future month
      const monthYM = `${currentYear}-${String(monthNum).padStart(2, "0")}`;
      const d = countryData.find((r) => toYM(r.month) === monthYM);
      return {
        month: monthNum,
        conversions: Math.round(d?.conversions ?? 0),
        revenue: Math.round(d?.conversionsValue ?? 0),
        adSpend: Math.round(d?.cost ?? 0),
        weeks: [], // Weekly data per country not yet available
      };
    });

    // Build historical years from country data
    const historicalYears: Record<number, MonthlyRecord[]> = {};

    for (const d of countryData) {
      const ym = toYM(d.month);
      const year = parseInt(ym.split("-")[0], 10);
      if (year >= currentYear) continue; // Skip current year (handled above)
      if (!historicalYears[year]) {
        historicalYears[year] = Array.from({ length: 12 }, (_, i) => ({
          month: i + 1, conversions: 0, revenue: 0, adSpend: 0, weeks: [],
        }));
      }
      const monthNum = parseInt(ym.split("-")[1], 10);
      historicalYears[year][monthNum - 1] = {
        month: monthNum,
        conversions: Math.round(d.conversions),
        revenue: Math.round(d.conversionsValue),
        adSpend: Math.round(d.cost),
        weeks: [],
      };
    }

    // Remove empty historical years
    for (const year of Object.keys(historicalYears)) {
      const yearData = historicalYears[Number(year)];
      if (!yearData.some((m) => m.conversions > 0 || m.adSpend > 0)) {
        delete historicalYears[Number(year)];
      }
    }

    // Scale target using average spend_share for this country in the current year
    const currentYearCountryData = countryData.filter((d) => toYM(d.month).startsWith(String(currentYear)));
    const avgSpendShare =
      currentYearCountryData.length > 0
        ? currentYearCountryData.reduce((s, d) => s + d.spendShare, 0) / currentYearCountryData.length
        : 0;

    return {
      clientId: fullData.clientId,
      currentYear: fullData.currentYear,
      targetCurrentYear: {
        conversions: Math.round(fullData.targetCurrentYear.conversions * avgSpendShare),
        revenue: Math.round(fullData.targetCurrentYear.revenue * avgSpendShare),
        adSpend: Math.round(fullData.targetCurrentYear.adSpend * avgSpendShare),
      },
      historicalYears,
      currentYearData,
      conversionOverrides: fullData.conversionOverrides,
    };
  }, [fullData, countryFilter, dataState?.countryMonthlyData]);
}
