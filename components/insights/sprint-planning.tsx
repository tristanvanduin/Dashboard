"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { Download, ChevronDown, ChevronUp, Loader2, Calendar, Plus, X, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface SprintItem {
  id: string;
  client_id: string;
  hypothesis_id: string | null;
  week_number: number | null;
  task: string;
  status: string;
  owner: string;
  metrics: string | null;
  review_timeframe: string | null;
  created_at: string;
  updated_at: string;
}

interface HypothesisRef {
  id: string;
  hypothesis: string;
  status: string;
  ice_total: number;
}

const STATUS_OPTIONS = [
  { value: "todo", label: "To Do", color: "bg-blue-100 text-blue-700" },
  { value: "in_planning", label: "in Planning", color: "bg-yellow-100 text-yellow-700" },
  { value: "ongoing", label: "On going", color: "bg-purple-100 text-purple-700" },
  { value: "done", label: "Klaar", color: "bg-emerald-100 text-emerald-700" },
  { value: "backlog", label: "Backlog", color: "bg-gray-100 text-gray-600" },
  { value: "expired", label: "Verlopen", color: "bg-red-100 text-red-600" },
];

const STATUS_COLOR = (status: string) =>
  STATUS_OPTIONS.find((s) => s.value === status)?.color || "bg-gray-100 text-gray-600";

interface Props {
  clientId: string;
  refreshKey?: number;
}

