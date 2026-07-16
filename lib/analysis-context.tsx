"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export type JobStatus = "running" | "done" | "error";

export interface AnalysisJob {
  id: string;
  label: string;
  status: JobStatus;
  error?: string;
  startedAt: number;
}

type OnComplete = (jobId: string) => void;
type OnError = (jobId: string, error: string) => void;

interface AnalysisContextValue {
  jobs: AnalysisJob[];
  /** Start a background analysis. Returns the job ID. The fetchFn runs independently of component lifecycle. */
  startJob: (id: string, label: string, fetchFn: () => Promise<void>) => void;
  /** Check if a specific job is running */
  isRunning: (id: string) => boolean;
  /** Subscribe to job completion */
  onComplete: OnComplete | null;
  onError: OnError | null;
  setOnComplete: (fn: OnComplete | null) => void;
  setOnError: (fn: OnError | null) => void;
  /** Dismiss a completed/failed notification */
  dismissJob: (id: string) => void;
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [onCompleteCb, setOnCompleteCb] = useState<OnComplete | null>(null);
  const [onErrorCb, setOnErrorCb] = useState<OnError | null>(null);

  const startJob = useCallback((id: string, label: string, fetchFn: () => Promise<void>) => {
    // Don't start if already running
    setJobs((prev) => {
      if (prev.some((j) => j.id === id && j.status === "running")) return prev;
      return [...prev.filter((j) => j.id !== id), { id, label, status: "running" as JobStatus, startedAt: Date.now() }];
    });

    // Run in background — not tied to any component
    fetchFn()
      .then(() => {
        setJobs((prev) => prev.map((j) => j.id === id ? { ...j, status: "done" as JobStatus } : j));
        // Auto-dismiss success after 8 seconds
        setTimeout(() => {
          setJobs((prev) => prev.filter((j) => j.id !== id));
        }, 8000);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Onbekende fout";
        setJobs((prev) => prev.map((j) => j.id === id ? { ...j, status: "error" as JobStatus, error: msg } : j));
      });
  }, []);

  const isRunning = useCallback((id: string) => {
    return jobs.some((j) => j.id === id && j.status === "running");
  }, [jobs]);

  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  return (
    <AnalysisContext.Provider value={{
      jobs,
      startJob,
      isRunning,
      onComplete: onCompleteCb,
      onError: onErrorCb,
      setOnComplete: setOnCompleteCb,
      setOnError: setOnErrorCb,
      dismissJob,
    }}>
      {children}
      <AnalysisNotifications jobs={jobs} onDismiss={dismissJob} />
    </AnalysisContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within AnalysisProvider");
  return ctx;
}

// ── Floating notification bar ──────────────────────────────────────────────

function AnalysisNotifications({ jobs, onDismiss }: { jobs: AnalysisJob[]; onDismiss: (id: string) => void }) {
  const visible = jobs.filter((j) => j.status !== "done" || Date.now() - j.startedAt < 10000);
  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {visible.map((job) => (
        <div
          key={job.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm ${
            job.status === "running"
              ? "bg-white border-rm-blue/20"
              : job.status === "done"
              ? "bg-emerald-50 border-emerald-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          {job.status === "running" && <Loader2 className="w-4 h-4 text-rm-blue animate-spin shrink-0" />}
          {job.status === "done" && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
          {job.status === "error" && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}

          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium ${
              job.status === "running" ? "text-rm-gray" :
              job.status === "done" ? "text-emerald-700" : "text-red-700"
            }`}>
              {job.label}
            </p>
            {job.status === "running" && (
              <p className="text-[10px] text-muted-foreground">Draait op de achtergrond...</p>
            )}
            {job.status === "done" && (
              <p className="text-[10px] text-emerald-600">Voltooid</p>
            )}
            {job.status === "error" && (
              <p className="text-[10px] text-red-500 truncate">{job.error}</p>
            )}
          </div>

          {job.status !== "running" && (
            <button
              onClick={() => onDismiss(job.id)}
              className="shrink-0 p-1 rounded hover:bg-black/5"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
