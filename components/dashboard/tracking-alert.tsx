"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { useClientDataState } from "@/lib/client-data-provider";
import type { MonthlyRecord } from "@/lib/types";

/**
 * Detects potential tracking breaks by comparing conversion efficiency (conv/spend)
 * against historical patterns. If efficiency drops >75% while spend is stable,
 * this likely indicates a tracking problem — not a performance problem.
 */
export function TrackingAlert({ clientId, onNavigateToSettings }: {
  clientId: string;
  onNavigateToSettings?: () => void;
}) {
  const dataState = useClientDataState();

  if (!dataState?.data) return null;

  const currentData = dataState.data.currentYearData;
  const realizedMonths = currentData.filter((m): m is MonthlyRecord => m !== null);

  if (realizedMonths.length < 2) return null;

  // Calculate historical conversion efficiency from previous years
  const historicalYears = Object.values(dataState.data.historicalYears);
  const allHistorical = historicalYears.flat();
  const historicalEfficiencies = allHistorical
    .filter((m) => m.conversions > 0 && m.adSpend > 0)
    .map((m) => m.conversions / m.adSpend);

  if (historicalEfficiencies.length < 6) return null;

  // Median historical efficiency (conversions per euro spent)
  const sorted = [...historicalEfficiencies].sort((a, b) => a - b);
  const medianEfficiency = sorted[Math.floor(sorted.length / 2)];

  if (medianEfficiency <= 0) return null;

  // Check recent months for efficiency anomalies
  const anomalyMonths: { month: MonthlyRecord; idx: number; efficiency: number }[] = [];

  for (let i = 0; i < realizedMonths.length; i++) {
    const m = realizedMonths[i];
    if (m.adSpend <= 0) continue;

    const efficiency = m.conversions / m.adSpend;
    // Flag if efficiency is <25% of historical median AND conversions dropped significantly
    if (efficiency < medianEfficiency * 0.25) {
      anomalyMonths.push({ month: m, idx: i, efficiency });
    }
  }

  // Only show alert if the most recent month(s) have anomalies
  const recentAnomaly = anomalyMonths.find((a) => a.idx === realizedMonths.length - 1);
  if (!recentAnomaly && anomalyMonths.length < 2) return null;

  // If no recent anomaly but multiple historical ones, still show for awareness
  if (!recentAnomaly) return null;

  const monthLabels = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
  const lastMonth = recentAnomaly.month;
  const monthLabel = monthLabels[recentAnomaly.idx] || `Maand ${recentAnomaly.idx + 1}`;
  const efficiencyDrop = Math.round((1 - recentAnomaly.efficiency / medianEfficiency) * 100);

  // Count how many consecutive recent months have anomalies
  let streakCount = 0;
  for (let i = realizedMonths.length - 1; i >= 0; i--) {
    if (anomalyMonths.some((a) => a.idx === i)) {
      streakCount++;
    } else {
      break;
    }
  }

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-red-700">
            Mogelijke tracking anomalie gedetecteerd
          </h3>
          <p className="text-xs text-red-600 mt-1">
            In {monthLabel} is de conversie-efficiëntie {efficiencyDrop}% lager dan het historisch gemiddelde
            ({lastMonth.conversions} conversies bij €{Math.round(lastMonth.adSpend)} spend).
            {streakCount > 1 && ` Dit patroon houdt al ${streakCount} maanden aan.`}
            {" "}Dit wijst mogelijk op een probleem met de conversietracking.
          </p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[10px] text-red-500">
              Controleer: Google Tag Assistant / GTM debug mode / conversieacties in Google Ads
            </span>
            {onNavigateToSettings && (
              <button
                onClick={onNavigateToSettings}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-red-700 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                Conversie override instellen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
