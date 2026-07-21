// Conversie-tracking-gap: converteert het account plots NIETS meer terwijl het verkeer gewoon
// doorloopt? Een totale nul in de recente dagen ná een gezonde basislijn wijst sterker op een
// kapotte tracking (pixel/tag/CAPI) dan op een echte vraaguitval. Bewust hoge-precisie: alleen
// alarm als de vorige 4 weken materieel converteerden ÉN de recent verwachte conversies ver
// boven nul liggen — zo blijft dunne lead-data (waar nul normaal is) buiten schot. Ratio's uit
// venstertotalen; een indicatie (verifieer de tracking), geen bewijs. Puur, los getest.

import { type DetectionResult, type SignalStory, type SignalEvidence } from "./types";

export interface TrackingGapRow { date: string; clicks: number; conversions: number }

export const TG_RECENT_DAYS = 7;
export const TG_BASELINE_DAYS = 28;
export const TG_MIN_BASELINE_CONVERSIONS = 12; // het account moet normaal materieel converteren
export const TG_MIN_BASELINE_CLICKS = 200;
export const TG_EXPECTED_MIN = 5;              // recent verwachte conversies moeten ver boven 0 liggen
export const TG_NEAR_ZERO = 0.5;               // "nul" met wat marge voor afronding

const eur = (v: number): string => `${Math.round(v * 100) / 100}`;
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

export function buildTrackingGapSignals(daily: TrackingGapRow[], opts: { channelLabel: string; idPrefix: string }): DetectionResult {
  const id = `${opts.idPrefix}_tracking_gap`;
  const now = Date.now();
  const ageOf = (date: string): number => (now - Date.parse(date)) / 86_400_000;

  let recClicks = 0, recConv = 0, baseClicks = 0, baseConv = 0;
  for (const r of daily) {
    const age = ageOf(r.date);
    if (!Number.isFinite(age) || age < 0) continue;
    if (age < TG_RECENT_DAYS) { recClicks += r.clicks; recConv += r.conversions; }
    else if (age < TG_RECENT_DAYS + TG_BASELINE_DAYS) { baseClicks += r.clicks; baseConv += r.conversions; }
  }

  // Alleen oordelen als het account normaal materieel converteert.
  if (baseConv < TG_MIN_BASELINE_CONVERSIONS || baseClicks < TG_MIN_BASELINE_CLICKS) return { triggered: [], checked: [id] };
  const baseRate = baseConv / baseClicks;
  const expected = baseRate * recClicks;

  // Alarm alleen bij een verrassende nul: recent (bijna) geen conversies terwijl er veel verwacht was.
  if (recConv <= TG_NEAR_ZERO && expected >= TG_EXPECTED_MIN) {
    return {
      triggered: [{
        id: `${opts.idPrefix}_tracking_gap`,
        category: "conversie_meting",
        scope: `${opts.channelLabel}-account`,
        story: `Op ${opts.channelLabel} liepen de laatste ${TG_RECENT_DAYS} dagen ${Math.round(recClicks)} klikken binnen maar ~0 conversies, terwijl de vorige ${TG_BASELINE_DAYS} dagen (~${eur(baseRate * 100)}% conversieratio) ongeveer ${Math.round(expected)} conversies deden verwachten: dit patroon wijst op een kapotte conversie-tracking.`,
        actionDirection: `controleer per direct de tracking (pixel/tag/CAPI, conversie-acties, recente site-wijziging) vóór je op de cijfers stuurt; een tracking-gat vervuilt elke CPA/ROAS en elke bijsturing`,
        certainty: "indicatie",
        evidence: [
          ev("klikken recent", String(Math.round(recClicks))),
          ev("conversies recent", String(Math.round(recConv))),
          ev("verwacht o.b.v. basislijn", String(Math.round(expected))),
          ev("basislijn-conversieratio", `${eur(baseRate * 100)}%`),
        ],
      }],
      checked: [id],
    };
  }
  return { triggered: [], checked: [id] };
}
