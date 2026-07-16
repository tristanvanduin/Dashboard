"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { describeGenerationOutcome } from "@/lib/progress/client";
import type { GenerationJobSnapshot } from "@/lib/progress/types";

interface Props {
  title: string;
  job: GenerationJobSnapshot | null;
  fallbackMessage?: string;
}

export function GenerationProgressCard({ title, job, fallbackMessage = "Voortgang wordt voorbereid..." }: Props) {
  const progress = job?.progress_pct ?? 0;
  const phases = job?.phases ?? [];
  const currentPhase = job?.current_phase;

  return (
    <div className="rounded-lg border border-border bg-white/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-rm-gray">{title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {job ? describeGenerationOutcome(job) : fallbackMessage}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-semibold text-rm-gray">{progress}%</p>
          <p className="text-[10px] text-muted-foreground">
            {job?.step_index ?? 0}/{job?.total_steps ?? 0} fases
          </p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all ${
            job?.status === "failed" ? "bg-red-500" : job?.status === "completed" ? "bg-emerald-500" : "bg-rm-blue"
          }`}
          style={{ width: `${Math.max(6, progress)}%` }}
        />
      </div>

      {phases.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {phases.map((phase) => {
            const isCurrent = phase.phase_key === currentPhase && job?.status === "running";
            const isFailed = phase.state === "failed";
            const isDone = phase.state === "completed";
            return (
              <div key={phase.phase_key} className="flex items-start gap-2 text-[11px]">
                <span className="mt-0.5 shrink-0">
                  {isCurrent && <Loader2 className="h-3.5 w-3.5 animate-spin text-rm-blue" />}
                  {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  {isFailed && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
                  {!isCurrent && !isDone && !isFailed && <span className="block h-3.5 w-3.5 rounded-full border border-gray-300" />}
                </span>
                <div className="min-w-0">
                  <p className={`font-medium ${
                    isFailed ? "text-red-700" : isDone ? "text-emerald-700" : isCurrent ? "text-rm-gray" : "text-muted-foreground"
                  }`}>
                    {phase.phase_label}
                  </p>
                  {phase.details && (
                    <p className="text-[10px] text-muted-foreground">{phase.details}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {job?.status === "failed" && job.error_message && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
          {job.error_message}
          {job.partial_output_exists ? " Partiële output is beschikbaar." : ""}
        </div>
      )}

      {job?.status === "completed" && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-700">
          {job.message || "Resultaat gereed."}
        </div>
      )}
    </div>
  );
}
