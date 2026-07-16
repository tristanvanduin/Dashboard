export type GenerationJobType =
  | "monthly_sop"
  | "biweekly_sop"
  | "weekly_sop"
  | "second_opinion"
  | "report_generation"
  | "pdf_generation";

export type GenerationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationPhaseState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface GenerationPhaseDefinition {
  key: string;
  label: string;
}

export interface GenerationJobRow {
  job_id: string;
  client_id: string | null;
  job_type: GenerationJobType;
  status: GenerationJobStatus;
  current_phase: string | null;
  current_phase_label: string | null;
  progress_pct: number;
  step_index: number;
  total_steps: number;
  message: string | null;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  partial_output_exists: boolean;
  metadata: Record<string, unknown> | null;
}

export interface GenerationJobEventRow {
  job_id: string;
  job_type?: GenerationJobType;
  phase_key: string;
  phase_label: string;
  phase_order: number;
  state: GenerationPhaseState;
  details: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

export interface GenerationJobSnapshot extends GenerationJobRow {
  phases: GenerationJobEventRow[];
  tracker_available?: boolean;
  tracker_message?: string | null;
}

export interface GenerationJobLookupResponse {
  found: boolean;
  trackerAvailable: boolean;
  error?: string;
  snapshot?: GenerationJobSnapshot;
}
