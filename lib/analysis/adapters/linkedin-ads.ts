// L2: de LinkedIn Ads ChannelAdapter op de gedeelde engine (C1). Definieert de LinkedIn Monthly
// SOP (9 stappen, bewust anders dan Google's 13 en Meta's 11) en levert die als adapter:
// stap-instructies, log-formats, purity-contracten en -regels, benchmarks, issue-clusters,
// entity-types en aliases. Zelfde grammatica en toon als Google en Meta, maar met de LinkedIn-kern:
// CPL leidt (geen ROAS-fixatie bij leadgen), en de ICP-fit is de scherpste stap.
//
// De ICP-fit-berekening zelf is deterministisch en los getest (lib/linkedin/icp-fit.ts); het model
// krijgt de uitkomsten aangeleverd via de pre-compute en duidt ze. Dit bestand is de prompt-laag.

import { registerAdapter, type ChannelAdapter } from "@/lib/analysis/channel-adapter";
import type { StepPurityRule } from "@/lib/analysis/step-validator";
import type { AccountType } from "@/lib/prompts/sop-prompts";

// Verplichte log-formats per stap, letterlijk volgens de L2-spec.
const LINKEDIN_LOG_FORMATS: Record<number, string> = {
  1: 'Log-formaat: "Het MoM verschil van X% op {doelmetric} is te verklaren door {KPI A}, {KPI B} - {KPI A} stijgt/daalt MoM met X% van {w1} naar {w2} - dit ligt wel/niet in lijn met de 13-maands trend - status: {OP SCHEMA/NIET OP SCHEMA/KRITIEK}."',
  2: 'Log-formaat: "Campagne {X} ({objective}, {cost_type}) draagt sterk bij aan {KPI A} - {KPI A} X% boven/onder accountgemiddelde - budgetbenutting X% met patroon {gelijkmatig/vroeg uitgeput} - Audience Network: {aan/uit, effect}."',
  3: 'Log-formaat: "Campagne {X} presteert boven/ondergemiddeld op {KPI A} - X% versus accountgemiddelde - breuklijn op {datum} - week-over-week trend van {w1} naar {w2}."',
  4: 'Log-formaat: "Creative {X} ({format}) is winnaar/bleeder - CTR X% (formatgem. Y%), CPL EUR X (accountgem. EUR Y) - sinds {week} CTR-verval van X% naar Y% over {dagen} dagen live."',
  5: 'Log-formaat: "Binnen {campagne/account} valt X% van de spend en Y% van de leads binnen het ICP - grootste waste-segment: {segment} met EUR X spend en {n} leads - {segment} levert CPL EUR X versus ICP-CPL EUR Y - demografie-coverage: Z%."',
  6: 'Log-formaat: "Funnel {campagne X}: open rate X%, completion rate Y% (richtwaarde 10 tot 15%), CPL EUR Z - drop-off zit bij {fase} - zichtbaar sinds {periode}." Geen leadgen-campagnes: 1 regel "Werkwijze funnel: geen leadgen-campagnes".',
  7: 'Log-formaat: "Doelgroep {campagne X} ({omvang ~N}) toont verzadiging - CPM steeg van EUR X naar EUR Y terwijl CTR daalde van X% naar Y% over {periode}."',
  8: 'Log-formaat: "Campagne {X} ({biedstrategie}) realiseert CPC EUR X versus EUR Y bij {alternatief regime} in vergelijkbare campagnes - dagbudget is op N van de M dagen voor 18:00 uitgeput."',
  9: 'Log-formaat per hypothese: "Hypothese: {causale claim} - onderbouwing: {bevinding stap N} - evidence: deterministic/inferred/hypothesis - voorgestelde route: {containment/recovery/scale}."',
};

