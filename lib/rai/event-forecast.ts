// R1 forecast per stream, strikt event-relatief. De kern: een event bouwt niet lineair op maar
// versnelt naar de beursdatum, dus een kalender-run-rate onderschat de eindstand. De eerlijke
// projectie gebruikt de vorige editie op GELIJKE dagen-uit als sjabloon: de groei die de vorige
// editie van D-x naar de beurs maakte, toegepast op waar deze editie nu op D-x staat. Alles
// ankert op dagen-tot-beurs (x). Nooit voorbij de beursdatum. Bouwt op event-time-axis.ts.

import {
  daysToFair,
  windowLengthDays,
  cumulativeThroughDaysOut,
  type Edition,
  type DailyPoint,
} from "./event-time-axis";
import { MATERIAL_WINDOW_DIFF } from "./event-time-axis";

export type ForecastMethod = "vorige_editie_sjabloon" | "tempo_extrapolatie" | "beurs_bereikt" | "geen_basis";
export type ForecastConfidence = "hoog" | "gemiddeld" | "laag" | "geen_basis";

export interface StreamForecast {
  method: ForecastMethod;
  daysToFairNow: number | null;
  currentCumulative: number;
  projectedFinal: number | null;
  target: number | null;
  projectedVsTargetPct: number | null;
  willHitTarget: boolean | null;
  confidence: ForecastConfidence;
  note: string;
}

// Binnen dit deel van het venster (dicht bij de beurs) is de sjabloon-projectie het meest
// betrouwbaar, want er rest weinig curve om te extrapoleren.
const HIGH_CONFIDENCE_WINDOW_FRAC = 0.3;

function round(v: number): number {
  return Math.round(v);
}

function withTarget(projectedFinal: number | null, target: number | null, base: Omit<StreamForecast, "projectedFinal" | "projectedVsTargetPct" | "willHitTarget" | "target">): StreamForecast {
  const projectedVsTargetPct =
    projectedFinal != null && target != null && target > 0
      ? Math.round((projectedFinal / target) * 1000) / 1000
      : null;
  return {
    ...base,
    projectedFinal,
    target,
    projectedVsTargetPct,
    willHitTarget: projectedVsTargetPct == null ? null : projectedVsTargetPct >= 1,
  };
}

// De forecast voor een stream. current en previous zijn al gefilterd op geo-clone en stream.
// previous mag null zijn (eerste editie).
export function forecastStream(input: {
  current: { edition: Edition; points: DailyPoint[] };
  previous: { edition: Edition; points: DailyPoint[] } | null;
  target: number | null;
  asOfDate: string;
}): StreamForecast {
  const { current, previous, target, asOfDate } = input;
  const x = daysToFair(current.edition.fairStartDate, asOfDate);

  if (x == null) {
    return withTarget(null, target, { method: "geen_basis", daysToFairNow: null, currentCumulative: 0, confidence: "geen_basis", note: "geen geldige beurs- of peildatum" });
  }

  // Cumulatief tot nu. Voorbij de beurs (x <= 0) is de eindstand bekend.
  const clampX = Math.max(x, 0);
  const currentCumulative = cumulativeThroughDaysOut(current.points, current.edition, clampX);

  if (x <= 0) {
    return withTarget(currentCumulative, target, { method: "beurs_bereikt", daysToFairNow: x, currentCumulative, confidence: "hoog", note: "de beurs is bereikt, dit is de eindstand" });
  }

  const curWindow = windowLengthDays(current.edition);

  // Sjabloon-pad: vergelijkbaar venster en de vorige editie had op D-x al opbouw.
  if (previous) {
    const prevWindow = windowLengthDays(previous.edition);
    const windowComparable =
      curWindow != null && prevWindow != null && prevWindow > 0 && Math.abs(curWindow - prevWindow) / prevWindow <= MATERIAL_WINDOW_DIFF;

    const prevAtX = cumulativeThroughDaysOut(previous.points, previous.edition, x);
    const prevFinal = cumulativeThroughDaysOut(previous.points, previous.edition, 0);

    if (windowComparable && prevAtX > 0 && prevFinal > 0) {
      const ratio = prevFinal / prevAtX; // groei van D-x naar de beurs bij de vorige editie
      const projectedFinal = round(currentCumulative * ratio);
      // Vertrouwen: hoger naarmate we dichter bij de beurs zijn (minder curve te extrapoleren).
      const fracLeft = curWindow && curWindow > 0 ? x / curWindow : 1;
      const confidence: ForecastConfidence = fracLeft <= HIGH_CONFIDENCE_WINDOW_FRAC ? "hoog" : "gemiddeld";
      return withTarget(projectedFinal, target, {
        method: "vorige_editie_sjabloon",
        daysToFairNow: x,
        currentCumulative,
        confidence,
        note: `geprojecteerd met de curve van editie ${previous.edition.editionId} op gelijke dagen-uit`,
      });
    }
  }

  // Terugval: tempo-extrapolatie. Lineair vanaf de campagnestart naar de beurs. Expliciet
  // onzeker, want een event versnelt naar het einde en lineair onderschat dat.
  const daysElapsed = curWindow != null ? curWindow - x : null;
  if (daysElapsed == null || daysElapsed <= 0 || currentCumulative <= 0) {
    return withTarget(null, target, { method: "geen_basis", daysToFairNow: x, currentCumulative, confidence: "geen_basis", note: "te weinig verstreken venster om te projecteren" });
  }
  const pace = currentCumulative / daysElapsed;
  const projectedFinal = round(pace * (curWindow as number));
  const reason = previous ? "geen vergelijkbaar vorige-editie-venster" : "eerste editie, geen sjabloon";
  return withTarget(projectedFinal, target, {
    method: "tempo_extrapolatie",
    daysToFairNow: x,
    currentCumulative,
    confidence: "laag",
    note: `${reason}; lineaire extrapolatie onderschat waarschijnlijk de eindpiek`,
  });
}
