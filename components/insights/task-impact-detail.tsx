"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { KpiSnapshot } from "@/lib/supabase";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

interface MetricDelta {
  label: string;
  before: string;
  after: string;
  deltaPct: number;
  /** If true, a decrease is good (e.g., CPA) */
  inverted?: boolean;
}

function computeDeltas(before: KpiSnapshot, after: KpiSnapshot): MetricDelta[] {
  const delta = (b: number, a: number) => b > 0 ? ((a - b) / b) * 100 : 0;

  return [
    {
      label: "CPA",
      before: fmt(before.cpa),
      after: fmt(after.cpa),
      deltaPct: delta(before.cpa, after.cpa),
      inverted: true,
    },
    {
      label: "ROAS",
      before: `${before.roas.toFixed(2)}x`,
      after: `${after.roas.toFixed(2)}x`,
      deltaPct: delta(before.roas, after.roas),
    },
    {
      label: "Conversies",
      before: before.conversions.toLocaleString("nl-NL"),
      after: after.conversions.toLocaleString("nl-NL"),
      deltaPct: delta(before.conversions, after.conversions),
    },
    {
      label: "Omzet",
      before: fmt(before.revenue),
      after: fmt(after.revenue),
      deltaPct: delta(before.revenue, after.revenue),
    },
    {
      label: "Spend",
      before: fmt(before.adSpend),
      after: fmt(after.adSpend),
      deltaPct: delta(before.adSpend, after.adSpend),
      inverted: true,
    },
  ];
}

export function TaskImpactDetail({
  before,
  after,
}: {
  before: KpiSnapshot;
  after: KpiSnapshot;
}) {
  const deltas = computeDeltas(before, after);

  return (
    <div className="grid grid-cols-5 gap-2 mt-3">
      {deltas.map((d) => {
        const isPositive = d.inverted ? d.deltaPct < 0 : d.deltaPct > 0;
        const isNeutral = Math.abs(d.deltaPct) < 1;

        return (
          <div key={d.label} className="bg-gray-50 rounded-lg p-2 text-center">
            <p className="text-[9px] text-muted-foreground font-medium uppercase">{d.label}</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              {isNeutral ? (
                <Minus className="w-3 h-3 text-gray-400" />
              ) : isPositive ? (
                <TrendingUp className="w-3 h-3 text-green-500" />
              ) : (
                <TrendingDown className="w-3 h-3 text-red-500" />
              )}
              <span className={`text-[11px] font-bold ${
                isNeutral ? "text-gray-400" : isPositive ? "text-green-600" : "text-red-500"
              }`}>
                {d.deltaPct > 0 ? "+" : ""}{d.deltaPct.toFixed(1)}%
              </span>
            </div>
            <p className="text-[9px] text-muted-foreground mt-0.5">
              {d.before} → {d.after}
            </p>
          </div>
        );
      })}
    </div>
  );
}
