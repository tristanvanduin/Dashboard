// M2: de Meta (Facebook/Instagram) Ads ChannelAdapter op de gedeelde engine (C1).
// Definieert de Meta Monthly SOP (11 stappen, bewust anders dan Google's 13) en levert
// die als adapter: stap-instructies, log-formats, purity-contracten en -regels, benchmarks,
// issue-clusters, entity-types en aliases. Zelfde grammatica en toon als Google.
//
// Niet hier: de data-laag (buildPreparedContext en buildCanonicalMetricMap op de M1-tabellen)
// en de validator/canonicalize-bedrading met deze regels; die volgen wanneer een echte
// Meta-run ze tegen live data kan toetsen. Dit bestand is de prompt-laag van de adapter.

import { registerAdapter, type ChannelAdapter } from "@/lib/analysis/channel-adapter";
import type { StepPurityRule } from "@/lib/analysis/step-validator";
import type { AccountType } from "@/lib/prompts/sop-prompts";

// Verplichte log-formats per stap, letterlijk volgens de M2-spec. De LLM moet per
// uitgevoerde werkwijze een log-entry in deze grammatica produceren.
const META_LOG_FORMATS: Record<number, string> = {
  1: 'Log-formaat: "Het MoM verschil van X% op {doelmetric} is te verklaren door {KPI A}, {KPI B} - {KPI A} stijgt/daalt MoM met X% van {w1} naar {w2} - dit ligt wel/niet in lijn met de 13-maands trend - status: {OP SCHEMA/NIET OP SCHEMA/KRITIEK}."',
  2: 'Log-formaat: "Campagne {X} draagt sterk bij aan {KPI A} - {KPI A} is X% boven/onder accountgemiddelde en steeg/daalde MoM met X% - breuklijn op {datum} valt samen met {wijziging} - learning-status: {actief/learning/limited}."',
  3: 'Log-formaat: "Ad set {X} ({audiencetype}) presteert boven/ondergemiddeld - {KPI A} X% versus gemiddelde - frequency {f} - sinds {week} trend van {w1} naar {w2}."',
  4: 'Log-formaat: "Ad {X} ({format}) is winnaar/bleeder - hook rate X% (gem. Y%), link CTR X%, CPA EUR X - fatigue: ja/nee, CTR daalde van X% naar Y% bij frequency Z sinds {datum}."',
  5: 'Log-formaat: "Patroon {attribuut={waarde}} presteert X% boven/onder accountgemiddelde op {metric} (n={ads}, {impressies} impressies, evidence: deterministic/inferred) - dit verklaart winnaar/bleeder {ad X}."',
  6: 'Log-formaat: "Placement {X} under-index/over-index op {KPI A} - {KPI A} X% versus accountgemiddelde - spend EUR X met {conversies} conversies - breuklijn sinds {periode}."',
  7: 'Log-formaat: "Segment {X} ({leeftijd/geslacht/regio}) presteert boven/ondergemiddeld op {KPI A} - X% versus gemiddelde bij {volume} conversies - minimumvolume gehaald: ja/nee."',
  8: 'Log-formaat: "Drop-off {fase X} naar {fase Y} is X% - zichtbaar sinds {periode} - mogelijke verklaring: {creative/doelgroep/landing}."',
  9: 'Log-formaat: "Frequency stijgt van X naar Y over {periode} terwijl link CTR daalt van X% naar Y% - verzadigingssignaal in {campagne/adset}."',
  10: 'Log-formaat: "Op {weekdag/dagdeel} is {KPI A} X% boven/onder gemiddeld - patroon zichtbaar over {periode}." Geen signaal: 1 regel "Werkwijze schedule: geen materieel weekdag- of dagdeelpatroon".',
  11: 'Log-formaat per hypothese: "Hypothese: {causale claim} - onderbouwing: {bevinding stap N} - evidence: deterministic/inferred/hypothesis - voorgestelde route: {containment/recovery/scale}."',
};

