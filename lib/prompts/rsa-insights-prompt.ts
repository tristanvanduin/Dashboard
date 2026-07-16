// RSA-insights: de promptbouwer die de voorgerekende copy-feiten omzet in de
// analyse-instructie. Puur; de feiten komen uit rsa-insights-facts.ts. De meetvalkuil zit
// hard in de regels: performance_label is leidend (de enige binnen-advertentie-vergelijking),
// serving-aandeel is context, en klik- of conversiecijfers per asset zijn indicatief en
// mogen NOOIT als hard bewijs worden opgevoerd (dubbeltelling).

import type { RsaInsightsFacts } from "@/lib/analysis/rsa-insights-facts";

function insightLine(i: RsaInsightsFacts["trekkers"][number]): string {
  return `- [${i.fieldType}] "${i.assetText}": ${i.dominantLabel} dominant (BEST ${i.labelShares.best}% / GOOD ${i.labelShares.good}% / LOW ${i.labelShares.low}%, impressie-gewogen), serving-aandeel ${i.servingSharePct}%, in ${i.adCount} ad(s), ${i.impressions} vertoningen${i.pinnedAnywhere ? ", ergens gepind" : ""}. Indicatief: CTR ${i.indicative.ctrPct ?? "onbekend"}%, ${i.indicative.conversions} conversies.`;
}

export function buildRsaInsightsPrompt(input: { facts: RsaInsightsFacts; goalsSection: string }): string {
  const { facts } = input;
  return `Je bent een senior Google Ads copy-specialist. Je analyseert de RSA-asset-prestaties op basis van UITSLUITEND de onderstaande, voorgerekende feiten en schrijft een actiegerichte analyse voor de content-marketeer.

## Klantdoelen en context
${input.goalsSection}

## Samenvatting
${facts.summary}

## Trekkers (BEST of GOOD dominant volgens Google)
${facts.trekkers.length > 0 ? facts.trekkers.map(insightLine).join("\n") : "Geen trekkers met volume."}

## Bleeders (LOW dominant met substantieel volume)
${facts.bleeders.length > 0 ? facts.bleeders.map(insightLine).join("\n") : "Geen bleeders boven de volumedrempel."}

## Dominante pins
${facts.pinDominance.length > 0 ? facts.pinDominance.map((p) => `- Ad ${p.adId} (${p.adGroupName ?? "adgroep onbekend"}): gepind "${p.assetText}" pakt ${p.servingSharePct}% van de rotatie, label ${p.label}`).join("\n") : "Geen dominante pins."}

## Ads met te weinig headline-varianten
${facts.lowVariantAds.length > 0 ? facts.lowVariantAds.map((v) => `- Ad ${v.adId} (${v.adGroupName ?? "adgroep onbekend"}): ${v.headlineCount} unieke headlines`).join("\n") : "Geen variant-armoede."}

## Voorgestelde acties (deterministisch samengesteld)
${facts.actions.length > 0 ? facts.actions.map((a) => `- [${a.kind}] ${a.detail}`).join("\n") : "Geen acties."}

## Beperking (verplicht te respecteren)
${facts.attributionNote}

## Regels
1. Gebruik ALLEEN cijfers die hierboven staan; verzin of herbereken niets.
2. Het performance_label is leidend: dat is de enige bron die assets BINNEN de advertentie vergelijkt. Serving-aandeel is context (hoe vaak Google het asset meeneemt). Klik- en conversiecijfers per asset zijn INDICATIEF en mogen nooit als hard bewijs worden opgevoerd; benoem dat expliciet als je ze aanhaalt.
3. De actielijst is de kern van je output: maak elke actie concreet uitvoerbaar voor een content-marketeer (welke tekst, welk thema, welke adgroep), en prioriteer op impressie-volume.
4. Trekkers-thema's (bijv. prijs, snelheid) mag je benoemen als PATROON-HYPOTHESE over de teksten heen, nooit als bewezen conversie-oorzaak.
5. Meet de prioriteit af tegen de klantdoelen hierboven.
6. Sluit af met de beperking in een zin.
7. Schrijf in het Nederlands, mobiel leesbaar, conclusies en acties in plaats van datadumps.

## Gevraagde output
Kort: (1) het beeld in twee zinnen, (2) de drie belangrijkste acties met het waarom en de concrete schrijfopdracht, (3) een thema-hypothese over wat de trekkers gemeen hebben, expliciet als hypothese, (4) de beperking in een zin.`;
}
