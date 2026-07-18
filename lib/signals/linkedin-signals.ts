// LinkedIn signaal-detectors (conversie + creative + pacing). Levert de losse "signaalverhalen"
// bovenop de LinkedIn-analyse, spiegelt het Google/Meta-signaal-frame in lib/signals/types.ts
// en meet UITSLUITEND op de eigen LinkedIn-metrieken. LinkedIn is B2B/leadgen: geen frequentie
// of hook-rate, maar wel lead-forms, CPL, CTR en video-completion.
//
// Vier detectors:
//   - lead-form drop-off: veel form-opens maar lage completion-rate (verspilde lead-intentie).
//   - CPL-druk: CPL stijgt materieel t.o.v. vorige periode of overschrijdt het target.
//   - betrokkenheid-zwakte: CTR ver onder de accountmediaan (relatief, geen verzonnen norm).
//   - video-drop-off: video-completion-rate ver onder de accountmediaan.

import { type DetectionResult, type SignalStory } from "./types";

export const FORM_COMPLETION_WEAK = 0.15; // onder 15% completion op geopende forms is zwak (heuristiek)
export const MIN_FORM_OPENS = 20;         // onder dit aantal opens is de rate ruis
export const CPL_RISE = 0.15;             // 15% CPL-stijging is materieel
export const MIN_IMPRESSIONS = 1000;
export const MIN_CLICKS = 20;
export const BENCH_FRAC = 0.6;            // onder 60% van de accountmediaan = zwak
export const MAX_STORIES = 3;

export interface LinkedInEntitySignalInput {
  entityUrn: string;
  name: string;                    // campagnenaam
  impressions: number;
  clicks: number;
  ctr: number | null;              // fractie
  cpl: number | null;
  formOpens: number | null;        // one_click_lead_form_opens
  formCompletionRate: number | null;
  videoCompletionRate: number | null;
  prevCtr?: number | null;
  prevCpl?: number | null;
}

export interface LinkedInSignalTargets {
  cplTarget?: number | null;
}

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// ── 1. Lead-form drop-off ───────────────────────────────────────────────────────────
export function detectLinkedInFormDropOff(entities: LinkedInEntitySignalInput[]): DetectionResult {
  const checked = ["linkedin_form_dropoff"];
  const triggered: SignalStory[] = entities
    .filter((e) => (e.formOpens ?? 0) >= MIN_FORM_OPENS && e.formCompletionRate != null && e.formCompletionRate < FORM_COMPLETION_WEAK)
    .sort((a, b) => (a.formCompletionRate ?? 1) - (b.formCompletionRate ?? 1))
    .slice(0, MAX_STORIES)
    .map((e) => ({
      id: "linkedin_form_dropoff",
      category: "conversie_meting" as const,
      scope: e.name,
      story:
        `Bij "${e.name}" openen mensen het lead-formulier (${e.formOpens} keer), maar slechts ${Math.round((e.formCompletionRate ?? 0) * 100)}% maakt het af. ` +
        `De intentie is er; de wrijving zit in het formulier zelf.`,
      actionDirection: "verkort het formulier of gebruik pre-fill; elke extra veld kost afmakers, juist op LinkedIn",
      certainty: "bewezen_binnen_platform" as const,
      evidence: [
        { metric: "form-opens", value: e.formOpens ?? 0 },
        { metric: "completion-rate", value: e.formCompletionRate ?? 0 },
      ],
    }));
  return { triggered, checked };
}

// ── 2. CPL-druk ─────────────────────────────────────────────────────────────────────
export function detectLinkedInCplPressure(entities: LinkedInEntitySignalInput[], targets?: LinkedInSignalTargets): DetectionResult {
  const checked = ["linkedin_cpl_pressure"];
  const cplTarget = Number(targets?.cplTarget ?? 0);
  const scored = entities
    .filter((e) => e.cpl != null && e.cpl > 0 && e.impressions >= MIN_IMPRESSIONS)
    .map((e) => {
      const rise = e.prevCpl != null && e.prevCpl > 0 ? (e.cpl! - e.prevCpl) / e.prevCpl : null;
      const overTarget = cplTarget > 0 ? e.cpl! > cplTarget : false;
      return { e, rise, overTarget };
    })
    .filter((s) => (s.rise != null && s.rise >= CPL_RISE) || s.overTarget)
    .sort((x, y) => (y.rise ?? 0) - (x.rise ?? 0))
    .slice(0, MAX_STORIES);

  const triggered: SignalStory[] = scored.map(({ e, rise, overTarget }) => ({
    id: "linkedin_cpl_pressure",
    category: "budget_pacing" as const,
    scope: e.name,
    story:
      `De cost-per-lead van "${e.name}" is €${(e.cpl ?? 0).toFixed(2)}` +
      (rise != null && rise >= CPL_RISE ? `, ${Math.round(rise * 100)}% hoger dan de vorige periode` : "") +
      (overTarget ? `, boven het CPL-target van €${cplTarget.toFixed(2)}` : "") +
      `. De leads worden duurder ingekocht.`,
    actionDirection: overTarget
      ? "toets targeting en bod: een te brede of te dure doelgroep drijft de CPL; scherp de ICP aan"
      : "kijk of de stijging door meer concurrentie of een zwakkere creative komt voordat je het bod aanpast",
    certainty: overTarget ? "bewezen_binnen_platform" as const : "indicatie" as const,
    evidence: [
      { metric: "CPL", value: Math.round((e.cpl ?? 0) * 100) / 100, prev: e.prevCpl ?? null },
      { metric: "CPL-target", value: cplTarget > 0 ? cplTarget : "geen" },
    ],
  }));
  return { triggered, checked };
}

