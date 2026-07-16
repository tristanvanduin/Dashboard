"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ClipboardCheck, Zap, Search, Loader2, Download, CheckCircle, XCircle,
  AlertTriangle, MinusCircle, Pencil, Save, X, Shield, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeExecutiveSummary, type AuditScore, type AuditRowResult, type SectionSummary } from "@/lib/second-opinion/types";
import { useGenerationProgress } from "@/lib/use-generation-progress";
import { GenerationProgressCard } from "@/components/ui/generation-progress-card";

interface Props { clientId: string; clientName: string; }

interface RunSummary { id: string; mode: string; status: string; created_at: string; completed_at: string | null; section_summaries: SectionSummary[] | null; pdf_storage_path: string | null; error: string | null; }
interface RunDetail { id: string; mode: string; status: string; created_at: string; results: AuditRowResult[] | null; section_summaries: SectionSummary[] | null; }

// ── Design tokens ──────────────────────────────────────────────────────────

const SCORE_STYLE: Record<AuditScore, { text: string; bg: string; border: string; badge: string }> = {
  "Goed":               { text: "text-green-700",  bg: "bg-green-50",  border: "border-green-200",  badge: "bg-green-100 text-green-700 border-green-200" },
  "Voldoende":          { text: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-200",  badge: "bg-amber-100 text-amber-700 border-amber-200" },
  "Onvoldoende":        { text: "text-red-700",    bg: "bg-red-50",    border: "border-red-200",    badge: "bg-red-100 text-red-700 border-red-200" },
  "Niet beoordeeld":    { text: "text-gray-400",   bg: "bg-gray-50/50", border: "border-gray-200", badge: "bg-gray-100 text-gray-400 border-gray-100" },
  "Niet van toepassing":{ text: "text-gray-300",   bg: "bg-gray-50/30", border: "border-gray-100", badge: "bg-gray-50 text-gray-300 border-gray-100" },
};

const SCORE_ICON: Record<AuditScore, React.ReactNode> = {
  "Goed": <CheckCircle className="w-3.5 h-3.5" />,
  "Voldoende": <AlertTriangle className="w-3.5 h-3.5" />,
  "Onvoldoende": <XCircle className="w-3.5 h-3.5" />,
  "Niet beoordeeld": <MinusCircle className="w-3.5 h-3.5" />,
  "Niet van toepassing": <MinusCircle className="w-3.5 h-3.5" />,
};

const IMPACT_STYLE: Record<string, string> = {
  "Hoog": "text-red-600",
  "Midden": "text-amber-600",
  "Laag": "text-gray-400",
};

const SCORE_OPTIONS: AuditScore[] = ["Goed", "Voldoende", "Onvoldoende", "Niet beoordeeld", "Niet van toepassing"];

function getFinalScore(row: AuditRowResult): AuditScore { return row.overrideScore ?? row.score; }
function getFinalComments(row: AuditRowResult): string { return row.overrideComments ?? row.comments; }

export function SecondOpinionView({ clientId, clientName }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningMode, setRunningMode] = useState<"quick" | "full" | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Map<number, { score: AuditScore; comments: string }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activePdfJobId, setActivePdfJobId] = useState<string | null>(null);
  const progress = useGenerationProgress(activeJobId);
  const pdfProgress = useGenerationProgress(activePdfJobId);

  const fetchRuns = useCallback(async () => {
    const res = await fetch(`/api/second-opinion?client_id=${clientId}`);
    if (res.ok) { const data = await res.json(); setRuns(data.runs ?? []); }
  }, [clientId]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  async function startAudit(mode: "quick" | "full") {
    const jobId = crypto.randomUUID();
    setActiveJobId(jobId);
    setRunningMode(mode);
    try {
      const res = await fetch("/api/second-opinion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, client_name: clientName, mode, job_id: jobId }) });
      if (res.ok) { const data = await res.json(); await fetchRuns(); if (data.runId) await loadRunDetail(data.runId); }
    } finally { setRunningMode(null); }
  }

  async function downloadPdf() {
    if (!activeRun) return;
    const jobId = crypto.randomUUID();
    setActivePdfJobId(jobId);
    const res = await fetch(`/api/second-opinion/pdf?run_id=${activeRun.id}&client_name=${encodeURIComponent(clientName)}&job_id=${jobId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "PDF generatie mislukt" }));
      throw new Error(err.error || "PDF generatie mislukt");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "second-opinion.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function loadRunDetail(runId: string) {
    setLoading(true);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;
      const res = await fetch(`${url}/rest/v1/second_opinion_runs?id=eq.${runId}&select=id,mode,status,created_at,results,section_summaries`, { headers: { "apikey": key, "Authorization": `Bearer ${key}` } });
      if (res.ok) { const data = await res.json(); if (data.length > 0) { setActiveRun(data[0]); setEditingSection(null); setEditBuffer(new Map()); } }
    } finally { setLoading(false); }
  }

  function startEditingSection(section: string) {
    if (!activeRun?.results) return;
    const buf = new Map<number, { score: AuditScore; comments: string }>();
    for (const row of activeRun.results.filter((r) => r.section === section)) buf.set(row.templateId, { score: getFinalScore(row), comments: getFinalComments(row) });
    setEditBuffer(buf); setEditingSection(section);
  }

  async function saveEdits() {
    if (!activeRun || editBuffer.size === 0) return;
    setSaving(true);
    try {
      const overrides = Array.from(editBuffer.entries()).map(([templateId, { score, comments }]) => ({ templateId, score, comments }));
      const res = await fetch("/api/second-opinion", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: activeRun.id, overrides }) });
      if (res.ok) await loadRunDetail(activeRun.id);
    } finally { setSaving(false); }
  }

  const sections = activeRun?.results ? [...new Set(activeRun.results.map((r) => r.section))] : [];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-4.5 h-4.5 text-orange-600" />
        </div>
        <div>
          <h2 className="text-base font-bold text-gray-900 leading-tight">Second Opinion</h2>
          <p className="text-xs text-muted-foreground">Account audit op basis van het Ranking Masters template</p>
        </div>
      </div>

      {/* ── Audit trigger cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => startAudit("quick")} disabled={runningMode !== null}
          className="group text-left bg-white rounded-lg border border-border p-4 hover:border-amber-300 hover:shadow-sm transition-all disabled:opacity-50">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-gray-900">Snelle Audit</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">10 Low Hanging Fruit checks</p>
          {runningMode === "quick" && <Loader2 className="w-4 h-4 animate-spin text-amber-500 mt-2" />}
        </button>
        <button onClick={() => startAudit("full")} disabled={runningMode !== null}
          className="group text-left bg-white rounded-lg border border-border p-4 hover:border-orange-300 hover:shadow-sm transition-all disabled:opacity-50">
          <div className="flex items-center gap-2 mb-1">
            <Search className="w-4 h-4 text-orange-600" />
            <span className="text-sm font-semibold text-gray-900">Volledige Audit</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">Alle checks over 9 categorieën</p>
          {runningMode === "full" && <Loader2 className="w-4 h-4 animate-spin text-orange-500 mt-2" />}
        </button>
      </div>

      {(runningMode !== null || progress.job) && (
        <GenerationProgressCard
          title="Second opinion voortgang"
          job={progress.job}
          fallbackMessage="Audit wordt gestart..."
        />
      )}
      {progress.trackerUnavailable && !progress.job && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {progress.trackerMessage || "Live voortgang niet beschikbaar. De audit loopt mogelijk nog door."}
        </div>
      )}

      {/* ── Active run ── */}
      {activeRun && activeRun.results && (() => {
        const exec = computeExecutiveSummary(activeRun.results);
        const vcMap: Record<string, string> = { "Sterk": "border-green-200 bg-green-50/60", "Voldoende": "border-amber-200 bg-amber-50/60", "Aandacht nodig": "border-red-200 bg-red-50/60", "Kritiek": "border-red-300 bg-red-50" };
        const vcText: Record<string, string> = { "Sterk": "text-green-700", "Voldoende": "text-amber-700", "Aandacht nodig": "text-red-700", "Kritiek": "text-red-800" };
        const confText: Record<string, string> = { "Hoog": "text-green-600", "Gemiddeld": "text-amber-600", "Beperkt": "text-red-600" };

        return (
          <div className="space-y-4">

            {/* ── Executive summary ── */}
            <div className={`rounded-lg border ${vcMap[exec.verdict] ?? "border-gray-200 bg-gray-50"} overflow-hidden`}>
              {/* Verdict + confidence */}
              <div className="px-5 py-4 flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className={`text-sm font-bold ${vcText[exec.verdict] ?? "text-gray-700"}`}>Verdict: {exec.verdict}</div>
                  <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{exec.verdictExplanation}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-xs font-semibold ${confText[exec.auditConfidence] ?? ""}`}>Vertrouwen: {exec.auditConfidence}</div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{exec.scoredChecks}/{exec.totalChecks} beoordeeld</p>
                </div>
              </div>

              {/* Stats strip */}
              <div className="px-5 py-3 border-t border-white/60 flex items-center gap-6 text-center">
                {[
                  { n: exec.totalChecks, label: "Totaal", color: "text-gray-900" },
                  { n: exec.goodCount, label: "Goed", color: "text-green-600" },
                  { n: exec.voldoendeCount, label: "Voldoende", color: "text-amber-600" },
                  { n: exec.onvoldoendeCount, label: "Onvoldoende", color: "text-red-600" },
                  { n: exec.unscoredChecks, label: "Review", color: "text-gray-400" },
                ].map((s) => (
                  <div key={s.label} className="flex-1">
                    <div className={`text-lg font-bold ${s.color}`}>{s.n}</div>
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Priority lists */}
              {(exec.directActions.length > 0 || exec.investigateFirst.length > 0 || exec.manualReviewItems.length > 0) && (
                <div className="px-5 py-4 border-t border-white/60 grid grid-cols-1 md:grid-cols-3 gap-5">
                  {exec.directActions.length > 0 && (
                    <PriorityList title="Direct verbeteren" color="red" icon={<XCircle className="w-3.5 h-3.5" />} items={exec.directActions} />
                  )}
                  {exec.investigateFirst.length > 0 && (
                    <PriorityList title="Eerst onderzoeken" color="amber" icon={<AlertTriangle className="w-3.5 h-3.5" />} items={exec.investigateFirst} />
                  )}
                  {exec.manualReviewItems.length > 0 && (
                    <PriorityList title="Handmatige review" color="blue" icon={<Eye className="w-3.5 h-3.5" />} items={exec.manualReviewItems.slice(0, 4)} />
                  )}
                </div>
              )}
            </div>

            {/* ── Actions bar ── */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="w-3.5 h-3.5" />
                <span>{activeRun.mode === "quick" ? "Snelle" : "Volledige"} Audit — {activeRun.results.length} checks</span>
                <span className="opacity-50">|</span>
                <span>{new Date(activeRun.created_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7 text-xs"
                onClick={() => { void downloadPdf().catch((err) => alert(err instanceof Error ? err.message : "PDF generatie mislukt")); }}
              >
                <Download className="w-3 h-3" /> PDF
              </Button>
            </div>

            {pdfProgress.job && (
              <GenerationProgressCard
                title="Second opinion PDF"
                job={pdfProgress.job}
                fallbackMessage="PDF-generatie wordt gestart..."
              />
            )}
            {pdfProgress.trackerUnavailable && !pdfProgress.job && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                {pdfProgress.trackerMessage || "Live PDF-voortgang niet beschikbaar."}
              </div>
            )}

            {/* ── Category chips ── */}
            {activeRun.section_summaries && activeRun.section_summaries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {activeRun.section_summaries.map((s) => {
                  const st = SCORE_STYLE[s.averageScore];
                  return (
                    <div key={s.section} className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border ${st.badge}`}>
                      {SCORE_ICON[s.averageScore]}
                      <span>{s.section}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Section detail cards ── */}
            {sections.map((section) => {
              const sectionRows = activeRun.results!.filter((r) => r.section === section);
              const isEditing = editingSection === section;
              const overriddenCount = sectionRows.filter((r) => r.isOverridden).length;

              return (
                <div key={section} className="bg-white rounded-lg border border-border overflow-hidden">
                  {/* Section header */}
                  <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between bg-gray-50/40">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-gray-900">{section}</h3>
                      <span className="text-[10px] text-muted-foreground">{sectionRows.length}</span>
                      {overriddenCount > 0 && (
                        <span className="text-[9px] bg-blue-50 text-blue-500 border border-blue-100 rounded px-1.5 py-px">{overriddenCount} bewerkt</span>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <Button onClick={() => { setEditingSection(null); setEditBuffer(new Map()); }} variant="ghost" size="sm" className="h-6 px-2 text-[11px]">Annuleren</Button>
                        <Button onClick={saveEdits} disabled={saving} size="sm" className="h-6 px-2.5 text-[11px] bg-blue-600 hover:bg-blue-700 text-white">
                          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}Opslaan
                        </Button>
                      </div>
                    ) : (
                      <button onClick={() => startEditingSection(section)} className="text-[11px] text-muted-foreground hover:text-gray-700 flex items-center gap-1 transition-colors">
                        <Pencil className="w-3 h-3" /> Bewerken
                      </button>
                    )}
                  </div>

                  {/* Rows */}
                  <div className="divide-y divide-border/40">
                    {sectionRows.map((row) => {
                      const score = getFinalScore(row);
                      const comments = getFinalComments(row);
                      const editData = editBuffer.get(row.templateId);
                      const isRowEditing = isEditing && editData;
                      const st = SCORE_STYLE[score];

                      return (
                        <div key={row.templateId} className={`grid grid-cols-[1fr_60px_170px] gap-4 items-start px-5 py-3 ${row.isOverridden ? "bg-blue-50/20" : ""} hover:bg-gray-50/30 transition-colors`}>
                          {/* Left: question + comments */}
                          <div className="min-w-0">
                            <div className="flex items-start gap-1.5">
                              <p className="text-sm text-gray-800 leading-snug">{row.controlPoint}</p>
                              {row.isOverridden && <span className="text-[8px] bg-blue-100 text-blue-600 rounded px-1 py-px shrink-0 mt-0.5">BEWERKT</span>}
                            </div>
                            {isRowEditing ? (
                              <textarea value={editData.comments} onChange={(e) => { const b = new Map(editBuffer); b.set(row.templateId, { ...editData, comments: e.target.value }); setEditBuffer(b); }}
                                className="mt-1.5 w-full text-xs border border-border rounded px-2.5 py-1.5 bg-white focus:outline-none focus:border-blue-400 resize-none" rows={2} placeholder="Toelichting..." />
                            ) : (
                              comments && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{comments}</p>
                            )}
                          </div>

                          {/* Center: impact */}
                          <div className="text-center pt-0.5">
                            <span className={`text-xs font-semibold ${IMPACT_STYLE[row.impact] ?? "text-gray-400"}`}>{row.impact}</span>
                          </div>

                          {/* Right: score badge */}
                          <div className="pt-0.5">
                            {isRowEditing ? (
                              <select value={editData.score} onChange={(e) => { const b = new Map(editBuffer); b.set(row.templateId, { ...editData, score: e.target.value as AuditScore }); setEditBuffer(b); }}
                                className="text-xs border border-border rounded px-2.5 py-1.5 bg-white focus:outline-none focus:border-blue-400 w-full">
                                {SCORE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            ) : (
                              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-md border w-full justify-center ${st.badge}`}>
                                {SCORE_ICON[score]}{score}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Loading ── */}
      {loading && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}

      {/* ── Previous runs ── */}
      {runs.length > 0 && !activeRun && (
        <div className="bg-white rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/60 bg-gray-50/40">
            <h3 className="text-[13px] font-semibold text-gray-900">Eerdere audits</h3>
          </div>
          <div className="divide-y divide-border/40">
            {runs.map((run) => (
              <button key={run.id} onClick={() => loadRunDetail(run.id)}
                className="w-full text-left flex items-center justify-between px-4 py-2.5 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-center gap-2.5">
                  {run.mode === "quick" ? <Zap className="w-3.5 h-3.5 text-amber-500" /> : <Search className="w-3.5 h-3.5 text-orange-500" />}
                  <span className="text-[13px] font-medium text-gray-900">{run.mode === "quick" ? "Snelle Audit" : "Volledige Audit"}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(run.created_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded ${run.status === "completed" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                  {run.status === "completed" ? "Afgerond" : run.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PriorityList({ title, color, icon, items }: { title: string; color: string; icon: React.ReactNode; items: Array<{ controlPoint: string; section: string }> }) {
  const colors: Record<string, { title: string; dot: string }> = {
    red: { title: "text-red-600", dot: "bg-red-400" },
    amber: { title: "text-amber-600", dot: "bg-amber-400" },
    blue: { title: "text-blue-600", dot: "bg-blue-400" },
  };
  const c = colors[color] ?? colors.blue;
  return (
    <div>
      <h4 className={`text-[11px] font-bold ${c.title} mb-1.5 flex items-center gap-1`}>{icon} {title}</h4>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-[11px] text-gray-600 flex items-start gap-1.5 leading-relaxed">
            <span className={`w-1 h-1 rounded-full ${c.dot} mt-[6px] shrink-0`} />
            <span>{item.controlPoint} <span className="text-[9px] text-gray-400">({item.section})</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
