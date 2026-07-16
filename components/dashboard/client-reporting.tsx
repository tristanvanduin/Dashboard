"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText, Loader2, Pencil, Save, X, Download, Plus, Check, Clock,
  Send, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { getAllClients } from "@/lib/clients";
import { useGenerationProgress } from "@/lib/use-generation-progress";
import { GenerationProgressCard } from "@/components/ui/generation-progress-card";

// ── Types (matching API output) ────────────────────────────────────────────

interface MetricPoint { month: string; value: number }
interface KpiCard { label: string; current: number; previous: number; changePct: number; yoyChangePct: number | null; format: "number" | "currency" | "percent" | "decimal" }
interface MetricSection { id: string; label: string; heading: string; body: string; bullets: string[]; chartData: MetricPoint[]; chartData2?: MetricPoint[]; chartLabel: string; chartLabel2?: string; chartType: "bar" | "line"; chartType2?: "bar" | "line" }
interface CountrySection {
  countryCode: string;
  countryName: string;
  kpiCards: KpiCard[];
  metricSections: MetricSection[];
}
interface ReportData {
  title: string; reportMonth: string; reportYear: number;
  kpiCards: KpiCard[]; metricSections: MetricSection[];
  actionSection: { heading: string; body: string };
  planningSection: { heading: string; body: string };
  countrySections?: CountrySection[];
  reportId?: string | null;
}
interface ReportSummary { id: string; report_date: string; report_month: number; report_year: number; title: string; status: string; created_at: string }

