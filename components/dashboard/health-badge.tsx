"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Info, Activity } from "lucide-react";
import { useClientHistoricalData, useClientDataState } from "@/lib/client-data-provider";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, type HealthScore } from "@/lib/health-score";

export function HealthBadge({ clientId }: { clientId: string }) {
  const data = useClientHistoricalData(clientId);
  const dataState = useClientDataState();
  const forecast = useMemo(() => computeForecast(data), [data]);

  const health = useMemo(() => computeHealthScore(
    forecast,
    dataState?.impressionShare,
    dataState?.wastefulSearchTerms,
    dataState?.adGroupBleeders,
  ), [forecast, dataState]);

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-start gap-5">
        {/* Score circle */}
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90">
            <circle cx="40" cy="40" r="34" fill="none" stroke="#E1E5F2" strokeWidth="6" />
            <circle
              cx="40" cy="40" r="34" fill="none"
              stroke={health.total >= 70 ? "#22c55e" : health.total >= 50 ? "#f59e0b" : "#ef4444"}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${health.total * 2.136} 213.6`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-xl font-bold ${health.color}`}>{health.total}</span>
            <span className="text-[9px] font-semibold text-muted-foreground">{health.grade}</span>
          </div>
        </div>

        {/* Factors */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-rm-blue" />
            <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">Account Health</h3>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {health.factors.map((f) => (
              <div key={f.name} className="text-center">
                <div className="text-xs font-semibold text-rm-gray">{f.score}/{f.maxScore}</div>
                <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${f.score >= 16 ? "bg-green-400" : f.score >= 10 ? "bg-amber-400" : "bg-red-400"}`}
                    style={{ width: `${(f.score / f.maxScore) * 100}%` }}
                  />
                </div>
                <div className="text-[9px] text-muted-foreground mt-1">{f.name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Anomalies */}
        {health.anomalies.length > 0 && (
          <div className="w-72 shrink-0">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Anomalieën ({health.anomalies.length})
            </p>
            <div className="space-y-1.5 max-h-[80px] overflow-y-auto">
              {health.anomalies.slice(0, 4).map((a, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  {a.severity === "critical" ? (
                    <AlertTriangle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                  ) : a.severity === "warning" ? (
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                  )}
                  <span className="text-[11px] text-rm-gray leading-tight">{a.title}</span>
                </div>
              ))}
              {health.anomalies.length > 4 && (
                <span className="text-[10px] text-muted-foreground">+{health.anomalies.length - 4} meer</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
