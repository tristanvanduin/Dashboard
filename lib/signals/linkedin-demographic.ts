// LinkedIn demografie-segment-efficiëntie: waar landt het budget binnen een demografische
// dimensie (functie, seniority, industrie, bedrijfsgrootte) en levert dat leads op tegen een
// redelijke CPL? De bestaande LinkedIn-detectoren kijken naar forms/CPL/engagement op
// entiteit-niveau en de ICP-fit vergelijkt met een gedeclareerd profiel; dit kijkt puur naar
// KOSTEN-efficiëntie per segment — het LinkedIn-equivalent van de Meta breakdown-efficiëntie.
// Per dimensie: het segment dat veel spend draagt maar een CPL ver boven het dimensie-gemiddelde
// (verspilling), en het efficiënte segment dat nog weinig budget krijgt (schaalkans). Ratio's
// uit periodetotalen, drempels op volume; eigen-platform-rekenkunde. Puur, los getest.

import { mergeDetections, type DetectionResult, type SignalStory, type SignalEvidence } from "./types";

export interface LinkedInDemographicRow {
  dimension: string; // al leesbaar: "functie" | "seniority" | "industrie" | "bedrijfsgrootte"
  value: string;     // al gelabeld segment (URN → label door de route)
  spend: number;
  leads: number;
}

export const LD_MIN_SEGMENT_SPEND = 50;        // minimale spend (EUR) om een segment serieus te nemen
export const LD_MIN_DIM_LEADS = 8;             // minimale leads over de dimensie om CPL's te vergelijken
export const LD_WASTE_CPL_MULT = 2;            // segment-CPL boven dit veelvoud van het dimensie-gemiddelde = waste
export const LD_WASTE_MIN_SPEND_SHARE = 0.15;  // en het draagt minstens dit deel van de dimensie-spend
export const LD_SCALE_CPL_FRAC = 0.6;          // segment-CPL onder dit deel van het gemiddelde = efficiënt
export const LD_SCALE_MAX_SPEND_SHARE = 0.25;  // maar draagt nog weinig budget: kop-ruimte

const eurS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "n.v.t." : `€${Math.round(v * 100) / 100}`);
const pctI = (v: number): string => `${Math.round(v * 100)}%`;
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

interface Seg { value: string; spend: number; leads: number }

function analyzeDimension(dimension: string, segs: Seg[]): SignalStory[] {
  const totalSpend = segs.reduce((s, x) => s + x.spend, 0);
  const totalLeads = segs.reduce((s, x) => s + x.leads, 0);
  if (totalSpend <= 0 || totalLeads < LD_MIN_DIM_LEADS) return [];
  const overallCpl = div(totalSpend, totalLeads)!;
  const stories: SignalStory[] = [];

  // ── Waste: het duurste materiële segment ver boven het dimensie-gemiddelde ──
  const wasteCandidates = segs
    .filter((s) => s.spend >= LD_MIN_SEGMENT_SPEND && s.spend / totalSpend >= LD_WASTE_MIN_SPEND_SHARE)
    .map((s) => ({ s, cpl: div(s.spend, s.leads), share: s.spend / totalSpend }))
    .filter(({ cpl }) => cpl == null || cpl >= overallCpl * LD_WASTE_CPL_MULT)
    .sort((a, b) => (b.cpl ?? Infinity) - (a.cpl ?? Infinity));

  if (wasteCandidates.length > 0) {
    const { s, cpl, share } = wasteCandidates[0];
    const cplText = cpl == null
      ? `€${Math.round(s.spend)} spend zonder leads`
      : `${eurS(cpl)} CPL — ${Math.round((cpl / overallCpl) * 10) / 10}× het ${dimension}-gemiddelde (${eurS(overallCpl)})`;
    stories.push({
      id: `linkedin_demographic_waste_${dimension}`,
      category: "budget_pacing",
      scope: `${dimension}: ${s.value}`,
      story: `Binnen ${dimension} draagt '${s.value}' ${pctI(share)} van de LinkedIn-spend maar levert weinig op: ${cplText}. Waarschijnlijk verspilling.`,
      actionDirection: `sluit '${s.value}' uit of verlaag het budgetaandeel en herverdeel naar de efficiënte ${dimension}-segmenten; controleer eerst of de lead-tracking voor dit segment klopt`,
      certainty: "bewezen_binnen_platform",
      evidence: [
        ev(`${dimension}-segment`, s.value),
        ev("spend-aandeel", pctI(share)),
        ev("CPL", cpl == null ? "geen leads" : eurS(cpl)),
        ev(`${dimension}-gemiddelde CPL`, eurS(overallCpl)),
      ],
    });
  }

  // ── Schaalkans: efficiënt segment met nog weinig budget ──
  const scaleCandidates = segs
    .filter((s) => s.spend >= LD_MIN_SEGMENT_SPEND && s.leads > 0)
    .map((s) => ({ s, cpl: div(s.spend, s.leads)!, share: s.spend / totalSpend }))
    .filter(({ cpl, share }) => cpl <= overallCpl * LD_SCALE_CPL_FRAC && share <= LD_SCALE_MAX_SPEND_SHARE)
    .sort((a, b) => a.cpl - b.cpl);

  if (scaleCandidates.length > 0) {
    const { s, cpl, share } = scaleCandidates[0];
    stories.push({
      id: `linkedin_demographic_scale_${dimension}`,
      category: "budget_pacing",
      scope: `${dimension}: ${s.value}`,
      story: `Binnen ${dimension} levert '${s.value}' efficiënt leads (${eurS(cpl)} CPL — ${Math.round((cpl / overallCpl) * 10) / 10}× het ${dimension}-gemiddelde van ${eurS(overallCpl)}) maar draagt pas ${pctI(share)} van de spend: kop-ruimte om op te schalen.`,
      actionDirection: `verhoog het budgetaandeel van '${s.value}' of maak een dedicated campagne, en meet of de CPL-voorsprong standhoudt bij meer volume`,
      certainty: "indicatie",
      evidence: [
        ev(`${dimension}-segment`, s.value),
        ev("CPL", eurS(cpl)),
        ev(`${dimension}-gemiddelde CPL`, eurS(overallCpl)),
        ev("spend-aandeel", pctI(share)),
      ],
    });
  }

  return stories;
}

// Bundel: aggregeer per dimensie + segment over de periode en analyseer elke dimensie.
export function buildLinkedInDemographicSignals(rows: LinkedInDemographicRow[]): DetectionResult {
  const byDim = new Map<string, Map<string, Seg>>();
  for (const r of rows) {
    if (!r.dimension || !r.value) continue;
    const segs = byDim.get(r.dimension) ?? new Map<string, Seg>();
    const cur = segs.get(r.value) ?? { value: r.value, spend: 0, leads: 0 };
    cur.spend += r.spend; cur.leads += r.leads;
    segs.set(r.value, cur);
    byDim.set(r.dimension, segs);
  }

  const results: DetectionResult[] = [];
  for (const [dimension, segs] of byDim) {
    const stories = analyzeDimension(dimension, [...segs.values()]);
    results.push({ triggered: stories, checked: [`linkedin_demographic_${dimension}`] });
  }
  if (results.length === 0) return { triggered: [], checked: ["linkedin_demographic"] };
  return mergeDetections(results);
}
