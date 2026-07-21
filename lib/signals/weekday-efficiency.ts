// Weekday-efficiëntie: converteert een bepaalde weekdag structureel slechter per euro? Meta en
// LinkedIn laten geen uur-planning per se toe, maar een weekdag die consequent duur converteert
// is stuurbaar (bod/budget-schema of dagdeel-uitsluiting). Het maand-totaal middelt dat weg.
// CPA per weekdag uit periodetotalen, drempels op volume; de dag-CPA is eigen-platform-
// rekenkunde, het schema-advies een indicatie. Puur, los getest.

import { type DetectionResult, type SignalStory, type SignalEvidence } from "./types";

export interface WeekdayRow { date: string; spend: number; conversions: number }

export const WD_MIN_TOTAL_CONVERSIONS = 15;  // minimaal volume om weekdag-CPA's te vergelijken
export const WD_MIN_DAY_SPEND_SHARE = 0.08;  // een weekdag moet materieel budget dragen
export const WD_WASTE_CPA_MULT = 1.6;        // dag-CPA boven dit veelvoud van het weekgemiddelde = duur

const WEEKDAY_NL = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const eurS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "n.v.t." : `€${Math.round(v * 100) / 100}`);
const pctI = (v: number): string => `${Math.round(v * 100)}%`;
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

export function buildWeekdayEfficiencySignals(rows: WeekdayRow[], opts: { channelLabel: string; idPrefix: string }): DetectionResult {
  const id = `${opts.idPrefix}_weekday`;
  const byDay = new Map<number, { spend: number; conversions: number }>();
  let totalSpend = 0, totalConv = 0;
  for (const r of rows) {
    const t = Date.parse(r.date);
    if (!Number.isFinite(t)) continue;
    const wd = new Date(t).getUTCDay();
    const cur = byDay.get(wd) ?? { spend: 0, conversions: 0 };
    cur.spend += r.spend; cur.conversions += r.conversions;
    byDay.set(wd, cur);
    totalSpend += r.spend; totalConv += r.conversions;
  }
  if (totalSpend <= 0 || totalConv < WD_MIN_TOTAL_CONVERSIONS) return { triggered: [], checked: [id] };
  const overallCpa = div(totalSpend, totalConv)!;

  const worst = [...byDay.entries()]
    .map(([wd, a]) => ({ wd, cpa: div(a.spend, a.conversions), share: a.spend / totalSpend }))
    .filter((d) => d.share >= WD_MIN_DAY_SPEND_SHARE)
    .filter((d) => d.cpa == null || d.cpa >= overallCpa * WD_WASTE_CPA_MULT)
    .sort((a, b) => (b.cpa ?? Infinity) - (a.cpa ?? Infinity))[0];

  if (!worst) return { triggered: [], checked: [id] };

  const name = WEEKDAY_NL[worst.wd];
  const cpaText = worst.cpa == null
    ? `converteert niet (spend zonder conversies)`
    : `converteert tegen ${eurS(worst.cpa)} CPA — ${Math.round((worst.cpa / overallCpa) * 10) / 10}× het weekgemiddelde (${eurS(overallCpa)})`;
  return {
    triggered: [{
      id: `${opts.idPrefix}_weekday_duur`,
      category: "budget_pacing",
      scope: `${opts.channelLabel}: ${name}`,
      story: `Op ${opts.channelLabel} draagt ${name} ${pctI(worst.share)} van de spend en ${cpaText}: die dag is structureel duur.`,
      actionDirection: `overweeg een lager bod/budget-schema op ${name} of onderzoek waarom die dag slechter converteert (doelgroep-actief, concurrentie, tracking)`,
      certainty: "indicatie",
      evidence: [ev("weekdag", name), ev("dag-CPA", worst.cpa == null ? "geen conversies" : eurS(worst.cpa)), ev("weekgemiddelde CPA", eurS(overallCpa)), ev("spend-aandeel", pctI(worst.share))],
    }],
    checked: [id],
  };
}
