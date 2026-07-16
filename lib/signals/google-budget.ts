// Categorie F: winner starves. De bestaande budget-allocatie-module is PRESCRIPTIEF (waar
// hoort de volgende euro heen). Deze detector kijkt DIAGNOSTISCH terug: waar ging het geld
// feitelijk heen, en klopte dat? Het patroon: een efficiente campagne liep tegen zijn
// budgetplafond terwijl het geld naar een minder efficiente campagne schoof. Dat is
// verdringing die niemand besloot, en precies materiaal voor de waarom-vraag.
//
// WAT DEZE DETECTOR NIET WEET, en dus niet beweert: of de campagnes daadwerkelijk EEN
// budget delen. Die relatie zit niet in de data (er is geen campaign_budget-tabel). Het
// verhaal spreekt daarom over het ACCOUNTGELD dat de verkeerde kant op ging, wat waar is
// ongeacht de budgetstructuur, en de zekerheid blijft indicatie.

import { type DetectionResult, pct } from "./types";
import { median } from "./google-funnel";

export const STARVED_BUDGET_LOST = 0.1; // vanaf tien procent budget-verlies telt een campagne als geknepen
export const SPEND_SHIFT_MATERIAL = 0.15; // vijftien procent spend-beweging is materieel
export const MIN_CONVERSIONS_FOR_CPA = 10; // onder dit volume is een CPA-vergelijking ruis

export interface StarveCampaignInput {
  campaignName: string;
  cost: number;
  prevCost: number;
  conversions: number;
  prevConversions: number;
  budgetLostIs: number; // huidige maand
}

interface Scored {
  campaignName: string;
  cpa: number;
  spendDelta: number; // relatief
  budgetLostIs: number;
  cost: number;
}

export function detectWinnerStarves(campaigns: StarveCampaignInput[]): DetectionResult {
  const checked = ["winner_starves"];

  // Alleen campagnes met genoeg conversies doen mee: anders vergelijk je CPA-ruis.
  const scored: Scored[] = campaigns
    .filter((c) => c.conversions >= MIN_CONVERSIONS_FOR_CPA && c.cost > 0 && c.prevCost > 0)
    .map((c) => ({
      campaignName: c.campaignName,
      cpa: c.cost / c.conversions,
      spendDelta: (c.cost - c.prevCost) / c.prevCost,
      budgetLostIs: c.budgetLostIs,
      cost: c.cost,
    }));

  // Met minder dan twee campagnes is er geen verdringing te zien, en zonder norm geen oordeel.
  if (scored.length < 2) return { triggered: [], checked };
  const medianCpa = median(scored.map((s) => s.cpa));
  if (medianCpa == null || medianCpa <= 0) return { triggered: [], checked };

  // De geknepen winnaar: efficienter dan de mediaan, tegen zijn budgetplafond, en niet
  // gegroeid. De grootste budget-rem eerst.
  const starved = scored
    .filter((s) => s.cpa < medianCpa && s.budgetLostIs >= STARVED_BUDGET_LOST && s.spendDelta < SPEND_SHIFT_MATERIAL)
    .sort((a, b) => b.budgetLostIs - a.budgetLostIs)[0];
  if (!starved) return { triggered: [], checked };

  // De groeier die het geld kreeg: minder efficient dan de mediaan en materieel gestegen.
  // De grootste stijging eerst, want die verklaart het meeste.
  const grower = scored
    .filter((s) => s.cpa > medianCpa && s.spendDelta >= SPEND_SHIFT_MATERIAL)
    .sort((a, b) => b.spendDelta - a.spendDelta)[0];
  if (!grower) return { triggered: [], checked };

  return {
    triggered: [
      {
        id: "winner_starves",
        category: "budget_pacing" as const,
        scope: `${starved.campaignName} tegenover ${grower.campaignName}`,
        story: `${starved.campaignName} converteert efficienter dan de account-mediaan (CPA ${starved.cpa.toFixed(2)} tegen mediaan ${medianCpa.toFixed(2)}) maar verloor ${pct(starved.budgetLostIs)} vertoningen aan zijn budgetplafond, terwijl ${grower.campaignName} met een duurdere CPA (${grower.cpa.toFixed(2)}) ${pct(grower.spendDelta)} meer uitgaf. Het accountgeld ging dus naar de minder efficiente kant terwijl de efficientere op slot zat. Of deze campagnes een budget delen is uit deze data niet te zien.`,
        actionDirection: `verhoog het budget van ${starved.campaignName} of haal het weg bij ${grower.campaignName}, en toets of de verschuiving een bewuste keuze was`,
        certainty: "indicatie" as const,
        evidence: [
          { metric: `cpa ${starved.campaignName}`, value: Math.round(starved.cpa * 100) / 100, prev: Math.round(medianCpa * 100) / 100 },
          { metric: `budget_lost_is ${starved.campaignName}`, value: starved.budgetLostIs },
          { metric: `cpa ${grower.campaignName}`, value: Math.round(grower.cpa * 100) / 100, prev: Math.round(medianCpa * 100) / 100 },
          { metric: `spend_delta ${grower.campaignName}`, value: Math.round(grower.spendDelta * 1000) / 1000 },
        ],
      },
    ],
    checked,
  };
}
