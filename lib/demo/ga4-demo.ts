// GA4-demodata voor demo-greentech: een gesynthetiseerde dagreeks die het vlaggenschip-signaal
// van de MVP laat zien — een WEBSITE-side tracking break. De laatste dagen lopen de sessies
// gewoon door (verkeer komt binnen) maar de key events (form_submit e.d.) vallen weg, terwijl de
// basislijn ervoor materieel converteerde. Dit is precies het scenario dat de advertentie-
// platformdata NIET ziet: paid clicks blijven stabiel, maar GA4 key events verdwijnen.
//
// Bewust één geïsoleerde plek (zoals lib/feed/owners-mock.ts). Verschijnt alleen voor de demo-
// klant; buiten demo geeft data-access "absent" en draait alles zonder GA4.

import type { Ga4Config, Ga4DailyRow, Ga4Dataset, Ga4Channel, Ga4Device } from "@/lib/ga4/types";

export const GA4_DEMO_CONFIG: Ga4Config = {
  propertyId: "properties/demo-greentech",
  keyEvents: ["form_submit", "generate_lead"],
  funnelSteps: ["session_start", "view_item", "form_start", "form_submit"],
};

// Deterministische pseudo-random zodat de demo stabiel is (geen Math.random flakiness in tests).
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

const CHANNELS: { channel: Ga4Channel; sessions: number; rate: number }[] = [
  { channel: "google", sessions: 220, rate: 0.055 },   // paid search: het leeuwendeel
  { channel: "meta", sessions: 90, rate: 0.018 },       // converteert op de site ver onder gemiddeld (CRO-kloof)
  { channel: "linkedin", sessions: 40, rate: 0.045 },
  { channel: "other", sessions: 160, rate: 0.02 },      // organisch/direct
];

// Device-verdeling met een bewuste mobiele CRO-penalty: mobiel is het grootste deel van het
// verkeer maar converteert de helft van desktop (mobiele landingpage/formulier blijft achter).
const DEVICES: { device: Ga4Device; frac: number; mult: number }[] = [
  { device: "desktop", frac: 0.55, mult: 1.3 },
  { device: "mobile", frac: 0.40, mult: 0.5 },
  { device: "tablet", frac: 0.05, mult: 1.0 },
];

// Landingpage-verdeling met een bewuste CRO-penalty op één pagina: /aanmelden vangt de helft van
// het paid verkeer maar converteert ver onder de andere pagina (boodschap/formulier lekt). De
// mult is frac-gewogen mean-1, dus de landingpage-split VERSCHUIFT alleen de conversie tússen de
// pagina's — de kanaal- en device-sommen blijven exact gelijk.
const PAGES: { path: string; frac: number; mult: number }[] = [
  { path: "/aanmelden", frac: 0.5, mult: 0.6 },    // lekt: converteert onder de paid-site
  { path: "/oplossingen", frac: 0.5, mult: 1.4 },  // sterke pagina compenseert
];

// Verdeelt een integer-totaal over gewichten met restverdeling (largest-remainder), zodat de som
// van de delen EXACT gelijk blijft aan het totaal. Zo behoudt de landingpage-split elke kanaal-,
// device- en site-som en blijven de bestaande detectoren (kanaal-kloof, device-kloof, tracking)
// ongewijzigd; alleen de verdeling tússen de pagina's verandert.
function splitInt(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((x) => Math.floor(x));
  let rem = total - out.reduce((s, v) => s + v, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rem; k++) out[order[k % order.length].i] += 1;
  return out;
}

// Bouwt ~35 dagen × kanaal × device × landingpage: een gezonde basislijn en de laatste 4 dagen met
// key events op ~0 (de break). De device-split draagt de mobiele CRO-kloof en de landingpage-split
// de pagina-kloof; alle kanaal-/device-sommen blijven exact kloppen (splitInt).
export function buildGa4DemoRows(now: Date = new Date()): Ga4DailyRow[] {
  const rnd = seeded(20260721);
  const rows: Ga4DailyRow[] = [];
  const TOTAL_DAYS = 35;
  const BREAK_DAYS = 4; // laatste 4 dagen: tracking kapot
  for (let i = TOTAL_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const broken = i < BREAK_DAYS;
    for (const c of CHANNELS) {
      for (const dv of DEVICES) {
        const jitter = 0.85 + rnd() * 0.3;
        const sessions = Math.round(c.sessions * dv.frac * jitter);
        if (sessions <= 0) continue;
        const engaged = Math.round(sessions * (0.55 + rnd() * 0.1));
        const keyEvents = broken ? 0 : Math.round(sessions * c.rate * dv.mult);
        // Funnel: bovenkant blijft doorlopen, alleen de laatste stap (form_submit) valt weg.
        const viewItem = Math.round(sessions * 0.7 * jitter);
        const formStart = Math.round(sessions * (0.12 + rnd() * 0.03));
        const formSubmit = broken ? 0 : Math.round(formStart * (0.45 + rnd() * 0.1) * dv.mult);

        // Splits de (kanaal × device × dag)-rij over de landingpagina's. Sessie-achtige tellingen
        // splitsen op frac; conversie-achtige (key events, form_submit) op frac × mult, zodat
        // /aanmelden materieel minder converteert. splitInt houdt elke som exact gelijk.
        const sessBy = splitInt(sessions, PAGES.map((p) => p.frac));
        const engBy = splitInt(engaged, PAGES.map((p) => p.frac));
        const viewBy = splitInt(viewItem, PAGES.map((p) => p.frac));
        const startBy = splitInt(formStart, PAGES.map((p) => p.frac));
        const keyBy = splitInt(keyEvents, PAGES.map((p) => p.frac * p.mult));
        const submitBy = splitInt(formSubmit, PAGES.map((p) => p.frac * p.mult));

        PAGES.forEach((pg, pi) => {
          if (sessBy[pi] <= 0) return;
          rows.push({
            date,
            channel: c.channel,
            device: dv.device,
            landingPage: pg.path,
            sessions: sessBy[pi],
            engagedSessions: engBy[pi],
            keyEvents: keyBy[pi],
            funnel: { session_start: sessBy[pi], view_item: viewBy[pi], form_start: startBy[pi], form_submit: submitBy[pi] },
          });
        });
      }
    }
  }
  return rows;
}

export function buildGa4DemoDataset(now: Date = new Date()): Ga4Dataset {
  return {
    availability: "mock",
    config: GA4_DEMO_CONFIG,
    rows: buildGa4DemoRows(now),
    limitations: ["Demo-GA4-data (mock): gesynthetiseerd voor review, geen live property."],
  };
}
