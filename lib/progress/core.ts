import type {
  GenerationJobEventRow,
  GenerationJobRow,
  GenerationJobStatus,
  GenerationJobType,
  GenerationPhaseDefinition,
  GenerationPhaseState,
} from "./types";

export const JOB_PHASES: Record<GenerationJobType, GenerationPhaseDefinition[]> = {
  monthly_sop: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_data", label: "Data ophalen..." },
    { key: "enrich_context", label: "Data verrijken..." },
    { key: "run_step_1", label: "Analyse stap 1 uitvoeren..." },
    { key: "run_step_2", label: "Analyse stap 2 uitvoeren..." },
    { key: "run_step_3", label: "Analyse stap 3 uitvoeren..." },
    { key: "run_step_4", label: "Analyse stap 4 uitvoeren..." },
    { key: "run_step_5", label: "Analyse stap 5 uitvoeren..." },
    { key: "run_step_6", label: "Analyse stap 6 uitvoeren..." },
    { key: "run_step_7", label: "Analyse stap 7 uitvoeren..." },
    { key: "run_step_8", label: "Analyse stap 8 uitvoeren..." },
    { key: "run_step_9", label: "Analyse stap 9 uitvoeren..." },
    { key: "finalize_conclusion", label: "Eindconclusie formuleren..." },
    { key: "structure_findings", label: "Findings structureren..." },
    { key: "build_recommendations", label: "Aanbevelingen genereren..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  biweekly_sop: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_data", label: "Data ophalen..." },
    { key: "enrich_context", label: "Data verrijken..." },
    { key: "run_analysis", label: "Analyse uitvoeren..." },
    { key: "extract_findings", label: "Findings structureren..." },
    { key: "extract_recommendations", label: "Aanbevelingen genereren..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  weekly_sop: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_data", label: "Data ophalen..." },
    { key: "enrich_context", label: "Data verrijken..." },
    { key: "run_analysis", label: "Analyse uitvoeren..." },
    { key: "extract_findings", label: "Findings structureren..." },
    { key: "extract_recommendations", label: "Aanbevelingen genereren..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  second_opinion: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_account_context", label: "Accountcontext ophalen..." },
    { key: "evaluate_checks", label: "Audit checks uitvoeren..." },
    { key: "synthesize_findings", label: "Audit samenvatten..." },
    { key: "build_pdf", label: "PDF opbouwen..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  report_generation: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_inputs", label: "Input ophalen..." },
    { key: "aggregate_data", label: "Data aggregeren..." },
    { key: "compose_sections", label: "Rapportsecties opstellen..." },
    { key: "compose_country_sections", label: "Landensecties opstellen..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  pdf_generation: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_inputs", label: "Brondata ophalen..." },
    { key: "render_pdf", label: "PDF opbouwen..." },
    { key: "store_artifact", label: "PDF opslaan..." },
    { key: "done", label: "Gereed" },
  ],
};

export function getPhaseDefinitions(jobType: GenerationJobType): GenerationPhaseDefinition[] {
  return JOB_PHASES[jobType];
}

export function getPhaseOrder(jobType: GenerationJobType, phaseKey: string | null | undefined): number {
  if (!phaseKey) return -1;
  return JOB_PHASES[jobType].findIndex((phase) => phase.key === phaseKey);
}

export function getPhaseDefinition(jobType: GenerationJobType, phaseKey: string): GenerationPhaseDefinition {
  return JOB_PHASES[jobType].find((phase) => phase.key === phaseKey)
    ?? { key: phaseKey, label: phaseKey };
}

export function buildPhaseProgress(jobType: GenerationJobType, phaseKey: string) {
  const phases = JOB_PHASES[jobType];
  const order = Math.max(0, getPhaseOrder(jobType, phaseKey));
  const total = phases.length;
  const pct = total <= 1 ? 100 : Math.min(100, Math.round((order / (total - 1)) * 100));
  return {
    stepIndex: Math.min(order + 1, total),
    totalSteps: total,
    progressPct: pct,
    phase: getPhaseDefinition(jobType, phaseKey),
    phaseOrder: order,
  };
}

export function canAdvancePhase(jobType: GenerationJobType, currentPhase: string | null, nextPhase: string): boolean {
  const currentOrder = getPhaseOrder(jobType, currentPhase);
  const nextOrder = getPhaseOrder(jobType, nextPhase);
  return nextOrder >= currentOrder;
}

