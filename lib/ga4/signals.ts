// GA4 deterministische detectoren → het gedeelde signaal-frame (DetectionResult/SignalStory).
// MVP: de WEBSITE-side tracking break. Dit spiegelt lib/signals/tracking-gap.ts, maar aan de
// GA4-kant: liepen de sessies de laatste dagen gewoon door terwijl de key events (form_submit,
// generate_lead …) naar ~0 vielen, ná een basislijn die materieel converteerde? Dat wijst op een
// kapotte website-tag/GA4-config — iets wat de advertentieplatformdata niet ziet (paid clicks
// blijven immers stabiel). Hoge precisie: alleen alarm bij een verrassende nul. Puur, los getest.

import type { DetectionResult, SignalStory, SignalEvidence } from "@/lib/signals/types";
import type { Ga4DailyRow } from "./types";

export const GA4_TG_RECENT_DAYS = 4;
export const GA4_TG_BASELINE_DAYS = 28;
export const GA4_TG_MIN_BASELINE_KEY_EVENTS = 12; // de site moet normaal materieel converteren
export const GA4_TG_MIN_BASELINE_SESSIONS = 400;
export const GA4_TG_EXPECTED_MIN = 5;             // recent verwachte key events moeten ver boven 0 liggen
export const GA4_TG_NEAR_ZERO = 0.5;

const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });
const round1 = (v: number): string => `${Math.round(v * 10) / 10}`;

// Detecteert de tracking break over het WEBSITE-totaal (alle kanalen samen): de betrouwbaarste
// signaalvorm, want een enkele campagne kan legitiem stilvallen — de hele site niet.
export function buildGa4TrackingSignals(rows: Ga4DailyRow[], opts: { idPrefix?: string } = {}): DetectionResult {
  const idPrefix = opts.idPrefix ?? "ga4";
  const id = `${idPrefix}_tracking_gap`;
  const now = Date.now();
  const ageOf = (date: string): number => (now - Date.parse(date)) / 86_400_000;

  let recSessions = 0, recKey = 0, baseSessions = 0, baseKey = 0;
  for (const r of rows) {
    const age = ageOf(r.date);
    if (!Number.isFinite(age) || age < 0) continue;
    if (age < GA4_TG_RECENT_DAYS) { recSessions += r.sessions; recKey += r.keyEvents; }
    else if (age < GA4_TG_RECENT_DAYS + GA4_TG_BASELINE_DAYS) { baseSessions += r.sessions; baseKey += r.keyEvents; }
  }

  // Alleen oordelen als de site normaal materieel converteert.
  if (baseKey < GA4_TG_MIN_BASELINE_KEY_EVENTS || baseSessions < GA4_TG_MIN_BASELINE_SESSIONS) {
    return { triggered: [], checked: [id] };
  }
  const baseRate = baseKey / baseSessions;
  const expected = baseRate * recSessions;

  if (recKey <= GA4_TG_NEAR_ZERO && expected >= GA4_TG_EXPECTED_MIN) {
    const story: SignalStory = {
      id,
      category: "conversie_meting",
      scope: "GA4-website (alle kanalen)",
      story: `In GA4 liepen de laatste ${GA4_TG_RECENT_DAYS} dagen ${Math.round(recSessions)} sessies binnen maar ~0 key events, terwijl de vorige ${GA4_TG_BASELINE_DAYS} dagen (~${round1(baseRate * 100)}% key-event-ratio) ongeveer ${Math.round(expected)} key events deden verwachten: dit wijst op een kapotte website-tag/GA4-meting, niet op vraaguitval.`,
      actionDirection: `controleer per direct de GA4-tag/gtag/GTM en de key-event-configuratie (recente site-deploy?) vóór je op conversiecijfers stuurt; een GA4-gat vervuilt elke funnel- en CRO-conclusie`,
      certainty: "indicatie",
      evidence: [
        ev("sessies recent", String(Math.round(recSessions))),
        ev("key events recent", String(Math.round(recKey))),
        ev("verwacht o.b.v. basislijn", String(Math.round(expected))),
        ev("basislijn key-event-ratio", `${round1(baseRate * 100)}%`),
      ],
    };
    return { triggered: [story], checked: [id] };
  }
  return { triggered: [], checked: [id] };
}
