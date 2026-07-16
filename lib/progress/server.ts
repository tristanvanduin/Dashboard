import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  buildCompletedJobUpdate,
  buildFailedJobUpdate,
  buildPhaseEvent,
  buildQueuedJob,
  buildRunningJobUpdate,
} from "./core";
import type { GenerationJobLookupResponse, GenerationJobRow, GenerationJobSnapshot, GenerationJobType } from "./types";
import { logger } from "@/lib/logger";

const JOBS_TABLE = "generation_jobs";
const EVENTS_TABLE = "generation_job_events";
const PROGRESS_RETRY_MS = 30_000;

const loggedMessages = new Set<string>();
let trackerUnavailableReason: string | null = null;
let trackerUnavailableDetectedAt = 0;

function logOnce(key: string, message: string) {
  if (loggedMessages.has(key)) return;
  loggedMessages.add(key);
  logger.error(message);
}

export function isProgressStorageUnavailableError(error: Pick<PostgrestError, "code" | "message"> | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205"
    || error.code === "42P01"
    || error.message.includes("Could not find the table")
    || error.message.includes("relation")
    || error.message.includes("schema cache");
}

function markTrackerUnavailable(reason: string) {
  trackerUnavailableDetectedAt = Date.now();
  if (trackerUnavailableReason === reason) return;
  trackerUnavailableReason = reason;
  logOnce(`tracker-unavailable:${reason}`, `[generation-progress] tracker storage unavailable: ${reason}`);
}

function clearTrackerUnavailable() {
  trackerUnavailableReason = null;
  trackerUnavailableDetectedAt = 0;
}

function shouldBypassProgressStorage(): boolean {
  return trackerUnavailableReason !== null && (Date.now() - trackerUnavailableDetectedAt) < PROGRESS_RETRY_MS;
}

function trackerUnavailableResponse(jobId?: string): GenerationJobLookupResponse {
  return {
    found: false,
    trackerAvailable: false,
    error: trackerUnavailableReason ?? "Live voortgang niet beschikbaar.",
    snapshot: jobId ? {
      job_id: jobId,
      client_id: null,
      job_type: "monthly_sop",
      status: "running",
      current_phase: null,
      current_phase_label: null,
      progress_pct: 0,
      step_index: 0,
      total_steps: 0,
      message: "Live voortgang niet beschikbaar. Generatie loopt mogelijk nog door.",
      started_at: null,
      updated_at: null,
      completed_at: null,
      error_message: null,
      partial_output_exists: false,
      metadata: { tracker_unavailable: true },
      phases: [],
      tracker_available: false,
      tracker_message: trackerUnavailableReason ?? "Live voortgang niet beschikbaar.",
    } : undefined,
  };
}

async function fetchJobRow(supabase: SupabaseClient, jobId: string): Promise<GenerationJobRow | null> {
  if (shouldBypassProgressStorage()) return null;

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return null;
    }
    logOnce(`fetch-job:${error.code}:${error.message}`, `[generation-progress] fetch job failed: ${error.message}`);
    return null;
  }

  clearTrackerUnavailable();
  return (data ?? null) as GenerationJobRow | null;
}

async function completeOtherRunningEvents(supabase: SupabaseClient, jobId: string, keepPhaseKey: string, now: string) {
  if (shouldBypassProgressStorage()) return;
  const { error } = await supabase
    .from(EVENTS_TABLE)
    .update({
      state: "completed",
      completed_at: now,
      updated_at: now,
    })
    .eq("job_id", jobId)
    .eq("state", "running")
    .neq("phase_key", keepPhaseKey);

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return;
    }
    logOnce(`complete-events:${error.code}:${error.message}`, `[generation-progress] complete running events failed: ${error.message}`);
  }
}

async function upsertEvent(supabase: SupabaseClient, event: ReturnType<typeof buildPhaseEvent>) {
  if (shouldBypassProgressStorage()) return;
  const { error } = await supabase
    .from(EVENTS_TABLE)
    .upsert(event, { onConflict: "job_id,phase_key" });

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return;
    }
    logOnce(`upsert-event:${error.code}:${error.message}`, `[generation-progress] upsert event failed: ${error.message}`);
  }
}

export async function createProgressJob(supabase: SupabaseClient, input: {
  jobId: string;
  clientId?: string | null;
  jobType: GenerationJobType;
  metadata?: Record<string, unknown>;
  initialMessage?: string | null;
}) {
  if (shouldBypassProgressStorage()) return null;

  const now = new Date().toISOString();
  const row = buildQueuedJob({
    jobId: input.jobId,
    clientId: input.clientId ?? null,
    jobType: input.jobType,
    metadata: input.metadata,
    now,
  });

  const { error } = await supabase
    .from(JOBS_TABLE)
    .upsert({
      ...row,
      message: input.initialMessage ?? row.current_phase_label,
    }, { onConflict: "job_id" });

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return null;
    }
    logOnce(`create-job:${error.code}:${error.message}`, `[generation-progress] create job failed: ${error.message}`);
    return null;
  }

  clearTrackerUnavailable();
  await upsertEvent(supabase, buildPhaseEvent({
    jobId: input.jobId,
    jobType: input.jobType,
    phaseKey: "init",
    state: "running",
    details: input.initialMessage ?? row.current_phase_label,
    now,
  }));

  return row;
}

