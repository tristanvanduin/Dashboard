/**
 * Campaign type definitions, purpose detection, and evaluation criteria.
 *
 * Every campaign has a `purpose` that determines how it should be
 * analyzed and what actions make sense:
 *
 *   brand       – Merkbescherming. Nooit opschalen.
 *   generic     – Groeimotor. Hier schaal je.
 *   category    – Product/dienst-specifiek segment.
 *   shopping    – Productfeed campagne (mix brand/non-brand).
 *   pmax        – Performance Max (mixed, moeilijk te sturen).
 *   remarketing – Retargeting warm publiek.
 *   awareness   – Top-of-funnel bereik (Video/Display).
 *   competitor  – Bieden op concurrent-merknamen.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The strategic purpose of a campaign. Determines how it should be analyzed,
 * what benchmarks apply, and what actions are appropriate.
 */
export type CampaignPurpose =
  | "brand"       // Merkbescherming — nooit opschalen
  | "generic"     // Groeimotor — hier schaal je
  | "category"    // Product/dienst-specifiek segment
  | "shopping"    // Productfeed campagne (mix brand/non-brand)
  | "pmax"        // Performance Max (mixed, moeilijk te sturen)
  | "remarketing" // Retargeting warm publiek
  | "awareness"   // Top-of-funnel bereik (Video/Display)
  | "competitor"; // Bieden op concurrent-merknamen

/** Whether a campaign is suitable for budget scaling */
export function isScalable(purpose: CampaignPurpose): boolean {
  return purpose === "generic" || purpose === "category" || purpose === "shopping";
}

/** Whether ROAS is a meaningful metric for this campaign purpose */
export function isRoasRelevant(purpose: CampaignPurpose): boolean {
  return purpose !== "awareness" && purpose !== "competitor";
}

/** Whether this campaign is expected to have high ROAS by nature (not because of skill) */
export function hasNaturallyHighRoas(purpose: CampaignPurpose): boolean {
  return purpose === "brand" || purpose === "remarketing";
}

/** Human-readable label for a campaign purpose */
export const PURPOSE_LABELS: Record<CampaignPurpose, string> = {
  brand: "Merkbescherming",
  generic: "Groei (non-brand)",
  category: "Categorie/Dienst",
  shopping: "Shopping",
  pmax: "Performance Max",
  remarketing: "Remarketing",
  awareness: "Awareness",
  competitor: "Concurrent",
};

// ── Comprehensive evaluation framework per campaign purpose ──────────────

export interface EvalCriterion {
  metric: string;
  label: string;
  /** Why this matters for this campaign purpose */
  why: string;
  direction: "higher_better" | "lower_better" | "range";
  /** Can we calculate this from the data we have? */
  available: boolean;
  /** Description of what to check manually in Google Ads */
  checkInAds?: string;
}

/**
 * Complete evaluation criteria per campaign purpose.
 * This is the heart of the analysis — the more criteria, the more insights.
 */
