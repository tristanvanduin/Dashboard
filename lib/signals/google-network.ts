// Netwerk-lek per campagne. BEWUST NAAST de bestaande accountbrede netwerk-mix in
// pmax-expert-layer.ts, die alle netwerken over het hele account optelt en op
// display-dominantie let. Dat verbergt precies het geval dat hier telt: draait er PMax in
// het account, dan is Display accountbreed volkomen normaal, en verdwijnt een enkele
// SEARCH-campagne die naar Display of zoekpartners lekt in dat gemiddelde. Terwijl dat een
// van de klassiekste verspillingen in Google Ads is.
//
// DE KERN VAN DE METHODE: vergelijken BINNEN de campagne, niet tegen een accountgemiddelde.
// Het zoeknetwerk van dezelfde campagne is de eerlijke maatstaf, want dat deelt de
// advertenties, de biedingen en de doelgroep. Verschilt de conversieratio daar fors van,
// dan ligt het aan het netwerk en niet aan de campagne.

import { type DetectionResult, pct } from "./types";

export const LEAK_MIN_COST_SHARE = 0.1; // een secundair netwerk telt vanaf tien procent van de campagnekosten
export const LEAK_MIN_CLICKS = 50; // onder dit volume is een conversieratio ruis
export const LEAK_CVR_GAP = 0.5; // de conversieratio moet minstens de helft slechter zijn
export const MAX_LEAK_STORIES = 2;

// De netwerken die naast het zoeknetwerk kunnen meeliften. MIXED en UNSPECIFIED laten we
// staan: die zijn niet toe te wijzen en dus geen basis voor een verhaal.
const SECONDARY_NETWORKS: Record<string, string> = {
  CONTENT: "het display-netwerk",
  SEARCH_PARTNERS: "de zoekpartners",
  YOUTUBE_WATCH: "YouTube",
  YOUTUBE_SEARCH: "YouTube-zoeken",
};

const REMEDY: Record<string, string> = {
  CONTENT: "zet Display uit in de campagne-instellingen; voor een zoekcampagne is dat een aparte campagne waard of helemaal niets",
  SEARCH_PARTNERS: "zet de zoekpartners uit in de campagne-instellingen; dat is een vinkje en raakt het zoeknetwerk niet",
  YOUTUBE_WATCH: "toets of dit netwerk bewust aanstaat voor deze campagne",
  YOUTUBE_SEARCH: "toets of dit netwerk bewust aanstaat voor deze campagne",
};

export interface NetworkRow {
  campaignName: string;
  networkType: string;
  cost: number;
  clicks: number;
  conversions: number;
}

export function detectNetwerkLek(rows: NetworkRow[], pmaxCampaigns: Set<string>): DetectionResult {
  const checked = ["netwerk_lek"];
  if (rows.length === 0) return { triggered: [], checked };

  // Per campagne per netwerk optellen; PMax-campagnes vallen af, want daar HOORT het
  // verkeer over meerdere netwerken te lopen.
  const byCampaign = new Map<string, Map<string, { cost: number; clicks: number; conversions: number }>>();
  for (const row of rows) {
    if (pmaxCampaigns.has(row.campaignName)) continue;
    const networks = byCampaign.get(row.campaignName) ?? new Map();
    const current = networks.get(row.networkType) ?? { cost: 0, clicks: 0, conversions: 0 };
    current.cost += Math.max(row.cost, 0);
    current.clicks += Math.max(row.clicks, 0);
    current.conversions += Math.max(row.conversions, 0);
    networks.set(row.networkType, current);
    byCampaign.set(row.campaignName, networks);
  }

  const stories: DetectionResult["triggered"] = [];
  for (const [campaignName, networks] of byCampaign) {
    const search = networks.get("SEARCH");
    // Zonder een zoeknetwerk met volume is er geen maatstaf binnen de campagne.
    if (!search || search.clicks < LEAK_MIN_CLICKS) continue;
    const searchCvr = search.conversions / search.clicks;
    if (searchCvr <= 0) continue; // converteert het zoeknetwerk zelf niet, dan is dit een ander verhaal

    const totalCost = [...networks.values()].reduce((s, n) => s + n.cost, 0);
    if (totalCost <= 0) continue;

    for (const [networkType, data] of networks) {
      const label = SECONDARY_NETWORKS[networkType];
      if (!label) continue;
      const costShare = data.cost / totalCost;
      if (costShare < LEAK_MIN_COST_SHARE || data.clicks < LEAK_MIN_CLICKS) continue;
      const cvr = data.conversions / data.clicks;
      const gap = (searchCvr - cvr) / searchCvr;
      if (gap < LEAK_CVR_GAP) continue;

      stories.push({
        id: "netwerk_lek",
        category: "budget_pacing" as const,
        scope: `${campaignName} op ${label}`,
        story: `${pct(costShare)} van de kosten van deze zoekcampagne ging naar ${label}, met een conversieratio die ${pct(gap)} lager ligt dan die van het zoeknetwerk in dezelfde campagne (${(cvr * 100).toFixed(2)} procent tegen ${(searchCvr * 100).toFixed(2)} procent). Dezelfde advertenties en biedingen, ander netwerk, dus het verschil zit in het netwerk.`,
        actionDirection: REMEDY[networkType] ?? "toets of dit netwerk bewust aanstaat voor deze campagne",
        certainty: "bewezen_binnen_platform" as const,
        evidence: [
          { metric: "kostenaandeel", value: Math.round(costShare * 1000) / 1000 },
          { metric: "conversieratio netwerk", value: Math.round(cvr * 10000) / 10000, prev: Math.round(searchCvr * 10000) / 10000 },
          { metric: "kosten", value: Math.round(data.cost * 100) / 100 },
          { metric: "klikken", value: data.clicks },
        ],
      });
    }
  }

  return { triggered: stories.sort((a, b) => Number(b.evidence[2].value) - Number(a.evidence[2].value)).slice(0, MAX_LEAK_STORIES), checked };
}
