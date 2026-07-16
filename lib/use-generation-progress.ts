"use client";

import { useEffect, useState } from "react";
import { isTerminalGenerationJob } from "@/lib/progress/client";
import type { GenerationJobLookupResponse, GenerationJobSnapshot } from "@/lib/progress/types";

interface UseGenerationProgressOptions {
  pollMs?: number;
}

export function useGenerationProgress(
  jobId: string | null,
  options: UseGenerationProgressOptions = {}
) {
  const pollMs = options.pollMs ?? 1200;
  const [job, setJob] = useState<GenerationJobSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [trackerUnavailable, setTrackerUnavailable] = useState(false);
  const [trackerMessage, setTrackerMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setLoading(false);
      setTrackerUnavailable(false);
      setTrackerMessage(null);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let missingAttempts = 0;

    async function poll() {
      if (!active) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/generation-jobs/${jobId}`, { cache: "no-store" });
        const body = await res.json().catch(() => null) as GenerationJobLookupResponse | null;

        if (!res.ok && res.status !== 202) {
          throw new Error(body?.error || "Voortgang laden mislukt");
        }

        if (!body) {
          throw new Error("Voortgang laden mislukt");
        }

        if (!body.trackerAvailable) {
          if (!active) return;
          setTrackerUnavailable(true);
          setTrackerMessage(body.error || "Live voortgang niet beschikbaar.");
          if (body.snapshot) setJob(body.snapshot);
          return;
        }

        if (!body.found || !body.snapshot) {
          missingAttempts += 1;
          if (missingAttempts >= 8) {
            setTrackerUnavailable(true);
            setTrackerMessage("Voortgang kon niet worden gestart. Generatie loopt mogelijk wel door.");
            return;
          }
          if (active) timer = setTimeout(poll, pollMs);
          return;
        }

        const data = body.snapshot as GenerationJobSnapshot;
        if (!active) return;
        missingAttempts = 0;
        setTrackerUnavailable(false);
        setTrackerMessage(null);
        setJob(data);

        if (!isTerminalGenerationJob(data)) {
          timer = setTimeout(poll, pollMs);
        }
      } catch {
        missingAttempts += 1;
        if (missingAttempts >= 6) {
          setTrackerUnavailable(true);
          setTrackerMessage("Voortgang laden mislukt. Generatie loopt mogelijk nog door.");
        } else if (active) {
          timer = setTimeout(poll, pollMs * 2);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, pollMs]);

  return { job, loading, trackerUnavailable, trackerMessage };
}
