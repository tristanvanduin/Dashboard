// G2: de promptbouwer die de voorgerekende quality-score-feiten omzet in de
// analyse-instructie. Puur; de deterministische feiten komen uit quality-score-facts.ts.
// De spec-no-go zit hard in de regels: de drie QS-componenten worden niet gesynct, dus
// component-oorzaken mogen niet als gemeten feit geclaimd worden; hefbomen afleiden uit CTR
// en structuur mag, expliciet als hypothese.

import type { QualityScoreFacts } from "@/lib/analysis/quality-score-facts";

function bucketsBlock(facts: QualityScoreFacts): string {
  return facts.buckets
    .map((b) => `- ${b.range}: €${b.spend} (${b.sharePct}% van de QS-gedekte spend), CTR ${b.avgCtrPct ?? "onbekend"}%, CPC €${b.avgCpc ?? "onbekend"}`)
    .join("\n");
}

function campaignsBlock(facts: QualityScoreFacts): string {
  if (facts.campaigns.length === 0) return "Geen campagne-uitsplitsing beschikbaar.";
  return facts.campaigns
    .map((c) => `- ${c.campaignName}: spend-gewogen QS ${c.spendWeightedQs ?? "onbekend"}, €${c.lowBucketSpend} van €${c.totalSpend} in de lage bucket`)
    .join("\n");
}

function priorityBlock(facts: QualityScoreFacts): string {
  if (facts.priorityKeywords.length === 0) return "Geen prioriteitswoorden (geen dure lage-QS-termen in de analysemaand).";
  return facts.priorityKeywords
    .map((k) => `- "${k.keywordText}" (${k.campaignName}${k.adGroupName ? `, ${k.adGroupName}` : ""}, ${k.matchType ?? "match onbekend"}): QS ${k.qualityScore}, €${k.cost}, ${k.clicks} klikken, ${k.conversions} conversies${k.converting ? " [CONVERTEERT: duur maar het werkt; verbeteren, niet zomaar pauzeren]" : ""}`)
    .join("\n");
}

function trendBlock(facts: QualityScoreFacts): string {
  if (facts.trend.length <= 1) return "Geen trend beschikbaar (een maand data).";
  return facts.trend.map((t) => `- ${t.month}: QS ${t.spendWeightedQs ?? "onbekend"}, lage-bucket-aandeel ${t.lowSpendSharePct ?? "onbekend"}%`).join("\n");
}

function flagsBlock(facts: QualityScoreFacts): string {
  if (facts.flags.length === 0) return "Geen flags.";
  return facts.flags.map((f) => `- [${f.kind}] ${f.detail}`).join("\n");
}

export function buildQualityScorePrompt(input: { facts: QualityScoreFacts; goalsSection: string }): string {
  const { facts } = input;
  return `Je bent een senior Google Ads specialist. Je analyseert de quality-score-situatie van een account op basis van UITSLUITEND de onderstaande, voorgerekende feiten.

## Klantdoelen en context
${input.goalsSection}

## Samenvatting
${facts.summary}

## De kosten-gewogen QS-verdeling (analysemaand ${facts.analysisMonth ?? "onbekend"}, dekking ${facts.coveragePct}% van de spend)
${bucketsBlock(facts)}

## Campagnes met de meeste spend in de lage bucket
${campaignsBlock(facts)}

## Prioriteitenlijst: hoge kosten maal lage QS
${priorityBlock(facts)}

## Trend
${trendBlock(facts)}

## Flags
${flagsBlock(facts)}

## Beperking (verplicht te respecteren)
${facts.componentNote}

## Regels
1. Gebruik ALLEEN cijfers die hierboven staan; verzin of herbereken niets.
2. Component-oorzaken (verwachte CTR, advertentierelevantie, bestemmingspagina-ervaring) mag je NIET als gemeten feit claimen; die data is er niet. Hefbomen afleiden uit de CTR-samenhang per bucket en de structuur (match type, adgroep) mag, maar markeer dat expliciet als hypothese.
3. Weeg de prioriteit op kosten: een dure lage-QS-term gaat voor tien goedkope.
4. Respecteer de converterend-vlag: een converterend laag-QS-woord verbeter je (advertentie, pagina), je pauzeert het niet zomaar.
5. Meet acties af tegen de klantdoelen hierboven, niet tegen een absolute norm.
6. Als de dekking laag is, zeg dat eerst en tempér de stelligheid van elk oordeel.
7. Schrijf in het Nederlands, mobiel leesbaar, zonder opsomming van alle data (de lezer heeft de tabellen niet nodig, wel de conclusies en de acties).

## Gevraagde output
Kort: (1) het oordeel over de verdeling en de trend, (2) de drie belangrijkste prioriteiten met het waarom en de hypothese-hefboom, (3) de concrete acties per prioriteit, (4) de beperking in een zin.`;
}
