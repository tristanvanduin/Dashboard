// =====================================================================
// STATUS: GEBOUWD EN GETEST, MAAR NOG NIET GEWIRED (bewuste keuze, zie hieronder).
// =====================================================================
// De beslis-kern voor hypotheses: de statusmachine.
//
// EERLIJKE CONTEXT: het accepteren en afwijzen BESTAAT al, in
// app/api/insights/monthly-hypotheses (POST met action accept of reject), met een gewirede
// UI in components/insights/hypotheses-block.tsx. Die route zet status en accepted_at.
// Deze kern is dus geen vervanging en er komt bewust GEEN tweede endpoint naast: twee
// schrijfpaden naar dezelfde statuskolom is precies de divergentie die SI6 wegnam.
//
// WAT DEZE KERN TOEVOEGT en wat de bestaande route mist:
// (1) Overgangsvalidatie. De route schrijft de nieuwe status zonder de huidige te lezen,
//     dus een al afgewezen hypothese kan alsnog op accepted gezet worden en accepted_at
//     wordt dan opnieuw geschreven. Dat verschuift het meetvenster van de evaluator.
// (2) Eindtoestanden: rejected en completed horen dicht te zijn.
// (3) isActionable als gedeelde guard, die SI5 (briefing pas na goedkeuring) nodig heeft.
//
// De volgende stap is deze kern in de bestaande route hangen, niet ernaast. Dat raakt een
// route met bestaande tests (lib/__tests__/monthly-hypotheses-insights.test.ts), dus het
// hoort een eigen beurt met een eigen verificatie te zijn.
//
// De kern is IO-vrij: hij bepaalt of een overgang mag en levert de patch. De schrijflaag
// blijft dun en de regels blijven los testbaar.

export type HypothesisStatus = "pending" | "accepted" | "rejected" | "completed";

export const HYPOTHESIS_STATUSES: HypothesisStatus[] = ["pending", "accepted", "rejected", "completed"];

// De toegestane overgangen. Een voorstel wordt aangenomen of afgewezen; een aangenomen
// hypothese kan alsnog worden afgewezen (voortschrijdend inzicht) of afgerond. Afgewezen
// en afgerond zijn eindtoestanden: wie zich bedenkt maakt een nieuwe hypothese, zodat de
// geschiedenis eerlijk blijft.
const ALLOWED: Record<HypothesisStatus, HypothesisStatus[]> = {
  pending: ["accepted", "rejected"],
  accepted: ["completed", "rejected"],
  rejected: [],
  completed: [],
};

export interface HypothesisPatch {
  status: HypothesisStatus;
  accepted_at?: string; // uitsluitend gezet op de overgang naar accepted
  // BEWUST NIET rationale: die kolom draagt de onderbouwing van het VOORSTEL (waarom stelde
  // de analyse dit voor). Die overschrijven met een beslissings-reden zou de geschiedenis
  // vernietigen. Migratie 021 voegt daarom een eigen beslislaag toe.
  decision_reason?: string;
  decided_at: string;
  decided_by?: string;
}

export type TransitionResult =
  | { ok: true; patch: HypothesisPatch; idempotent: boolean }
  | { ok: false; reason: string };

export function isHypothesisStatus(value: unknown): value is HypothesisStatus {
  return typeof value === "string" && (HYPOTHESIS_STATUSES as string[]).includes(value);
}

export function decideTransition(input: {
  current: { status: string | null; accepted_at: string | null };
  next: HypothesisStatus;
  reason?: string | null;
  by?: string | null;
  now: string; // ISO, door de route aangeleverd zodat de kern deterministisch blijft
}): TransitionResult {
  const current = (input.current.status ?? "pending") as HypothesisStatus;
  if (!isHypothesisStatus(current)) {
    return { ok: false, reason: `de huidige status "${input.current.status}" is onbekend; handmatig herstel nodig` };
  }
  // Dezelfde status opnieuw zetten is GEEN fout maar een idempotente herhaling: de
  // bestaande route herpusht bij een tweede accept bewust de gekoppelde sprint-taken
  // (planHypothesisSprintSync is daarop gebouwd). Wat hier wel gebeurt: accepted_at wordt
  // NIET opnieuw gezet, want dat zou het meetvenster van de evaluator verschuiven.
  if (current === input.next) {
    const patch: HypothesisPatch = { status: input.next, decided_at: input.now };
    if (input.reason && input.reason.trim().length > 0) patch.decision_reason = input.reason.trim();
    if (input.by && input.by.trim().length > 0) patch.decided_by = input.by.trim();
    return { ok: true, patch, idempotent: true };
  }
  if (!ALLOWED[current].includes(input.next)) {
    const opties = ALLOWED[current];
    return {
      ok: false,
      reason: opties.length === 0
        ? `${current} is een eindtoestand; maak een nieuwe hypothese in plaats van deze te heropenen`
        : `van ${current} kan alleen naar ${opties.join(" of ")}, niet naar ${input.next}`,
    };
  }

  // Een afwijzing zonder reden is geen beslissing maar een klik: de volgende lezer moet
  // kunnen zien waarom iets is afgevallen.
  if (input.next === "rejected" && !(input.reason && input.reason.trim().length > 0)) {
    return { ok: false, reason: "een afwijzing vereist een reden" };
  }

  const patch: HypothesisPatch = { status: input.next, decided_at: input.now };
  if (input.next === "accepted") {
    // Het startpunt van het meetvenster. Wordt UITSLUITEND gezet bij de overgang NAAR
    // accepted, dus nooit bij een idempotente herhaling: de evaluator meet vanaf dit
    // moment, en verschuiven zou de meting corrumperen.
    patch.accepted_at = input.now;
  }
  if (input.reason && input.reason.trim().length > 0) {
    patch.decision_reason = input.reason.trim();
  }
  if (input.by && input.by.trim().length > 0) {
    patch.decided_by = input.by.trim();
  }
  return { ok: true, patch, idempotent: false };
}

// De guard voor SI5 en voor elke andere consument die op een genomen beslissing wil leunen.
export function isActionable(status: string | null): boolean {
  return status === "accepted";
}