export const PURPOSE_EVAL_CRITERIA: Record<CampaignPurpose, EvalCriterion[]> = {
  brand: [
    { metric: "impression_share", label: "Impression Share", why: "Verlies je branded zoekopdrachten aan concurrenten? Moet >90% zijn.", direction: "higher_better", available: false, checkInAds: "Kolommen → Concurrentiemetrics → Imp. Share" },
    { metric: "impression_share_lost_budget", label: "IS Lost (Budget)", why: "Als je branded IS verliest door budget is dat direct actie — verhoog budget.", direction: "lower_better", available: false, checkInAds: "Kolommen → Concurrentiemetrics → IS Lost (Budget)" },
    { metric: "impression_share_lost_rank", label: "IS Lost (Rank)", why: "IS verlies door rank = Quality Score of bod probleem op eigen merknaam.", direction: "lower_better", available: false, checkInAds: "Kolommen → Concurrentiemetrics → IS Lost (Rank)" },
    { metric: "absolute_top_is", label: "Abs. Top Impression Rate", why: "Op je eigen merknaam wil je positie 1 — moet >80% zijn.", direction: "higher_better", available: false, checkInAds: "Kolommen → Concurrentiemetrics → Abs. Top IS" },
    { metric: "ctr", label: "CTR", why: "Brand CTR moet hoog zijn (>8%). Daling = advertentietekst verouderd of concurrenten bieden op je merk.", direction: "higher_better", available: true },
    { metric: "cpc_trend", label: "CPC Trend", why: "Stijgende CPC op branded = concurrenten bieden op je merk of Quality Score daalt.", direction: "lower_better", available: true },
    { metric: "conversion_rate", label: "Conversieratio", why: "Brand bezoekers kennen je al — conversieratio moet hoog zijn (>5%). Daling = landingspagina of aanbod probleem.", direction: "higher_better", available: true },
    { metric: "cpa", label: "CPA", why: "Brand CPA moet het laagst zijn van alle campagnes. Als niet → iets is mis.", direction: "lower_better", available: true },
    { metric: "conv_trend", label: "Conversie Trend", why: "Dalende branded conversies = minder merkbekendheid of PMax steelt traffic.", direction: "higher_better", available: true },
    { metric: "auction_insights", label: "Auction Insights", why: "Welke concurrenten bieden op je merknaam? Overlap rate en IS van concurrenten.", direction: "lower_better", available: false, checkInAds: "Campagne → Auction Insights → Overlap Rate" },
  ],
  generic: [
    { metric: "roas", label: "ROAS", why: "Primaire KPI — rendement van non-brand spend. Vergelijk met target en andere generic campagnes.", direction: "higher_better", available: true },
    { metric: "cpa", label: "CPA", why: "Kosten per acquisitie. Moet binnen target liggen. Te hoog = slechte zoektermen of lage conversieratio.", direction: "lower_better", available: true },
    { metric: "conversion_rate", label: "Conversieratio", why: "Effectiviteit van clicks. Daling = landingspagina-issue, verkeerde doelgroep, of slechte zoektermen.", direction: "higher_better", available: true },
    { metric: "ctr", label: "CTR", why: "Relevantie-indicator. Te laag (<2%) = advertentietekst matcht niet met zoekintentie.", direction: "higher_better", available: true },
    { metric: "cpc_trend", label: "CPC Trend", why: "Stijgende CPC zonder hogere conversieratio = verslechterende efficiency.", direction: "lower_better", available: true },
    { metric: "conv_trend", label: "Conversie Trend", why: "MoM ontwikkeling. Daling = marktverandering, concurrentie, of optimalisatiefout.", direction: "higher_better", available: true },
    { metric: "impression_share_lost_budget", label: "IS Lost (Budget)", why: "Als je IS verliest door budget op goede generic campagnes = directe groeikans.", direction: "lower_better", available: false, checkInAds: "Kolommen → Concurrentiemetrics → IS Lost (Budget)" },
    { metric: "impression_share_lost_rank", label: "IS Lost (Rank)", why: "IS verlies door rank = Quality Score verbeteren of bod verhogen.", direction: "lower_better", available: false, checkInAds: "Kolommen → Concurrentiemetrics → IS Lost (Rank)" },
    { metric: "quality_score", label: "Quality Score", why: "QS <6 = te hoge CPC. Check subfactoren: verwachte CTR, advertentierelevantie, landingspagina-ervaring.", direction: "higher_better", available: false, checkInAds: "Keywords → Kolommen → Quality Score + subfactoren" },
    { metric: "search_term_quality", label: "Zoektermkwaliteit", why: "% irrelevante zoektermen. Te veel = geld verspilling. Wekelijks checken.", direction: "higher_better", available: false, checkInAds: "Campagne → Zoektermen → Filteren op hoge kosten / lage conversies" },
    { metric: "volume_trend", label: "Impressie Volume", why: "Dalende impressies = markt krimpt, budget te laag, of zoekwoorden te restrictief.", direction: "higher_better", available: true },
  ],
  category: [
    { metric: "roas", label: "ROAS", why: "Vergelijk ROAS met andere categorie-campagnes — welke verdient meer budget?", direction: "higher_better", available: true },
    { metric: "cpa", label: "CPA", why: "Vergelijk CPA over categorieën heen. Hogere CPA kan OK zijn als conversiewaarde hoger is.", direction: "lower_better", available: true },
    { metric: "conversion_rate", label: "Conversieratio", why: "Categorie-specifieke landingspagina effectiviteit. Vergelijk met andere categorieën.", direction: "higher_better", available: true },
    { metric: "ctr", label: "CTR", why: "Relevantie van ads voor dit segment. Laag = advertentietekst past niet bij zoekintentie.", direction: "higher_better", available: true },
    { metric: "cpc_trend", label: "CPC Trend", why: "Marktdruk op dit segment. Stijging = meer concurrentie in deze categorie.", direction: "lower_better", available: true },
    { metric: "conv_trend", label: "Conversie Trend", why: "Seizoenseffect of structureel? Vergelijk met vorig jaar voor seizoenscorrectie.", direction: "higher_better", available: true },
    { metric: "volume_share", label: "Volume vs Andere Categorieën", why: "Draagt deze categorie genoeg bij? Is het segment groot genoeg om te investeren?", direction: "higher_better", available: true },
    { metric: "search_term_quality", label: "Zoektermkwaliteit", why: "Relevantie van zoektermen voor dit specifieke segment.", direction: "higher_better", available: false, checkInAds: "Zoektermen rapport filteren op deze campagne" },
    { metric: "quality_score", label: "Quality Score", why: "Categorie-specifieke relevantie. Landingspagina moet matchen met de categorie.", direction: "higher_better", available: false, checkInAds: "Keywords → Quality Score" },
  ],
  shopping: [
    { metric: "roas", label: "ROAS", why: "Rendement per product. Vergelijk met target. Shopping ROAS vaak hoger dan generic door koopintentie.", direction: "higher_better", available: true },
    { metric: "cpa", label: "CPA", why: "Kosten per aankoop. Vergelijk met gemiddelde orderwaarde voor winstgevendheid.", direction: "lower_better", available: true },
    { metric: "ctr", label: "CTR", why: "Feed kwaliteit indicator. Lage CTR = slechte productafbeeldingen, titels, of prijzen.", direction: "higher_better", available: true },
    { metric: "conversion_rate", label: "Conversieratio", why: "Prijs-competitiviteit en productpagina kwaliteit. Laag = te duur of slechte PDP.", direction: "higher_better", available: true },
    { metric: "cpc_trend", label: "CPC Trend", why: "Concurrentiedruk in shopping. Stijging = meer adverteerders of hogere biedingen.", direction: "lower_better", available: true },
    { metric: "conv_trend", label: "Conversie Trend", why: "Product performance over tijd. Seizoen? Voorraadprobleem? Prijs verandering?", direction: "higher_better", available: true },
    { metric: "brand_nonbrand_split", label: "Brand/Non-brand Split", why: "Shopping vangt ook branded zoektermen. Check % branded traffic — dat moet via brand campagne.", direction: "range", available: false, checkInAds: "Zoektermrapport → Filter op merknaam → % branded" },
    { metric: "product_coverage", label: "Productdekking", why: "Hoeveel % producten krijgt impressies? 0-click producten = feed probleem.", direction: "higher_better", available: false, checkInAds: "Producten tab → Filter op 0 clicks" },
    { metric: "feed_quality", label: "Feed Kwaliteit", why: "Disapprovals, waarschuwingen, ontbrekende attributen verlagen zichtbaarheid.", direction: "higher_better", available: false, checkInAds: "Merchant Center → Diagnostics" },
    { metric: "click_share", label: "Click Share", why: "Hoeveel % van beschikbare clicks pak je? Lager = ruimte voor groei.", direction: "higher_better", available: false, checkInAds: "Kolommen → Concurrentiemetrics → Click Share" },
    { metric: "benchmark_cpc", label: "Benchmark CPC", why: "Je CPC vs marktgemiddelde. Hoger = te agressief bieden of lage feed kwaliteit.", direction: "range", available: false, checkInAds: "Products tab → Benchmark columns" },
  ],
  pmax: [
    { metric: "roas", label: "ROAS (met kanttekening)", why: "PMax ROAS is misleidend — bevat vaak branded traffic. Echte ROAS is lager.", direction: "higher_better", available: true },
    { metric: "conv_trend", label: "Conversie Trend", why: "Dalend = Google's algoritme vindt minder goede doelgroepen, of budget te laag.", direction: "higher_better", available: true },
    { metric: "cpa", label: "CPA", why: "Vergelijk met andere campagnes. PMax CPA moet competitief zijn met generic.", direction: "lower_better", available: true },
    { metric: "brand_cannibalization", label: "Brand Kannibalisatie", why: "PMax steelt vaak branded zoekverkeer → ROAS lijkt goed maar is niet incrementeel.", direction: "lower_better", available: false, checkInAds: "Insights → Search Term Insights → % branded" },
    { metric: "asset_group_perf", label: "Asset Group Performance", why: "Welke asset groups presteren? Slechte assets = slechte plaatsingen.", direction: "higher_better", available: false, checkInAds: "Asset Groups → Performance rating" },
    { metric: "network_split", label: "Netwerk Verdeling", why: "Hoeveel gaat naar Search vs Display vs YouTube? Te veel Display = slecht.", direction: "range", available: false, checkInAds: "Insights → Placements report" },
    { metric: "new_vs_returning", label: "Nieuw vs Terugkerend", why: "PMax moet nieuwe klanten aantrekken. Te veel returning = overlap met remarketing.", direction: "higher_better", available: false, checkInAds: "Reporting → New vs Returning customers" },
    { metric: "audience_signals", label: "Doelgroep Signalen", why: "Zijn je audience signals effectief? Check welke signalen converteren.", direction: "higher_better", available: false, checkInAds: "Asset Groups → Audience Signals → Performance" },
    { metric: "ctr", label: "CTR (per netwerk)", why: "Gemiddelde CTR is misleidend door netwerk-mix. Search CTR moet hoog zijn.", direction: "higher_better", available: true },
    { metric: "cpc_trend", label: "CPC Trend", why: "Stijgende CPC = Google vergroot bereik naar duurdere plaatsingen.", direction: "lower_better", available: true },
    { metric: "conversion_rate", label: "Conversieratio", why: "Dalende conv. rate = PMax target steeds bredere doelgroepen met lagere intentie.", direction: "higher_better", available: true },
  ],
  remarketing: [
    { metric: "conversion_rate", label: "Conversieratio", why: "Remarketing moet hogere conv. rate hebben dan prospecting. Als niet → lijsten zijn te breed.", direction: "higher_better", available: true },
    { metric: "cpa", label: "CPA", why: "Remarketing CPA moet lager zijn dan acquisitie. Hoger = te brede doelgroep of ad fatigue.", direction: "lower_better", available: true },
    { metric: "ctr", label: "CTR", why: "Dalende CTR = ad fatigue. Mensen zijn je ads moe. Tijd voor creative refresh.", direction: "higher_better", available: true },
    { metric: "ctr_trend", label: "CTR Trend", why: "Dalende trend over weken = duidelijk teken van ad fatigue. Ververs creatives.", direction: "higher_better", available: true },
    { metric: "frequency", label: "Frequentie", why: "Ideaal: 3-5x per maand. >7x = irritatie en merksschade. <2x = te weinig.", direction: "range", available: false, checkInAds: "Kolommen → Reach metrics → Avg. Freq." },
    { metric: "view_through", label: "View-through vs Click-through", why: "Te veel view-through = zwakke attributie. Betrouwbaarder als click-through domineert.", direction: "range", available: false, checkInAds: "Kolommen → Conversies → View-through conversions" },
    { metric: "overlap", label: "Campagne Overlap", why: "Remarketing mag niet converteren wat andere campagnes al zouden vangen.", direction: "lower_better", available: false, checkInAds: "Insights → Campagne overlap rapport" },
    { metric: "list_size_trend", label: "Lijst Grootte", why: "Krimpende lijsten = minder verkeer naar site. Groeiende = meer prospecting werkt.", direction: "higher_better", available: false, checkInAds: "Audience Manager → Doelgroep grootte" },
    { metric: "conv_trend", label: "Conversie Trend", why: "Dalend = lijsten uitgeput of creatives verouderd.", direction: "higher_better", available: true },
    { metric: "roas", label: "ROAS", why: "Remarketing ROAS is altijd hoog maar deels geïnfleerd. Vergelijk met incrementaliteit.", direction: "higher_better", available: true },
  ],
  awareness: [
    { metric: "cpm", label: "CPM", why: "Kosten per 1000 vertoningen. Primaire efficiency metric. Vergelijk met benchmark.", direction: "lower_better", available: true },
    { metric: "reach", label: "Bereik / Impressies", why: "Hoeveel unieke mensen bereikt? Stijgend = campagne schaalt. Dalend = doelgroep uitgeput.", direction: "higher_better", available: true },
    { metric: "ctr", label: "CTR", why: "Engagement met de ad. <0.5% Display = creative werkt niet. Video: kijk naar view rate.", direction: "higher_better", available: true },
    { metric: "ctr_trend", label: "CTR Trend", why: "Dalende CTR = creative vermoeidheid. Tijd voor nieuwe visuals/video.", direction: "higher_better", available: true },
    { metric: "frequency", label: "Frequentie", why: "1-3x ideaal voor awareness. >5x = geldverspilling en irritatie. >8x = stop.", direction: "range", available: false, checkInAds: "Reach metrics → Avg. Impression Frequency" },
    { metric: "view_rate", label: "View Rate (Video)", why: "% dat >30s of volledig kijkt. <15% = video is niet boeiend genoeg. >25% = goed.", direction: "higher_better", available: false, checkInAds: "Video campaigns → View rate" },
    { metric: "cost_per_view", label: "Kosten per View (Video)", why: "Efficiency van video views. Vergelijk met benchmark voor je branche.", direction: "lower_better", available: false, checkInAds: "Video campaigns → CPV" },
    { metric: "audience_penetration", label: "Doelgroep Penetratie", why: "Bereik je het gewenste % van je doelgroep? Te laag = budget verhogen.", direction: "higher_better", available: false, checkInAds: "Reach Planner of Audience insights" },
    { metric: "brand_lift", label: "Brand Lift", why: "Directe meting of awareness campagne merkbekendheid verhoogt. Gouden standaard.", direction: "higher_better", available: false, checkInAds: "Brand Lift experiment (indien actief)" },
    { metric: "assisted_conversions", label: "Geassisteerde Conversies", why: "Draagt awareness bij aan conversies in andere campagnes? Check assisted conv.", direction: "higher_better", available: false, checkInAds: "Attribution → Assisted Conversions" },
    { metric: "conv_trend", label: "Volume Trend", why: "Niet conversies zelf, maar impressie/bereik trend over tijd.", direction: "higher_better", available: true },
  ],
  competitor: [
    { metric: "ctr", label: "CTR", why: "Competitor CTR is altijd lager dan eigen brand (<3% is normaal). Maar te laag (<1%) = beter stoppen.", direction: "higher_better", available: true },
    { metric: "cpc_trend", label: "CPC Trend", why: "Concurrent-CPC is hoog door lage QS. Stijgend = concurrent verdedigt actiever.", direction: "lower_better", available: true },
    { metric: "conversion_rate", label: "Conversieratio", why: "Lager dan generic is verwacht. Maar als <1% → ROI is er niet.", direction: "higher_better", available: true },
    { metric: "cpa", label: "CPA", why: "Altijd hoger dan brand/generic. Maar vergelijk met customer lifetime value.", direction: "lower_better", available: true },
    { metric: "roas", label: "ROAS", why: "Vaak laag maar kan strategisch waardevol zijn. <0.5 = heroverweeg.", direction: "higher_better", available: true },
    { metric: "impression_share", label: "Impression Share", why: "Hoeveel van concurrent's zoekverkeer vang je? Lager = weinig zichtbaarheid.", direction: "higher_better", available: false, checkInAds: "Auction Insights → IS op concurrent termen" },
    { metric: "quality_score", label: "Quality Score", why: "Op concurrent termen altijd laag (3-5). <3 = Google straft je, CPC schiet omhoog.", direction: "higher_better", available: false, checkInAds: "Keywords → Quality Score" },
    { metric: "strategic_value", label: "Strategische Waarde", why: "Weeg kosten af tegen merkbekendheid bij concurrent-publiek. Is het de investering waard?", direction: "higher_better", available: false },
    { metric: "conv_trend", label: "Conversie Trend", why: "Daling = concurrent verbetert hun eigen positie/aanbod.", direction: "higher_better", available: true },
  ],
};

