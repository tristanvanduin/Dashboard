// Demo geo-dataset voor de kaart-laag (Laag 1): per-kanaal land-data én de VS-staten-drilldown.
// Waarom mock: alleen Google levert vandaag echte land-data (op landniveau); Meta/LinkedIn geo en
// staten-uitsplitsing zijn nog niet gesynct (Laag 2). Deze mock laat de kaart-UX op elk kanaal én
// bij "Alle kanalen" zien, met plausibele verschillen per kanaal, zodat de metric-selector iets te
// vertellen heeft. Puur presentatie — nooit vermengd met echte data; alleen actief in demo-modus.

export interface GeoAgg {
  code: string; // alpha-2 land óf USPS-staat
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

const AOV = 130;
// Bouwt een rij uit impressies + CTR + conversieratio + CPA, zodat de afgeleide metrics kloppen.
function row(code: string, impressions: number, ctr: number, convRate: number, cpa: number): GeoAgg {
  const clicks = Math.round(impressions * ctr);
  const conversions = Math.round(clicks * convRate);
  const cost = Math.round(conversions * cpa);
  return { code, impressions, clicks, cost, conversions, conversionsValue: Math.round(conversions * AOV) };
}

// Per kanaal een eigen geografisch profiel. Google = demand-capture (NL/US/CA, sterke conv). Meta =
// awareness (breed bereik, veel impressies, lagere conv-ratio). LinkedIn = B2B (smal, duur, kwaliteit).
type Channel = "google" | "meta" | "linkedin" | "blended";

const COUNTRY_BASE: Record<Exclude<Channel, "blended">, GeoAgg[]> = {
  google: [
    row("NL", 132500, 0.047, 0.037, 50),
    row("US", 94000, 0.044, 0.029, 74),
    row("CA", 46700, 0.038, 0.023, 96),
  ],
  meta: [
    row("NL", 410000, 0.021, 0.012, 62),
    row("US", 288000, 0.019, 0.009, 85),
    row("DE", 176000, 0.018, 0.010, 78),
    row("BE", 98000, 0.020, 0.011, 70),
    row("GB", 142000, 0.017, 0.008, 92),
  ],
  linkedin: [
    row("NL", 84000, 0.011, 0.021, 118),
    row("US", 61000, 0.010, 0.017, 156),
    row("DE", 39000, 0.009, 0.018, 142),
    row("GB", 47000, 0.009, 0.015, 168),
  ],
};

// VS-staten per kanaal. Google sterk in CA/TX/NY; Meta breder; LinkedIn geconcentreerd in de
// B2B-hubs (NY/CA/MA). Alleen de VS — dit voedt de drilldown-kaart onder de wereldkaart.
const STATE_BASE: Record<Exclude<Channel, "blended">, GeoAgg[]> = {
  google: [
    row("CA", 22800, 0.045, 0.031, 70),
    row("TX", 16400, 0.043, 0.028, 76),
    row("NY", 14900, 0.046, 0.030, 72),
    row("IL", 8600, 0.041, 0.026, 84),
    row("FL", 9800, 0.040, 0.024, 90),
    row("WA", 6100, 0.044, 0.029, 74),
    row("MA", 5400, 0.047, 0.032, 68),
  ],
  meta: [
    row("CA", 68000, 0.020, 0.010, 80),
    row("TX", 54000, 0.019, 0.009, 86),
    row("NY", 47000, 0.021, 0.011, 78),
    row("FL", 41000, 0.018, 0.008, 94),
    row("IL", 29000, 0.019, 0.009, 88),
    row("GA", 22000, 0.017, 0.008, 96),
    row("WA", 18000, 0.020, 0.010, 82),
  ],
  linkedin: [
    row("NY", 16800, 0.011, 0.019, 150),
    row("CA", 15200, 0.010, 0.018, 158),
    row("MA", 9400, 0.012, 0.022, 138),
    row("IL", 6100, 0.009, 0.016, 166),
    row("TX", 7300, 0.009, 0.015, 172),
    row("WA", 5200, 0.010, 0.017, 160),
  ],
};

// Blended = som over de kanalen per code (impressies/klikken/kosten/conversies opgeteld).
function blend(sets: GeoAgg[][]): GeoAgg[] {
  const m = new Map<string, GeoAgg>();
  for (const set of sets) {
    for (const r of set) {
      const a = m.get(r.code) ?? { code: r.code, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
      a.impressions += r.impressions; a.clicks += r.clicks; a.cost += r.cost;
      a.conversions += r.conversions; a.conversionsValue += r.conversionsValue;
      m.set(r.code, a);
    }
  }
  return [...m.values()];
}

export function demoGeoCountries(channel: Channel): GeoAgg[] {
  if (channel === "blended") return blend(Object.values(COUNTRY_BASE));
  return COUNTRY_BASE[channel];
}

export function demoGeoStates(channel: Channel): GeoAgg[] {
  if (channel === "blended") return blend(Object.values(STATE_BASE));
  return STATE_BASE[channel];
}
