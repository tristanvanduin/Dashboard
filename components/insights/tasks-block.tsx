"use client";

import { useState, useEffect, useMemo } from "react";
import { CheckCircle2, Circle, Clock, CalendarDays, CalendarRange, Zap } from "lucide-react";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { computeForecast, type ClientForecast } from "@/lib/forecast";
import { getClientSettings } from "@/lib/client-settings";
import { supabase, type KpiSnapshot } from "@/lib/supabase";

type Cadence = "actions" | "weekly" | "biweekly" | "monthly";

interface Task {
  id: string;
  text: string;
  done: boolean;
  step: string;
  dynamic?: boolean;
}

const CADENCE_CONFIG: Record<Cadence, { label: string; icon: React.ReactNode }> = {
  actions: { label: "Acties", icon: <Zap className="w-3.5 h-3.5" /> },
  weekly: { label: "Wekelijks", icon: <Clock className="w-3.5 h-3.5" /> },
  biweekly: { label: "2-Wekelijks", icon: <CalendarDays className="w-3.5 h-3.5" /> },
  monthly: { label: "Maandelijks", icon: <CalendarRange className="w-3.5 h-3.5" /> },
};

const SOP_TASKS: Record<Exclude<Cadence, "actions">, Task[]> = {
  weekly: [
    { id: "w1", step: "§1", text: "Account health check: last 7 days KPI's controleren op onverwachte verschuivingen", done: false },
    { id: "w2", step: "§1", text: "Account trendlines (14 dagen) checken op snel ontwikkelende negatieve trends", done: false },
    { id: "w3", step: "§2", text: "Keyword Buckets (7 dagen): Bleeders identificeren die directe actie vereisen", done: false },
    { id: "w4", step: "§3", text: "Search Term Buckets (7 dagen): Bleeders identificeren, negatieve zoekwoorden toevoegen", done: false },
    { id: "w5", step: "§4", text: "Product Buckets (7 dagen): Product Bleeders identificeren en actie ondernemen", done: false },
    { id: "w6", step: "§5", text: "Geautomatiseerde alerts mail controleren (Critical/Strong/Mild) en beoordelen", done: false },
  ],
  biweekly: [
    { id: "b1", step: "§1", text: "Account Performance: huidige maand vs doelstellingen, eerder geïdentificeerde KPI's checken", done: false },
    { id: "b2", step: "§2", text: "Campagne Performance: over- en underperformers checken, trend ontwikkeling (30 dagen)", done: false },
    { id: "b3", step: "§3", text: "Ad Group Performance: bijdrage aan campagne trends, impact van eerdere optimalisaties", done: false },
    { id: "b4", step: "§4", text: "Device & Engagement: bounce rate en engagement metrics ontwikkeling controleren", done: false },
    { id: "b5", step: "§5", text: "Checkout Performance: funnel drop-offs checken (50% vuistregel per fase)", done: false },
    { id: "b6", step: "§6", text: "Bevindingen loggen in Monday Board, sprintplanning aanpassen indien nodig", done: false },
  ],
  monthly: [
    { id: "m1", step: "§1", text: "Account Performance: doelstellingen controleren, KPI-keten analyseren, 13-maanden trend", done: false },
    { id: "m2", step: "§2", text: "Campagne Performance: account performance verder verklaren + campagne evaluatie", done: false },
    { id: "m3", step: "§3", text: "Ad Group Performance: campagne performance verder verklaren + ad group evaluatie", done: false },
    { id: "m4", step: "§4", text: "Auction Insights: concurrentie analyse op impression share (6 maanden + 3 maanden wekelijks)", done: false },
    { id: "m5", step: "§5", text: "Keyword Performance: match type analyse, buckets, Quality Score en subfactoren", done: false },
    { id: "m6", step: "§6", text: "Product Performance: custom labels, categorieën, SKU labelizer verdeling, product buckets", done: false },
    { id: "m7", step: "§7", text: "Search Term Performance: match type analyse, buckets, toevoegen/uitsluiten beoordelen", done: false },
    { id: "m8", step: "§8", text: "Creative Performance: assets + ad copy over 14/30/60/90 dagen, degradatie identificeren", done: false },
    { id: "m9", step: "§9", text: "Audience Performance: doelgroepen analyseren (leeftijd, geslacht, etc.), trends identificeren", done: false },
    { id: "m10", step: "§10", text: "Device & Engagement: device performance + bounce rate/engagement rate/sessieduur", done: false },
    { id: "m11", step: "§11", text: "Geografische Performance: regio analyse met trend charts, per campagne/ad group", done: false },
    { id: "m12", step: "§12", text: "Checkout, Ad Schedule & Network: funnel, weekdag patronen, netwerk performance", done: false },
    { id: "m13", step: "§13", text: "Hypotheses opstellen, ICE scoren, sprintplanning bijwerken, klantbespreking voorbereiden", done: false },
  ],
};

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

