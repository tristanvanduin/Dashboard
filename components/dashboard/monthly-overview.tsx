"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, CheckCircle2, Clock, ArrowRight } from "lucide-react";
import { REALIZED_THROUGH_MONTH } from "@/lib/types";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast, ForecastMetric, ForecastPoint, MONTH_LABELS } from "@/lib/forecast";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

function formatNumber(v: number) {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

const METRIC_LABELS: Record<ForecastMetric, string> = {
  conversions: "Conversies",
  revenue: "Omzet",
  roas: "ROAS",
  cpa: "CPA",
};

/** CPA is inverted: lower is better */
function isLowerBetter(metric: ForecastMetric): boolean {
  return metric === "cpa";
}

function getFormatter(metric: ForecastMetric) {
  if (metric === "revenue" || metric === "cpa") return formatCurrency;
  if (metric === "roas") return (v: number) => `${v.toFixed(2)}x`;
  return formatNumber;
}

function MonthCard({
  pt,
  format,
  variant,
  inverted,
  partialRealized,
  monthProgressPct,
}: {
  pt: ForecastPoint;
  format: (v: number) => string;
  variant: "previous" | "current" | "next";
  /** If true, lower values are better (CPA) */
  inverted?: boolean;
  /** For current month: realized value so far (partial month) */
  partialRealized?: number;
  /** For current month: % of month elapsed */
  monthProgressPct?: number;
}) {
  const value = pt.realized ?? pt.forecast ?? 0;
  const diff = pt.expected > 0 ? ((value - pt.expected) / pt.expected) * 100 : 0;
  const ratio = pt.monthRatio;
  // For CPA: lower than expected = positive
  const isPositive = inverted ? diff <= 0 : diff >= 0;
  const isRealized = pt.realized !== null;
  const isCurrent = variant === "current";

  const diffColor = isPositive ? "text-green-600" : "text-red-500";

  const borderColors = {
    previous: isPositive ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50",
    current: "border-rm-blue/30 bg-rm-blue/5",
    next: "border-border bg-gray-50/50",
  };

  const labels = {
    previous: "Vorige maand",
    current: "Huidige maand",
    next: "Volgende maand",
  };

  const statusIcons = {
    previous: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
    current: <Clock className="w-3.5 h-3.5 text-rm-blue" />,
    next: <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />,
  };

  // For current month: partial realized pacing
  const hasPartial = isCurrent && partialRealized !== undefined && partialRealized > 0;
  const partialPacingPct = hasPartial && monthProgressPct && pt.expected > 0
    ? (partialRealized! / (pt.expected * (monthProgressPct / 100))) * 100
    : 0;
  const partialIsOnTrack = partialPacingPct >= 90;

  return (
    <div className={`rounded-lg border p-4 ${borderColors[variant]}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {statusIcons[variant]}
          <div>
            <span className="text-sm font-semibold text-rm-gray">{pt.monthLabel} 2026</span>
            <span className="text-[10px] text-muted-foreground ml-1.5">{labels[variant]}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isPositive
            ? <TrendingUp className="w-3.5 h-3.5 text-green-600" />
            : <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          }
          <span className={`text-xs font-bold ${diffColor}`}>
            {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Values */}
      <div className="space-y-1.5">
        {/* Current month: Gerealiseerd (partial) at the top */}
        {hasPartial && (
          <div className="flex justify-between items-baseline">
            <span className="text-[11px] text-muted-foreground">Gerealiseerd</span>
            <span className="text-base font-bold text-rm-blue">
              {format(partialRealized!)}
            </span>
          </div>
        )}

        {/* Main value: Gerealiseerd (previous) or Prognose (current/next) */}
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] text-muted-foreground">
            {isRealized ? "Gerealiseerd" : "Prognose"}
          </span>
          <span className={`${hasPartial ? "text-xs" : "text-base font-bold"} ${
            hasPartial ? "text-muted-foreground" : variant === "current" ? "text-rm-blue" : "text-rm-gray"
          }`}>
            {format(value)}
          </span>
        </div>

        {/* Verwacht */}
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] text-muted-foreground">Verwacht</span>
          <span className="text-xs text-muted-foreground">{format(pt.expected)}</span>
        </div>
      </div>

      {/* Ratio bar */}
      <div className="mt-3">
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-muted-foreground">Ratio</span>
          <span className={`font-semibold ${diffColor}`}>
            {(ratio * 100).toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 bg-white/80 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isPositive ? "bg-green-500" : "bg-red-500"
            }`}
            style={{ width: `${Math.min(ratio * 100, 120)}%` }}
          />
        </div>
        {/* Current month: mini progress within the month */}
        {hasPartial && monthProgressPct && (
          <div className="mt-1.5">
            <div className="flex justify-between text-[10px] mb-0.5">
              <span className="text-muted-foreground">Maandvoortgang</span>
              <span className={`font-medium ${partialIsOnTrack ? "text-green-600" : "text-amber-500"}`}>
                {Math.round(monthProgressPct)}% van maand
              </span>
            </div>
            <div className="h-1 bg-white/80 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${partialIsOnTrack ? "bg-rm-blue" : "bg-amber-400"}`}
                style={{ width: `${Math.min(monthProgressPct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MonthlyOverview({ clientId, countryFilter }: { clientId: string; countryFilter?: string | null }) {
  const [metric, setMetric] = useState<ForecastMetric>("conversions");

  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const forecast = computeForecast(data);
  const result = forecast[metric];
  const format = getFormatter(metric);

  // Previous = last realized month, Current = first forecast, Next = second forecast
  const prevMonth = result.points[REALIZED_THROUGH_MONTH - 1]; // Mar (index 2)
  const currMonth = result.points[REALIZED_THROUGH_MONTH];      // Apr (index 3)
  const nextMonth = result.points[REALIZED_THROUGH_MONTH + 1];  // May (index 4)

  // Current month partial realization from weekly data
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgressPct = (dayOfMonth / daysInMonth) * 100;

  // Sum realized weeks for current month, or estimate from daily run rate
  const currentMonthWeeks = result.weeklyPoints.filter(
    (wp) => wp.month === REALIZED_THROUGH_MONTH + 1
  );
  const weeklyRealized = currentMonthWeeks
    .filter((wp) => wp.realized !== null)
    .reduce((s, wp) => s + (wp.realized ?? 0), 0);

  // If no weekly data yet, estimate from YTD daily rate × days elapsed this month
  const partialRealized = weeklyRealized > 0
    ? weeklyRealized
    : (() => {
        const kpi = forecast[metric === "roas" || metric === "cpa" ? "conversions" : metric].kpi;
        const daysElapsed = Math.floor(
          (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
        );
        const dailyRate = daysElapsed > 0 ? kpi.ytdRealized / daysElapsed : 0;
        // For derived metrics (ROAS, CPA), use the underlying values
        if (metric === "roas") {
          const revDaily = forecast.revenue.kpi.ytdRealized / daysElapsed;
          const spendDaily = forecast.adSpend.kpi.ytdRealized / daysElapsed;
          return spendDaily > 0 ? (revDaily * dayOfMonth) / (spendDaily * dayOfMonth) : 0;
        }
        if (metric === "cpa") {
          const spendDaily = forecast.adSpend.kpi.ytdRealized / daysElapsed;
          const convDaily = forecast.conversions.kpi.ytdRealized / daysElapsed;
          return convDaily > 0 ? (spendDaily * dayOfMonth) / (convDaily * dayOfMonth) : 0;
        }
        return Math.round(dailyRate * dayOfMonth);
      })();

  // All 12 months for the strip — focus months are highlighted
  const focusIndices = new Set([REALIZED_THROUGH_MONTH - 1, REALIZED_THROUGH_MONTH, REALIZED_THROUGH_MONTH + 1]);

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header with metric tabs */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">
            Maandprestaties
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Vorige, huidige en volgende maand · ratio geeft aan of je boven of onder verwachting zit
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(["conversions", "revenue", "roas", "cpa"] as ForecastMetric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                metric === m
                  ? "bg-rm-blue text-white"
                  : "text-muted-foreground hover:text-rm-blue"
              }`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* 3 main month cards */}
      <div className="px-5 pb-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {prevMonth && <MonthCard pt={prevMonth} format={format} variant="previous" inverted={isLowerBetter(metric)} />}
          {currMonth && <MonthCard pt={currMonth} format={format} variant="current" inverted={isLowerBetter(metric)} partialRealized={partialRealized} monthProgressPct={monthProgressPct} />}
          {nextMonth && <MonthCard pt={nextMonth} format={format} variant="next" inverted={isLowerBetter(metric)} />}
        </div>
      </div>

      {/* All 12 months — focus months highlighted */}
      <div className="mt-2 border-t border-border">
        <div className="px-5 py-3">
          <div className="flex gap-0.5 overflow-x-auto">
            {result.points.map((pt, i) => {
              const value = pt.realized ?? pt.forecast ?? 0;
              const isRealized = pt.realized !== null;
              const isFocus = focusIndices.has(i);
              const ratio = pt.monthRatio;
              // CPA: ratio < 1 means cheaper than expected = good
              const inverted = isLowerBetter(metric);
              const isPositive = inverted ? ratio <= 1 : ratio >= 1;
              const ratioColor = isPositive ? "text-green-600" : "text-red-500";
              const barColor = isPositive ? "bg-green-400" : "bg-red-400";

              return (
                <div
                  key={pt.month}
                  className={`flex-1 min-w-[52px] rounded-md px-1.5 py-2 text-center transition-colors ${
                    isFocus
                      ? "bg-rm-blue/8 ring-1 ring-rm-blue/20"
                      : isRealized
                        ? "bg-gray-50"
                        : ""
                  }`}
                >
                  <p className={`text-[10px] font-medium mb-1 ${
                    isFocus ? "text-rm-blue font-semibold" : isRealized ? "text-rm-gray" : "text-muted-foreground"
                  }`}>
                    {pt.monthLabel}
                  </p>
                  <p className={`text-[11px] font-semibold ${isFocus ? "text-rm-blue" : "text-rm-gray"}`}>
                    {format(value)}
                  </p>
                  <div className="mt-1.5 mx-auto w-full max-w-[36px]">
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${Math.min(ratio * 100, 120)}%` }}
                      />
                    </div>
                  </div>
                  <p className={`text-[9px] font-bold mt-0.5 ${ratioColor}`}>
                    {(ratio * 100).toFixed(0)}%
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
