// Hefboom 2: de promptbouwer die het voorgerekende herallocatie-voorstel omzet in de
// analyse-instructie. Puur en los getest. De beslissing per campagne is al deterministisch
// gemaakt; het model prioriteert en formuleert het budgetadvies, het herrekent niet.

import type { BudgetFact, BudgetAllocationSummary, BudgetTarget } from "@/lib/analysis/budget-allocation-facts";

function euro(v: number): string {
  return `${Math.round(v)}`;
}

function candidateLines(facts: BudgetFact[]): string {
  if (facts.length === 0) return "- geen";
  return facts
    .map((f) => {
      const eff = f.cpa !== null ? `CPA ${f.cpa}` : f.roas !== null ? `ROAS ${f.roas}` : "geen conversie-economie";
      return `- ${f.campaignName}: ${eff}, spend ${euro(f.cost)}, verloren door budget ${Math.round(f.budgetLostIs * 100)}%, door rang ${Math.round(f.rankLostIs * 100)}%. ${f.reason}.`;
    })
    .join("\n");
}

export function buildBudgetAllocationPrompt(input: {
  summary: BudgetAllocationSummary;
  scaleUp: BudgetFact[];
  scaleDown: BudgetFact[];
  target: BudgetTarget;
  goalsSection?: string;
}): string {
  const targetText = input.target.targetRoas != null
    ? `ROAS-target ${input.target.targetRoas}`
    : input.target.targetCpa != null
      ? `CPA-target ${input.target.targetCpa}`
      : "geen target ingesteld";

  return `Je bent een senior Google Ads-specialist. Analyseer de budgetallocatie over campagnes. De efficientie, groeiruimte en verzadiging per campagne zijn al deterministisch voorgerekend; jouw taak is prioriteren en een concreet budgetadvies formuleren, niet herrekenen.

## Voorgerekende samenvatting
Campagnes: ${input.summary.campaignsAnalysed}. Kandidaat voor meer budget: ${input.summary.scaleUp}. Kandidaat voor minder budget: ${input.summary.scaleDown}. Gelijk houden: ${input.summary.hold}. Beoordeeld tegen: ${targetText}.

## Meer budget (gerangschikt, beste bestemming voor de volgende euro bovenaan)
${candidateLines(input.scaleUp)}

## Minder budget (bron om budget uit weg te halen, grootste spend op een misser eerst)
${candidateLines(input.scaleDown)}
${input.goalsSection ? `\n\n## Doelstellingen en targets\n${input.goalsSection}` : ""}

## Jouw analyse
- Stel een concrete herallocatie voor: haal budget weg bij de campagnes die de target missen, zet het bij de efficiente campagnes met de meeste groeiruimte.
- Begin bij de grootste hefboom: de winnaar met de meeste onbenutte vraag verdient de eerste euro.
- Benoem de rang-beperkte campagnes apart: die krijgen geen extra budget, daar is bod of kwaliteit de rem.

## Regels
- Rapporteer tegen de target uit de doelstellingen, niet tegen een absolute norm.
- Verplaats budget UITSLUITEND naar campagnes met bewezen efficientie tegen de target en aantoonbare groeiruimte. Geen extra budget naar een campagne zonder conversie-economie of naar een rang-beperkte campagne.
- Verzin geen cijfers; gebruik alleen de voorgerekende feiten hierboven.`;
}
