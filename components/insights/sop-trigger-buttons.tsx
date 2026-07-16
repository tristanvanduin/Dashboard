"use client";

import { useState, useEffect } from "react";
import { Loader2, Calendar, CheckCircle2, AlertCircle, FileDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAnalysis } from "@/lib/analysis-context";
import { getAllClients } from "@/lib/clients";
import { useGenerationProgress } from "@/lib/use-generation-progress";
import { GenerationProgressCard } from "@/components/ui/generation-progress-card";

type SopType = "weekly" | "biweekly" | "monthly";

interface SopStatus {
  running: boolean;
  lastDate: string | null;
  error: string | null;
  success: boolean;
}

const SOP_CONFIG: Record<SopType, { label: string; description: string; endpoint: string }> = {
  weekly: {
    label: "Weekly",
    description: "Health check & bleeders",
    endpoint: "/api/analysis/weekly",
  },
  biweekly: {
    label: "Bi-weekly",
    description: "Campagne tracking & trends",
    endpoint: "/api/analysis/biweekly",
  },
  monthly: {
    label: "Monthly",
    description: "Volledige analyse & actiepunten",
    endpoint: "/api/analysis/monthly",
  },
};

export interface SopError {
  id: string;
  type: SopType;
  label: string;
  error: string;
  timestamp: string;
}

interface Props {
  clientId: string;
  onAnalysisComplete: () => void;
  onAnalysisError?: (error: SopError) => void;
}