export async function updateProgressPhase(supabase: SupabaseClient, input: {
  jobId: string;
  phaseKey: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  allowRegression?: boolean;
}) {
  const current = await fetchJobRow(supabase, input.jobId);
  if (!current) return null;

  const update = buildRunningJobUpdate({
    current,
    phaseKey: input.phaseKey,
    message: input.message,
    metadata: input.metadata,
    allowRegression: input.allowRegression,
  });

  if (!update) return current;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from(JOBS_TABLE)
    .update(update)
    .eq("job_id", input.jobId);

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return current;
    }
    logOnce(`update-phase:${error.code}:${error.message}`, `[generation-progress] update phase failed: ${error.message}`);
    return current;
  }

  await completeOtherRunningEvents(supabase, input.jobId, input.phaseKey, now);
  await upsertEvent(supabase, buildPhaseEvent({
    jobId: input.jobId,
    jobType: current.job_type,
    phaseKey: input.phaseKey,
    state: "running",
    details: input.message,
    now,
  }));

  return { ...current, ...update } as GenerationJobRow;
}

export async function markProgressCompleted(supabase: SupabaseClient, input: {
  jobId: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  partialOutputExists?: boolean;
}) {
  const current = await fetchJobRow(supabase, input.jobId);
  if (!current) return null;

  const update = buildCompletedJobUpdate({
    current,
    message: input.message,
    metadata: input.metadata,
    partialOutputExists: input.partialOutputExists,
  });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from(JOBS_TABLE)
    .update(update)
    .eq("job_id", input.jobId);

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return current;
    }
    logOnce(`complete-job:${error.code}:${error.message}`, `[generation-progress] complete job failed: ${error.message}`);
    return current;
  }

  await completeOtherRunningEvents(supabase, input.jobId, "done", now);
  await upsertEvent(supabase, buildPhaseEvent({
    jobId: input.jobId,
    jobType: current.job_type,
    phaseKey: "done",
    state: "completed",
    details: input.message ?? "Gereed",
    now,
    completed: true,
  }));

  return { ...current, ...update } as GenerationJobRow;
}

export async function markProgressFailed(supabase: SupabaseClient, input: {
  jobId: string;
  errorMessage: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  partialOutputExists?: boolean;
}) {
  const current = await fetchJobRow(supabase, input.jobId);
  if (!current) return null;

  const update = buildFailedJobUpdate({
    current,
    errorMessage: input.errorMessage,
    message: input.message,
    metadata: input.metadata,
    partialOutputExists: input.partialOutputExists,
  });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from(JOBS_TABLE)
    .update(update)
    .eq("job_id", input.jobId);

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return current;
    }
    logOnce(`fail-job:${error.code}:${error.message}`, `[generation-progress] fail job failed: ${error.message}`);
    return current;
  }

  if (current.current_phase) {
    await upsertEvent(supabase, buildPhaseEvent({
      jobId: input.jobId,
      jobType: current.job_type,
      phaseKey: current.current_phase,
      state: "failed",
      details: input.errorMessage,
      now,
      completed: true,
    }));
  }

  return { ...current, ...update } as GenerationJobRow;
}

export async function fetchProgressSnapshot(supabase: SupabaseClient, jobId: string): Promise<GenerationJobLookupResponse> {
  if (shouldBypassProgressStorage()) {
    return trackerUnavailableResponse(jobId);
  }

  const [jobRes, eventsRes] = await Promise.all([
    supabase.from(JOBS_TABLE).select("*").eq("job_id", jobId).maybeSingle(),
    supabase.from(EVENTS_TABLE).select("*").eq("job_id", jobId).order("phase_order", { ascending: true }),
  ]);

  if (jobRes.error) {
    if (isProgressStorageUnavailableError(jobRes.error)) {
      markTrackerUnavailable(jobRes.error.message);
      return trackerUnavailableResponse(jobId);
    }
    logOnce(`fetch-snapshot-job:${jobRes.error.code}:${jobRes.error.message}`, `[generation-progress] fetch snapshot job failed: ${jobRes.error.message}`);
    return { found: false, trackerAvailable: true, error: jobRes.error.message };
  }

  clearTrackerUnavailable();

  if (!jobRes.data) {
    return { found: false, trackerAvailable: true };
  }

  if (eventsRes.error) {
    if (isProgressStorageUnavailableError(eventsRes.error)) {
      markTrackerUnavailable(eventsRes.error.message);
      return trackerUnavailableResponse(jobId);
    }
    logOnce(`fetch-snapshot-events:${eventsRes.error.code}:${eventsRes.error.message}`, `[generation-progress] fetch snapshot events failed: ${eventsRes.error.message}`);
  }

  const snapshot: GenerationJobSnapshot = {
    ...(jobRes.data as GenerationJobRow),
    phases: ((eventsRes.data ?? []) as GenerationJobSnapshot["phases"]).sort((a, b) => a.phase_order - b.phase_order),
    tracker_available: true,
    tracker_message: null,
  };

  return {
    found: true,
    trackerAvailable: true,
    snapshot,
  };
}

export function getProgressTrackerState() {
  return {
    available: trackerUnavailableReason === null,
    reason: trackerUnavailableReason,
  };
}
