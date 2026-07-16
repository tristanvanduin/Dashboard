"use client";

import { useState } from "react";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { computeForecast, MONTH_LABELS, type ForecastMetric } from "@/lib/forecast";

function formatNumber(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function formatRoas(v: number): string {
  return `${v.toFixed(2)}x`;
}

const METRICS: { id: ForecastMetric; label: string; format: (v: number) => string }[] = [
  { id: "conversions", label: "Conversies", format: formatNumber },
  { id: "revenue", label: "Omzet", format: formatCurrency },
  { id: "roas", label: "ROAS", format: formatRoas },
  { id: "cpa", label: "CPA", format: formatCurrency },
];

export function ForecastTable({ clientId }: { clientId: string }) {
  const [selectedMetric, setSelectedMetric] = useState<ForecastMetric>("conversions");
  const data = useClientHistoricalData(clientId);
  const forecast = computeForecast(data);

  const metric = METRICS.find((m) => m.id === selectedMetric)!;
  const result = forecast[selectedMetric];
  const fmt = metric.format;

  // CPA: lower is better
  const isInverted = selectedMetric === "cpa";

  // Totals
  const totalExpected = result.points.reduce((s, p) => s + p.expected, 0);
  const totalRealized = result.points.reduce((s, p) => s + (p.realized ?? 0), 0);
  const totalForecast = result.points.reduce((s, p) => s + (p.forecast ?? 0), 0);
  const totalValue = totalRealized + totalForecast;

  // For ROAS/CPA totals, use the KPI values (not sum of monthly)
  const isRatio = selectedMetric === "roas" || selectedMetric === "cpa";
  const kpiTarget = result.kpi.annualTarget;
  const kpiAdjusted = result.kpi.adjustedAnnual;
  const totalDiffPct = result.kpi.diffPct;

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header with metric tabs */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">
          Maandelijkse uitsplitsing — {metric.label}
        </h3>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {METRICS.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedMetric(m.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                selectedMetric === m.id
                  ? "bg-rm-blue text-white"
                  : "text-muted-foreground hover:text-rm-blue"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-b border-border bg-gray-50/50">
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Maand</th>
              <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Verwacht</th>
              <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Gerealiseerd</th>
              <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Prognose</th>
              <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {result.points.map((pt) => {
              const value = pt.realized ?? pt.forecast ?? 0;
              const ratio = pt.monthRatio;
              const isPositive = isInverted ? ratio <= 1 : ratio >= 1;
              const isRealized = pt.realized !== null;

              return (
                <tr
                  key={pt.month}
                  className={`border-b border-border/50 ${isRealized ? "bg-white" : "bg-gray-50/30"}`}
                >
                  <td className="px-5 py-2.5 font-medium text-rm-gray">{pt.monthLabel}</td>
                  <td className="px-5 py-2.5 text-right text-muted-foreground">{fmt(pt.expected)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-rm-gray">
                    {pt.realized !== null ? fmt(pt.realized) : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right text-rm-blue font-medium">
                    {pt.forecast !== null ? fmt(pt.forecast) : "—"}
                  </td>
                  <td className={`px-5 py-2.5 text-right font-bold ${isPositive ? "text-green-600" : "text-red-500"}`}>
                    {(ratio * 100).toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-gray-50">
              <td className="px-5 py-3 font-bold text-rm-gray">Totaal</td>
              <td className="px-5 py-3 text-right font-semibold text-muted-foreground">
                {isRatio ? fmt(kpiTarget) : fmt(totalExpected)}
              </td>
              <td className="px-5 py-3 text-right font-bold text-rm-gray">
                {isRatio ? "—" : fmt(totalRealized)}
              </td>
              <td className="px-5 py-3 text-right font-bold text-rm-blue">
                {isRatio ? fmt(kpiAdjusted) : fmt(totalForecast)}
              </td>
              <td className={`px-5 py-3 text-right font-bold ${
                (isInverted ? totalDiffPct <= 0 : totalDiffPct >= 0) ? "text-green-600" : "text-red-500"
              }`}>
                {totalDiffPct > 0 ? "+" : ""}{totalDiffPct.toFixed(0)}%
              </td>
            </tr>
            {/* Annual forecast summary row */}
            {!isRatio && (
              <tr className="bg-rm-blue/5">
                <td className="px-5 py-2.5 text-xs font-semibold text-rm-blue" colSpan={2}>
                  Jaarprognose (gerealiseerd + prognose)
                </td>
                <td className="px-5 py-2.5 text-right text-xs font-bold text-rm-blue" colSpan={2}>
                  {fmt(totalRealized + totalForecast)}
                </td>
                <td className={`px-5 py-2.5 text-right text-xs font-bold ${
                  (isInverted ? totalDiffPct <= 0 : totalDiffPct >= 0) ? "text-green-600" : "text-red-500"
                }`}>
                  vs doel {fmt(totalExpected)}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
