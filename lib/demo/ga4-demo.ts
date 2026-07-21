// GA4-demodata voor demo-greentech: een gesynthetiseerde dagreeks die het vlaggenschip-signaal
// van de MVP laat zien — een WEBSITE-side tracking break. De laatste dagen lopen de sessies
// gewoon door (verkeer komt binnen) maar de key events (form_submit e.d.) vallen weg, terwijl de
// basislijn ervoor materieel converteerde. Dit is precies het scenario dat de advertentie-
// platformdata NIET ziet: paid clicks blijven stabiel, maar GA4 key events verdwijnen.
//
// Bewust één geïsoleerde plek (zoals lib/feed/owners-mock.ts). Verschijnt alleen voor de demo-
// klant; buiten demo geeft data-access "absent" en draait alles zonder GA4.

import type { Ga4Config, Ga4DailyRow, Ga4Dataset, Ga4Channel } from "@/lib/ga4/types";

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
  { channel: "meta", sessions: 90, rate: 0.03 },
  { channel: "linkedin", sessions: 40, rate: 0.045 },
  { channel: "other", sessions: 160, rate: 0.02 },      // organisch/direct
];

// Bouwt ~35 dagen: een gezonde basislijn en de laatste 4 dagen met key events op ~0 (de break).
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
      const jitter = 0.85 + rnd() * 0.3;
      const sessions = Math.round(c.sessions * jitter);
      const engaged = Math.round(sessions * (0.55 + rnd() * 0.1));
      const baseKey = sessions * c.rate;
      const keyEvents = broken ? 0 : Math.round(baseKey);
      // Funnel: bovenkant blijft doorlopen, alleen de laatste stap (form_submit) valt weg.
      const sessionStart = sessions;
      const viewItem = Math.round(sessions * 0.7 * jitter);
      const formStart = Math.round(sessions * (0.12 + rnd() * 0.03));
      const formSubmit = broken ? 0 : Math.round(formStart * (0.45 + rnd() * 0.1));
      rows.push({
        date,
        channel: c.channel,
        sessions,
        engagedSessions: engaged,
        keyEvents,
        funnel: { session_start: sessionStart, view_item: viewItem, form_start: formStart, form_submit: formSubmit },
      });
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
