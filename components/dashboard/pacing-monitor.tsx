"use client";

import { useMemo } from "react";
import { Clock, Target, Zap, AlertTriangle, TrendingUp, Calendar } from "lucide-react";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast } from "@/lib/forecast";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 }).format(v);
}

function PacingRing({ pct, color, size = 44 }: { pct: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(pct / 100, 1) * circ;

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E1E5F2" strokeWidth="5" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
      />
    </svg>
  );
}

export function PacingMonitor({ clientId, countryFilter }: { clientId: string; countryFilter?: string | null }) {
  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const forecast = useMemo(() => computeForecast(data), [data]);

  const conv = forecast.conversions.kpi;
  const spend = forecast.adSpend.kpi;
  const rev = forecast.revenue.kpi;

  const now = new Date();
  const currentMonth = now.getMonth(); // 0-indexed
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate();
  const monthProgressPct = (dayOfMonth / daysInMonth) * 100;

  // Year progress
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const yearProgressPct = (dayOfYear / 365) * 100;

  // Realized months
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null);
  const realizedCount = realizedMonths.length;

  // Year pacing: compare realized vs EXPECTED for this period (not linear annual %)
  // This accounts for seasonality — Q1 might only be 15% of the annual target, not 25%
  const convExpectedYtd = conv.ytdExpected;
  const spendExpectedYtd = spend.ytdExpected;

  // Pacing %: how far are we toward annual target
  const convPacingPct = conv.annualTarget > 0 ? (conv.ytdRealized / conv.annualTarget) * 100 : 0;
  const spendPacingPct = spend.annualTarget > 0 ? (spend.ytdRealized / spend.annualTarget) * 100 : 0;
  const revPacingPct = rev.annualTarget > 0 ? (rev.ytdRealized / rev.annualTarget) * 100 : 0;

  // On pace? Compare realized vs what was EXPECTED for this period (season-aware)
  const convPaceRatio = convExpectedYtd > 0 ? conv.ytdRealized / convExpectedYtd : 1;
  const spendPaceRatio = spendExpectedYtd > 0 ? spend.ytdRealized / spendExpectedYtd : 1;

  // Daily run rate
  const daysElapsed = Math.max(dayOfYear, 1);
  const dailyConvRate = conv.ytdRealized / daysElapsed;
  const dailySpendRate = spend.ytdRealized / daysElapsed;
  const remainingDays = 365 - dayOfYear;
  // "Nodig per dag" based on remaining target gap (target - realized so far)
  const convGap = Math.max(0, conv.annualTarget - conv.ytdRealized);
  const spendGap = Math.max(0, spend.annualTarget - spend.ytdRealized);
  const convNeededPerDay = remainingDays > 0 ? convGap / remainingDays : 0;
  const spendNeededPerDay = remainingDays > 0 ? spendGap / remainingDays : 0;

  // Status colors & labels
  // Conversions: straightforward pace check
  const convColor = convPaceRatio >= 0.9 ? "#22c55e" : convPaceRatio >= 0.7 ? "#f59e0b" : "#ef4444";
  const convStatus = convPaceRatio >= 0.9 ? "Op schema" : convPaceRatio >= 0.7 ? "Achterlopend" : "Sterk achter";

  // Budget: also consider whether spend is translating into results
  // If spend is "on track" but conversions are far behind, the spend is inefficient
  const spendIsOnPace = spendPaceRatio >= 0.9;
  const convIsWayBehind = convPaceRatio < 0.7;
  const spendColor = spendIsOnPace && convIsWayBehind
    ? "#f59e0b"  // amber: spending enough but not getting results
    : spendPaceRatio >= 0.9 ? "#22c55e" : spendPaceRatio >= 0.7 ? "#f59e0b" : "#ef4444";
  const spendStatus = spendIsOnPace && convIsWayBehind
    ? "Inefficiënt"
    : spendPaceRatio >= 0.9 ? "Op schema" : spendPaceRatio >= 0.7 ? "Achterlopend" : "Sterk achter";

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">Pacing</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">
          Dag {dayOfYear} van 365 · {Math.round(yearProgressPct)}% van het jaar
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Conversions pacing */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <PacingRing pct={convPacingPct} color={convColor} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-bold" style={{ color: convColor }}>
                {Math.round(convPacingPct)}%
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-rm-gray">Conversies</p>
            <p className="text-[10px] text-muted-foreground">{num(conv.ytdRealized)} / {num(conv.annualTarget)}</p>
            <p className="text-[10px] font-medium" style={{ color: convColor }}>{convStatus}</p>
          </div>
        </div>

        {/* Spend pacing */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <PacingRing pct={spendPacingPct} color={spendColor} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-bold" style={{ color: spendColor }}>
                {Math.round(spendPacingPct)}%
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-rm-gray">Budget</p>
            <p className="text-[10px] text-muted-foreground">{fmt(spend.ytdRealized)} / {fmt(spend.annualTarget)}</p>
            <p className="text-[10px] font-medium" style={{ color: spendColor }}>{spendStatus}</p>
          </div>
        </div>

        {/* Daily run rate — conversions */}
        <div className="border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tempo conversies</p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-rm-gray">{num(dailyConvRate)}</span>
            <span className="text-[10px] text-muted-foreground">/dag</span>
          </div>
          {convNeededPerDay > 0 && (
            <p className={`text-[10px] mt-1 ${dailyConvRate >= convNeededPerDay ? "text-green-600" : "text-red-500"}`}>
              {dailyConvRate >= convNeededPerDay ? "✓" : "✗"} Nodig: {num(convNeededPerDay)}/dag
            </p>
          )}
        </div>

        {/* Daily run rate — spend */}
        <div className="border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tempo spend</p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-rm-gray">{fmt(dailySpendRate)}</span>
            <span className="text-[10px] text-muted-foreground">/dag</span>
          </div>
          {spendNeededPerDay > 0 && (
            <p className={`text-[10px] mt-1 ${dailySpendRate >= spendNeededPerDay * 0.9 ? "text-green-600" : "text-red-500"}`}>
              {dailySpendRate >= spendNeededPerDay * 0.9 ? "✓" : "✗"} Nodig: {fmt(spendNeededPerDay)}/dag
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