/** Generate dynamic tasks based on forecast results */
function generateDynamicTasks(forecast: ClientForecast): Task[] {
  const tasks: Task[] = [];
  let idx = 0;

  const convDiff = forecast.conversions.kpi.diffPct;
  const spendDiff = forecast.adSpend.kpi.diffPct;
  const budget = forecast.budgetRecommendation;
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null);
  const spendFactor = forecast.adSpend.kpi.projectionFactor;
  const convFactor = forecast.conversions.kpi.projectionFactor;
  const efficiency = spendFactor > 0 ? convFactor / spendFactor : 1;

  // CPA trend
  const cpaPoints = forecast.cpa.points.filter((p) => p.realized !== null);
  const lastCpa = cpaPoints[cpaPoints.length - 1]?.realized ?? 0;

  // ── Budget taken ──

  if (budget.behindTarget && budget.extraSpendNeeded > 0) {
    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Budget", dynamic: true, done: false,
      text: `Bereid budget-voorstel voor klant voor: verhoog naar ${fmt(budget.requiredMonthlySpend)}/maand (+${Math.round(budget.spendIncreasePct)}%). Onderbouw met huidige CPA van ${fmt(budget.currentCpa)}.`,
    });
  }

  if (spendDiff < -10) {
    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Budget", dynamic: true, done: false,
      text: `Check waarom spend ${Math.round(Math.abs(spendDiff))}% onder target is. Zijn er campagnes gepauzeerd? Budget caps bereikt? Delivery issues?`,
    });
  }

  // ── Performance taken ──

  if (convDiff < -15) {
    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Analyse", dynamic: true, done: false,
      text: `Campagne Performance Review: open Google Ads → sorteer campagnes op spend → check per campagne: conversies, CPA, ROAS. Markeer de top 3 underperformers.`,
    });

    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Analyse", dynamic: true, done: false,
      text: `Impression Share analyse: check IS Lost (Budget) en IS Lost (Rank) voor top campagnes. Noteer de percentages — dit bepaalt of budget of kwaliteit het probleem is.`,
    });

    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Zoektermen", dynamic: true, done: false,
      text: `Zoektermrapport 30 dagen: filter op kosten > ${fmt(lastCpa * 2)} met 0 conversies. Dit zijn directe besparingskansen. Voeg toe als negatief zoekwoord.`,
    });
  }

  // ── Efficiency taken ──

  if (efficiency < 0.85 || (Math.abs(spendDiff) < 10 && convDiff < -15)) {
    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Efficiency", dynamic: true, done: false,
      text: `Conversieratio analyse: check conversieratio per device (desktop vs mobiel) en per landingspagina. Identificeer pagina's met <1% conversieratio.`,
    });

    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Efficiency", dynamic: true, done: false,
      text: `Biedstrategie evaluatie: controleer per campagne welke biedstrategie actief is. Overweeg target CPA of target ROAS als dat nog niet het geval is.`,
    });
  }

  // ── CPA taken ──

  if (lastCpa > 0 && cpaPoints.length >= 2) {
    const firstCpa = cpaPoints[0]?.realized ?? 0;
    const cpaTrend = firstCpa > 0 ? ((lastCpa - firstCpa) / firstCpa) * 100 : 0;

    if (cpaTrend > 15) {
      idx++;
      tasks.push({
        id: `dyn-${idx}`, step: "CPA", dynamic: true, done: false,
        text: `CPA stijgt ${Math.round(cpaTrend)}%. Check: (1) CPC ontwikkeling in Auction Insights, (2) Conversieratio trend op landingspagina's, (3) Zoektermkwaliteit — meer irrelevant verkeer?`,
      });
    }
  }

  // ── Concurrentie taken ──

  if (convDiff < -20) {
    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Concurrentie", dynamic: true, done: false,
      text: `Auction Insights check: zijn er nieuwe concurrenten? Stijgt de overlap rate? Dalen Impression Share of Avg Position? Dit kan verklaren waarom CPC stijgt.`,
    });
  }

  // ── Klantcommunicatie ──

  if (convDiff < -25) {
    idx++;
    tasks.push({
      id: `dyn-${idx}`, step: "Klant", dynamic: true, done: false,
      text: `Plan klantbespreking: deel resultaten vs doelen, presenteer oorzaakanalyse, leg budget-scenario's voor, en stem verwachtingen af.`,
    });
  }

  // ── Standaard onderhoud (altijd) ──

  idx++;
  tasks.push({
    id: `dyn-${idx}`, step: "Onderhoud", dynamic: true, done: false,
    text: `Wekelijks: keyword buckets checken (7d bleeders), zoektermrapport opschonen, alerts reviewen.`,
  });

  return tasks;
}

