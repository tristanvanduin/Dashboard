/**
 * Second Opinion audit template — source of truth for all checklist rows.
 *
 * Derived from the Ranking Masters Second Opinion Template spreadsheet.
 * Two modes:
 *   - "quick" = shortlist (10 Low Hanging Fruit items)
 *   - "full"  = longlist  (all 45 items across 9 categories)
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type AuditSection =
  | "Website"
  | "Aanbod"
  | "Tracking"
  | "Bieding / Budget"
  | "Search"
  | "PMAX"
  | "Shopping"
  | "Remarketing"
  | "Settings";

export type Impact = "Hoog" | "Midden" | "Laag";
export type Complexity = "Simpel" | "Midden" | "Complex";
export type AuditMode = "quick" | "full";

export type SupportStatus =
  | "supported"       // can be evaluated with available data
  | "partial"         // some data available, needs interpretation
  | "unsupported";    // no data — manual review or clearly marked

export interface TemplateRow {
  id: number;
  section: AuditSection;
  controlPoint: string;
  impact: Impact;
  complexity: Complexity;
  isShortlist: boolean;
  supportStatus: SupportStatus;
  /** Which data sources this check needs */
  dataSources: string[];
}

// ── Template definition ────────────────────────────────────────────────────

export const AUDIT_TEMPLATE: TemplateRow[] = [
  // ── Website (6 items) — all unsupported (no crawl data) ──
  { id: 1,  section: "Website", controlPoint: "Heeft de website een goede navigatie?", impact: "Hoog", complexity: "Complex", isShortlist: false, supportStatus: "unsupported", dataSources: [] },
  { id: 2,  section: "Website", controlPoint: "Heeft de website zichtbare vertrouwenselementen?", impact: "Hoog", complexity: "Simpel", isShortlist: false, supportStatus: "unsupported", dataSources: [] },
  { id: 3,  section: "Website", controlPoint: "Is het proces naar de primaire CTA frictieloos?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "unsupported", dataSources: [] },
  { id: 4,  section: "Website", controlPoint: "Zijn CTA's duidelijk gedefinieerd en is er een primaire CTA?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "unsupported", dataSources: [] },
  { id: 5,  section: "Website", controlPoint: "Bevat de PDP / LP voldoende informatie? Is deze conversiegericht en gebruiksvriendelijk?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "unsupported", dataSources: [] },
  { id: 6,  section: "Website", controlPoint: "Is de PLP overzichtelijk, conversiegericht en gebruiksvriendelijk?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "unsupported", dataSources: [] },

  // ── Aanbod (2 items) — unsupported (no competitor data) ──
  { id: 7,  section: "Aanbod", controlPoint: "Zijn de USP's differentiërend t.o.v. concurrenten?", impact: "Hoog", complexity: "Complex", isShortlist: false, supportStatus: "unsupported", dataSources: [] },
  { id: 8,  section: "Aanbod", controlPoint: "Zijn er USP's gedefinieerd?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "unsupported", dataSources: [] },

  // ── Tracking (2 items) ──
  { id: 9,  section: "Tracking", controlPoint: "Worden de belangrijkste conversies gebruikt voor bodoptimalisatie en rapportage (primair) en minder belangrijke conversieacties voor observatie (secundair)?", impact: "Hoog", complexity: "Midden", isShortlist: true, supportStatus: "supported", dataSources: ["client_settings.conversion_actions"] },
  { id: 10, section: "Tracking", controlPoint: "Zijn alle belangrijke conversieacties geconfigureerd en werken deze naar behoren?", impact: "Hoog", complexity: "Complex", isShortlist: false, supportStatus: "partial", dataSources: ["client_settings.conversion_actions", "ads_account_monthly"] },

  // ── Bieding / Budget (2 items) ──
  { id: 11, section: "Bieding / Budget", controlPoint: "Zijn de gebruikte biedstrategieën logisch op basis van gestelde doelen en conversie volume?", impact: "Hoog", complexity: "Midden", isShortlist: true, supportStatus: "supported", dataSources: ["ads_campaign_metadata", "client_settings.kpi_targets"] },
  { id: 12, section: "Bieding / Budget", controlPoint: "Is het budget toereikend in relatie tot de doelstellingen en is er een limitatie wegens budget?", impact: "Midden", complexity: "Midden", isShortlist: false, supportStatus: "supported", dataSources: ["ads_campaign_impression_share", "ads_campaign_metadata", "client_settings.kpi_targets"] },

  // ── Search (8 items) ──
  { id: 13, section: "Search", controlPoint: "Zijn de zoekwoorden logisch en is de matchtype logisch?", impact: "Hoog", complexity: "Midden", isShortlist: true, supportStatus: "supported", dataSources: ["ads_keyword_performance_monthly"] },
  { id: 14, section: "Search", controlPoint: "Zijn zoekwoorden logisch gesegmenteerd / geconsolideerd?", impact: "Hoog", complexity: "Complex", isShortlist: true, supportStatus: "partial", dataSources: ["ads_keyword_performance_monthly"] },
  { id: 15, section: "Search", controlPoint: "Is er een DSA en is deze correct / logisch opgezet?", impact: "Hoog", complexity: "Midden", isShortlist: true, supportStatus: "supported", dataSources: ["ads_campaign_metadata"] },
  { id: 16, section: "Search", controlPoint: "Zijn de correcte campagnedoelen ingesteld?", impact: "Hoog", complexity: "Simpel", isShortlist: false, supportStatus: "supported", dataSources: ["ads_campaign_metadata"] },
  { id: 17, section: "Search", controlPoint: "Worden zoekpartners / Display netwerken gebruikt? - prestaties?", impact: "Laag", complexity: "Simpel", isShortlist: false, supportStatus: "supported", dataSources: ["ads_network_performance_monthly"] },
  { id: 18, section: "Search", controlPoint: "Zijn er negatives toegevoegd en zijn deze georganiseerd?", impact: "Midden", complexity: "Midden", isShortlist: false, supportStatus: "partial", dataSources: ["ads_search_terms_monthly"] },
  { id: 19, section: "Search", controlPoint: "Hoe is de kwaliteitsscore en welke verbeterpunten zijn hier te identificeren?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "partial", dataSources: ["ads_keyword_performance_monthly"] },
  { id: 20, section: "Search", controlPoint: "Zijn de RSA's compleet en wordt er getest met 'CTR Boosters'?", impact: "Midden", complexity: "Midden", isShortlist: false, supportStatus: "supported", dataSources: ["ads_creative_performance"] },

  // ── PMAX (6 items) ──
  { id: 21, section: "PMAX", controlPoint: "Zijn de juiste campagnedoelen geselecteerd in de Performance Max campagnes en is de data-input correct?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "partial", dataSources: ["ads_campaign_metadata"] },
  { id: 22, section: "PMAX", controlPoint: "Wordt de uiteindelijke URL uitbreiding gebruikt? En zijn alle irrelevante URL's uitgesloten?", impact: "Midden", complexity: "Midden", isShortlist: false, supportStatus: "supported", dataSources: ["campaign.url_expansion_opt_out"] },
  { id: 23, section: "PMAX", controlPoint: "Zijn alle branded zoektermen uitgesloten (via Google Support)? Zo ja, is er een branded standard shopping campagne om zichtbaarheid op Google Shopping te garanderen?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "partial", dataSources: ["ads_campaign_metadata", "ads_search_terms_monthly"] },
  { id: 24, section: "PMAX", controlPoint: "Worden Audience signals correct en optimaal ingezet?", impact: "Hoog", complexity: "Complex", isShortlist: false, supportStatus: "partial", dataSources: ["asset_group_signal"] },
  { id: 25, section: "PMAX", controlPoint: "Zijn assets toegevoegd en geoptimaliseerd? (indien van toepassing)", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "partial", dataSources: ["ads_asset_group_performance_monthly"] },
  { id: 26, section: "PMAX", controlPoint: "Worden producten optimaal gevoed en hoe is de performance verdeling van producten? (indien van toepassing)", impact: "Hoog", complexity: "Complex", isShortlist: false, supportStatus: "supported", dataSources: ["ads_product_performance_monthly"] },

  // ── Shopping (7 items) ──
  { id: 27, section: "Shopping", controlPoint: "Draait er ook een PMAX? Is er kannibalisatie? Is er grond voor overstap naar PMAX?", impact: "Hoog", complexity: "Complex", isShortlist: false, supportStatus: "supported", dataSources: ["ads_campaign_metadata", "ads_campaign_monthly"] },
  { id: 28, section: "Shopping", controlPoint: "Zijn de juiste campagnedoelen geselecteerd in de Shopping campagnes en is de data-input correct?", impact: "Hoog", complexity: "Simpel", isShortlist: false, supportStatus: "partial", dataSources: ["ads_campaign_metadata"] },
  { id: 29, section: "Shopping", controlPoint: "Zijn er actieve product filters? Bevordert of hindert dit de prestaties?", impact: "Hoog", complexity: "Simpel", isShortlist: false, supportStatus: "partial", dataSources: ["ads_product_performance_monthly"] },
  { id: 30, section: "Shopping", controlPoint: "Worden negatives toegevoegd en georganiseerd?", impact: "Midden", complexity: "Midden", isShortlist: false, supportStatus: "partial", dataSources: ["ads_search_terms_monthly"] },
  { id: 31, section: "Shopping", controlPoint: "Zijn de campagne prioriteitsinstellingen correct geconfigureerd?", impact: "Midden", complexity: "Complex", isShortlist: false, supportStatus: "supported", dataSources: ["campaign.shopping_setting.campaign_priority"] },
  { id: 32, section: "Shopping", controlPoint: "Worden zoekpartners ingezet? Hoe presteren deze?", impact: "Laag", complexity: "Simpel", isShortlist: false, supportStatus: "supported", dataSources: ["ads_network_performance_monthly"] },
  { id: 33, section: "Shopping", controlPoint: "Worden producten optimaal gevoed en hoe is de performance verdeling van producten? (indien van toepassing)", impact: "Hoog", complexity: "Complex", isShortlist: false, supportStatus: "supported", dataSources: ["ads_product_performance_monthly"] },

  // ── Remarketing (6 items) ──
  { id: 34, section: "Remarketing", controlPoint: "Zijn er actieve remarketing campagnes (Display, Discovery, YouTube)? Zo niet, is het logisch om deze op te zetten?", impact: "Hoog", complexity: "Complex", isShortlist: true, supportStatus: "supported", dataSources: ["ads_campaign_metadata"] },
  { id: 35, section: "Remarketing", controlPoint: "Worden alle relevante remarketing doelgroepen getarget, en zijn deze gesegmenteerd o.b.v. activiteit, intentie, gedrag en tijd?", impact: "Hoog", complexity: "Simpel", isShortlist: false, supportStatus: "partial", dataSources: ["ads_campaign_metadata"] },
  { id: 36, section: "Remarketing", controlPoint: "Worden uitsluitingsplaatsingen actief toegevoegd bij slecht presterende plaatsingen (Display & YouTube)?", impact: "Midden", complexity: "Simpel", isShortlist: false, supportStatus: "partial", dataSources: ["ads_campaign_metadata"] },
  { id: 37, section: "Remarketing", controlPoint: "Is de gekozen biedstrategie logisch voor de campagnes?", impact: "Hoog", complexity: "Simpel", isShortlist: false, supportStatus: "supported", dataSources: ["ads_campaign_metadata"] },
  { id: 38, section: "Remarketing", controlPoint: "Staat geoptimaliseerd targeting uit op advertentiegroep niveau? Als het aanstaat: hoe zijn de resultaten?", impact: "Hoog", complexity: "Simpel", isShortlist: false, supportStatus: "supported", dataSources: ["ad_group.targeting_setting"] },
  { id: 39, section: "Remarketing", controlPoint: "Staat frequentiebeheer op 'laat Google Ads optimaliseren hoe vaak ads worden vertoond'? Zo ja/nee - moet er een frequentielimiet worden ingesteld?", impact: "Laag", complexity: "Simpel", isShortlist: false, supportStatus: "supported", dataSources: ["campaign.frequency_caps"] },

  // ── Settings (6 items) ──
  { id: 40, section: "Settings", controlPoint: "Is de Campagnestructuur logisch en conform Best Practices?", impact: "Hoog", complexity: "Midden", isShortlist: true, supportStatus: "supported", dataSources: ["ads_campaign_metadata"] },
  { id: 41, section: "Settings", controlPoint: "Staan er AAR's aan?", impact: "Hoog", complexity: "Simpel", isShortlist: true, supportStatus: "partial", dataSources: ["manual_check"] },
  { id: 42, section: "Settings", controlPoint: "Zijn er plaatsingen / contentvormen uitgesloten? (irrelevante / gevoelige)", impact: "Midden", complexity: "Simpel", isShortlist: true, supportStatus: "partial", dataSources: ["ads_campaign_metadata"] },
  { id: 43, section: "Settings", controlPoint: "Is de Locatie targeting logisch en correct ingesteld?", impact: "Hoog", complexity: "Simpel", isShortlist: true, supportStatus: "supported", dataSources: ["getCampaignLocationTargets"] },
  { id: 44, section: "Settings", controlPoint: "Zijn alle belangrijke accounts gekoppeld (GA4, GMC, My Business, etc.)?", impact: "Hoog", complexity: "Simpel", isShortlist: false, supportStatus: "partial", dataSources: ["ads_campaign_metadata"] },
  { id: 45, section: "Settings", controlPoint: "Worden gebruikersgegevens verzameld conform AVG/GDPR richtlijnen?", impact: "Hoog", complexity: "Complex", isShortlist: false, supportStatus: "unsupported", dataSources: [] },

  // ── PMAX Intelligence (4 new items) ──
  { id: 46, section: "PMAX", controlPoint: "Is de netwerkverdeling binnen PMAX gezond? (Search vs Display vs Video)", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "supported", dataSources: ["ads_pmax_network_breakdown"] },
  { id: 47, section: "PMAX", controlPoint: "Zijn er asset groups die budget absorberen zonder conversies?", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "supported", dataSources: ["ads_asset_group_performance_monthly"] },
  { id: 48, section: "PMAX", controlPoint: "Is de asset-kwaliteit voldoende? (performance labels, type-dekking)", impact: "Hoog", complexity: "Midden", isShortlist: false, supportStatus: "supported", dataSources: ["ads_pmax_asset_performance"] },
  { id: 49, section: "PMAX", controlPoint: "Zijn er plaatsingen met hoge kosten en lage opbrengst? (placement waste)", impact: "Midden", complexity: "Simpel", isShortlist: false, supportStatus: "supported", dataSources: ["ads_pmax_placements"] },
];

// ── Helpers ────────────────────────────────────────────────────────────────

/** Get the shortlist (10 Low Hanging Fruit items) */
export function getShortlistTemplate(): TemplateRow[] {
  return AUDIT_TEMPLATE.filter((r) => r.isShortlist);
}

/** Get the full longlist (all 45 items) */
export function getLonglistTemplate(): TemplateRow[] {
  return AUDIT_TEMPLATE;
}

/** Get template for a given mode */
export function getTemplateForMode(mode: AuditMode): TemplateRow[] {
  return mode === "quick" ? getShortlistTemplate() : getLonglistTemplate();
}

/** All unique sections in the template */
export const ALL_SECTIONS: AuditSection[] = [
  "Website", "Aanbod", "Tracking", "Bieding / Budget",
  "Search", "PMAX", "Shopping", "Remarketing", "Settings",
];

/** Sections relevant for shortlist mode */
export const SHORTLIST_SECTIONS: AuditSection[] = [
  "Tracking", "Bieding / Budget", "Search", "Remarketing", "Settings",
];
