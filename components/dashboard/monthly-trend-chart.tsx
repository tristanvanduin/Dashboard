"use client";

import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { TrendingUp } from "lucide-react";

// Herbruikbare maand-trendgrafiek: spend-balken (linker-as) plus een tweede metriek als lijn
// (rechter-as). Gebruikt door het beursoverzicht en de cross-channel-view zodat het verhaal
// zichtbaar wordt naast de tabel. Rendert niets onder de twee datapunten (een lijn van één
// punt is zinloos).

export interface MonthlyTrendPoint {
  maand: string;
  spend: number;
  lijn: number;
}

export function MonthlyTrendChart({ title, data, lineLabel, height = 240 }: {
  title: string;
  data: MonthlyTrendPoint[];
  lineLabel: string;
  height?: number;
}) {
  if (data.length < 2) return null;
  const rows = data.map((d) => ({ maand: d.maand, Spend: Math.round(d.spend), [lineLabel]: Math.round(d.lijn) }));

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <TrendingUp className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">{title}</h3>
      </div>
      <div className="px-3 py-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
            <XAxis dataKey="maand" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="spend" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="lijn" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="spend" dataKey="Spend" fill="#08288C" radius={[3, 3, 0, 0]} opacity={0.85} />
            <Line yAxisId="lijn" dataKey={lineLabel} stroke="#F16B37" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Gegroepeerde maandbalken per serie (bijv. spend per kanaal), voor de cross-channel-vergelijking.
const SERIES_COLORS = ["#08288C", "#F16B37", "#3B9C6E", "#8B5CF6"];

export function GroupedMonthlyBars({ title, months, series, data, height = 260 }: {
  title: string;
  months: string[];
  series: string[];
  data: Record<string, number | string>[];
  height?: number;
}) {
  if (months.length < 1 || series.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <TrendingUp className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">{title}</h3>
      </div>
      <div className="px-3 py-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
            <XAxis dataKey="maand" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} opacity={0.9} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
