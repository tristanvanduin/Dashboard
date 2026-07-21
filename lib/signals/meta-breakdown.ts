// Meta breakdown-efficiëntie: waar landt het budget binnen een dimensie (plaatsing, leeftijd,
// device) en converteert dat segment mee? De bestaande Meta-detectoren kijken naar de creative;
// dit kijkt naar de STRUCTUUR — het segment-equivalent van Google's geo/device-herverdeling.
// Per breakdown-dimensie: het segment dat veel spend draagt maar tegen een CPA ver boven het
// dimensie-gemiddelde (verspilling), en het segment dat efficiënt converteert maar nog weinig
// budget krijgt (schaalkans). Ratio's uit periodetotalen, drempels op volume; de rekenkunde op
// eigen Meta-cijfers is bewezen_binnen_platform, de herverdeel-duiding is de actie. Puur, los getest.

import { mergeDetections, type DetectionResult, type SignalStory, type SignalEvidence } from "./types";

export interface MetaBreakdownRow {
  breakdownType: string;  // publisher_platform | platform_position | age | gender | device_platform | ...
  breakdownValue: string; // facebook | audience_network | 25-34 | mobile_app | ...
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
}

export const BD_MIN_SEGMENT_SPEND = 50;        // minimale spend (EUR) om een segment serieus te nemen
export const BD_MIN_TYPE_CONVERSIONS = 10;     // minimale conversies over de dimensie om CPA's te vergelijken
export const BD_WASTE_CPA_MULT = 2;            // segment-CPA boven dit veelvoud van het dimensie-gemiddelde = waste
export const BD_WASTE_MIN_SPEND_SHARE = 0.15;  // en het draagt minstens dit deel van de dimensie-spend
export const BD_SCALE_CPA_FRAC = 0.6;          // segment-CPA onder dit deel van het gemiddelde = efficiënt
export const BD_SCALE_MAX_SPEND_SHARE = 0.25;  // maar draagt nog weinig budget: kop-ruimte

const TYPE_LABEL: Record<string, string> = {
  publisher_platform: "plaatsing",
  platform_position: "plaatsingspositie",
  age: "leeftijd",
  gender: "geslacht",
  device_platform: "device",
  impression_device: "device",
};
export const metaBreakdownTypeLabel = (t: string): string => TYPE_LABEL[t] ?? t.replace(/_/g, " ");
const typeLabel = metaBreakdownTypeLabel;

const eurS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "n.v.t." : `€${Math.round(v * 100) / 100}`);
const pctI = (v: number): string => `${Math.round(v * 100)}%`;
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

interface Seg { value: string; impressions: number; clicks: number; spend: number; conversions: number }