// ── AI-generated tasks from sop_tasks ──

interface AiTask {
  id: string;
  title: string;
  description: string;
  action_type: string;
  affected_campaign: string | null;
  priority: string;
  frequency: string;
  status: string;
  due_date: string | null;
  recommendation_id: string | null;
}

const FREQUENCY_MAP: Record<Cadence, string> = {
  actions: "direct",
  weekly: "weekly",
  biweekly: "biweekly",
  monthly: "monthly",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-600 bg-red-50 border-red-200",
  high: "text-orange-600 bg-orange-50 border-orange-200",
  medium: "text-amber-600 bg-amber-50 border-amber-200",
  low: "text-gray-600 bg-gray-50 border-gray-200",
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  budget: "Budget",
  bid: "Biedstrategie",
  targeting: "Targeting",
  creative: "Creative",
  structure: "Structuur",
  tracking: "Tracking",
  audit: "Audit",
  negative: "Negatieve KW",
};

const STORAGE_KEY_PREFIX = "rm-dashboard-tasks-";

const severityColors: Record<string, string> = {
  "Budget": "text-red-600 bg-red-50",
  "Analyse": "text-rm-orange bg-orange-50",
  "Zoektermen": "text-purple-600 bg-purple-50",
  "Efficiency": "text-amber-600 bg-amber-50",
  "CPA": "text-amber-700 bg-amber-50",
  "Concurrentie": "text-slate-600 bg-slate-50",
  "Klant": "text-rm-blue bg-blue-50",
  "Onderhoud": "text-gray-600 bg-gray-100",
  "Kans": "text-green-600 bg-green-50",
};

function loadTasks(clientId: string, cadence: Cadence, dynamicTasks: Task[]): Task[] {
  const baseTasks = cadence === "actions" ? dynamicTasks : SOP_TASKS[cadence];
  if (typeof window === "undefined") return baseTasks;
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${clientId}-${cadence}`);
    if (stored) {
      const savedDone: Record<string, boolean> = JSON.parse(stored);
      return baseTasks.map((t) => ({ ...t, done: savedDone[t.id] ?? t.done }));
    }
  } catch { /* ignore */ }
  return baseTasks;
}

function saveTasks(clientId: string, cadence: Cadence, tasks: Task[]) {
  if (typeof window === "undefined") return;
  const doneMap = Object.fromEntries(tasks.map((t) => [t.id, t.done]));
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${clientId}-${cadence}`, JSON.stringify(doneMap));
}

