// R1: de pure event-tijdas-kern voor RAI. RAI adverteert per beurs, dus kalender-MoM en YoY
// vergelijken ongelijke momenten en zijn fout. Alles rekent in dagen-tot-beurs, binnen het
// venster campagnestart-tot-beurseinde, en editie-over-editie op GELIJKE dagen-uit. IO-vrij
// en los getest; de streams, targets, forecast, status en UI rusten op deze kern.

const DAY_MS = 86400000;

function parseDate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t;
}

export interface Edition {
  editionId: string;
  campaignStartDate: string; // ISO, begin van het advertentievenster
  fairStartDate: string; // ISO, eerste beursdag (het ijkpunt van de tijdas)
  fairEndDate: string; // ISO, laatste beursdag
}

export interface DailyPoint {
  date: string; // ISO
  value: number; // bijv. registraties of exposanten op die dag
}

// Dagen tot de beurs: positief voor de beurs, 0 op de eerste beursdag, negatief erna.
export function daysToFair(fairStartDate: string, date: string): number | null {
  const f = parseDate(fairStartDate);
  const d = parseDate(date);
  if (f == null || d == null) return null;
  return Math.round((f - d) / DAY_MS);
}

// Valt de datum binnen het analysevenster: campagnestart tot en met beurseinde.
export function isWithinWindow(date: string, edition: Edition): boolean {
  const d = parseDate(date);
  const start = parseDate(edition.campaignStartDate);
  const end = parseDate(edition.fairEndDate);
  if (d == null || start == null || end == null) return false;
  return d >= start && d <= end;
}

// De vensterlengte in dagen: van campagnestart tot de eerste beursdag. Dit is het aantal
// dagen-uit waarop de campagne draait en de basis voor de vergelijkbaarheid van edities.
export function windowLengthDays(edition: Edition): number | null {
  return daysToFair(edition.fairStartDate, edition.campaignStartDate);
}

// Cumulatieve waarde tot en met dagen-uit x: de som van alle in-venster punten die x of meer
// dagen voor de beurs vallen. Zo krijg je "waar stond deze editie op D-x".
export function cumulativeThroughDaysOut(points: DailyPoint[], edition: Edition, x: number): number {
  let sum = 0;
  for (const p of points) {
    if (!isWithinWindow(p.date, edition)) continue;
    const dtf = daysToFair(edition.fairStartDate, p.date);
    if (dtf == null) continue;
    if (dtf >= x) sum += p.value;
  }
  return sum;
}

export interface CurvePoint {
  daysToFair: number;
  cumulative: number;
}

// De volledige cumulatieve curve per dagen-uit (aflopend van ver-voor-de-beurs naar de
// beurs), alleen over in-venster punten. Basis voor de forecast-sjabloon en de grafiek.
export function cumulativeCurve(points: DailyPoint[], edition: Edition): CurvePoint[] {
  const inWindow = points
    .filter((p) => isWithinWindow(p.date, edition))
    .map((p) => ({ dtf: daysToFair(edition.fairStartDate, p.date), value: p.value }))
    .filter((p): p is { dtf: number; value: number } => p.dtf != null)
    .sort((a, b) => b.dtf - a.dtf); // van hoog (vroeg) naar laag (dicht bij de beurs)

  const curve: CurvePoint[] = [];
  let running = 0;
  for (const p of inWindow) {
    running += p.value;
    curve.push({ daysToFair: p.dtf, cumulative: running });
  }
  return curve;
}

// Het deel dat een materieel ander campagnevenster markeert: als de vensterlengtes van de
// twee edities meer dan deze fractie verschillen, is een vergelijking niet eerlijk.
export const MATERIAL_WINDOW_DIFF = 0.2;

export type ComparabilityReason = "eerste_editie" | "geen_vorige_data" | "materieel_ander_venster";

export interface EditionComparison {
  comparable: boolean;
  reason?: ComparabilityReason;
  daysToFairNow: number | null; // het huidige dagen-uit-punt
  currentCumulative: number;
  previousCumulativeAtSameDaysOut: number | null;
  deltaPct: number | null; // (huidig - vorig) / vorig
}

// Editie-over-editie op gelijke dagen-uit, cumulatief tot het huidige dagen-uit-punt. Dit is
// de eerlijke vergelijking die kalender-YoY niet geeft. Markeert expliciet wanneer het niet
// kan: geen vorige editie, geen vorige data, of een materieel ander campagnevenster. Nooit
// een stille vergelijking over ongelijke vensters.
export function alignEditionsAtEqualDaysOut(
  current: { edition: Edition; points: DailyPoint[] },
  previous: { edition: Edition; points: DailyPoint[] } | null,
  asOfDate: string
): EditionComparison {
  const x = daysToFair(current.edition.fairStartDate, asOfDate);
  const currentCumulative = x == null ? 0 : cumulativeThroughDaysOut(current.points, current.edition, x);

  if (!previous) {
    return { comparable: false, reason: "eerste_editie", daysToFairNow: x, currentCumulative, previousCumulativeAtSameDaysOut: null, deltaPct: null };
  }
  if (previous.points.filter((p) => isWithinWindow(p.date, previous.edition)).length === 0) {
    return { comparable: false, reason: "geen_vorige_data", daysToFairNow: x, currentCumulative, previousCumulativeAtSameDaysOut: null, deltaPct: null };
  }

  const curWindow = windowLengthDays(current.edition);
  const prevWindow = windowLengthDays(previous.edition);
  if (curWindow != null && prevWindow != null && prevWindow > 0) {
    const diff = Math.abs(curWindow - prevWindow) / prevWindow;
    if (diff > MATERIAL_WINDOW_DIFF) {
      return { comparable: false, reason: "materieel_ander_venster", daysToFairNow: x, currentCumulative, previousCumulativeAtSameDaysOut: null, deltaPct: null };
    }
  }

  const previousCumulative = x == null ? 0 : cumulativeThroughDaysOut(previous.points, previous.edition, x);
  const deltaPct = previousCumulative > 0 ? Math.round(((currentCumulative - previousCumulative) / previousCumulative) * 1000) / 1000 : null;

  return { comparable: true, daysToFairNow: x, currentCumulative, previousCumulativeAtSameDaysOut: previousCumulative, deltaPct };
}