export function SprintPlanning({ clientId, refreshKey }: Props) {
  const [items, setItems] = useState<SprintItem[]>([]);
  const [hypotheses, setHypotheses] = useState<Map<string, HypothesisRef>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"active" | "done" | "all">("all");
  const [collapsedHypotheses, setCollapsedHypotheses] = useState<Set<string>>(new Set());
  const [showAddHypothesis, setShowAddHypothesis] = useState(false);
  const [newHypothesis, setNewHypothesis] = useState("");
  const [newMetrics, setNewMetrics] = useState("");
  const [newTimeframe, setNewTimeframe] = useState("");
  const [showAddTask, setShowAddTask] = useState<string | null>(null); // hypothesis_id or "standalone"
  const [newTask, setNewTask] = useState("");
  const [newOwner, setNewOwner] = useState("Ranking Masters");
  const [importing, setImporting] = useState(false);

  const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }

    const [{ data: itemsData }, { data: hypData }] = await Promise.all([
      supabase.from("sprint_items").select("*").eq("client_id", clientId).order("week_number", { ascending: true }),
      supabase.from("sprint_hypotheses").select("id, hypothesis, status, ice_total").eq("client_id", clientId).in("status", ["accepted", "completed"]),
    ]);

    const allItems = (itemsData ?? []) as SprintItem[];

    // Auto-expire: items with week_number > 2 weeks ago that aren't done
    const expiredIds: string[] = [];
    for (const item of allItems) {
      if (
        item.week_number &&
        item.week_number < currentWeek - 2 &&
        !["done", "expired"].includes(item.status)
      ) {
        expiredIds.push(item.id);
        item.status = "expired";
      }
    }
    // Batch update expired items in Supabase
    if (expiredIds.length > 0) {
      await supabase
        .from("sprint_items")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .in("id", expiredIds);
    }

    setItems(allItems);
    const map = new Map<string, HypothesisRef>();
    for (const h of (hypData ?? []) as HypothesisRef[]) {
      map.set(h.id, h);
    }
    setHypotheses(map);
    setLoading(false);
  }, [clientId, currentWeek]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  async function updateItem(id: string, field: string, value: string) {
    if (!supabase) return;
    await supabase.from("sprint_items").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", id);
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  async function addHypothesisWithTask() {
    if (!supabase || !newHypothesis.trim()) return;
    const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    const { data: hyp } = await supabase
      .from("sprint_hypotheses")
      .insert({
        client_id: clientId,
        hypothesis: newHypothesis.trim(),
        measurement_metric: newMetrics.trim() || null,
        timeframe: newTimeframe.trim() || null,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (hyp && newTask.trim()) {
      await supabase.from("sprint_items").insert({
        client_id: clientId,
        hypothesis_id: hyp.id,
        week_number: currentWeek,
        task: newTask.trim(),
        status: "todo",
        owner: newOwner,
        metrics: newMetrics.trim() || null,
        review_timeframe: newTimeframe.trim() || null,
      });
    }

    setNewHypothesis("");
    setNewMetrics("");
    setNewTimeframe("");
    setNewTask("");
    setShowAddHypothesis(false);
    await refresh();
  }

  async function addTaskToHypothesis(hypothesisId: string | null) {
    if (!supabase || !newTask.trim()) return;
    const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    await supabase.from("sprint_items").insert({
      client_id: clientId,
      hypothesis_id: hypothesisId,
      week_number: currentWeek,
      task: newTask.trim(),
      status: "todo",
      owner: newOwner,
    });

    setNewTask("");
    setNewOwner("Ranking Masters");
    setShowAddTask(null);
    await refresh();
  }

  async function importCSV(file: File) {
    if (!supabase) return;
    setImporting(true);

    try {
      const text = await file.text();
      const lines = text.split("\n");
      const headers = lines[0].split(",").map((h) => h.trim());

      // Parse CSV with quote handling
      const rows: Record<string, string>[] = [];
      let currentRow: string[] = [];
      let inQuote = false;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!inQuote) currentRow = [];

        let field = inQuote ? currentRow[currentRow.length - 1] + "\n" : "";
        for (let j = 0; j < line.length; j++) {
          const ch = line[j];
          if (ch === '"') { inQuote = !inQuote; }
          else if (ch === "," && !inQuote) { currentRow.push(field); field = ""; }
          else { field += ch; }
        }
        if (inQuote) { currentRow[currentRow.length - 1] = field; continue; }
        currentRow.push(field);

        const obj: Record<string, string> = {};
        for (let k = 0; k < headers.length; k++) obj[headers[k]] = (currentRow[k] || "").trim();
        if (obj["Taak"] || obj["taak"] || obj["Task"]) rows.push(obj);
      }

      const statusMap: Record<string, string> = {
        "Klaar": "done", "To Do": "todo", "in Planning": "in_planning",
        "On going": "ongoing", "Backlog / Verlopen": "expired", "Backlog": "backlog", "Verlopen": "expired",
      };

      // Group by hypothesis
      const groups = new Map<string, typeof rows>();
      for (const row of rows) {
        const hyp = row["Hypothese"] || row["hypothese"] || "(geen hypothese)";
        if (!groups.has(hyp)) groups.set(hyp, []);
        groups.get(hyp)!.push(row);
      }

      for (const [hypothesis, tasks] of groups) {
        const allDone = tasks.every((t) => statusMap[t["Status"]] === "done");
        const metrics = tasks[0]["Metrics"] || tasks[0]["metrics"] || null;
        const timeframe = tasks[0]["Looptijd tot Beoordeling"] || tasks[0]["looptijd"] || null;

        const { data: hyp } = await supabase
          .from("sprint_hypotheses")
          .insert({
            client_id: clientId,
            hypothesis: hypothesis === "(geen hypothese)" ? "Import: geen hypothese" : hypothesis,
            measurement_metric: metrics, timeframe,
            status: allDone ? "completed" : "accepted",
            accepted_at: new Date().toISOString(),
          })
          .select("id").single();

        if (!hyp) continue;

        const sprintItems = tasks.map((t) => ({
          client_id: clientId,
          hypothesis_id: hyp.id,
          week_number: t["Week"] || t["week"] ? parseInt(t["Week"] || t["week"]) : null,
          task: t["Taak"] || t["taak"] || t["Task"] || "(geen taak)",
          status: statusMap[t["Status"] || t["status"]] || "todo",
          owner: t["Verantwoordelijke"] || t["verantwoordelijke"] || "Ranking Masters",
          metrics: t["Metrics"] || t["metrics"] || null,
          review_timeframe: t["Looptijd tot Beoordeling"] || t["looptijd"] || null,
        }));

        await supabase.from("sprint_items").insert(sprintItems);
      }

      await refresh();
    } catch (err) {
      console.error("CSV import failed:", err);
    } finally {
      setImporting(false);
    }
  }

  function toggleCollapse(hypId: string) {
    setCollapsedHypotheses((prev) => {
      const next = new Set(prev);
      if (next.has(hypId)) next.delete(hypId);
      else next.add(hypId);
      return next;
    });
  }

  function exportCSV() {
    const headers = ["Week", "Taak", "Status", "Verantwoordelijke", "Hypothese", "Looptijd tot Beoordeling", "Metrics"];
    const rows = filteredItems.map((item) => {
      const hyp = item.hypothesis_id ? hypotheses.get(item.hypothesis_id) : null;
      const statusLabel = STATUS_OPTIONS.find((s) => s.value === item.status)?.label || item.status;
      return [
        item.week_number || "",
        `"${(item.task || "").replace(/"/g, '""')}"`,
        statusLabel,
        item.owner || "",
        `"${(hyp?.hypothesis || "").replace(/"/g, '""')}"`,
        item.review_timeframe || "",
        item.metrics || "",
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sprintplanning-${clientId}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredItems = items.filter((item) => {
    if (filter === "active") return !["done", "expired"].includes(item.status);
    if (filter === "done") return item.status === "done";
    return true;
  });

  // Group by hypothesis
  const grouped = new Map<string, SprintItem[]>();
  const noHypothesis: SprintItem[] = [];

  for (const item of filteredItems) {
    if (item.hypothesis_id) {
      if (!grouped.has(item.hypothesis_id)) grouped.set(item.hypothesis_id, []);
      grouped.get(item.hypothesis_id)!.push(item);
    } else {
      noHypothesis.push(item);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-rm-blue" />
      </div>
    );
  }

  if (items.length === 0 && !showAddHypothesis && !showAddTask) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 shadow-sm text-center">
        <Calendar className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
        <p className="text-sm text-muted-foreground mb-3">Nog geen sprintplanning.</p>
        <button
          onClick={() => setShowAddHypothesis(true)}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 transition-colors"
        >
          <Plus className="w-3 h-3 inline mr-1" /> Hypothese + taak toevoegen
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">Sprintplanning</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {filteredItems.length} taken · Week {currentWeek} ({new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-gray-100 rounded-md p-0.5">
            {(["active", "done", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                  filter === f ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
                }`}
              >
                {f === "active" ? "Actief" : f === "done" ? "Klaar" : "Alles"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer">
            {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {importing ? "Importeren..." : "CSV Import"}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) importCSV(e.target.files[0]); e.target.value = ""; }}
            />
          </label>
          <button
            onClick={() => setShowAddHypothesis(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md bg-rm-blue text-white hover:bg-rm-blue/90 transition-colors"
          >
            <Plus className="w-3 h-3" /> Hypothese + taak
          </button>
          <button
            onClick={() => setShowAddTask("standalone")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md border border-rm-blue/30 text-rm-blue hover:bg-rm-blue/5 transition-colors"
          >
            <Plus className="w-3 h-3" /> Losse taak
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md border border-border hover:bg-gray-50 transition-colors"
          >
            <Download className="w-3 h-3" /> CSV Export
          </button>
        </div>
      </div>

      {/* Add hypothesis form */}
      {showAddHypothesis && (
        <div className="px-5 py-4 border-b border-border bg-purple-50/30 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-purple-700">Nieuwe hypothese + taak toevoegen</p>
            <button onClick={() => setShowAddHypothesis(false)} className="p-1 hover:bg-purple-100 rounded"><X className="w-3.5 h-3.5 text-purple-400" /></button>
          </div>
          <textarea
            value={newHypothesis}
            onChange={(e) => setNewHypothesis(e.target.value)}
            placeholder="Hypothese: Met het [actie] verwachten we [verwachting]..."
            className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-purple-400 resize-none"
            rows={2}
          />
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Eerste taak (optioneel)"
            className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-purple-400"
          />
          <div className="flex gap-3">
            <input value={newMetrics} onChange={(e) => setNewMetrics(e.target.value)} placeholder="Metrics (bijv. ROAS, CR)" className="flex-1 text-xs border border-purple-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-purple-400" />
            <input value={newTimeframe} onChange={(e) => setNewTimeframe(e.target.value)} placeholder="Looptijd (bijv. 3 maanden)" className="flex-1 text-xs border border-purple-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-purple-400" />
            <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="text-xs border border-purple-200 rounded-lg px-3 py-1.5 bg-white">
              <option value="Ranking Masters">Ranking Masters</option>
              <option value="Klant">Klant</option>
            </select>
          </div>
          <button onClick={addHypothesisWithTask} disabled={!newHypothesis.trim()} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 transition-colors">
            Toevoegen
          </button>
        </div>
      )}

      {/* Add standalone task form */}
      {showAddTask === "standalone" && (
        <div className="px-5 py-4 border-b border-border bg-blue-50/30 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-rm-blue">Losse taak toevoegen (zonder hypothese)</p>
            <button onClick={() => setShowAddTask(null)} className="p-1 hover:bg-blue-100 rounded"><X className="w-3.5 h-3.5 text-blue-400" /></button>
          </div>
          <div className="flex gap-3">
            <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Taakomschrijving" className="flex-1 text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-rm-blue" />
            <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="text-xs border border-blue-200 rounded-lg px-3 py-1.5 bg-white">
              <option value="Ranking Masters">Ranking Masters</option>
              <option value="Klant">Klant</option>
            </select>
            <button onClick={() => addTaskToHypothesis(null)} disabled={!newTask.trim()} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 disabled:opacity-40 transition-colors">
              Toevoegen
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50/50 border-b border-border">
            <tr>
              <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left w-16">Week</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Taak</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left w-28">Status</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left w-36">Verantwoordelijke</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left w-24">Looptijd</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left w-32">Metrics</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Grouped by hypothesis */}
            {Array.from(grouped.entries()).map(([hypId, groupItems]) => {
              const hyp = hypotheses.get(hypId);
              const isCollapsed = collapsedHypotheses.has(hypId);

              return (
                <Fragment key={`group-${hypId}`}>
                  {/* Hypothesis header row */}
                  <tr
                    key={`hyp-${hypId}`}
                    className="bg-purple-50/40 cursor-pointer hover:bg-purple-50/60"
                    onClick={() => toggleCollapse(hypId)}
                  >
                    <td colSpan={6} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {isCollapsed
                          ? <ChevronDown className="w-3.5 h-3.5 text-purple-400" />
                          : <ChevronUp className="w-3.5 h-3.5 text-purple-400" />
                        }
                        <span className="text-[11px] font-medium text-purple-700 max-w-[50%]">
                          {hyp?.hypothesis || "Hypothese"}
                        </span>
                        <span className="ml-auto flex items-center gap-2 text-[9px] text-purple-400">
                          {groupItems.length} taken · ICE {hyp?.ice_total?.toFixed(1) || "?"}
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowAddTask(hypId); setNewTask(""); setNewOwner("Ranking Masters"); }}
                            className="p-0.5 rounded hover:bg-purple-200 transition-colors"
                            title="Taak toevoegen"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </span>
                      </div>
                    </td>
                  </tr>

                  {/* Task rows */}
                  {!isCollapsed && groupItems.map((item) => (
                    <SprintRow key={item.id} item={item} onUpdate={updateItem} currentWeek={currentWeek} />
                  ))}
                  {!isCollapsed && showAddTask === hypId && (
                    <tr className="bg-purple-50/20">
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2" colSpan={3}>
                        <div className="flex items-center gap-2">
                          <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Nieuwe taak..." className="flex-1 text-xs border border-purple-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-purple-400" />
                          <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="text-xs border border-purple-200 rounded px-2 py-1 bg-white">
                            <option value="Ranking Masters">RM</option>
                            <option value="Klant">Klant</option>
                          </select>
                          <button onClick={() => addTaskToHypothesis(hypId)} disabled={!newTask.trim()} className="px-2 py-1 text-[10px] font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40">Voeg toe</button>
                          <button onClick={() => setShowAddTask(null)} className="p-1 hover:bg-purple-100 rounded"><X className="w-3 h-3 text-purple-400" /></button>
                        </div>
                      </td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {/* Items without hypothesis */}
            {noHypothesis.map((item) => (
              <SprintRow key={item.id} item={item} onUpdate={updateItem} currentWeek={currentWeek} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SprintRow({ item, onUpdate, currentWeek }: { item: SprintItem; onUpdate: (id: string, field: string, value: string) => void; currentWeek: number }) {
  const isOverdue = item.week_number != null && item.week_number < currentWeek && !["done", "expired"].includes(item.status);
  const isCurrent = item.week_number != null && item.week_number === currentWeek;

  return (
    <tr className={`hover:bg-gray-50/50 transition-colors ${isOverdue ? "bg-red-50/30" : ""} ${item.status === "expired" ? "opacity-50" : ""}`}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={item.week_number || ""}
            onChange={(e) => onUpdate(item.id, "week_number", e.target.value)}
            className={`w-12 text-xs text-center border rounded px-1 py-0.5 focus:bg-white focus:border-rm-blue focus:outline-none ${
              isOverdue ? "border-red-300 bg-red-50 text-red-600 font-bold" :
              isCurrent ? "border-emerald-300 bg-emerald-50 text-emerald-600 font-bold" :
              "border-transparent hover:border-border bg-transparent"
            }`}
            placeholder="—"
          />
          {isOverdue && <span className="text-[8px] text-red-500 font-bold">!</span>}
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm text-rm-gray">{item.task}</td>
      <td className="px-4 py-2.5">
        <select
          value={item.status}
          onChange={(e) => onUpdate(item.id, "status", e.target.value)}
          className={`text-[10px] font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${STATUS_COLOR(item.status)}`}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <select
          value={item.owner}
          onChange={(e) => onUpdate(item.id, "owner", e.target.value)}
          className="text-xs border border-transparent hover:border-border rounded px-1 py-0.5 bg-transparent focus:bg-white focus:border-rm-blue focus:outline-none cursor-pointer"
        >
          <option value="Ranking Masters">Ranking Masters</option>
          <option value="Klant">Klant</option>
        </select>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.review_timeframe || "—"}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.metrics || "—"}</td>
    </tr>
  );
}
