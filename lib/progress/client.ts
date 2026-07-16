import { shouldPollGenerationJob } from "./core";
import type { GenerationJobSnapshot } from "./types";

export function isTerminalGenerationJob(job: Pick<GenerationJobSnapshot, "status"> | null | undefined): boolean {
  return !shouldPollGenerationJob(job?.status);
}

export function describeGenerationOutcome(job: Pick<GenerationJobSnapshot, "status" | "message" | "error_message" | "partial_output_exists"> | null | undefined): string {
  if (!job) return "Nog geen voortgang beschikbaar.";
  if (job.status === "completed") return job.message || "Gereed";
  if (job.status === "failed") {
    return job.partial_output_exists
      ? `${job.error_message || "Generatie mislukt"} Partiële output aanwezig.`
      : (job.error_message || "Generatie mislukt.");
  }
  return job.message || "Bezig...";
}