export function buildQueuedJob(input: {
  jobId: string;
  clientId?: string | null;
  jobType: GenerationJobType;
  metadata?: Record<string, unknown>;
  now?: string;
}): GenerationJobRow {
  const now = input.now ?? new Date().toISOString();
  const progress = buildPhaseProgress(input.jobType, "init");
  return {
    job_id: input.jobId,
    client_id: input.clientId ?? null,
    job_type: input.jobType,
    status: "queued",
    current_phase: "init",
    current_phase_label: progress.phase.label,
    progress_pct: 0,
    step_index: 0,
    total_steps: progress.totalSteps,
    message: null,
    started_at: now,
    updated_at: now,
    completed_at: null,
    error_message: null,
    partial_output_exists: false,
    metadata: input.metadata ?? {},
  };
}

export function buildRunningJobUpdate(input: {
  current: Pick<GenerationJobRow, "job_type" | "current_phase" | "metadata" | "partial_output_exists">;
  phaseKey: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  allowRegression?: boolean;
  now?: string;
}): Partial<GenerationJobRow> | null {
  const now = input.now ?? new Date().toISOString();
  if (!input.allowRegression && !canAdvancePhase(input.current.job_type, input.current.current_phase, input.phaseKey)) {
    return null;
  }

  const progress = buildPhaseProgress(input.current.job_type, input.phaseKey);
  return {
    status: "running",
    current_phase: input.phaseKey,
    current_phase_label: progress.phase.label,
    progress_pct: progress.progressPct,
    step_index: progress.stepIndex,
    total_steps: progress.totalSteps,
    message: input.message ?? null,
    updated_at: now,
    error_message: null,
    metadata: {
      ...(input.current.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  };
}

export function buildCompletedJobUpdate(input: {
  current: Pick<GenerationJobRow, "job_type" | "metadata" | "partial_output_exists">;
  message?: string | null;
  metadata?: Record<string, unknown>;
  partialOutputExists?: boolean;
  now?: string;
}): Partial<GenerationJobRow> {
  const now = input.now ?? new Date().toISOString();
  const progress = buildPhaseProgress(input.current.job_type, "done");
  return {
    status: "completed",
    current_phase: "done",
    current_phase_label: progress.phase.label,
    progress_pct: 100,
    step_index: progress.totalSteps,
    total_steps: progress.totalSteps,
    message: input.message ?? "Gereed",
    completed_at: now,
    updated_at: now,
    error_message: null,
    partial_output_exists: input.partialOutputExists ?? input.current.partial_output_exists,
    metadata: {
      ...(input.current.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  };
}

export function buildFailedJobUpdate(input: {
  current: Pick<GenerationJobRow, "job_type" | "current_phase" | "metadata" | "partial_output_exists">;
  errorMessage: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  partialOutputExists?: boolean;
  now?: string;
}): Partial<GenerationJobRow> {
  const now = input.now ?? new Date().toISOString();
  const activePhase = input.current.current_phase ?? "init";
  const progress = buildPhaseProgress(input.current.job_type, activePhase);
  return {
    status: "failed",
    current_phase: activePhase,
    current_phase_label: progress.phase.label,
    progress_pct: progress.progressPct,
    step_index: progress.stepIndex,
    total_steps: progress.totalSteps,
    message: input.message ?? progress.phase.label,
    completed_at: now,
    updated_at: now,
    error_message: input.errorMessage,
    partial_output_exists: input.partialOutputExists ?? input.current.partial_output_exists,
    metadata: {
      ...(input.current.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  };
}

export function buildPhaseEvent(input: {
  jobId: string;
  jobType: GenerationJobType;
  phaseKey: string;
  state: GenerationPhaseState;
  details?: string | null;
  now?: string;
  completed?: boolean;
}): GenerationJobEventRow {
  const now = input.now ?? new Date().toISOString();
  const progress = buildPhaseProgress(input.jobType, input.phaseKey);
  return {
    job_id: input.jobId,
    job_type: input.jobType,
    phase_key: input.phaseKey,
    phase_label: progress.phase.label,
    phase_order: progress.phaseOrder,
    state: input.state,
    details: input.details ?? null,
    started_at: now,
    completed_at: input.completed ? now : null,
    updated_at: now,
  };
}

export function shouldPollGenerationJob(status: GenerationJobStatus | null | undefined): boolean {
  return status === "queued" || status === "running";
}
