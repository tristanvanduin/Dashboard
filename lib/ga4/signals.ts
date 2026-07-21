// GA4 deterministische detectoren → het gedeelde signaal-frame (DetectionResult/SignalStory).
// MVP: de WEBSITE-side tracking break. Dit spiegelt lib/signals/tracking-gap.ts, maar aan de
// GA4-kant: liepen de sessies de laatste dagen gewoon door terwijl de key events (form_submit,
// generate_lead …) naar ~0 vielen, ná een basislijn die materieel converteerde? Dat wijst op een
// kapotte website-tag/GA4-config — iets wat de advertentieplatformdata niet ziet (paid clicks
// blijven immers stabiel). Hoge precisie: alleen alarm bij een verrassende nul. Puur, los getest.

import type { DetectionResult, SignalStory, SignalEvidence } from "@/lib/signals/types";
import type { Ga4DailyRow, Ga4Device } from "./types";

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

// ── CRO-signaal: kanaal-conversie-kloof ─────────────────────────────────────
// Welk PAID-kanaal stuurt verkeer dat op de site materieel slechter converteert dan het site-
// gemiddelde? Dat is een CRO-vraag (landingpage-fit per kanaal), niet een mediavraag — precies
// wat de advertentieplatformdata niet ziet. Over één venster (geen prior nodig): key-event-ratio
// per kanaal vs de blended site-ratio. "other" (organisch/direct) telt mee in het site-totaal
// maar wordt zelf niet beoordeeld (geen paid landing-keuze). certainty "indicatie".

export const GA4_CRO_WINDOW_DAYS = 28;
export const GA4_CRO_MIN_CHANNEL_SESSIONS = 300;
export const GA4_CRO_MIN_SITE_KEY_EVENTS = 12;
export const GA4_CRO_GAP_RATIO = 0.7; // kanaalratio ≤ 70% van de site-ratio = materieel slechter

const CRO_CHANNEL_LABEL: Record<string, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn" };

export function buildGa4CroSignals(rows: Ga4DailyRow[], opts: { idPrefix?: string } = {}): DetectionResult {
  const idPrefix = opts.idPrefix ?? "ga4";
  const id = `${idPrefix}_cro_channel_gap`;
  const now = Date.now();
  const ageOf = (date: string): number => (now - Date.parse(date)) / 86_400_000;

  let siteSessions = 0, siteKey = 0;
  const byChannel = new Map<string, { sessions: number; key: number }>();
  for (const r of rows) {
    const age = ageOf(r.date);
    if (!Number.isFinite(age) || age < 0 || age >= GA4_CRO_WINDOW_DAYS) continue;
    siteSessions += r.sessions; siteKey += r.keyEvents;
    const a = byChannel.get(r.channel) ?? { sessions: 0, key: 0 };
    a.sessions += r.sessions; a.key += r.keyEvents;
    byChannel.set(r.channel, a);
  }

  // Alleen oordelen als de site normaal materieel converteert.
  if (siteSessions <= 0 || siteKey < GA4_CRO_MIN_SITE_KEY_EVENTS) return { triggered: [], checked: [id] };
  const siteRate = siteKey / siteSessions;

  const triggered: SignalStory[] = [];
  // Deterministische volgorde (grootste kloof eerst) zodat de output stabiel is.
  const paid = [...byChannel.entries()].filter(([ch]) => ch === "google" || ch === "meta" || ch === "linkedin");
  const scored = paid
    .filter(([, a]) => a.sessions >= GA4_CRO_MIN_CHANNEL_SESSIONS)
    .map(([ch, a]) => ({ ch, a, rate: a.sessions > 0 ? a.key / a.sessions : 0 }))
    .filter((x) => x.rate <= siteRate * GA4_CRO_GAP_RATIO)
    .sort((x, y) => x.rate - y.rate);

  for (const { ch, a, rate } of scored) {
    const gapPct = Math.round((1 - rate / siteRate) * 100);
    triggered.push({
      id: `${idPrefix}_cro_gap_${ch}`,
      category: "cross_channel",
      scope: `${CRO_CHANNEL_LABEL[ch] ?? ch}-verkeer (GA4-website)`,
      story: `${CRO_CHANNEL_LABEL[ch] ?? ch}-verkeer converteert op de site met ${round1(rate * 100)}% key-event-ratio, ${gapPct}% onder het site-gemiddelde (${round1(siteRate * 100)}%): het kanaal stuurt verkeer dat op de landingspagina slechter presteert dan gemiddeld.`,
      actionDirection: `beoordeel de landingpage-fit voor ${CRO_CHANNEL_LABEL[ch] ?? ch} (boodschap-match, formulier, mobiel/desktop): dit is een CRO-kwestie op de site, niet per se een mediakwestie`,
      certainty: "indicatie",
      evidence: [
        ev(`${ch} sessies (${GA4_CRO_WINDOW_DAYS}d)`, String(Math.round(a.sessions))),
        ev(`${ch} key events`, String(Math.round(a.key))),
        ev(`${ch} key-event-ratio`, `${round1(rate * 100)}%`),
        ev("site-gemiddelde", `${round1(siteRate * 100)}%`),
      ],
    });
  }

  return { triggered, checked: [id] };
}

