// R1 status en pacing per stream, event-relatief op D-x. Het stoplicht zegt de BMS in een
// oogopslag of een stream op target komt; de pacing of het budget in het juiste tempo naar de
// beursdatum wordt uitgegeven. Beide ankeren op dagen-tot-beurs. Bouwt op de forecast (voor de
// status) en de tijdas-kern (voor de pacing-curve).

import { daysToFair, windowLengthDays, type Edition } from "./event-time-axis";
import type { StreamForecast, ForecastConfidence } from "./event-forecast";

export type StreamStatus = "op_koers" | "aandacht" | "kritiek" | "onbekend";

// Onder dit deel van het target komt de stream in het rood; tussen dit en 1,0 is het oranje.
export const CRITICAL_THRESHOLD = 0.85;

export interface StreamStatusResult {
  status: StreamStatus;
  confidence: ForecastConfidence;
  projectedVsTargetPct: number | null;
  reason: string;
}

// Het stream-stoplicht uit de forecast tegen het target. Guard: een kritiek-oordeel dat op een
// lage-zekerheid tempo-extrapolatie berust wordt afgezwakt naar aandacht, want die methode
// onderschat de eindpiek en zou een vals alarm geven.
export function streamStatusFromForecast(forecast: StreamForecast): StreamStatusResult {
  const pct = forecast.projectedVsTargetPct;
  if (pct == null) {
    return { status: "onbekend", confidence: forecast.confidence, projectedVsTargetPct: null, reason: "geen forecast of target om tegen af te zetten" };
  }

  let status: StreamStatus = pct >= 1 ? "op_koers" : pct >= CRITICAL_THRESHOLD ? "aandacht" : "kritiek";
  let reason =
    status === "op_koers" ? "de verwachte eindstand haalt het target"
      : status === "aandacht" ? "de verwachte eindstand blijft iets onder target"
        : "de verwachte eindstand blijft ver onder target";

  if (status === "kritiek" && forecast.confidence === "laag") {
    status = "aandacht";
    reason = "verwachting onder target, maar de projectie is een onzekere tempo-extrapolatie die de eindpiek onderschat";
  }

  return { status, confidence: forecast.confidence, projectedVsTargetPct: pct, reason };
}

export type PacingStatus = "op_pace" | "onderbesteding" | "overbesteding" | "onbekend";

// Binnen deze band rond het geplande tempo geldt het als op pace.
export const PACING_BAND = 0.1;

export interface PacingResult {
  status: PacingStatus;
  plannedToDate: number | null;
  actualToDate: number;
  pacingRatio: number | null;
  reason: string;
}

// De budget-pacing per stream of kanaal: de werkelijke besteding tot nu tegen de geplande
// besteding tot nu. De geplande curve loopt lineair over het venster tot de beursdatum, dus op
// D-x hoort een evenredig deel van het totaal besteed te zijn. Ankert op dagen-tot-beurs.
export function budgetPacing(input: {
  edition: Edition;
  plannedTotalBudget: number | null;
  actualSpendToDate: number;
  asOfDate: string;
}): PacingResult {
  const { edition, plannedTotalBudget, actualSpendToDate, asOfDate } = input;
  const x = daysToFair(edition.fairStartDate, asOfDate);
  const windowLength = windowLengthDays(edition);

  if (x == null || windowLength == null || windowLength <= 0 || plannedTotalBudget == null || plannedTotalBudget <= 0) {
    return { status: "onbekend", plannedToDate: null, actualToDate: actualSpendToDate, pacingRatio: null, reason: "geen gepland budget of geldig venster" };
  }

  // Verstreken deel van het venster op D-x, geklemd tussen 0 en 1 (voorbij de beurs is alles).
  const elapsed = windowLength - Math.max(x, 0);
  const elapsedFraction = Math.min(Math.max(elapsed / windowLength, 0), 1);
  const plannedToDate = Math.round(plannedTotalBudget * elapsedFraction);

  if (plannedToDate <= 0) {
    return { status: "onbekend", plannedToDate, actualToDate: actualSpendToDate, pacingRatio: null, reason: "nog geen gepland budget verstreken" };
  }

  const pacingRatio = Math.round((actualSpendToDate / plannedToDate) * 1000) / 1000;
  let status: PacingStatus;
  let reason: string;
  if (pacingRatio > 1 + PACING_BAND) {
    status = "overbesteding";
    reason = "sneller dan gepland; het budget dreigt voor de beurs op te raken";
  } else if (pacingRatio < 1 - PACING_BAND) {
    status = "onderbesteding";
    reason = "trager dan gepland; er blijft budget liggen richting de beurs";
  } else {
    status = "op_pace";
    reason = "de besteding volgt de geplande curve naar de beursdatum";
  }

  return { status, plannedToDate, actualToDate: actualSpendToDate, pacingRatio, reason };
}
