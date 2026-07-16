// Hefboom 3: de promptbouwer voor de fit van de biedstrategie. De classificatie per campagne
// is al deterministisch gemaakt; het model prioriteert en formuleert het advies, het
// herclassificeert niet. Puur en los getest.

import type { BidFact, BidStrategySummary, BidGoal } from "@/lib/analysis/bid-strategy-facts";

function campaignLines(facts: BidFact[]): string {
  if (facts.length === 0) return "- geen";
  return facts
    .map((f) => `- ${f.campaignName}: strategie ${f.strategy}, ${f.conversions} conversies${f.hasValue ? " met waarde" : " zonder waarde"}. Diagnose: ${f.fit}. ${f.recommendation}.`)
    .join("\n");
}

export function buildBidStrategyPrompt(input: {
  summary: BidStrategySummary;
  campaigns: BidFact[];
  goal: BidGoal;
  goalsSection?: string;
}): string {
  const doel = input.goal.hasRoasTarget ? "ROAS-doel" : input.goal.hasCpaTarget ? "CPA-doel" : "geen expliciet doel";
  return `Je bent een senior Google Ads-specialist. Beoordeel of de biedstrategieen per campagne passen bij het conversievolume, de waarde-tracking en het doel. De fit per campagne is al deterministisch voorgerekend; jouw taak is prioriteren en een concreet advies formuleren, niet herclassificeren.

## Voorgerekende samenvatting
Campagnes: ${input.summary.campaignsAnalysed}. Passend: ${input.summary.fit}. Mismatches: ${input.summary.mismatches}. Doel van het account: ${doel}.

## Campagnes, mismatches vooraan (voorgerekend)
${campaignLines(input.campaigns)}
${input.goalsSection ? `\n\n## Doelstellingen en targets\n${input.goalsSection}` : ""}

## Jouw analyse
- Behandel de mismatches op volgorde van impact (conversievolume) en leg per campagne uit waarom de huidige strategie knelt en wat de betere is.
- Wees concreet over de overstap: van handmatig naar smart alleen bij genoeg volume; naar waarde-bieden alleen met conversiewaarde en genoeg volume.

## Regels
- Adviseer smart bidding UITSLUITEND bij campagnes met genoeg conversievolume om te leren; raad het af bij te weinig volume.
- Adviseer waarde-bieden UITSLUITEND als de conversiewaarde betrouwbaar getrackt wordt.
- Rapporteer tegen het doel uit de doelstellingen. Verzin geen cijfers; gebruik alleen de voorgerekende feiten.`;
}