// Step-Purity Contract per stap: wat de stap mag duiden en wat niet, in de Google-grammatica.
const META_PURITY_CONTRACTS: Record<number, string> = {
  1: `### Step-Purity Contract
- Doel: accountstatus, KPI-keten, target-gap en trendstatus duiden
- Leidende databronnen: account month-data, targets, 13-maands en MoM, change history, benchmarks
- Mag beoordelen: account en hooguit campagne-allocatie als accountverklaring
- Primaire metrics: Conversies, Conversiewaarde, Spend, ROAS/CPA, CVR, Link CTR, CPC
- Mag concluderen: status, target-gap, trendrichting, waarschijnlijke bottleneck in de KPI-keten
- Mag NIET concluderen: creative/audience/placement/device/geo/funnel als definitieve hoofdoorzaak`,
  2: `### Step-Purity Contract
- Doel: campagnestructuur, objectives, budgetallocatie en learning-status duiden
- Leidende databronnen: campagne-month-data, change_log, learning_stage_info, budgetbenutting
- Mag beoordelen: campagne en account-allocatie
- Mag concluderen: welke campagnes het accountresultaat verklaren, structuur- en budgetfricties, learning-status
- Mag NIET concluderen: creative-, doelgroep- of placement-root-cause als definitieve hoofdclaim`,
  3: `### Step-Purity Contract
- Doel: ad set- en doelgroepperformance, audience-type en overlap-risico duiden
- Leidende databronnen: adset-month-data, targeting_summary, frequency per adset
- Mag beoordelen: adset en doelgroep
- Mag concluderen: boven/ondergemiddelde adsets, audience-type-verschillen, overlap-risico, frequency-druk per adset
- Mag NIET concluderen: specifieke creative-attributen of placement als definitieve hoofdoorzaak`,
  4: `### Step-Purity Contract
- Doel: kwantitatieve creative-performance en fatigue duiden
- Leidende databronnen: ad-month-data, funnel-metrics per ad, frequency en dagen-live
- Mag beoordelen: ad en creative op metrisch niveau
- Mag concluderen: winnaars en bleeders, hook/hold/CTR/CPA versus gemiddelde, fatigue op basis van CTR-verval
- Mag NIET concluderen: WAAROM visueel (dat is stap 5); geen audience- of placement-hoofdclaim`,
  5: `### Step-Purity Contract
- Doel: visuele attributen die de winnaars en bleeders uit stap 4 verklaren
- Leidende databronnen: meta_creative_patterns en visual-features (M3), uitsluitend evidence-gedekt
- Mag beoordelen: visuele patronen met voldoende n en impressies
- Mag concluderen: alleen patronen die de evidence-drempels halen, met expliciete WAAROM (attribuut, lift, n)
- Mag NIET concluderen: vision-claims zonder M3-data; bij onvoldoende data degradeert de stap naar 1 regel`,
  6: `### Step-Purity Contract
- Doel: placement- en platformperformance en waste duiden
- Leidende databronnen: breakdown-data (publisher_platform, platform_position, impression_device)
- Mag beoordelen: placement, platform en device
- Mag concluderen: under/over-index per placement, device-verschillen, placement-waste
- Mag NIET concluderen: creative- of doelgroep-root-cause als definitieve hoofdclaim`,
  7: `### Step-Purity Contract
- Doel: demografie en geo duiden binnen minimumvolume
- Leidende databronnen: breakdown-data (age_gender, country/region)
- Mag beoordelen: leeftijd, geslacht en regio
- Mag concluderen: boven/ondergemiddelde segmenten boven de minimumvolumegrens
- Mag NIET concluderen: segmenten onder de volumegrens als stellig; geen creative-hoofdclaim`,
  8: `### Step-Purity Contract
- Doel: funnel-drop-offs en attributie duiden
- Leidende databronnen: funnelkolommen (landing_page_views, add_to_cart, initiate_checkout, conversions)
- Mag beoordelen: funnelfasen op account- en campagneniveau
- Mag concluderen: drop-offs per fase, vergelijking met 3 maanden, attributie-kanttekening expliciet
- Mag NIET concluderen: een enkele creative of doelgroep als bewezen oorzaak; benoem als mogelijke verklaring`,
  9: `### Step-Purity Contract
- Doel: frequency en verzadiging duiden
- Leidende databronnen: frequency- en reach/views-trend op account/campagne
- Mag beoordelen: frequency versus CTR/CPA, verzadigingssignaal
- Mag concluderen: verzadiging (stijgende frequency, dalende incrementele conversies), first-time reach-indicatie
- Mag NIET concluderen: specifieke creative-vermoeidheid als visuele oorzaak (dat is stap 4 en 5)`,
  10: `### Step-Purity Contract
- Doel: weekdag- en dagdeelpatronen duiden
- Leidende databronnen: dagniveau-aggregatie uit daily
- Mag beoordelen: schedule-patronen
- Mag concluderen: materiele weekdag- of dagdeelverschillen; bij geen signaal 1 regel
- Mag NIET concluderen: oorzaken buiten schedule als hoofdclaim`,
  11: `### Step-Purity Contract
- Doel: hypotheses en sprintplanning synthetiseren uit de voorgaande stappen
- Leidende databronnen: alle voorgaande stap-conclusies en de canonical claim-set
- Mag beoordelen: het account-breed, als synthese
- Mag concluderen: gegronde hypotheses met evidence-niveau en routes; creative-briefing-trigger bij voldoende patronen
- Mag NIET concluderen: nieuwe cijfers verzinnen die niet uit eerdere stappen of de prepared context komen`,
};

