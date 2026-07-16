// G1: de promptbouwer die de voorgerekende impression-share-feiten omzet in de
// analyse-instructie. Puur en los getest; de deterministische feiten komen uit
// impression-share-facts.ts, temperatuur 0 en de repair zijn zaak van runStep. De prompt
// beschrijft niet, hij laat het model de al berekende diagnose interpreteren en vertalen
// naar acties, wat de analyse scherper maakt dan een checklist.

import type { CampaignISFact, ImpressionShareSummary, CountryISFact, LossDriver, ActionCandidate } from "@/lib/analysis/impression-share-facts";

const DRIVER_LABEL: Record<LossDriver, string> = {
  budget: "budget-gedreven",
  rank: "rang-gedreven (bod of kwaliteit)",
  mixed: "gemengd",
  none: "gezond",
};

const ACTION_LABEL: Record<ActionCandidate, string> = {
  raise_budget: "kandidaat voor budgetverhoging",
  improve_bid_or_quality: "kandidaat voor bod- of kwaliteitswerk",
  both: "kandidaat voor budget en bod of kwaliteit",
  none: "geen actie",
};

function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`;
}

// Bouwt het feitenblok voor de campagnes (al gerangschikt op grootste verlies).
function campaignFactsBlock(campaigns: CampaignISFact[]): string {
  if (campaigns.length === 0) return "Geen campagne-impression-share-data beschikbaar.";
  const lines = campaigns.map((c) => {
    const mom = c.impressionShareMoM === null ? "" : ` (MoM ${c.impressionShareMoM >= 0 ? "+" : ""}${pct(c.impressionShareMoM)})`;
    const cpa = c.cpa === null ? "geen conversies" : `CPA ${c.cpa}`;
    return `- ${c.campaignName}: IS ${pct(c.impressionShare)}${mom}, verloren door budget ${pct(c.budgetLostIs)}, door rang ${pct(c.rankLostIs)}. Diagnose: ${DRIVER_LABEL[c.driver]}, ${ACTION_LABEL[c.action]}. ${c.conversions} conversies, ${cpa}.`;
  });
  return lines.join("\n");
}

function geoFactsBlock(geo: CountryISFact[]): string {
  if (geo.length === 0) return "";
  const lines = geo.map((g) => `- ${g.countryCode}: IS ${pct(g.impressionShare)}, totaal verlies ${pct(g.totalLostIs)}, ${DRIVER_LABEL[g.driver]}.`);
  return `\n\n## Zichtbaarheid per land (voorgerekend)\n${lines.join("\n")}`;
}

export function buildImpressionSharePrompt(input: {
  summary: ImpressionShareSummary;
  campaigns: CampaignISFact[];
  geo: CountryISFact[];
  goalsSection?: string;
}): string {
  const s = input.summary;
  return `Je bent een senior Google Ads-specialist. Analyseer de zichtbaarheid (impression share) van dit account. De diagnose per campagne is al deterministisch voorgerekend; jouw taak is interpreteren en vertalen naar concrete, geprioriteerde acties, niet herrekenen.

## Voorgerekende samenvatting
Campagnes geanalyseerd: ${s.campaignsAnalysed}. Budget-gedreven verlies: ${s.budgetDriven}. Rang-gedreven verlies: ${s.rankDriven}. Gemengd: ${s.mixed}. Gezond: ${s.healthy}. Kandidaten voor budgetverhoging: ${s.raiseBudgetCandidates}. Kandidaten voor bod of kwaliteit: ${s.bidOrQualityCandidates}.

## Campagnes, gerangschikt op grootste zichtbaarheidsverlies (voorgerekend)
${campaignFactsBlock(input.campaigns)}${geoFactsBlock(input.geo)}
${input.goalsSection ? `\n\n## Doelstellingen en targets\n${input.goalsSection}` : ""}

## Jouw analyse
- Leg per belangrijke campagne uit wat het zichtbaarheidsverlies betekent en of het budget- of rang-gedreven is.
- Prioriteer: begin bij de campagnes met het grootste verlies en de gezondste economie.
- Vertaal naar acties: budget-gedreven met gezonde economie krijgt een budgetvoorstel; rang-gedreven krijgt bod- of kwaliteitswerk. Benoem de geo-laag waar de zichtbaarheid regionaal wegvalt.

## Regels
- Rapporteer tegen de eigen historie en de targets uit de doelstellingen, niet tegen een absolute norm.
- Stel budgetverhoging UITSLUITEND voor bij een campagne met gezonde conversie-economie tegen de target, nooit blind op verloren aandeel. Een campagne zonder conversies krijgt geen budgetvoorstel.
- Verzin geen cijfers; gebruik alleen de voorgerekende feiten hierboven.`;
}