function analyzeType(type: string, segs: Seg[]): SignalStory[] {
  const totalSpend = segs.reduce((s, x) => s + x.spend, 0);
  const totalConv = segs.reduce((s, x) => s + x.conversions, 0);
  if (totalSpend <= 0 || totalConv < BD_MIN_TYPE_CONVERSIONS) return [];
  const overallCpa = div(totalSpend, totalConv)!;
  const label = typeLabel(type);
  const stories: SignalStory[] = [];

  // ── Waste: het duurste materiële segment ver boven het dimensie-gemiddelde ──
  const wasteCandidates = segs
    .filter((s) => s.spend >= BD_MIN_SEGMENT_SPEND && s.spend / totalSpend >= BD_WASTE_MIN_SPEND_SHARE)
    .map((s) => ({ s, cpa: div(s.spend, s.conversions), share: s.spend / totalSpend }))
    // zero-conversie met materiële spend = oneindige CPA (bovenaan), anders CPA ver boven gemiddeld
    .filter(({ cpa }) => cpa == null || cpa >= overallCpa * BD_WASTE_CPA_MULT)
    .sort((a, b) => (b.cpa ?? Infinity) - (a.cpa ?? Infinity));

  if (wasteCandidates.length > 0) {
    const { s, cpa, share } = wasteCandidates[0];
    const cpaText = cpa == null
      ? `€${Math.round(s.spend)} spend zonder conversies`
      : `${eurS(cpa)} CPA — ${Math.round((cpa / overallCpa) * 10) / 10}× het ${label}-gemiddelde (${eurS(overallCpa)})`;
    stories.push({
      id: `meta_breakdown_waste_${type}`,
      category: "budget_pacing",
      scope: `${label}: ${s.value}`,
      story: `Binnen ${label} draagt '${s.value}' ${pctI(share)} van de Meta-spend maar presteert slecht: ${cpaText}. Waarschijnlijk verspilling.`,
      actionDirection: `sluit '${s.value}' uit of verlaag het budgetaandeel en herverdeel naar de efficiënte ${label}-segmenten; controleer eerst of de tracking voor dit segment klopt`,
      certainty: "bewezen_binnen_platform",
      evidence: [
        ev(`${label}-segment`, s.value),
        ev("spend-aandeel", pctI(share)),
        ev("CPA", cpa == null ? "geen conversies" : eurS(cpa)),
        ev(`${label}-gemiddelde CPA`, eurS(overallCpa)),
      ],
    });
  }

  // ── Schaalkans: efficiënt segment met nog weinig budget ──
  const scaleCandidates = segs
    .filter((s) => s.spend >= BD_MIN_SEGMENT_SPEND && s.conversions > 0)
    .map((s) => ({ s, cpa: div(s.spend, s.conversions)!, share: s.spend / totalSpend }))
    .filter(({ cpa, share }) => cpa <= overallCpa * BD_SCALE_CPA_FRAC && share <= BD_SCALE_MAX_SPEND_SHARE)
    .sort((a, b) => a.cpa - b.cpa);

  if (scaleCandidates.length > 0) {
    const { s, cpa, share } = scaleCandidates[0];
    stories.push({
      id: `meta_breakdown_scale_${type}`,
      category: "budget_pacing",
      scope: `${label}: ${s.value}`,
      story: `Binnen ${label} converteert '${s.value}' efficiënt (${eurS(cpa)} CPA — ${Math.round((cpa / overallCpa) * 10) / 10}× het ${label}-gemiddelde van ${eurS(overallCpa)}) maar draagt pas ${pctI(share)} van de spend: kop-ruimte om op te schalen.`,
      actionDirection: `verhoog het budgetaandeel van '${s.value}' of geef het een eigen adset, en meet of de CPA-voorsprong standhoudt bij meer volume`,
      certainty: "indicatie",
      evidence: [
        ev(`${label}-segment`, s.value),
        ev("CPA", eurS(cpa)),
        ev(`${label}-gemiddelde CPA`, eurS(overallCpa)),
        ev("spend-aandeel", pctI(share)),
      ],
    });
  }

  return stories;
}

// Bundel: aggregeer per dimensie + segment over de periode en analyseer elke dimensie.
export function buildMetaBreakdownSignals(rows: MetaBreakdownRow[]): DetectionResult {
  const byType = new Map<string, Map<string, Seg>>();
  for (const r of rows) {
    if (!r.breakdownType || !r.breakdownValue) continue;
    const segs = byType.get(r.breakdownType) ?? new Map<string, Seg>();
    const cur = segs.get(r.breakdownValue) ?? { value: r.breakdownValue, impressions: 0, clicks: 0, spend: 0, conversions: 0 };
    cur.impressions += r.impressions; cur.clicks += r.clicks; cur.spend += r.spend; cur.conversions += r.conversions;
    segs.set(r.breakdownValue, cur);
    byType.set(r.breakdownType, segs);
  }

  const results: DetectionResult[] = [];
  for (const [type, segs] of byType) {
    const stories = analyzeType(type, [...segs.values()]);
    results.push({ triggered: stories, checked: [`meta_breakdown_${type}`] });
  }
  if (results.length === 0) return { triggered: [], checked: ["meta_breakdown"] };
  return mergeDetections(results);
}