// Step-Purity Contract per stap: wat de stap mag duiden en wat niet, in de gedeelde grammatica.
const LINKEDIN_PURITY_CONTRACTS: Record<number, string> = {
  1: `### Step-Purity Contract
- Doel: accountstatus, KPI-keten, target-gap en trendstatus duiden
- Leidende databronnen: linkedin_account_daily, targets, 13-maands en MoM, benchmarks
- Mag beoordelen: account en hooguit campagne-allocatie als accountverklaring
- Primaire metrics: Leads, CPL, Form completion rate, Form opens, Clicks, CPC, Spend, Impressions, CTR
- Mag concluderen: status, target-gap, trendrichting, waarschijnlijke bottleneck in de KPI-keten
- Mag NIET concluderen: creative/format/doelgroep/ICP/funnel als definitieve hoofdoorzaak, of ROAS als leidende maat`,
  2: `### Step-Purity Contract
- Doel: campaign groups, objectives, biedstrategie en budget-pacing duiden
- Leidende databronnen: linkedin_campaign_groups, linkedin_campaigns, campaign_daily, budgetbenutting
- Mag beoordelen: campagne en account-allocatie, objective-mix, Audience Network aan/uit
- Mag concluderen: welke campagnes en objectives het accountresultaat verklaren, pacing- en budgetfricties
- Mag NIET concluderen: creative-, demografie- of ICP-root-cause als definitieve hoofdclaim`,
  3: `### Step-Purity Contract
- Doel: campagne-performance en breuklijnen op de KPI-set duiden
- Leidende databronnen: linkedin_campaign_daily, versus-accountgemiddelde, MoM en week-over-week
- Mag beoordelen: campagne versus accountgemiddelde
- Mag concluderen: boven- en ondergemiddelde campagnes, breuklijnen, week-patronen
- Mag NIET concluderen: specifieke creative-attributen of demografie-segmenten als hoofdoorzaak`,
  4: `### Step-Purity Contract
- Doel: creative-performance per format kwantitatief duiden, inclusief tijdsverval
- Leidende databronnen: linkedin_creative_daily, linkedin_creatives, format- en accountgemiddelde
- Mag beoordelen: creative versus formatgemiddelde en accountgemiddelde
- Primaire metrics: CTR, engagement, video view/completion, CPL
- Mag concluderen: winnaars en bleeders per format, CTR-verval over dagen-live als slijtage-proxy
- Mag NIET concluderen: demografie- of ICP-oorzaak als hoofdclaim; frequency per creative bestaat niet, benoem tijdsverval als proxy`,
  5: `### Step-Purity Contract
- Doel: de demografie-verdeling en de ICP-fit duiden (de kernstap)
- Leidende databronnen: linkedin_demographic_daily, linkedin_icp, urn_labels, de voorgerekende ICP-fit en waste
- Mag beoordelen: per pivot de verdeling van impressies, clicks, spend en leads, en de ICP-fit
- Mag concluderen: aandeel spend en leads binnen ICP, waste-segmenten, CPL binnen versus buiten ICP, met coverage-kanttekening
- Mag NIET concluderen: leadkwaliteit-claims zonder ICP-definitie of CRM-bron (dan beschrijvend), of segmenten die de API onderdrukt reconstrueren`,
  6: `### Step-Purity Contract
- Doel: de lead-gen funnel per fase duiden
- Leidende databronnen: form opens, leads, completion rate uit de daily-tabellen, lead_forms indien gesynct
- Mag beoordelen: open rate, completion rate en CPL per fase, form- versus landing-page-campagnes
- Mag concluderen: waar de drop-off zit en sinds wanneer
- Mag NIET concluderen: creative- of demografie-oorzaak als bewezen; benoem als mogelijke verklaring`,
  7: `### Step-Purity Contract
- Doel: audience-omvang en verzadiging duiden
- Leidende databronnen: audience_count_estimate, CPM-trend, CTR-trend per campagne, ICP-fit uit stap 5
- Mag beoordelen: te smalle en te brede doelgroepen, verzadigingssignaal over 3 maanden
- Mag concluderen: verzadiging (stijgende CPM bij dalende CTR), breedte-mismatch met ICP
- Mag NIET concluderen: creative-slijtage als verzadigingsoorzaak (dat is stap 4)`,
  8: `### Step-Purity Contract
- Doel: bidding-regime en pacing duiden
- Leidende databronnen: cost_type, unit_cost, dagelijkse spend-curves
- Mag beoordelen: handmatige biedingen versus maximum delivery, dagbudget-knelpunten
- Mag concluderen: CPC/CPL-effect per regime, vroege uitputting, aanbevolen regime per campagne
- Mag NIET concluderen: doelgroep- of creative-oorzaak als hoofdclaim`,
  9: `### Step-Purity Contract
- Doel: gegronde hypotheses en sprintplanning synthetiseren
- Leidende databronnen: alle voorgaande stap-conclusies en de canonical claim-set
- Mag beoordelen: de samenhang tussen de bevindingen
- Mag concluderen: hypotheses met evidence-niveau, ICE-prioritering, routes containment/recovery/scale
- Mag NIET concluderen: nieuwe cijfers verzinnen; impact-claims moeten gegrond zijn (besparing = werkelijke waste-spend, volume = begrensd door audience of pacing)`,
};

