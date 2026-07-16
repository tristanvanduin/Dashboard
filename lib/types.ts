export interface WeeklyRecord {
  week: number;    // 1-based week within the month (1–5)
  month: number;   // 1–12
  conversions: number;
  revenue: number;
  adSpend: number;
}

export interface MonthlyRecord {
  month: number; // 1–12
  conversions: number;
  revenue: number;
  adSpend: number;
  weeks: WeeklyRecord[];
}

export interface ClientAnnualData {
  conversions: number;
  revenue: number;
  adSpend: number;
}

export interface ClientHistoricalData {
  clientId: string;
  /** Target for the current year */
  targetCurrentYear: ClientAnnualData;
  /**
   * Historical years keyed by year number (e.g., { 2022: [...], 2023: [...], 2024: [...], 2025: [...] }).
   * More years = better forecasts. The engine weighs recent years heavier.
   */
  historicalYears: Record<number, MonthlyRecord[]>;
  /** Current year data — realized months + null for future months */
  currentYearData: (MonthlyRecord | null)[];
  /** What year is "current" */
  currentYear: number;
  /** Manual conversion overrides for months with broken tracking. Key = "YYYY-MM", value = estimated conversions */
  conversionOverrides?: Record<string, number>;
}

// ── Backwards compatibility: map old field names to new structure ──

/** @deprecated Use historicalYears / currentYearData instead */
export function getHistoricalYear(data: ClientHistoricalData, year: number): MonthlyRecord[] {
  if (year === data.currentYear) {
    return data.currentYearData.map((m, i) => m ?? {
      month: i + 1, conversions: 0, revenue: 0, adSpend: 0, weeks: [],
    });
  }
  return data.historicalYears[year] ?? Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, conversions: 0, revenue: 0, adSpend: 0, weeks: [],
  }));
}

// Months with realized data for the current year
export const REALIZED_THROUGH_MONTH = 3; // Jan–Mar
export const CURRENT_YEAR = 2026;
