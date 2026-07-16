// R1-comparison-laag voor RAI. Drie dingen die de kalender-vergelijking niet geeft:
// 1. Editie-over-editie die de ECHTE vorige editie pakt, of die nu 1 of 2 jaar terug ligt
//    (niet elke beurs is jaarlijks), per beurs en geo-clone.
// 2. Week-over-week tempo binnen het campagnevenster, fijner dan maand-op-maand.
// 3. Een geo-clone-filter, want aftakkingen van een beurs zitten in hetzelfde account en
//    moeten schoon te scheiden zijn.
// Bouwt op de tijdas-kern (event-time-axis.ts). IO-vrij en los getest.

import {
  daysToFair,
  isWithinWindow,
  alignEditionsAtEqualDaysOut,
  type Edition,
  type DailyPoint,
  type EditionComparison,
} from "./event-time-axis";

export type FairCadence = "annual" | "biennial" | "custom";

// Een editie hangt aan een beurs EN een geo-clone: dezelfde beurs kan in meerdere geografieen
// draaien (aftakkingen), elk met een eigen tijdlijn, in hetzelfde account.
export interface RaiEdition extends Edition {
  fairId: string;
  geoClone: string;
  cadence: FairCadence;
}

export type Stream = "registraties" | "exposanten" | "onbekend";

export interface RaiDataPoint extends DailyPoint {
  geoClone: string;
  stream: Stream;
  editionId: string;
}

// De filter: scope de datapunten tot een geo-clone, stream en/of editie. Ongetagde of andere
// punten vallen weg. Dit is de schone scheiding van aftakkingen in hetzelfde account.
export function selectPoints(
  points: RaiDataPoint[],
  filter: { geoClone?: string; stream?: Stream; editionId?: string }
): RaiDataPoint[] {
  return points.filter((p) => {
    if (filter.geoClone != null && p.geoClone !== filter.geoClone) return false;
    if (filter.stream != null && p.stream !== filter.stream) return false;
    if (filter.editionId != null && p.editionId !== filter.editionId) return false;
    return true;
  });
}

// Alle geo-clones die in de data voorkomen, voor de filter-opties in de UI.
export function availableGeoClones(points: RaiDataPoint[]): string[] {
  return [...new Set(points.map((p) => p.geoClone))].sort();
}

// De verwachte gap in dagen voor een cadans, voor de sanity-check op de editie-resolutie.
function expectedGapDays(cadence: FairCadence): number | null {
  if (cadence === "annual") return 365;
  if (cadence === "biennial") return 730;
  return null; // custom: geen verwachting
}

export interface PreviousEditionResult {
  edition: RaiEdition | null;
  gapDays: number | null;
  cadenceMatches: boolean; // valt de gap redelijk bij de opgegeven cadans?
}

// Resolveert de vorige editie van DEZELFDE beurs en geo-clone: de editie met de grootste
// beursdatum die voor de huidige valt. Cadans-agnostisch in de resolutie zelf, dus een
// tweejaarlijkse beurs pakt vanzelf de editie van twee jaar terug. De cadans dient alleen
// voor een sanity-label (valt de gap bij wat je verwacht?).
export function previousEditionFor(editions: RaiEdition[], currentEditionId: string): PreviousEditionResult {
  const current = editions.find((e) => e.editionId === currentEditionId);
  if (!current) return { edition: null, gapDays: null, cadenceMatches: false };

  const currentStart = daysToFair(current.fairStartDate, current.fairStartDate); // 0, alleen om de parse te valideren
  if (currentStart == null) return { edition: null, gapDays: null, cadenceMatches: false };

  const priorSameFair = editions
    .filter((e) => e.fairId === current.fairId && e.geoClone === current.geoClone && e.editionId !== current.editionId)
    .filter((e) => {
      const gap = daysToFair(current.fairStartDate, e.fairStartDate); // positief als e voor current ligt
      return gap != null && gap > 0;
    })
    .sort((a, b) => {
      const ga = daysToFair(current.fairStartDate, a.fairStartDate) ?? Number.MAX_SAFE_INTEGER;
      const gb = daysToFair(current.fairStartDate, b.fairStartDate) ?? Number.MAX_SAFE_INTEGER;
      return ga - gb; // kleinste positieve gap eerst = de meest recente vorige editie
    });

  const prev = priorSameFair[0] ?? null;
  if (!prev) return { edition: null, gapDays: null, cadenceMatches: false };

  const gapDays = daysToFair(current.fairStartDate, prev.fairStartDate);
  const expected = expectedGapDays(current.cadence);
  // Redelijk als binnen 90 dagen van de verwachte gap (beursdata schuiven per jaar wat op).
  const cadenceMatches = expected == null || (gapDays != null && Math.abs(gapDays - expected) <= 90);

  return { edition: prev, gapDays, cadenceMatches };
}

