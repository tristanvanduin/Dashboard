// Run-rate-forecast voor jonge kanalen (Meta/LinkedIn): geen meerjarige historie, dus geen
// kalender-YoY zoals bij Google. In plaats daarvan: (1) de lopende maand projecteren op het
// tempo tot nu, en (2) de volgende volle maand schatten met een lichte lineaire trend over de
// recente volle maanden. Bewust conservatief en met expliciete onzekerheid — bij weinig
// historie is één punt valse precisie. Puur en los getest.

export interface MonthValue {
  month: string; // "YYYY-MM"
  value: number;
}

// Projecteer de eindstand van de lopende maand op basis van het tempo tot nu.
// projected = mtd / dagTotNu * dagenInMaand. Onder MIN_DAYS is de projectie te ruw: null.
export const MIN_DAYS_FOR_RUNRATE = 5;

export function projectCurrentMonth(mtd: number, dayOfMonth: number, daysInMonth: number): { projected: number | null; reliable: boolean } {
  if (dayOfMonth <= 0 || daysInMonth <= 0 || mtd < 0) return { projected: null, reliable: false };
  const projected = Math.round((mtd / dayOfMonth) * daysInMonth);
  return { projected, reliable: dayOfMonth >= MIN_DAYS_FOR_RUNRATE };
}

// Lichte lineaire trend (kleinste kwadraten) over de recente volle maanden, één stap vooruit.
// Geklemd op niet-negatief en binnen een band rond de laatste maand, zodat een korte reeks
// geen wilde extrapolatie geeft. Onder 2 maanden: de laatste maand (vlak).
export const TREND_BAND = 0.5; // max +/-50% t.o.v. de laatste maand

export function projectNextMonth(months: MonthValue[]): { projected: number | null; method: "trend" | "laatste" | "geen" } {
  const vals = months.map((m) => m.value).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return { projected: null, method: "geen" };
  const last = vals[vals.length - 1];
  if (vals.length < 3) return { projected: Math.round(last), method: "laatste" };

  // Kleinste-kwadraten-helling over index 0..n-1.
  const n = vals.length;
  const xMean = (n - 1) / 2;
  const yMean = vals.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (vals[i] - yMean); den += (i - xMean) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const raw = yMean + slope * (n - xMean); // projectie op index n (volgende maand)
  const lo = last * (1 - TREND_BAND);
  const hi = last * (1 + TREND_BAND);
  const clamped = Math.max(0, Math.min(hi, Math.max(lo, raw)));
  return { projected: Math.round(clamped), method: "trend" };
}

// Combineert beide voor een metriek: de lopende maand (run-rate) en de volgende volle maand.
export interface ChannelMetricForecast {
  currentMonthProjected: number | null;
  currentMonthReliable: boolean;
  nextMonthProjected: number | null;
  nextMonthMethod: "trend" | "laatste" | "geen";
  fullMonths: MonthValue[];
}

export function forecastChannelMetric(input: {
  fullMonths: MonthValue[]; // volle maanden, oplopend
  mtd: number;
  dayOfMonth: number;
  daysInMonth: number;
}): ChannelMetricForecast {
  const cur = projectCurrentMonth(input.mtd, input.dayOfMonth, input.daysInMonth);
  const nxt = projectNextMonth(input.fullMonths);
  return {
    currentMonthProjected: cur.projected,
    currentMonthReliable: cur.reliable,
    nextMonthProjected: nxt.projected,
    nextMonthMethod: nxt.method,
    fullMonths: input.fullMonths,
  };
}
