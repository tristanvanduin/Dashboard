import assert from "node:assert/strict";
import {
  buildCompletedJobUpdate,
  buildFailedJobUpdate,
  buildQueuedJob,
  buildRunningJobUpdate,
  shouldPollGenerationJob,
} from "../progress/core";
import { describeGenerationOutcome, isTerminalGenerationJob } from "../progress/client";
import { isProgressStorageUnavailableError } from "../progress/server";
import type { GenerationJobRow } from "../progress/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function makeJob(overrides: Partial<GenerationJobRow> = {}): GenerationJobRow {
  return {
    ...buildQueuedJob({
      jobId: "00000000-0000-0000-0000-000000000001",
      clientId: "gads-demo",
      jobType: "monthly_sop",
      metadata: { source: "test" },
      now: "2026-04-13T10:00:00.000Z",
    }),
    ...overrides,
  };
}

console.log("\n=== Generation Progress Tests ===\n");

test("progress job creation starts queued with init metadata", () => {
  const job = makeJob();
  assert.equal(job.status, "queued");
  assert.equal(job.current_phase, "init");
  assert.equal(job.total_steps, 17);
  assert.equal(job.progress_pct, 0);
});

test("phase updates advance in order", () => {
  const job = makeJob();
  const fetchUpdate = buildRunningJobUpdate({
    current: job,
    phaseKey: "fetch_data",
    message: "Data ophalen...",
    now: "2026-04-13T10:01:00.000Z",
  });
  assert(fetchUpdate);
  assert.equal(fetchUpdate.status, "running");
  assert.equal(fetchUpdate.current_phase, "fetch_data");
  assert.equal(fetchUpdate.progress_pct, 6);

  const stepUpdate = buildRunningJobUpdate({
    current: { ...job, ...fetchUpdate },
    phaseKey: "run_step_1",
    message: "Stap 1",
    now: "2026-04-13T10:02:00.000Z",
  });
  assert(stepUpdate);
  assert.equal(stepUpdate.current_phase, "run_step_1");
  assert.equal(stepUpdate.progress_pct, 19);
});

test("invalid backward phase regression is blocked by default", () => {
  const current = makeJob({ current_phase: "run_step_3", status: "running" });
  const update = buildRunningJobUpdate({
    current,
    phaseKey: "fetch_data",
    message: "Backwards",
  });
  assert.equal(update, null);
});

test("completion state reaches 100 percent and terminal status", () => {
  const current = makeJob({ current_phase: "save_outputs", status: "running", progress_pct: 94 });
  const completed = buildCompletedJobUpdate({
    current,
    message: "Klaar",
    metadata: { artifact_ready: true },
    now: "2026-04-13T10:03:00.000Z",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.current_phase, "done");
  assert.equal(completed.progress_pct, 100);
  assert.equal(completed.completed_at, "2026-04-13T10:03:00.000Z");
});

test("failure state preserves current phase and error", () => {
  const current = makeJob({ current_phase: "render_pdf", status: "running", partial_output_exists: true });
  const failed = buildFailedJobUpdate({
    current,
    errorMessage: "PDF render fout",
    now: "2026-04-13T10:04:00.000Z",
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.current_phase, "render_pdf");
  assert.equal(failed.error_message, "PDF render fout");
  assert.equal(failed.partial_output_exists, true);
});

test("polling logic stops on terminal jobs and keeps running jobs alive", () => {
  assert.equal(shouldPollGenerationJob("queued"), true);
  assert.equal(shouldPollGenerationJob("running"), true);
  assert.equal(shouldPollGenerationJob("completed"), false);
  assert.equal(isTerminalGenerationJob({ status: "completed" } as never), true);
  assert.equal(isTerminalGenerationJob({ status: "running" } as never), false);
});

test("client-facing outcome text handles running completed and failed jobs", () => {
  assert.equal(
    describeGenerationOutcome({ status: "running", message: "Analyse uitvoeren...", error_message: null, partial_output_exists: false }),
    "Analyse uitvoeren..."
  );
  assert.equal(
    describeGenerationOutcome({ status: "completed", message: "Rapport gereed.", error_message: null, partial_output_exists: false }),
    "Rapport gereed."
  );
  assert.equal(
    describeGenerationOutcome({ status: "failed", message: null, error_message: "PDF mislukt", partial_output_exists: true }),
    "PDF mislukt Partiële output aanwezig."
  );
});

test("missing-table errors are classified as tracker-unavailable", () => {
  assert.equal(isProgressStorageUnavailableError({ code: "PGRST205", message: "Could not find the table 'public.generation_jobs' in the schema cache" }), true);
  assert.equal(isProgressStorageUnavailableError({ code: "42P01", message: "relation \"generation_jobs\" does not exist" }), true);
  assert.equal(isProgressStorageUnavailableError({ code: "23505", message: "duplicate key value violates unique constraint" }), false);
});

console.log("\n=== Results: 8 passed, 0 failed ===\n");