// Kern-instructie per stap (Bron plus Werkwijze), letterlijk gebaseerd op de L2-spec.
const LINKEDIN_RAW_INSTRUCTIONS: Record<number, string> = {
  1: `## Stap 1: Account Performance
Bron: linkedin_account_daily, 13 maanden.
Werkwijze: toets CPL of de conversie-target uit client_settings. Verklaar het MoM-verschil via de keten Leads naar Form completion rate naar Form opens naar Clicks naar CPC/Spend naar Impressions naar CTR. Beoordeel de trend over 2 en 13 maanden en plaats seizoenscontext (B2B: vakanties en kwartaaleinden benoemen als de data het toont, niet als excuus).`,
  2: `## Stap 2: Campaign Groups, Objectives en Budget
Bron: linkedin_campaign_groups, linkedin_campaigns, linkedin_campaign_daily.
Werkwijze: beoordeel de objective-mix versus de doelstelling, de cost_type en biedstrategie per campagne, de budget-pacing (uitputting per dag: spend gelijkmatig of vroeg op) en of Audience Network aan of uit staat plus het effect ervan.`,
  3: `## Stap 3: Campaign Performance
Bron: linkedin_campaign_daily.
Werkwijze: identificeer boven- en ondergemiddelde campagnes op de KPI-set, MoM-breuklijnen en week-over-week patronen.`,
  4: `## Stap 4: Creative Performance
Bron: linkedin_creative_daily en linkedin_creatives.
Werkwijze: zet per format (single image, video, carousel, document, text, message) de CTR, engagement, video view/completion en CPL af tegen het formatgemiddelde en het accountgemiddelde. Benoem per creative winnaars en bleeders. Detecteer slijtage via CTR-verval over dagen-live; LinkedIn geeft geen frequency per creative, dus tijdsverval is de proxy en dat benoem je expliciet.`,
  5: `## Stap 5: Demografie en ICP-fit (de kernstap)
Bron: linkedin_demographic_daily, linkedin_icp en linkedin_urn_labels, met de voorgerekende ICP-fit en waste.
Werkwijze: beoordeel per pivot (functie, senioriteit, industrie, bedrijfsgrootte) de verdeling van impressies, clicks, spend en leads. De ICP-fit-score (aandeel spend en aandeel leads binnen ICP-segmenten), de waste (spend op expliciet niet-ICP segmenten) en de CPL binnen versus buiten ICP zijn deterministisch aangeleverd; duid ze. Behandel per ondermaatse campagne de demografie apart en vermeld coverage_pct zodat onderdrukte segmenten eerlijk meewegen. Zonder ingevulde ICP: beschrijvend, geen fit-score, met expliciete melding.`,
  6: `## Stap 6: Lead Gen Funnel
Bron: form opens, leads en completion rate uit de daily-tabellen, plus linkedin_lead_forms indien gesynct.
Werkwijze: beoordeel de open rate (opens/clicks), de completion rate (leads/opens) en de CPL per fase. Vergelijk lead-gen-form- versus landing-page-campagnes en lokaliseer de drop-off (advertentie, form-lengte, doelgroep). Geen leadgen-campagnes: 1 regel en door.`,
  7: `## Stap 7: Audience-omvang en Verzadiging
Bron: audience_count_estimate, CPM-trend en CTR-trend per campagne.
Werkwijze: signaleer te smalle doelgroepen (hoge CPM-stijging plus dalende CTR bij kleine audience_count), te brede doelgroepen (lage ICP-fit uit stap 5) en een verzadigingssignaal over 3 maanden.`,
  8: `## Stap 8: Bidding en Pacing
Bron: cost_type, unit_cost en de dagelijkse spend-curves.
Werkwijze: vergelijk handmatige biedingen versus maximum delivery per campagne en hun CPC/CPL-effect, signaleer dagbudget-knelpunten (vroege uitputting) en geef per campagne een aanbeveling richting het bewezen efficientere regime.`,
  9: `## Stap 9: Hypotheses en Sprintplanning
Bron: alle voorgaande stap-conclusies en de canonical claim-set.
Werkwijze: synthetiseer gegronde hypotheses met disjuncte guardrails en evidence-niveau, prioriteer met ICE en onderbouw impact-claims gegrond (besparing = werkelijke spend van waste-segmenten, volume = begrensd door audience-omvang of pacing-data). Routes containment, recovery en scale, mode-bewust.`,
};

// Hecht log-format en purity-contract aan elke kern-instructie, net als Google en Meta.
function withLinkedinStepContract(step: number, instruction: string): string {
  const logFormat = LINKEDIN_LOG_FORMATS[step] || "";
  return `${instruction}\n\n${logFormat}\n\n${LINKEDIN_PURITY_CONTRACTS[step]}`;
}