// ── CRO-signaal: device-kloof (mobile vs desktop) ───────────────────────────
// Converteert PAID mobiel verkeer op de site materieel slechter dan desktop? Klassieke CRO-vraag
// (mobiele landingpage/formulier/snelheid) die de advertentieplatformdata niet als zodanig ziet.
// Site-breed over de paid-kanalen samen, over één venster. certainty "indicatie".

export const GA4_DEV_WINDOW_DAYS = 28;
export const GA4_DEV_MIN_SESSIONS = 300;      // per device-zijde
export const GA4_DEV_MIN_DESKTOP_KEY_EVENTS = 12;
export const GA4_DEV_GAP_RATIO = 0.7;         // mobiel ≤ 70% van desktop = materieel slechter

const PAID_CHANNELS = new Set(["google", "meta", "linkedin"]);

export function buildGa4DeviceCroSignals(rows: Ga4DailyRow[], opts: { idPrefix?: string } = {}): DetectionResult {
  const idPrefix = opts.idPrefix ?? "ga4";
  const id = `${idPrefix}_cro_device_gap`;
  const now = Date.now();
  const ageOf = (date: string): number => (now - Date.parse(date)) / 86_400_000;

  const byDevice = new Map<Ga4Device, { sessions: number; key: number }>();
  for (const r of rows) {
    if (!r.device || !PAID_CHANNELS.has(r.channel)) continue; // alleen paid, alleen met device
    const age = ageOf(r.date);
    if (!Number.isFinite(age) || age < 0 || age >= GA4_DEV_WINDOW_DAYS) continue;
    const a = byDevice.get(r.device) ?? { sessions: 0, key: 0 };
    a.sessions += r.sessions; a.key += r.keyEvents;
    byDevice.set(r.device, a);
  }

  const mobile = byDevice.get("mobile");
  const desktop = byDevice.get("desktop");
  if (!mobile || !desktop) return { triggered: [], checked: [id] };
  // Beide zijden moeten materieel volume hebben en desktop moet normaal converteren.
  if (mobile.sessions < GA4_DEV_MIN_SESSIONS || desktop.sessions < GA4_DEV_MIN_SESSIONS || desktop.key < GA4_DEV_MIN_DESKTOP_KEY_EVENTS) {
    return { triggered: [], checked: [id] };
  }
  const mobileRate = mobile.key / mobile.sessions;
  const desktopRate = desktop.key / desktop.sessions;
  if (desktopRate <= 0 || mobileRate > desktopRate * GA4_DEV_GAP_RATIO) return { triggered: [], checked: [id] };

  const gapPct = Math.round((1 - mobileRate / desktopRate) * 100);
  const story: SignalStory = {
    id: `${idPrefix}_cro_device_mobile`,
    category: "cross_channel",
    scope: "Paid mobiel verkeer (GA4-website)",
    story: `Paid mobiel verkeer converteert op de site met ${round1(mobileRate * 100)}% key-event-ratio, ${gapPct}% onder desktop (${round1(desktopRate * 100)}%): het mobiele scherm blijft materieel achter.`,
    actionDirection: `beoordeel de mobiele landingpage-ervaring (snelheid, formulierlengte, tap-targets, sticky CTA) — dit is een CRO-kwestie op de site, niet per se een mediakwestie`,
    certainty: "indicatie",
    evidence: [
      ev(`mobiel sessies (${GA4_DEV_WINDOW_DAYS}d)`, String(Math.round(mobile.sessions))),
      ev("mobiel key-event-ratio", `${round1(mobileRate * 100)}%`),
      ev("desktop key-event-ratio", `${round1(desktopRate * 100)}%`),
      ev("kloof", `${gapPct}%`),
    ],
  };
  return { triggered: [story], checked: [id] };
}