// Kern-instructies per stap (de werkwijze), volgens de M2-spec. Het log-format en het
// purity-contract worden hieronder aangehecht, net als bij Google.
const META_RAW_INSTRUCTIONS: Record<number, string> = {
  1: `## Stap 1: Account Performance
Bron: meta_account_daily over 13 maanden met maandaggregatie.
Werkwijze: toets de doelstellingen (CPA/ROAS-target uit client_settings). Verklaar het maand-op-maand verschil via de keten Conversiewaarde naar Conversies naar CVR naar Link clicks naar CPC/Spend naar Impressions naar Link CTR. Zet de trend af tegen zowel 2 maanden als de 13-maands lijn. Voer een attributie-sanity uit (tracking-break-check). Gebruik uitsluitend de aangeleverde voorgerekende getallen.`,
  2: `## Stap 2: Campagnestructuur en Budget
Bron: meta_campaigns, meta_campaign_daily en meta_change_log.
Werkwijze: toets objectives tegen de doelstelling, beoordeel de CBO- versus ABO-verdeling, de learning-status per adset (learning_stage_info) en de budgetbenutting. Bepaal welke campagnes het accountresultaat verklaren en koppel breuklijnen aan het change_log.`,
  3: `## Stap 3: Ad Set en Doelgroep Performance
Bron: meta_adset_daily en targeting_summary.
Werkwijze: identificeer boven- en ondergemiddelde adsets, vergelijk audience-types (broad/Advantage+ versus interesse versus custom/lookalike), signaleer overlap-risico (zelfde doelgroepomschrijving in meerdere adsets) en beoordeel de frequency per adset.`,
  4: `## Stap 4: Creative Performance (kwantitatief)
Bron: meta_ad_daily en meta_creatives.
Werkwijze: zet per ad de funnel-metrics (hook rate, hold rate, link CTR, CVR, CPA/ROAS) af tegen het accountgemiddelde. Detecteer fatigue: link CTR minus 30% versus de eigen eerste-week-baseline bij frequency boven 2.5. Benoem winnaars en bleeders kwantitatief. Verklaar nog NIET visueel waarom; dat is stap 5.`,
  5: `## Stap 5: Creative Visual Deep-dive
Bron: meta_creative_patterns en meta_creative_visual_features (uit M3).
Werkwijze: bepaal welke visuele attributen de winnaars en bleeders uit stap 4 verklaren. Rapporteer uitsluitend patronen die de evidence-drempels halen en benoem expliciet WAAROM (attribuut, lift, n, impressies). Bij onvoldoende vision-data: exact 1 regel "Werkwijze visual deep-dive: onvoldoende geanalyseerde creatives" en door.`,
  6: `## Stap 6: Placement en Platform
Bron: meta_breakdown_daily (publisher_platform, platform_position, impression_device).
Werkwijze: vergelijk feed versus stories versus reels versus audience network per KPI, beoordeel device-verschillen en signaleer placement-waste (spend zonder conversies).`,
  7: `## Stap 7: Demografie en Geo
Bron: meta_breakdown_daily (age_gender, country/region).
Werkwijze: beoordeel leeftijd, geslacht en regio per KPI, met een expliciete minimum-volumegrens per segment. Rapporteer alleen segmenten die de grens halen als stellig.`,
  8: `## Stap 8: Funnel en Attributie
Bron: funnelkolommen in meta_account_daily en meta_campaign_daily (landing_page_views, add_to_cart, initiate_checkout, conversions).
Werkwijze: bereken drop-offs per fase (vuistregel 50%), vergelijk de laatste maand met de afgelopen 3 maanden en plaats de attributie-kanttekening expliciet (Meta-attributie versus site-data).`,
  9: `## Stap 9: Frequency en Verzadiging
Bron: frequency- en reach/views-trend op account- en campagneniveau.
Werkwijze: zet de frequency-trend af tegen CTR/CPA, detecteer een verzadigingssignaal (stijgende frequency bij dalende incrementele conversies) en geef een first-time-reach-indicatie.`,
  10: `## Stap 10: Schedule
Bron: dagniveau-aggregatie uit daily (weekdagpatronen).
Werkwijze: beoordeel weekdag- en dagdeelverschillen per KPI. Bij geen materieel signaal: exact 1 regel en door.`,
  11: `## Stap 11: Hypotheses en Sprintplanning
Bron: alle voorgaande stap-conclusies en de canonical claim-set.
Werkwijze: synthetiseer gegronde hypotheses met evidence-niveau en routes (containment/recovery/scale), mode-bewust. Extra werkwijze D, creative-briefing-trigger: bepaal of de patronen uit stap 5 een nieuwe briefing rechtvaardigen (drempel: minstens 2 deterministic patronen of 1 fatigue-kritieke winnaar) en zet dat als taak.`,
};

