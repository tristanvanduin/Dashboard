// Diagnose-check 5 uit de metric-matrix: belofte versus levering. Een campagne met een
// CTR BOVEN de account-mediaan en een conversieratio ERONDER trekt bovengemiddeld veel
// klikken die daarna bovengemiddeld vaak afhaken. Dat is de handtekening van een kloof
// tussen wat de advertentie belooft en wat de bestemming levert.
//
// TWEE ONTWERPKEUZES:
// (1) De MEDIAAN, niet het gemiddelde. Een enkele campagne met een extreme CTR kantelt een
//     gemiddelde en dan meet je jezelf tegen die uitschieter. De mediaan blijft staan.
// (2) De zekerheid is bewust INDICATIE en nooit bewezen. De data toont de kloof hard, maar
//     de OORZAAK kan ook het aanbod, de prijs of de doelgroep zijn. De landing-audit (W1)
//     is de bevestigingsbron; die kijkt echt naar de pagina. Deze detector wijst hem aan.

import { type DetectionResult, pct } from "./types";

export const MIN_CLICKS_FOR_FUNNEL_STORY = 100; // onder dit volume is een conversieratio ruis
export const FUNNEL_GAP_MATERIAL = 0.2; // twintig procent relatief van de mediaan, beide kanten
export const MAX_FUNNEL_STORIES = 3; // de sectie blijft leesbaar; de grootste kloof telt

export interface FunnelCampaignInput {
  campaignName: string;
  impressions: number;
  clicks: number;
  conversions: number;
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface CampaignRates {
  campaignName: string;
  clicks: number;
  ctr: number;
  cvr: number;
}

export function detectBelofteVersusLevering(campaigns: FunnelCampaignInput[]): DetectionResult {
  const checked = ["belofte_versus_levering"];

  // Alleen campagnes met genoeg klikken doen mee, zowel voor de mediaan als voor het
  // oordeel: anders bepaalt een campagne met drie klikken de norm.
  const rates: CampaignRates[] = campaigns
    .filter((c) => c.clicks >= MIN_CLICKS_FOR_FUNNEL_STORY && c.impressions > 0)
    .map((c) => ({
      campaignName: c.campaignName,
      clicks: c.clicks,
      ctr: c.clicks / c.impressions,
      cvr: c.conversions / c.clicks,
    }));

  // Met minder dan drie campagnes is een mediaan geen norm maar een toevalligheid.
  if (rates.length < 3) return { triggered: [], checked };

  const medianCtr = median(rates.map((r) => r.ctr));
  const medianCvr = median(rates.map((r) => r.cvr));
  if (medianCtr == null || medianCvr == null || medianCtr <= 0 || medianCvr <= 0) {
    return { triggered: [], checked };
  }

  const gaps = rates
    .map((r) => ({
      ...r,
      ctrLift: (r.ctr - medianCtr) / medianCtr,
      cvrGap: (r.cvr - medianCvr) / medianCvr,
    }))
    .filter((r) => r.ctrLift >= FUNNEL_GAP_MATERIAL && r.cvrGap <= -FUNNEL_GAP_MATERIAL)
    // De grootste kloof eerst: hoge CTR en lage CVR samen wegen.
    .sort((a, b) => b.ctrLift - b.cvrGap - (a.ctrLift - a.cvrGap))
    .slice(0, MAX_FUNNEL_STORIES);

  return {
    triggered: gaps.map((g) => ({
      id: "belofte_versus_levering",
      category: "conversie_meting" as const,
      scope: g.campaignName,
      story: `De advertenties trekken bovengemiddeld veel klikken (CTR ${pct(g.ctrLift)} boven de account-mediaan) maar die klikken converteren ondergemiddeld (conversieratio ${pct(Math.abs(g.cvrGap))} onder de mediaan). Dat patroon wijst op een kloof tussen de belofte in de advertentie en wat de bestemmingspagina levert; de oorzaak kan ook bij het aanbod of de doelgroep liggen.`,
      actionDirection: "draai de landing-audit op deze campagne om de belofte tegen de pagina te leggen voordat je aan de biedingen komt",
      certainty: "indicatie" as const,
      evidence: [
        { metric: "ctr", value: Math.round(g.ctr * 10000) / 10000, prev: Math.round(medianCtr * 10000) / 10000 },
        { metric: "conversieratio", value: Math.round(g.cvr * 10000) / 10000, prev: Math.round(medianCvr * 10000) / 10000 },
        { metric: "klikken", value: g.clicks },
      ],
    })),
    checked,
  };
}