export interface WeekTempo {
  weeksToFair: number;
  increment: number;
}

export interface WeekOverWeekResult {
  weeks: WeekTempo[]; // alle complete weken, meest recent (dicht bij de beurs) eerst
  recentWeek: WeekTempo | null;
  priorWeek: WeekTempo | null;
  wowDeltaPct: number | null;
}

// Week-over-week tempo binnen het venster, in weken-tot-beurs. De huidige, nog lopende week
// wordt uitgesloten zodat je twee complete weken vergelijkt. Fijner dan maand-op-maand en
// event-relatief in plaats van kalender.
export function weekOverWeekTempo(points: RaiDataPoint[], edition: Edition, asOfDate: string): WeekOverWeekResult {
  const todayDtf = daysToFair(edition.fairStartDate, asOfDate);
  const todayWeek = todayDtf == null ? null : Math.floor(todayDtf / 7);

  const byWeek = new Map<number, number>();
  for (const p of points) {
    if (!isWithinWindow(p.date, edition)) continue;
    const dtf = daysToFair(edition.fairStartDate, p.date);
    if (dtf == null || dtf < 0) continue; // alleen tot en met de beurs
    const w = Math.floor(dtf / 7);
    byWeek.set(w, (byWeek.get(w) ?? 0) + p.value);
  }

  const allWeeks = [...byWeek.entries()]
    .map(([weeksToFair, increment]) => ({ weeksToFair, increment }))
    .sort((a, b) => a.weeksToFair - b.weeksToFair); // laag = dicht bij de beurs = recent

  // Complete weken: verder-uit dan de huidige, nog lopende week.
  const completeWeeks = todayWeek == null ? allWeeks : allWeeks.filter((w) => w.weeksToFair > todayWeek);

  const recentWeek = completeWeeks[0] ?? null;
  const priorWeek = completeWeeks[1] ?? null;
  const wowDeltaPct =
    recentWeek && priorWeek && priorWeek.increment > 0
      ? Math.round(((recentWeek.increment - priorWeek.increment) / priorWeek.increment) * 1000) / 1000
      : null;

  return { weeks: completeWeeks, recentWeek, priorWeek, wowDeltaPct };
}

export interface EventComparison {
  geoClone: string;
  stream: Stream;
  editionOverEdition: EditionComparison;
  previousEditionGapDays: number | null;
  cadenceMatches: boolean;
  weekOverWeek: WeekOverWeekResult;
}

// Bindt alles samen voor een geo-clone en stream: filter de data, resolveer de echte vorige
// editie (cadans-bewust), en lever de editie-over-editie plus de week-over-week. Dit is de
// event-relatieve vervanging van MoM en YoY, per aftakking.
export function buildEventComparison(input: {
  allPoints: RaiDataPoint[];
  editions: RaiEdition[];
  currentEditionId: string;
  geoClone: string;
  stream: Stream;
  asOfDate: string;
}): EventComparison {
  const current = input.editions.find((e) => e.editionId === input.currentEditionId);
  const prev = previousEditionFor(input.editions, input.currentEditionId);

  const currentPoints = selectPoints(input.allPoints, { geoClone: input.geoClone, stream: input.stream, editionId: input.currentEditionId });
  const previousPoints = prev.edition
    ? selectPoints(input.allPoints, { geoClone: input.geoClone, stream: input.stream, editionId: prev.edition.editionId })
    : [];

  const editionOverEdition: EditionComparison = current
    ? alignEditionsAtEqualDaysOut(
        { edition: current, points: currentPoints },
        prev.edition ? { edition: prev.edition, points: previousPoints } : null,
        input.asOfDate
      )
    : { comparable: false, reason: "eerste_editie", daysToFairNow: null, currentCumulative: 0, previousCumulativeAtSameDaysOut: null, deltaPct: null };

  const weekOverWeek = current
    ? weekOverWeekTempo(currentPoints, current, input.asOfDate)
    : { weeks: [], recentWeek: null, priorWeek: null, wowDeltaPct: null };

  return {
    geoClone: input.geoClone,
    stream: input.stream,
    editionOverEdition,
    previousEditionGapDays: prev.gapDays,
    cadenceMatches: prev.cadenceMatches,
    weekOverWeek,
  };
}