export function TasksBlock({ clientId, selectedInsightId, refreshKey }: { clientId: string; selectedInsightId?: string | null; refreshKey?: number }) {
  const data = useClientHistoricalData(clientId);
  const forecast = useMemo(() => computeForecast(data), [data]);
  const dynamicTasks = useMemo(() => generateDynamicTasks(forecast), [forecast]);
  const dynamicCount = dynamicTasks.length;

  const [cadence, setCadence] = useState<Cadence>("actions");
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks(clientId, "actions", dynamicTasks));
  const [aiTasks, setAiTasks] = useState<AiTask[]>([]);
  const [aiTasksLoading, setAiTasksLoading] = useState(false);

  useEffect(() => {
    setTasks(loadTasks(clientId, cadence, dynamicTasks));
  }, [clientId, cadence, dynamicTasks]);

  // Fetch AI-generated tasks from sop_tasks
  const [recInsightMap, setRecInsightMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!supabase) return;
    setAiTasksLoading(true);

    // Fetch tasks for current frequency
    supabase
      .from("sop_tasks")
      .select("*")
      .eq("client_id", clientId)
      .eq("frequency", FREQUENCY_MAP[cadence])
      .neq("status", "completed")
      .order("priority")
      .then(({ data: rows }) => {
        setAiTasks((rows ?? []) as AiTask[]);
        setAiTasksLoading(false);
      });

    // Fetch recommendation → insight_id mapping for filtering
    supabase
      .from("sop_recommendations")
      .select("id, insight_id")
      .eq("client_id", clientId)
      .then(({ data: rows }) => {
        const map = new Map<string, string>();
        for (const r of (rows ?? []) as Array<{ id: string; insight_id: string | null }>) {
          if (r.insight_id) map.set(r.id, r.insight_id);
        }
        setRecInsightMap(map);
      });
  }, [clientId, cadence, refreshKey]);

  const markAiTaskDone = (taskId: string) => {
    if (!supabase) return;
    supabase.from("sop_tasks").update({ status: "completed" }).eq("id", taskId).then(() => {
      setAiTasks((prev) => prev.filter((t) => t.id !== taskId));
    });
  };

  const toggleTask = (id: string) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id);
      const updated = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      saveTasks(clientId, cadence, updated);

      // Record KPI snapshot in Supabase when completing a task
      if (task && !task.done && supabase) {
        const cpaPts = forecast.cpa.points.filter((p) => p.realized !== null);
        const roasPts = forecast.roas.points.filter((p) => p.realized !== null);
        const snapshot: KpiSnapshot = {
          conversions: forecast.conversions.kpi.ytdRealized,
          revenue: forecast.revenue.kpi.ytdRealized,
          adSpend: forecast.adSpend.kpi.ytdRealized,
          cpa: cpaPts[cpaPts.length - 1]?.realized ?? 0,
          roas: roasPts[roasPts.length - 1]?.realized ?? 0,
        };

        supabase.from("task_completions").insert({
          client_id: clientId,
          task_id: id,
          cadence,
          task_text: task.text,
          kpi_snapshot: snapshot,
          reminder_days: 14,
        }).then(() => {});
      }

      // Remove Supabase record when unchecking
      if (task && task.done && supabase) {
        supabase.from("task_completions")
          .delete()
          .eq("client_id", clientId)
          .eq("task_id", id)
          .eq("cadence", cadence)
          .then(() => {});
      }

      return updated;
    });
  };

  const resetTasks = () => {
    const baseTasks = cadence === "actions" ? dynamicTasks : SOP_TASKS[cadence];
    const fresh = baseTasks.map((t) => ({ ...t, done: false }));
    setTasks(fresh);
    saveTasks(clientId, cadence, fresh);
  };

  const completed = tasks.filter((t) => t.done).length;
  const allDone = completed === tasks.length;

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">
          Taken
        </h3>
        <span className="text-xs text-muted-foreground">
          {completed}/{tasks.length} afgerond
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">
        {cadence === "actions"
          ? "Automatisch gegenereerd op basis van resultaten"
          : "Analysechecklist op basis van Ranking Masters SOP"}
      </p>

      {/* Cadence tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 mb-4">
        {(["actions", "weekly", "biweekly", "monthly"] as Cadence[]).map((c) => (
          <button
            key={c}
            onClick={() => setCadence(c)}
            className={`flex items-center gap-1.5 flex-1 justify-center px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors relative ${
              cadence === c
                ? "bg-white text-rm-blue shadow-sm"
                : "text-muted-foreground hover:text-rm-gray"
            }`}
          >
            {CADENCE_CONFIG[c].icon}
            {CADENCE_CONFIG[c].label}
            {c === "actions" && (dynamicCount + aiTasks.length) > 0 && cadence === "actions" && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {dynamicCount + aiTasks.length}
              </span>
            )}
            {c !== "actions" && c === cadence && aiTasks.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-rm-blue text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {aiTasks.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${allDone ? "bg-green-500" : cadence === "actions" ? "bg-rm-orange" : "bg-rm-blue"}`}
            style={{ width: `${tasks.length > 0 ? (completed / tasks.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* AI-generated tasks from analysis */}
      {!aiTasksLoading && aiTasks.length > 0 && (() => {
        // Filter AI tasks by selectedInsightId via recommendation chain
        const filteredAiTasks = selectedInsightId
          ? aiTasks.filter((t) => {
              if (!t.recommendation_id) return false;
              return recInsightMap.get(t.recommendation_id) === selectedInsightId;
            })
          : aiTasks;

        return filteredAiTasks.length > 0 ? (
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-rm-blue uppercase tracking-wide mb-2">
            AI Analyse taken ({filteredAiTasks.length}{selectedInsightId ? " gefilterd" : ""})
          </p>
          <div className="space-y-1.5">
            {filteredAiTasks.map((at) => (
              <div
                key={at.id}
                className={`flex items-start gap-3 p-2.5 rounded-lg border ${PRIORITY_COLORS[at.priority] ?? "border-border"}`}
              >
                <button onClick={() => markAiTaskDone(at.id)} className="shrink-0 mt-0.5">
                  <Circle className="w-4.5 h-4.5 text-gray-300 hover:text-green-500 transition-colors" />
                </button>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-rm-gray block">{at.title}</span>
                  <span className="text-xs text-muted-foreground block mt-0.5">{at.description}</span>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${PRIORITY_COLORS[at.priority] ?? ""}`}>
                      {at.priority}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {ACTION_TYPE_LABELS[at.action_type] ?? at.action_type}
                    </span>
                    {at.affected_campaign && (
                      <span className="text-[9px] text-muted-foreground truncate max-w-[150px]">
                        {at.affected_campaign}
                      </span>
                    )}
                    {at.due_date && (
                      <span className="text-[9px] text-muted-foreground">
                        Deadline: {at.due_date}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        ) : null;
      })()}

      {/* Fallback message when no AI tasks on Acties tab */}
      {cadence === "actions" && !aiTasksLoading && aiTasks.length === 0 && (
        <p className="text-[10px] text-muted-foreground mb-3 px-2 py-1.5 bg-gray-50 rounded-lg">
          Geen AI taken beschikbaar — draai eerst een analyse via /api/analysis/monthly
        </p>
      )}

      {/* Legacy tasks: show for non-actions tabs, or as fallback when no AI tasks */}
      {(cadence !== "actions" || aiTasks.length === 0) && (
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => toggleTask(task.id)}
            className="flex items-start gap-3 p-2.5 rounded-lg w-full text-left hover:bg-gray-50 transition-colors"
          >
            {task.done ? (
              <CheckCircle2 className="w-4.5 h-4.5 text-green-500 shrink-0 mt-0.5" />
            ) : (
              <Circle className="w-4.5 h-4.5 text-gray-300 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <span className={`text-sm leading-relaxed ${task.done ? "line-through text-muted-foreground" : "text-rm-gray"}`}>
                {task.text}
              </span>
              <span className={`block text-[9px] mt-0.5 ${
                task.dynamic && severityColors[task.step]
                  ? `font-semibold inline-block px-1.5 py-0.5 rounded w-fit ${severityColors[task.step]}`
                  : "text-muted-foreground"
              }`}>
                {task.dynamic ? task.step : `SOP stap ${task.step}`}
              </span>
            </div>
          </button>
        ))}
      </div>
      )}

      {/* Reset */}
      {completed > 0 && (
        <button
          onClick={resetTasks}
          className="mt-3 text-[11px] text-muted-foreground hover:text-rm-blue transition-colors"
        >
          {allDone ? "✓ Alle taken afgerond — reset voor nieuwe cyclus" : "Reset taken"}
        </button>
      )}
    </div>
  );
}