export function SopTriggerButtons({ clientId, onAnalysisComplete, onAnalysisError }: Props) {
  const { startJob, isRunning: isJobRunning } = useAnalysis();
  const [status, setStatus] = useState<Record<SopType, SopStatus>>({
    weekly: { running: false, lastDate: null, error: null, success: false },
    biweekly: { running: false, lastDate: null, error: null, success: false },
    monthly: { running: false, lastDate: null, error: null, success: false },
  });
  const [activeJobIds, setActiveJobIds] = useState<Record<SopType, string | null>>({
    weekly: null,
    biweekly: null,
    monthly: null,
  });
  const [activePdfJobIds, setActivePdfJobIds] = useState<Record<SopType, string | null>>({
    weekly: null,
    biweekly: null,
    monthly: null,
  });
  const weeklyProgress = useGenerationProgress(activeJobIds.weekly);
  const biweeklyProgress = useGenerationProgress(activeJobIds.biweekly);
  const monthlyProgress = useGenerationProgress(activeJobIds.monthly);
  const weeklyPdfProgress = useGenerationProgress(activePdfJobIds.weekly);
  const biweeklyPdfProgress = useGenerationProgress(activePdfJobIds.biweekly);
  const monthlyPdfProgress = useGenerationProgress(activePdfJobIds.monthly);
  const progressByType = {
    weekly: weeklyProgress.job,
    biweekly: biweeklyProgress.job,
    monthly: monthlyProgress.job,
  } as const;
  const pdfProgressByType = {
    weekly: weeklyPdfProgress.job,
    biweekly: biweeklyPdfProgress.job,
    monthly: monthlyPdfProgress.job,
  } as const;

  // Load last analysis dates on mount
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;

    async function loadLastDates() {
      if (!sb) return;
      const types: SopType[] = ["weekly", "biweekly", "monthly"];
      const updates: Partial<Record<SopType, SopStatus>> = {};

      for (const type of types) {
        const { data } = await sb
          .from("sop_analysis_output")
          .select("analysis_date")
          .eq("client_id", clientId)
          .eq("sop_type", type)
          .order("analysis_date", { ascending: false })
          .limit(1);

        if (data && data.length > 0) {
          updates[type] = { ...status[type], lastDate: data[0].analysis_date };
        }
      }

      if (Object.keys(updates).length > 0) {
        setStatus((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(updates)) {
            next[k as SopType] = { ...next[k as SopType], ...v };
          }
          return next;
        });
      }
    }

    loadLastDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function uploadSopFile(sopType: SopType, analysisDate: string, markdownContent: string) {
    const sb = supabase;
    if (!sb) return;

    const fileName = `${analysisDate}-${sopType}-analyse.md`;
    const storagePath = `${clientId}/SOP's/${Date.now()}-${fileName}`;
    const blob = new Blob([markdownContent], { type: "text/markdown" });

    const { error: storageErr } = await sb.storage
      .from("client-files")
      .upload(storagePath, blob);

    if (storageErr) {
      console.error("SOP upload error:", storageErr.message);
      return;
    }

    await sb.from("client_files").insert({
      client_id: clientId,
      folder: "SOP's",
      file_name: fileName,
      file_size: blob.size,
      content_type: "text/markdown",
      storage_path: storagePath,
    });
  }

  function runSop(type: SopType) {
    const config = SOP_CONFIG[type];
    const jobId = `sop-${type}-${clientId}`;
    const progressJobId = crypto.randomUUID();
    setActiveJobIds((prev) => ({ ...prev, [type]: progressJobId }));

    setStatus((prev) => ({
      ...prev,
      [type]: { ...prev[type], running: true, error: null, success: false },
    }));

    startJob(jobId, `${config.label} analyse`, async () => {
      try {
        const res = await fetch(config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, job_id: progressJobId }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analyse mislukt");

        // Build markdown from response
        let markdown: string;
        const analysisDate = data.analysisDate || new Date().toISOString().split("T")[0];

        if (type === "monthly" && data.steps) {
          const header = `# Maandelijkse SEA Analyse\n**Client:** ${clientId}\n**Datum:** ${analysisDate}\n**Periode:** ${data.period?.start} t/m ${data.period?.end}\n**Model:** ${data.model}\n\n---\n\n`;
          const stepsContent = data.steps
            .map((s: { step: number; name: string; output: string }) =>
              `## Stap ${s.step}: ${s.name}\n\n${s.output}`
            )
            .join("\n\n---\n\n");
          markdown = header + stepsContent;
        } else {
          const typeLabel = type === "weekly" ? "Wekelijkse" : "Tweewekelijkse";
          const header = `# ${typeLabel} SEA Analyse\n**Client:** ${clientId}\n**Datum:** ${analysisDate}\n**Periode:** ${data.periodStart} t/m ${data.periodEnd}\n**Model:** ${data.model}\n\n---\n\n`;
          markdown = header + (data.output || data.fullOutput || "Geen output");
        }

        await uploadSopFile(type, analysisDate, markdown);

        setStatus((prev) => ({
          ...prev,
          [type]: { running: false, lastDate: analysisDate, error: null, success: true },
        }));

        setTimeout(() => {
          setStatus((prev) => ({
            ...prev,
            [type]: { ...prev[type], success: false },
          }));
        }, 5000);

        onAnalysisComplete();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Onbekende fout";
        setStatus((prev) => ({
          ...prev,
          [type]: { ...prev[type], running: false, error: errorMsg, success: false },
        }));
        onAnalysisError?.({
          id: `${type}-${Date.now()}`,
          type,
          label: config.label,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
        throw err; // Re-throw so startJob marks it as error
      }
    });
  }

  const [pdfLoading, setPdfLoading] = useState<Record<SopType, boolean>>({
    weekly: false,
    biweekly: false,
    monthly: false,
  });

  async function downloadPdf(type: SopType, e: React.MouseEvent) {
    e.stopPropagation(); // Don't trigger the analysis button
    const clientName = getAllClients().find((c) => c.id === clientId)?.name ?? clientId;
    const progressJobId = crypto.randomUUID();
    setActivePdfJobIds((prev) => ({ ...prev, [type]: progressJobId }));
    setPdfLoading((prev) => ({ ...prev, [type]: true }));

    try {
      const params = new URLSearchParams({
        client_id: clientId,
        sop_type: type,
        client_name: clientName,
        job_id: progressJobId,
      });
      const res = await fetch(`/api/analysis/pdf?${params}`);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "PDF generatie mislukt" }));
        throw new Error(err.error || "PDF generatie mislukt");
      }

      // Download the PDF
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `SOP-${type}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download failed:", err);
      alert(err instanceof Error ? err.message : "PDF download mislukt");
    } finally {
      setPdfLoading((prev) => ({ ...prev, [type]: false }));
    }
  }

  const anyRunning = Object.values(status).some((s) => s.running) ||
    (["weekly", "biweekly", "monthly"] as SopType[]).some((t) => isJobRunning(`sop-${t}-${clientId}`));

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-rm-gray">SOP Analyse</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Klik op een analyse om deze handmatig uit te voeren. Output wordt opgeslagen bij Bestanden &gt; SOP&apos;s.
        </p>
      </div>
      <div className="px-5 py-4 flex gap-3 flex-wrap">
        {(Object.entries(SOP_CONFIG) as [SopType, typeof SOP_CONFIG.weekly][]).map(([type, config]) => {
          const s = status[type];
          const progressJob = progressByType[type];
          const pdfProgressJob = pdfProgressByType[type];
          const progressState = type === "weekly" ? weeklyProgress : type === "biweekly" ? biweeklyProgress : monthlyProgress;
          const pdfProgressState = type === "weekly" ? weeklyPdfProgress : type === "biweekly" ? biweeklyPdfProgress : monthlyPdfProgress;
          return (
            <div key={type} className="flex-1 min-w-[160px] flex flex-col gap-1.5">
              <button
                onClick={() => runSop(type)}
                disabled={anyRunning}
                className={`w-full px-4 py-3 rounded-lg border transition-all text-left ${
                  s.running
                    ? "border-rm-blue/30 bg-rm-blue/5 cursor-wait"
                    : s.success
                    ? "border-emerald-300 bg-emerald-50"
                    : s.error
                    ? "border-red-300 bg-red-50"
                    : "border-border hover:border-rm-blue/40 hover:bg-gray-50 cursor-pointer"
                } ${anyRunning && !s.running ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-rm-gray">{config.label}</span>
                  {s.running && <Loader2 className="w-4 h-4 text-rm-blue animate-spin" />}
                  {s.success && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  {s.error && <AlertCircle className="w-4 h-4 text-red-500" />}
                </div>
                <p className="text-[10px] text-muted-foreground">{config.description}</p>
                {s.lastDate && (
                  <div className="flex items-center gap-1 mt-2 text-[9px] text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    Laatst: {s.lastDate}
                  </div>
                )}
                {s.error && (
                  <p className="text-[10px] text-red-500 mt-1 truncate">{s.error}</p>
                )}
                {s.running && type === "monthly" && (
                  <p className="text-[10px] text-rm-blue mt-1">Dit duurt ca. 2-3 minuten...</p>
                )}
                {s.running && type !== "monthly" && (
                  <p className="text-[10px] text-rm-blue mt-1">Dit duurt ca. 30-60 seconden...</p>
                )}
              </button>
              {s.lastDate && (
                <button
                  onClick={(e) => downloadPdf(type, e)}
                  disabled={pdfLoading[type] || anyRunning}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[10px] text-muted-foreground hover:bg-gray-50 hover:text-rm-gray hover:border-rm-orange/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pdfLoading[type] ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FileDown className="w-3 h-3" />
                  )}
                  {pdfLoading[type] ? "PDF genereren..." : "Download PDF"}
                </button>
              )}
              {(s.running || progressJob) && (
                <GenerationProgressCard
                  title={`${config.label} voortgang`}
                  job={progressJob}
                  fallbackMessage="Voortgang wordt gestart..."
                />
              )}
              {progressState.trackerUnavailable && !progressJob && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  {progressState.trackerMessage || "Live voortgang niet beschikbaar. Analyse loopt mogelijk nog door."}
                </div>
              )}
              {(pdfLoading[type] || pdfProgressJob) && (
                <GenerationProgressCard
                  title={`${config.label} PDF`}
                  job={pdfProgressJob}
                  fallbackMessage="PDF-generatie wordt gestart..."
                />
              )}
              {pdfProgressState.trackerUnavailable && !pdfProgressJob && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  {pdfProgressState.trackerMessage || "Live PDF-voortgang niet beschikbaar."}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