const LINKEDIN_STEP_INSTRUCTIONS: Record<number, string> = Object.fromEntries(
  Object.keys(LINKEDIN_RAW_INSTRUCTIONS).map((k) => {
    const step = Number(k);
    return [step, withLinkedinStepContract(step, LINKEDIN_RAW_INSTRUCTIONS[step])];
  })
);

// Regex die per stap in de log-entries aanwezig moeten zijn (validator-input), afgeleid van de log-formats.
const LINKEDIN_LOG_FORMAT_SKELETONS: Record<number, RegExp[]> = {
  1: [/is te verklaren door/i, /MoM|maand op maand/i, /status:/i],
  2: [/draagt sterk bij aan|boven\/onder accountgemiddelde/i, /budgetbenutting|pacing/i, /audience network/i],
  3: [/presteert (boven|onder)/i, /breuklijn|week-over-week/i],
  4: [/winnaar|bleeder/i, /format/i, /CTR-verval|dagen live/i],
  5: [/binnen het ICP|ICP/i, /waste-segment/i, /coverage/i],
  6: [/open rate/i, /completion rate/i, /drop-off|geen leadgen/i],
  7: [/verzadiging/i, /CPM steeg|CTR daalde/i],
  8: [/biedstrategie|maximum delivery|handmatig/i, /CPC/i, /dagbudget/i],
  9: [/hypothese/i, /evidence/i, /route/i],
};

// Purity-regels per stap. Alleen note en forbiddenNarrativePatterns; de domeinafbakening dekt de
// LinkedIn-kern: CPL leidt, geen ROAS-fixatie, geen cross-domein-hoofdoorzaak.
const LINKEDIN_PURITY_RULES: Partial<Record<number, StepPurityRule>> = {
  1: { forbiddenNarrativePatterns: [/creative|format|doelgroep|audience|ICP|funnel/i], note: "Accountstatus en KPI-keten; CPL leidt, geen ROAS als hoofdmaat en geen diepe oorzaakclaim over latere domeinen." },
  2: { forbiddenNarrativePatterns: [/specifiek creative|demografie|ICP-segment/i], note: "Campaign groups, budget en pacing; geen creative- of demografie-root-cause als hoofdclaim." },
  3: { forbiddenNarrativePatterns: [/specifiek creative|demografie-segment/i], note: "Campagne versus accountgemiddelde; geen specifieke creative- of segment-oorzaak als hoofdclaim." },
  4: { forbiddenNarrativePatterns: [/demografie-root|ICP-root|frequency per creative/i], note: "Kwantitatieve creative-metrics per format; tijdsverval is de slijtage-proxy, geen frequency per creative." },
  5: { forbiddenNarrativePatterns: [/zonder ICP-definitie|gereconstrueerd segment/i], note: "Demografie en ICP-fit; geen leadkwaliteit-claim zonder ICP of CRM, geen onderdrukte segmenten reconstrueren." },
  6: { forbiddenNarrativePatterns: [/bewezen oorzaak|definitief door/i], note: "Funnel per fase; benoem drop-off-oorzaken als mogelijke verklaring, niet als bewijs." },
  7: { forbiddenNarrativePatterns: [/creative-slijtage|kleur|compositie/i], note: "Audience-omvang en verzadiging; geen creative-oorzaak (stap 4)." },
  8: { forbiddenNarrativePatterns: [/doelgroep-root|creative-root/i], note: "Bidding en pacing; geen doelgroep- of creative-oorzaak als hoofdclaim." },
  9: { forbiddenNarrativePatterns: [/nieuw cijfer|nieuwe metric die/i], note: "Synthese uit eerdere stappen; geen nieuwe cijfers verzinnen, impact-claims gegrond." },
};