// Hecht log-format en purity-contract aan elke kern-instructie, net als Google's withStepPurityContract.
function withMetaStepContract(step: number, instruction: string): string {
  const logFormat = META_LOG_FORMATS[step] || "";
  return `${instruction}\n\n${logFormat}\n\n${META_PURITY_CONTRACTS[step]}`;
}

const META_STEP_INSTRUCTIONS: Record<number, string> = Object.fromEntries(
  Object.keys(META_RAW_INSTRUCTIONS).map((k) => {
    const step = Number(k);
    return [step, withMetaStepContract(step, META_RAW_INSTRUCTIONS[step])];
  })
);

// Regex die per stap in de log-entries aanwezig moeten zijn (validator-input), afgeleid van de log-formats.
const META_LOG_FORMAT_SKELETONS: Record<number, RegExp[]> = {
  1: [/is te verklaren door/i, /MoM|maand op maand/i, /status:/i],
  2: [/draagt sterk bij aan|boven\/onder accountgemiddelde/i, /breuklijn/i, /learning-status/i],
  3: [/presteert (boven|onder)/i, /frequency/i, /audiencetype|broad|lookalike|interesse|custom/i],
  4: [/winnaar|bleeder/i, /hook rate/i, /fatigue/i],
  5: [/patroon/i, /evidence/i, /impressies|n=/i],
  6: [/under-index|over-index/i, /placement|platform/i, /spend/i],
  7: [/presteert (boven|onder)/i, /minimumvolume|volume/i],
  8: [/drop-off/i, /zichtbaar sinds|sinds/i],
  9: [/frequency stijgt|verzadigingssignaal/i, /link CTR daalt|CTR/i],
  10: [/weekdag|dagdeel|geen materieel/i],
  11: [/hypothese/i, /evidence/i, /route/i],
};