const MONTH_NAMES = ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"];
const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Concept", color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
  final: { label: "Definitief", color: "text-green-600", bg: "bg-green-50 border-green-200" },
  sent: { label: "Verstuurd", color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
};

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtValue(v: number, format: string): string {
  if (format === "currency") return `€${new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v)}`;
  if (format === "percent") return `${v.toFixed(1)}%`;
  if (format === "decimal") return v.toFixed(2);
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

// ── Mini chart component ───────────────────────────────────────────────────

function MiniChart({ data, type, label, color = "#E87722", height = 180 }: { data: MetricPoint[]; type: "bar" | "line"; label: string; color?: string; height?: number }) {
  if (data.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      <ResponsiveContainer width="100%" height={height}>
        {type === "bar" ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} width={45} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} name={label} />
          </BarChart>
        ) : (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} width={45} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} name={label} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function ClientReporting({ clientId }: { clientId: string }) {
  const clientName = getAllClients().find((c) => c.id === clientId)?.name ?? clientId;

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState("draft");
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activePdfJobId, setActivePdfJobId] = useState<string | null>(null);
  const progress = useGenerationProgress(activeJobId);
  const pdfProgress = useGenerationProgress(activePdfJobId);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<{ heading: string; body: string } | null>(null);

  // ── Fetch reports list ─────────────────────────────────────────

  const fetchReports = useCallback(async () => {
    const res = await fetch(`/api/client-reports?client_id=${clientId}`);
    if (res.ok) {
      const data = await res.json();
      return (data.reports ?? []) as ReportSummary[];
    }
    return [];
  }, [clientId]);

  async function loadReport(id: string) {
    setLoading(true);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;
      const res = await fetch(
        `${url}/rest/v1/client_reports?id=eq.${id}&select=id,title,sections,status,report_month,report_year,created_at`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          const row = data[0];
          // sections column contains the full ReportData
          const rd = row.sections as ReportData;
          setReport(rd);
          setReportId(row.id);
          setReportStatus(row.status);
          setEditingId(null);
          setEditBuf(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      const list = await fetchReports();
      setReports(list);
      if (list.length > 0 && !report) {
        await loadReport(list[0].id);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // ── Generate ───────────────────────────────────────────────────

  async function generateReport() {
    const jobId = crypto.randomUUID();
    setActiveJobId(jobId);
    setGenerating(true);
    try {
      const res = await fetch("/api/client-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_name: clientName, job_id: jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mislukt");
      setReport(data);
      setReportId(data.reportId);
      setReportStatus("draft");
      const list = await fetchReports();
      setReports(list);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Mislukt");
    } finally {
      setGenerating(false);
    }
  }

  // ── Edit + save ────────────────────────────────────────────────

  function startEdit(sectionId: string, heading: string, body: string) {
    setEditBuf({ heading, body });
    setEditingId(sectionId);
  }

  async function saveEdit() {
    if (!report || !editingId || !editBuf || !reportId) return;
    setSaving(true);
    try {
      // Update in local state
      const updated = { ...report };
      const ms = updated.metricSections.find((s) => s.id === editingId);
      if (ms) { ms.heading = editBuf.heading; ms.body = editBuf.body; }
      if (editingId === "acties") { updated.actionSection = { heading: editBuf.heading, body: editBuf.body }; }
      if (editingId === "planning") { updated.planningSection = { heading: editBuf.heading, body: editBuf.body }; }

      await fetch("/api/client-reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId, sections: updated }),
      });
      setReport(updated);
      setEditingId(null);
      setEditBuf(null);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(newStatus: string) {
    if (!reportId) return;
    await fetch("/api/client-reports", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report_id: reportId, status: newStatus }) });
    setReportStatus(newStatus);
    const list = await fetchReports();
    setReports(list);
  }

  async function downloadPdf() {
    if (!reportId) return;
    const jobId = crypto.randomUUID();
    setActivePdfJobId(jobId);
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/client-reports/pdf?report_id=${reportId}&client_name=${encodeURIComponent(clientName)}&job_id=${jobId}`);
      if (!res.ok) throw new Error("PDF mislukt");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "rapport.pdf";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { alert(err instanceof Error ? err.message : "PDF mislukt"); }
    finally { setPdfLoading(false); }
  }

  function copyText() {
    if (!report) return;
    const parts = [report.title, ""];
    for (const s of report.metricSections) {
      parts.push(s.heading, ...s.bullets, "", s.body, "", "---", "");
    }
    parts.push(report.actionSection.heading, "", report.actionSection.body, "", "---", "");
    parts.push(report.planningSection.heading, "", report.planningSection.body);
    navigator.clipboard.writeText(parts.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-rm-blue/10 flex items-center justify-center shrink-0">
            <FileText className="w-4.5 h-4.5 text-rm-blue" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 leading-tight">Rapportage</h2>
            <p className="text-xs text-muted-foreground">Maandrapportage — per metric, met grafieken en bewerkbare tekst</p>
          </div>
        </div>
        <button onClick={generateReport} disabled={generating} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rm-blue text-white text-sm font-medium hover:bg-rm-blue/90 transition-colors disabled:opacity-50">
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {generating ? "Genereren..." : "Nieuw rapport"}
        </button>
      </div>

      {(generating || progress.job) && (
        <GenerationProgressCard
          title="Rapport voortgang"
          job={progress.job}
          fallbackMessage="Rapportgeneratie wordt gestart..."
        />
      )}
      {progress.trackerUnavailable && !progress.job && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {progress.trackerMessage || "Live voortgang niet beschikbaar. Rapportgeneratie loopt mogelijk nog door."}
        </div>
      )}

      {(pdfLoading || pdfProgress.job) && (
        <GenerationProgressCard
          title="Rapport PDF"
          job={pdfProgress.job}
          fallbackMessage="PDF-generatie wordt gestart..."
        />
      )}
      {pdfProgress.trackerUnavailable && !pdfProgress.job && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {pdfProgress.trackerMessage || "Live PDF-voortgang niet beschikbaar."}
        </div>
      )}

      {/* Report list (when no active report) */}
      {!report && !generating && !loading && reports.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border"><h3 className="text-sm font-semibold text-rm-gray">Eerdere rapportages</h3></div>
          <div className="divide-y divide-border">
            {reports.map((r) => (
              <button key={r.id} onClick={() => loadReport(r.id)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left">
                <div>
                  <p className="text-sm font-medium text-rm-gray">{r.title}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{MONTH_NAMES[r.report_month - 1]} {r.report_year}</p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[r.status]?.bg ?? ""} ${STATUS_STYLE[r.status]?.color ?? ""}`}>{STATUS_STYLE[r.status]?.label ?? r.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading / Generating */}
      {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-rm-blue" /></div>}
      {generating && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-rm-blue" />
          <p className="text-sm text-muted-foreground">Rapport wordt gegenereerd...</p>
          <p className="text-[10px] text-muted-foreground">Data ophalen, metrics berekenen, tekst genereren — ca. 30-60 sec</p>
        </div>
      )}

      {/* Empty state */}
      {!report && !generating && !loading && reports.length === 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm p-12 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-rm-gray mb-1">Nog geen rapportages</h3>
          <p className="text-xs text-muted-foreground mb-4">Genereer een rapport met grafieken, KPI&apos;s en analyse per metric.</p>
          <button onClick={generateReport} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rm-blue text-white text-sm font-medium hover:bg-rm-blue/90">
            <Plus className="w-4 h-4" /> Eerste rapport genereren
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ACTIVE REPORT */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {report && !loading && !generating && (
        <div className="space-y-5">

          {/* Actions bar */}
          <div className="bg-white rounded-xl border border-border shadow-sm px-5 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-rm-gray">{report.title}</h2>
              <p className="text-[10px] text-muted-foreground">{report.reportMonth} {report.reportYear}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[reportStatus]?.bg ?? ""} ${STATUS_STYLE[reportStatus]?.color ?? ""}`}>{STATUS_STYLE[reportStatus]?.label ?? reportStatus}</span>
              {reportStatus === "draft" && <button onClick={() => updateStatus("final")} className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border border-green-200 bg-green-50 text-green-600 hover:bg-green-100"><Check className="w-3 h-3" /> Definitief</button>}
              {reportStatus === "final" && <button onClick={() => updateStatus("sent")} className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100"><Send className="w-3 h-3" /> Verstuurd</button>}
              {reportId && <button onClick={downloadPdf} disabled={pdfLoading} className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border border-rm-orange/30 bg-orange-50 text-rm-orange hover:bg-orange-100 disabled:opacity-50">{pdfLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} PDF</button>}
              <button onClick={copyText} className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-gray-50">{copied ? <Check className="w-3 h-3 text-green-500" /> : <Download className="w-3 h-3" />} {copied ? "Gekopieerd!" : "Tekst"}</button>
              <button onClick={() => { setReport(null); setReportId(null); fetchReports().then(setReports); }} className="text-[10px] font-medium px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-gray-50">Terug</button>
            </div>
          </div>

          {/* ── KPI Summary Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {report.kpiCards.map((kpi) => {
              const isPositive = kpi.changePct > 0;
              // For CPA: lower is better, so invert the color
              const invertColor = kpi.label === "CPA" || kpi.label === "Kosten";
              const changeColor = invertColor
                ? (isPositive ? "text-red-600" : "text-green-600")
                : (isPositive ? "text-green-600" : "text-red-600");

              return (
                <div key={kpi.label} className="bg-white rounded-xl border border-border shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-muted-foreground">{kpi.label}</span>
                    <span className={`text-[10px] font-bold ${changeColor}`}>
                      {kpi.changePct > 0 ? "+" : ""}{kpi.changePct}%
                    </span>
                  </div>
                  <p className="text-lg font-bold text-rm-gray">{fmtValue(kpi.current, kpi.format)}</p>
                  <p className="text-[10px] text-muted-foreground">({fmtValue(kpi.previous, kpi.format)})</p>
                  {kpi.yoyChangePct != null && (
                    <p className="text-[9px] text-muted-foreground mt-1">YoY: {kpi.yoyChangePct > 0 ? "+" : ""}{kpi.yoyChangePct}%</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Per-metric sections ── */}
          {report.metricSections.map((section) => {
            const isEditing = editingId === section.id;

            return (
              <div key={section.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                {/* Section label bar */}
                <div className="px-5 py-2 border-b border-border flex items-center justify-between bg-gray-50/50">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{section.label}</span>
                  {!isEditing && (
                    <button onClick={() => startEdit(section.id, section.heading, section.body)} className="p-1 rounded-md hover:bg-gray-100 text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                  )}
                  {isEditing && (
                    <div className="flex items-center gap-1">
                      <button onClick={saveEdit} disabled={saving} className="p-1 rounded-md bg-rm-blue text-white hover:bg-rm-blue/90">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}</button>
                      <button onClick={() => { setEditingId(null); setEditBuf(null); }} className="p-1 rounded-md border border-border hover:bg-gray-50"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>

                <div className="px-5 py-4">
                  {/* Layout: text left, charts right */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left: headline + bullets + body */}
                    <div>
                      {isEditing && editBuf ? (
                        <>
                          <input type="text" value={editBuf.heading} onChange={(e) => setEditBuf({ ...editBuf, heading: e.target.value })} className="w-full text-xl font-bold text-rm-gray border border-border rounded-md px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-rm-blue" />
                          <div className="mb-3">
                            {section.bullets.map((b, i) => <p key={i} className="text-sm text-rm-gray font-medium">• {b}</p>)}
                          </div>
                          <textarea value={editBuf.body} onChange={(e) => setEditBuf({ ...editBuf, body: e.target.value })} rows={6} className="w-full text-sm text-rm-gray border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rm-blue resize-y leading-relaxed" />
                        </>
                      ) : (
                        <>
                          <h3 className="text-xl font-bold text-rm-gray leading-snug mb-3">{section.heading}<span className="text-rm-orange">.</span></h3>
                          <div className="space-y-0.5 mb-3">
                            {section.bullets.map((b, i) => <p key={i} className="text-sm text-rm-gray"><span className="font-semibold">•</span> {b}</p>)}
                          </div>
                          <p className="text-sm text-rm-gray leading-relaxed">{section.body}</p>
                        </>
                      )}
                    </div>

                    {/* Right: charts */}
                    <div className="space-y-4">
                      <MiniChart data={section.chartData} type={section.chartType} label={section.chartLabel} />
                      {section.chartData2 && section.chartLabel2 && (
                        <MiniChart data={section.chartData2} type={section.chartType2 ?? "line"} label={section.chartLabel2} color="#1e40af" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* ── Actions section ── */}
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-2 border-b border-border flex items-center justify-between bg-gray-50/50">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Acties komende maand</span>
              {editingId !== "acties" && <button onClick={() => startEdit("acties", report.actionSection.heading, report.actionSection.body)} className="p-1 rounded-md hover:bg-gray-100 text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>}
              {editingId === "acties" && (
                <div className="flex items-center gap-1">
                  <button onClick={saveEdit} disabled={saving} className="p-1 rounded-md bg-rm-blue text-white">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}</button>
                  <button onClick={() => { setEditingId(null); setEditBuf(null); }} className="p-1 rounded-md border border-border hover:bg-gray-50"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
            <div className="px-5 py-4">
              {editingId === "acties" && editBuf ? (
                <>
                  <input type="text" value={editBuf.heading} onChange={(e) => setEditBuf({ ...editBuf, heading: e.target.value })} className="w-full text-xl font-bold text-rm-gray border border-border rounded-md px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-rm-blue" />
                  <textarea value={editBuf.body} onChange={(e) => setEditBuf({ ...editBuf, body: e.target.value })} rows={8} className="w-full text-sm text-rm-gray border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rm-blue resize-y leading-relaxed" />
                </>
              ) : (
                <>
                  <h3 className="text-xl font-bold text-rm-gray leading-snug mb-3">{report.actionSection.heading}<span className="text-rm-orange">.</span></h3>
                  <div className="text-sm text-rm-gray leading-relaxed whitespace-pre-line">{report.actionSection.body}</div>
                </>
              )}
            </div>
          </div>

          {/* ── Planning section ── */}
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-2 border-b border-border flex items-center justify-between bg-gray-50/50">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Planning & Vooruitblik</span>
              {editingId !== "planning" && <button onClick={() => startEdit("planning", report.planningSection.heading, report.planningSection.body)} className="p-1 rounded-md hover:bg-gray-100 text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>}
              {editingId === "planning" && (
                <div className="flex items-center gap-1">
                  <button onClick={saveEdit} disabled={saving} className="p-1 rounded-md bg-rm-blue text-white">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}</button>
                  <button onClick={() => { setEditingId(null); setEditBuf(null); }} className="p-1 rounded-md border border-border hover:bg-gray-50"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
            <div className="px-5 py-4">
              {editingId === "planning" && editBuf ? (
                <>
                  <input type="text" value={editBuf.heading} onChange={(e) => setEditBuf({ ...editBuf, heading: e.target.value })} className="w-full text-xl font-bold text-rm-gray border border-border rounded-md px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-rm-blue" />
                  <textarea value={editBuf.body} onChange={(e) => setEditBuf({ ...editBuf, body: e.target.value })} rows={8} className="w-full text-sm text-rm-gray border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rm-blue resize-y leading-relaxed" />
                </>
              ) : (
                <>
                  <h3 className="text-xl font-bold text-rm-gray leading-snug mb-3">{report.planningSection.heading}<span className="text-rm-orange">.</span></h3>
                  <div className="text-sm text-rm-gray leading-relaxed whitespace-pre-line">{report.planningSection.body}</div>
                </>
              )}
            </div>
          </div>

          {/* ── Country Sections (multi-country only) ── */}
          {report.countrySections && report.countrySections.length > 0 && (
            <>
              {report.countrySections.map((cs) => (
                <div key={cs.countryCode}>
                  {/* Country divider */}
                  <div className="bg-rm-blue rounded-xl p-6 mt-2">
                    <h2 className="text-xl font-bold text-white">Voortgang SEA {cs.countryName}</h2>
                  </div>

                  {/* Country KPI cards */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
                    {cs.kpiCards.map((kpi) => {
                      const isPositive = kpi.changePct > 0;
                      const invertColor = kpi.label === "CPA" || kpi.label === "Kosten";
                      const changeColor = invertColor
                        ? (isPositive ? "text-red-600" : "text-green-600")
                        : (isPositive ? "text-green-600" : "text-red-600");
                      return (
                        <div key={kpi.label} className="bg-white rounded-xl border border-border shadow-sm p-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-medium text-muted-foreground">{kpi.label}</span>
                            <span className={`text-[10px] font-bold ${changeColor}`}>{kpi.changePct > 0 ? "+" : ""}{kpi.changePct}%</span>
                          </div>
                          <p className="text-lg font-bold text-rm-gray">{fmtValue(kpi.current, kpi.format)}</p>
                          <p className="text-[10px] text-muted-foreground">({fmtValue(kpi.previous, kpi.format)})</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Country metric sections */}
                  {cs.metricSections.map((section) => (
                    <div key={section.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden mt-4">
                      <div className="px-5 py-2 border-b border-border bg-gray-50/50">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{section.label}</span>
                      </div>
                      <div className="px-5 py-4">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div>
                            <h3 className="text-xl font-bold text-rm-gray leading-snug mb-3">{section.heading}<span className="text-rm-orange">.</span></h3>
                            <div className="space-y-0.5 mb-3">
                              {section.bullets.map((b, i) => <p key={i} className="text-sm text-rm-gray"><span className="font-semibold">•</span> {b}</p>)}
                            </div>
                            <p className="text-sm text-rm-gray leading-relaxed">{section.body}</p>
                          </div>
                          <div className="space-y-4">
                            <MiniChart data={section.chartData} type={section.chartType} label={section.chartLabel} />
                            {section.chartData2 && section.chartLabel2 && (
                              <MiniChart data={section.chartData2} type={section.chartType2 ?? "line"} label={section.chartLabel2} color="#1e40af" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

        </div>
      )}
    </div>
  );
}