// ── CRO-signaal: landingpage-kloof ──────────────────────────────────────────
// Welke LANDINGSPAGINA vangt paid verkeer op dat op de site materieel slechter converteert dan de
// paid-site als geheel? Dat is de scherpst-actioneerbare CRO-vraag (boodschap-match, formulier,
// snelheid op díe pagina) en precies wat de advertentieplatformdata niet ziet — de mediakant kan
// gezond zijn terwijl de pagina zelf lekt. Over één venster, alleen paid, alleen rijen mét
// landingPage; de paid-site-ratio is de benchmark. certainty "indicatie".

export const GA4_LP_WINDOW_DAYS = 28;
export const GA4_LP_MIN_PAGE_SESSIONS = 300;      // per landingspagina
export const GA4_LP_MIN_SITE_KEY_EVENTS = 12;     // de paid-site moet normaal materieel converteren
export const GA4_LP_GAP_RATIO = 0.7;              // pagina ≤ 70% van de paid-site-ratio = materieel slechter

// Stabiel, leesbaar id-fragment uit een pad: alleen [a-z0-9], rest → "_". Zo blijft het verhaal-id
// deterministisch over runs (geen hash-flakiness) en herkenbaar in de wachtrij.
function slugifyPath(path: string): string {
  const s = path.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s.length > 0 ? s : "page";
}

export function buildGa4LandingPageCroSignals(rows: Ga4DailyRow[], opts: { idPrefix?: string } = {}): DetectionResult {
  const idPrefix = opts.idPrefix ?? "ga4";
  const id = `${idPrefix}_cro_landingpage_gap`;
  const now = Date.now();
  const ageOf = (date: string): number => (now - Date.parse(date)) / 86_400_000;

  let siteSessions = 0, siteKey = 0;
  const byPage = new Map<string, { sessions: number; key: number }>();
  for (const r of rows) {
    if (!r.landingPage || !PAID_CHANNELS.has(r.channel)) continue; // alleen paid, alleen met landingpage
    const age = ageOf(r.date);
    if (!Number.isFinite(age) || age < 0 || age >= GA4_LP_WINDOW_DAYS) continue;
    siteSessions += r.sessions; siteKey += r.keyEvents;
    const a = byPage.get(r.landingPage) ?? { sessions: 0, key: 0 };
    a.sessions += r.sessions; a.key += r.keyEvents;
    byPage.set(r.landingPage, a);
  }

  // Alleen oordelen als de paid-site normaal materieel converteert én er iets te vergelijken valt
  // (minstens twee pagina's — met één pagina ís die pagina het site-gemiddelde).
  if (siteSessions <= 0 || siteKey < GA4_LP_MIN_SITE_KEY_EVENTS || byPage.size < 2) return { triggered: [], checked: [id] };
  const siteRate = siteKey / siteSessions;

  // Deterministische volgorde (grootste kloof eerst) zodat de output stabiel is.
  const scored = [...byPage.entries()]
    .filter(([, a]) => a.sessions >= GA4_LP_MIN_PAGE_SESSIONS)
    .map(([page, a]) => ({ page, a, rate: a.sessions > 0 ? a.key / a.sessions : 0 }))
    .filter((x) => x.rate <= siteRate * GA4_LP_GAP_RATIO)
    .sort((x, y) => x.rate - y.rate || x.page.localeCompare(y.page));

  const triggered: SignalStory[] = scored.map(({ page, a, rate }) => {
    const gapPct = Math.round((1 - rate / siteRate) * 100);
    return {
      id: `${idPrefix}_cro_lp_${slugifyPath(page)}`,
      category: "cross_channel",
      scope: `Landingspagina ${page} (paid, GA4-website)`,
      story: `De landingspagina ${page} vangt paid verkeer op dat met ${round1(rate * 100)}% key-event-ratio converteert, ${gapPct}% onder het paid-site-gemiddelde (${round1(siteRate * 100)}%): deze pagina lekt materieel meer dan de rest.`,
      actionDirection: `beoordeel de fit van ${page} (boodschap-match met de advertentie, formulier, laadsnelheid, mobiele weergave) — dit is een CRO-kwestie op de pagina zelf, niet per se een mediakwestie`,
      certainty: "indicatie",
      evidence: [
        ev(`sessies op de pagina (${GA4_LP_WINDOW_DAYS}d)`, String(Math.round(a.sessions))),
        ev("key events op de pagina", String(Math.round(a.key))),
        ev("key-event-ratio pagina", `${round1(rate * 100)}%`),
        ev("paid-site-gemiddelde", `${round1(siteRate * 100)}%`),
      ],
    };
  });

  return { triggered, checked: [id] };
}
