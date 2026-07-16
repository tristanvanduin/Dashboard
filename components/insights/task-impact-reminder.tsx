"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Eye, X, ChevronDown, ChevronUp } from "lucide-react";
import { supabase, type TaskCompletion, type KpiSnapshot } from "@/lib/supabase";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { computeForecast } from "@/lib/forecast";
import { TaskImpactDetail } from "./task-impact-detail";

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function getCurrentKpiSnapshot(clientId: string, data: ReturnType<typeof useClientHistoricalData>): KpiSnapshot {
  const forecast = computeForecast(data);
  const convPts = forecast.conversions.points.filter((p) => p.realized !== null);
  const cpaPts = forecast.cpa.points.filter((p) => p.realized !== null);
  const roasPts = forecast.roas.points.filter((p) => p.realized !== null);
  const lastConv = convPts[convPts.length - 1];
  const lastCpa = cpaPts[cpaPts.length - 1];
  const lastRoas = roasPts[roasPts.length - 1];

  return {
    conversions: lastConv?.realized ?? 0,
    revenue: forecast.revenue.kpi.ytdRealized,
    adSpend: forecast.adSpend.kpi.ytdRealized,
    cpa: lastCpa?.realized ?? 0,
    roas: lastRoas?.realized ?? 0,
  };
}

export function TaskImpactReminder({ clientId }: { clientId: string }) {
  const [pendingReminders, setPendingReminders] = useState<TaskCompletion[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [checkedImpact, setCheckedImpact] = useState<Record<string, KpiSnapshot>>({});
  const clientData = useClientHistoricalData(clientId);

  const fetchReminders = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("task_completions")
      .select("*")
      .eq("client_id", clientId)
      .eq("reminder_dismissed", false)
      .is("followup_checked_at", null)
      .order("completed_at", { ascending: false });

    // Filter to only show reminders that are due
    const due = (data ?? []).filter((tc: TaskCompletion) => {
      const daysSince = daysAgo(tc.completed_at);
      return daysSince >= tc.reminder_days;
    });

    setPendingReminders(due);
  }, [clientId]);

  useEffect(() => { fetchReminders(); }, [fetchReminders]);

  async function checkImpact(tc: TaskCompletion) {
    if (!supabase) return;
    const currentKpi = getCurrentKpiSnapshot(clientId, clientData);

    await supabase.from("task_completions").update({
      followup_kpi: currentKpi,
      followup_checked_at: new Date().toISOString(),
    }).eq("id", tc.id);

    setCheckedImpact((prev) => ({ ...prev, [tc.id]: currentKpi }));
  }

  async function dismiss(id: string) {
    if (!supabase) return;
    await supabase.from("task_completions").update({
      reminder_dismissed: true,
    }).eq("id", id);
    setPendingReminders((prev) => prev.filter((r) => r.id !== id));
  }

  if (pendingReminders.length === 0) return null;

  return (
    <div className="bg-amber-50 rounded-xl border border-amber-200 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-amber-600" />
        <h3 className="text-sm font-semibold text-amber-800 uppercase tracking-wide">
          Impact check ({pendingReminders.length})
        </h3>
        <p className="text-[10px] text-amber-600 ml-auto">
          Taken die eerder afgevinkt zijn — tijd om de impact te meten
        </p>
      </div>

      <div className="space-y-2">
        {pendingReminders.map((tc) => {
          const days = daysAgo(tc.completed_at);
          const isExpanded = expandedId === tc.id;
          const impact = checkedImpact[tc.id] ?? tc.followup_kpi;

          return (
            <div key={tc.id} className="bg-white rounded-lg border border-amber-100 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-rm-gray">{tc.task_text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Afgevinkt {days} dagen geleden · {tc.cadence}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!impact && (
                    <button
                      onClick={() => checkImpact(tc)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-rm-blue text-white hover:bg-rm-blue/90"
                    >
                      <Eye className="w-3 h-3" /> Check impact
                    </button>
                  )}
                  {impact && (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : tc.id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-green-100 text-green-700"
                    >
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      Bekijk resultaat
                    </button>
                  )}
                  <button
                    onClick={() => dismiss(tc.id)}
                    className="p-1 rounded hover:bg-gray-100"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              </div>

              {/* Impact detail */}
              {isExpanded && impact && (
                <TaskImpactDetail before={tc.kpi_snapshot} after={impact} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
