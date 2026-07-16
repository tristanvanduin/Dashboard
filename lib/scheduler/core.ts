// W1.3 (O3, 5b en 5c): de pure scheduler- en pump-beslislogica. IO-vrij en los getest;
// de cron-routes (/api/cron/scheduler, /api/cron/pump) en de runNextSteps-pump (volgende
// ronde) consumeren dit. De constanten volgen de uitgevoerde preflight.

// Duurmeting uit 756 echte stap-fases (generation_job_events): mediaan 11s, p90 44s.
// Budget 240s per invocatie (maxDuration 300 minus 60 marge): 5 stappen op p90 past ruim.
export const PUMP_BATCH_SIZE = 5;

// Een run die langer dan dit op running staat zonder voortgang is stale en mag opnieuw
// geclaimd worden (dekt ook de gemeten uitschieter van 1165s in een enkele stap).
export const STALE_RUNNING_MINUTES = 15;

// Retry: een failed run met attempts 0 gaat na minimaal deze wachttijd terug naar pending.
export const RETRY_DELAY_MINUTES = 30;

export interface AnalysisSchedule {
  enabled?: boolean;
  day_of_month?: number;
  channels?: string[];
}

// Is deze klant vandaag aan de beurt? day_of_month clampt naar de laatste dag van korte
// maanden (31 in april betekent 30 april; 31 in februari betekent 28 of 29).
export function isDueToday(schedule: AnalysisSchedule | null | undefined, now: Date): boolean {
  if (!schedule?.enabled) return false;
  const wanted = Math.max(1, Math.min(31, schedule.day_of_month ?? 2));
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() === Math.min(wanted, lastDayOfMonth);
}

// Datacompleetheid: daily-data aanwezig tot en met de laatste dag van de vorige maand
// (periodEnd). lastDailyDate is de hoogste date in de daily-tabel van het kanaal.
export function dataCompleteForMonth(lastDailyDate: string | null, periodEnd: string): boolean {
  if (!lastDailyDate) return false;
  return lastDailyDate >= periodEnd;
}

export type RunStatus = "scheduled" | "pending" | "running" | "completed" | "failed" | "blocked" | string;

// De retry-beslissing van de scheduler-cron over een failed run.
export function retryDecision(
  status: RunStatus,
  attempts: number,
  failedAt: Date | null,
  now: Date
): "requeue" | "final" | "none" {
  if (status !== "failed") return "none";
  if (attempts >= 1) return "final";
  if (!failedAt) return "requeue";
  const minuten = (now.getTime() - failedAt.getTime()) / 60_000;
  return minuten >= RETRY_DELAY_MINUTES ? "requeue" : "none";
}

// Stale-detectie voor de pump-claim: running zonder voortgang sinds updatedAt.
export function isStaleRunning(status: RunStatus, updatedAt: Date | null, now: Date): boolean {
  if (status !== "running" || !updatedAt) return false;
  return now.getTime() - updatedAt.getTime() >= STALE_RUNNING_MINUTES * 60_000;
}

// Idempotente stap-overslag: de eerste stap zonder opgeslagen sectie is de volgende;
// null betekent dat alle stappen al persistent staan (de run kan afronden).
export function nextStepToRun(totalSteps: number, savedStepNumbers: ReadonlySet<number>): number | null {
  for (let step = 1; step <= totalSteps; step += 1) {
    if (!savedStepNumbers.has(step)) return step;
  }
  return null;
}