// Purity-regels per stap. Bewust alleen note en forbiddenNarrativePatterns, omdat de
// allowedEntityTypes/allowedActionDomains-enums Google-specifiek zijn; de verboden
// patronen dekken de domeinafbakening type-veilig af.
const META_PURITY_RULES: Partial<Record<number, StepPurityRule>> = {
  1: { forbiddenNarrativePatterns: [/creative|hook|doelgroep|audience|placement|platform|device|funnel|geo/i], note: "Accountstatus en KPI-keten; geen diepe oorzaakclaim over latere domeinen." },
  2: { forbiddenNarrativePatterns: [/creative|hook|placement|device|funnel/i], note: "Campagnestructuur, budget en learning; geen creative- of placement-root-cause als hoofdclaim." },
  3: { forbiddenNarrativePatterns: [/specifiek creative|hook rate|placement|funnel/i], note: "Ad set en doelgroep; geen specifieke creative-attributen of placement als hoofdoorzaak." },
  4: { forbiddenNarrativePatterns: [/visueel|kleur|compositie|hook visual|audience overlap|placement/i], note: "Kwantitatieve creative-metrics; geen visuele WAAROM (stap 5) en geen placement-hoofdclaim." },
  5: { forbiddenNarrativePatterns: [/zonder evidence|vermoedelijk patroon/i], note: "Alleen evidence-gedekte visuele patronen; degradeer netjes bij onvoldoende data." },
  6: { forbiddenNarrativePatterns: [/creative-root|doelgroep-root/i], note: "Placement, platform en device; geen creative- of doelgroep-root-cause als hoofdclaim." },
  7: { forbiddenNarrativePatterns: [/creative|placement/i], note: "Demografie en geo binnen minimumvolume; geen creative-hoofdclaim." },
  8: { forbiddenNarrativePatterns: [/bewezen oorzaak|definitief door/i], note: "Funnel en attributie; benoem oorzaken als mogelijke verklaring, niet als bewijs." },
  9: { forbiddenNarrativePatterns: [/visuele vermoeidheid|kleur|compositie/i], note: "Frequency en verzadiging; geen visuele creative-oorzaak (stap 4 en 5)." },
  10: { forbiddenNarrativePatterns: [/creative|doelgroep|placement/i], note: "Schedule; geen oorzaken buiten schedule als hoofdclaim." },
  11: { forbiddenNarrativePatterns: [/nieuw cijfer|nieuwe metric die/i], note: "Synthese uit eerdere stappen; geen nieuwe cijfers verzinnen." },
};