// ── 3. Betrokkenheid-zwakte (CTR relatief aan de accountmediaan) ────────────────────
export function detectLinkedInEngagementWeakness(entities: LinkedInEntitySignalInput[]): DetectionResult {
  const checked = ["linkedin_engagement_weakness"];
  const eligible = entities.filter((e) => e.impressions >= MIN_IMPRESSIONS && e.clicks >= MIN_CLICKS && e.ctr != null);
  const medCtr = median(eligible.map((e) => e.ctr!).filter((v): v is number => v != null));
  if (medCtr == null || medCtr <= 0) return { triggered: [], checked };

  const triggered: SignalStory[] = eligible
    .filter((e) => e.ctr! < medCtr * BENCH_FRAC)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_STORIES)
    .map((e) => ({
      id: "linkedin_engagement_weakness",
      category: "creative" as const,
      scope: e.name,
      story:
        `De CTR van "${e.name}" (${((e.ctr ?? 0) * 100).toFixed(2)}%) ligt ver onder de accountmediaan (${(medCtr * 100).toFixed(2)}%). ` +
        `De boodschap resoneert niet met deze doelgroep.`,
      actionDirection: "herzie de hook en het aanbod; op LinkedIn werkt een scherpe, functie-specifieke boodschap beter dan een generieke",
      certainty: "bewezen_binnen_platform" as const,
      evidence: [
        { metric: "CTR", value: Math.round((e.ctr ?? 0) * 10000) / 100 },
        { metric: "accountmediaan CTR", value: Math.round(medCtr * 10000) / 100 },
      ],
    }));
  return { triggered, checked };
}

// ── 4. Video-drop-off (completion relatief aan de accountmediaan) ───────────────────
export function detectLinkedInVideoDropOff(entities: LinkedInEntitySignalInput[]): DetectionResult {
  const checked = ["linkedin_video_dropoff"];
  const eligible = entities.filter((e) => e.impressions >= MIN_IMPRESSIONS && e.videoCompletionRate != null);
  const medVc = median(eligible.map((e) => e.videoCompletionRate!).filter((v): v is number => v != null));
  if (medVc == null || medVc <= 0) return { triggered: [], checked };

  const triggered: SignalStory[] = eligible
    .filter((e) => e.videoCompletionRate! < medVc * BENCH_FRAC)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_STORIES)
    .map((e) => ({
      id: "linkedin_video_dropoff",
      category: "creative" as const,
      scope: e.name,
      story:
        `De video van "${e.name}" wordt door weinig kijkers afgemaakt (completion-rate ${((e.videoCompletionRate ?? 0) * 100).toFixed(0)}%, ver onder de accountmediaan). ` +
        `De kern van de boodschap bereikt bijna niemand.`,
      actionDirection: "kort de video in of zet de kernboodschap vooraan; op LinkedIn kijkt men zelden een lange video uit",
      certainty: "bewezen_binnen_platform" as const,
      evidence: [
        { metric: "video-completion", value: Math.round((e.videoCompletionRate ?? 0) * 100) / 100 },
        { metric: "accountmediaan", value: Math.round(medVc * 100) / 100 },
      ],
    }));
  return { triggered, checked };
}

// ── Aggregator ──────────────────────────────────────────────────────────────────────
export function buildLinkedInSignals(input: { entities: LinkedInEntitySignalInput[]; targets?: LinkedInSignalTargets }): DetectionResult {
  const results = [
    detectLinkedInFormDropOff(input.entities),
    detectLinkedInCplPressure(input.entities, input.targets),
    detectLinkedInEngagementWeakness(input.entities),
    detectLinkedInVideoDropOff(input.entities),
  ];
  return {
    triggered: results.flatMap((r) => r.triggered),
    checked: [...new Set(results.flatMap((r) => r.checked))],
  };
}