/** Shorthand: get the primary focus areas for a purpose */
export function getPurposeFocus(purpose: CampaignPurpose): string {
  const criteria = PURPOSE_EVAL_CRITERIA[purpose];
  return criteria
    .filter((c) => c.available)
    .slice(0, 4)
    .map((c) => c.label)
    .join(", ");
}

export interface CampaignMonthlyMetrics {
  month: number; // 1-12
  conversions: number;
  revenue: number;
  adSpend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  roas: number;
  cpa: number;
}

export interface CampaignData {
  campaignId: string;
  campaignName: string;
  campaignType: "Search" | "Shopping" | "PMax" | "Display" | "Video";
  purpose: CampaignPurpose;
  status: "ENABLED" | "PAUSED";
  monthly: CampaignMonthlyMetrics[];
}

export interface ClientCampaignData {
  clientId: string;
  campaigns: CampaignData[];
}

/**
 * Detect campaign purpose from campaign name and type.
 * Works with real API data (Google Ads / Meta).
 *
 * Detection rules (order matters — first match wins):
 * 1. Name contains "Brand" (but NOT "Non-Brand") → brand
 * 2. Name contains "Remarketing" or "Retargeting" → remarketing
 * 3. Name contains "Concurrent" or "Competitor" → competitor
 * 4. Type is Video or name contains "Awareness" → awareness
 * 5. Type is PMax → pmax
 * 6. Type is Shopping → shopping
 * 7. Name contains "Generic" → generic
 * 8. Otherwise Search → category (specific product/service campaign)
 */
export function detectCampaignPurpose(
  name: string,
  type: CampaignData["campaignType"],
): CampaignPurpose {
  const lower = name.toLowerCase();

  // "Non-Brand" / "Nonbrand" must NOT match as brand
  const isNonBrand = /non[\s-]?brand/i.test(lower);
  if (lower.includes("brand") && !isNonBrand) return "brand";
  if (lower.includes("remarketing") || lower.includes("retargeting")) return "remarketing";
  if (lower.includes("concurrent") || lower.includes("competitor")) return "competitor";
  if (type === "Video" || lower.includes("awareness")) return "awareness";
  if (type === "PMax") return "pmax";
  if (type === "Shopping") return "shopping";
  if (lower.includes("generic")) return "generic";

  // Search campaigns without "Brand" or "Generic" → category-specific
  return "category";
}