// Benchmarks per accounttype, als richtwaarden (geen harde normen). Meta-context.
const META_BENCHMARKS: Record<AccountType, string> = {
  ecommerce_roas: "Meta-benchmarks (richtwaarden, e-commerce ROAS): Link CTR feed 0,8 tot 1,5%, hook rate video 25 tot 40%, hold rate 10 tot 20%, frequency-alarm boven 3,5 per 7 dagen bij prospecting. Vermeld CPM-context bij spend-verschuivingen. ROAS afmeten tegen de target uit client_settings.",
  ecommerce_cpa: "Meta-benchmarks (richtwaarden, e-commerce CPA): Link CTR feed 0,8 tot 1,5%, hook rate video 25 tot 40%, hold rate 10 tot 20%, frequency-alarm boven 3,5 per 7 dagen bij prospecting. CPA afmeten tegen de target; let op CVR- en funnel-drop-offs als kostendrijver.",
  leadgen_cpa: "Meta-benchmarks (richtwaarden, leadgen CPA): Link CTR feed 0,8 tot 1,5%, hook rate video 25 tot 40%, frequency-alarm boven 3,5 per 7 dagen. Beoordeel leadkwaliteit-signalen waar beschikbaar; CPA tegen de target.",
  leadgen_volume: "Meta-benchmarks (richtwaarden, leadgen volume): Link CTR feed 0,8 tot 1,5%, hook rate video 25 tot 40%, frequency-alarm boven 3,5 per 7 dagen. Bewaak volume versus CPA-plafond en verzadiging bij opschalen.",
  hybrid: "Meta-benchmarks (richtwaarden, hybride): Link CTR feed 0,8 tot 1,5%, hook rate video 25 tot 40%, hold rate 10 tot 20%, frequency-alarm boven 3,5 per 7 dagen. Weeg ROAS en CPA tegen de doelstelling die in client_settings primair is.",
};

// De issue_cluster-lijst voor Meta (prompt-lijst), conform de M2-spec.
const META_ISSUE_CLUSTERS: readonly string[] = [
  "creative_fatigue", "hook_dropoff", "creative_winner", "audience_overlap", "learning_phase_instability",
  "placement_waste", "frequency_saturation", "funnel_dropoff", "attribution_gap", "demo_inefficiency",
  "geo_allocation", "scaling_opportunity", "budget_constraint", "performance_winner", "efficiency_gain",
  "volume_shortfall", "uncategorized",
];

// De entity_type-lijst voor Meta.
const META_ENTITY_TYPES: readonly string[] = [
  "account", "campaign", "adset", "ad", "creative", "audience", "placement", "platform", "device", "age_gender", "country", "schedule",
];

// Meta-specifieke aliases voor canonicalisatie (metric- en entity-normalisatie).
const META_METRIC_ALIASES: Array<[RegExp, string]> = [
  [/\b(link ?ctr|link click[- ]?through)\b/i, "Link CTR"],
  [/\b(hook ?rate|3[- ]?sec(ond)? view ?rate)\b/i, "Hook rate"],
  [/\b(hold ?rate|thruplay ?rate)\b/i, "Hold rate"],
  [/\b(cpa|cost ?per ?(acquisition|purchase|result))\b/i, "CPA"],
  [/\b(roas|return ?on ?ad ?spend)\b/i, "ROAS"],
  [/\b(cvr|conversie ?ratio|conversion ?rate)\b/i, "CVR"],
  [/\b(cpm|cost ?per ?mille)\b/i, "CPM"],
  [/\b(frequency|frequentie)\b/i, "Frequency"],
];

const META_ENTITY_ALIASES: Array<[RegExp, string]> = [
  [/\b(ad ?set|adgroep op meta)\b/i, "adset"],
  [/\b(advertentie|creative|ad)\b/i, "ad"],
  [/\b(doelgroep|audience|lookalike|custom audience)\b/i, "audience"],
  [/\b(plaatsing|placement|feed|stories|reels|audience network)\b/i, "placement"],
];

export const metaAdsAdapter: ChannelAdapter = {
  channel: "meta_ads",
  sopTypeKey: "meta_monthly",
  stepCount: 11,
  benchmarks: META_BENCHMARKS,
  issueClusters: META_ISSUE_CLUSTERS,
  entityTypes: META_ENTITY_TYPES,
  stepInstructions: META_STEP_INSTRUCTIONS,
  logFormats: META_LOG_FORMATS,
  purityContracts: META_PURITY_CONTRACTS,
  logFormatSkeletons: META_LOG_FORMAT_SKELETONS,
  purityRules: META_PURITY_RULES,
  metricAliases: META_METRIC_ALIASES,
  entityAliases: META_ENTITY_ALIASES,
};

registerAdapter(metaAdsAdapter);