// Benchmarks per accounttype als richtwaarden. LinkedIn is leadgen B2B-georienteerd; CPL leidt.
const LINKEDIN_BENCHMARKS: Record<AccountType, string> = {
  ecommerce_roas: "LinkedIn-benchmarks (richtwaarden): LinkedIn is leadgen-georienteerd, dus CPL leidt tenzij conversiewaarde echt aanwezig is; gebruik ROAS niet als hoofdmaat. CTR single image 0,4 tot 0,65%, document ads hoger, form completion 10 tot 15%, video view rate circa 30%. CPC en CPL zijn markt-contextueel; rapporteer altijd tegen de eigen historie.",
  ecommerce_cpa: "LinkedIn-benchmarks (richtwaarden): CPL leidt; conversiewaarde alleen als die echt aanwezig is. CTR single image 0,4 tot 0,65%, form completion 10 tot 15%, video view rate circa 30%. Rapporteer CPC en CPL tegen de eigen historie, niet tegen een absolute norm.",
  leadgen_cpa: "LinkedIn-benchmarks (richtwaarden, leadgen B2B): CTR single image 0,4 tot 0,65%, document ads hoger, form completion 10 tot 15%, video view rate circa 30%. CPC en CPL zijn markt-contextueel; rapporteer altijd tegen de eigen historie. CPL afmeten tegen de target uit client_settings.",
  leadgen_volume: "LinkedIn-benchmarks (richtwaarden, leadgen volume): CTR single image 0,4 tot 0,65%, form completion 10 tot 15%. Bewaak leadvolume versus het CPL-plafond en verzadiging bij opschalen; rapporteer tegen de eigen historie.",
  hybrid: "LinkedIn-benchmarks (richtwaarden, hybride): weeg CPL en, alleen indien echt aanwezig, conversiewaarde tegen de doelstelling die in client_settings primair is. CTR single image 0,4 tot 0,65%, form completion 10 tot 15%. Rapporteer tegen de eigen historie.",
};

// De issue_cluster-lijst voor LinkedIn, conform de L2-spec.
const LINKEDIN_ISSUE_CLUSTERS: readonly string[] = [
  "cpl_inflation", "lead_quality_mismatch", "icp_waste", "audience_too_narrow", "audience_saturation",
  "form_dropoff", "creative_fatigue", "creative_winner", "format_gap", "budget_pacing_issue",
  "bidding_inefficiency", "audience_network_leakage", "scaling_opportunity", "performance_winner",
  "efficiency_gain", "volume_shortfall", "uncategorized",
];

// De entity_type-lijst voor LinkedIn, met de demografie-pivots als eersteklas entiteiten.
const LINKEDIN_ENTITY_TYPES: readonly string[] = [
  "account", "campaign_group", "campaign", "creative", "audience", "format",
  "job_function", "seniority", "industry", "company_size", "region", "country",
];

// LinkedIn-specifieke aliases voor canonicalisatie.
const LINKEDIN_METRIC_ALIASES: Array<[RegExp, string]> = [
  [/\b(cpl|cost ?per ?lead|kosten ?per ?lead)\b/i, "CPL"],
  [/\b(form ?completion ?rate|formulier ?voltooiing)\b/i, "Form completion rate"],
  [/\b(form ?opens?|formulier ?openingen)\b/i, "Form opens"],
  [/\b(open ?rate)\b/i, "Open rate"],
  [/\b(leads?|aanvragen)\b/i, "Leads"],
  [/\b(ctr|click[- ]?through ?rate)\b/i, "CTR"],
  [/\b(cpc|cost ?per ?click)\b/i, "CPC"],
  [/\b(cpm|cost ?per ?mille)\b/i, "CPM"],
];

const LINKEDIN_ENTITY_ALIASES: Array<[RegExp, string]> = [
  [/\b(campaign ?group|campagnegroep)\b/i, "campaign_group"],
  [/\b(campagne|campaign)\b/i, "campaign"],
  [/\b(creative|advertentie|ad)\b/i, "creative"],
  [/\b(doelgroep|audience|matched ?audience)\b/i, "audience"],
  [/\b(functie|job ?function)\b/i, "job_function"],
  [/\b(senioriteit|seniority)\b/i, "seniority"],
  [/\b(industrie|industry|sector)\b/i, "industry"],
  [/\b(bedrijfsgrootte|company ?size|staff ?count)\b/i, "company_size"],
];

export const linkedinAdsAdapter: ChannelAdapter = {
  channel: "linkedin_ads",
  sopTypeKey: "linkedin_monthly",
  stepCount: 9,
  benchmarks: LINKEDIN_BENCHMARKS,
  issueClusters: LINKEDIN_ISSUE_CLUSTERS,
  entityTypes: LINKEDIN_ENTITY_TYPES,
  stepInstructions: LINKEDIN_STEP_INSTRUCTIONS,
  logFormats: LINKEDIN_LOG_FORMATS,
  purityContracts: LINKEDIN_PURITY_CONTRACTS,
  logFormatSkeletons: LINKEDIN_LOG_FORMAT_SKELETONS,
  purityRules: LINKEDIN_PURITY_RULES,
  metricAliases: LINKEDIN_METRIC_ALIASES,
  entityAliases: LINKEDIN_ENTITY_ALIASES,
};

registerAdapter(linkedinAdsAdapter);
