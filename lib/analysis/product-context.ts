import { detectSearchTermCountries } from "@/lib/countries";
import type {
  EvidenceSource,
  ExclusionSafety,
  ProductClassification,
  RecommendedScope,
  SearchTermVerdict,
} from "@/lib/schema/search-term-schema";

const STOPWORDS = new Set([
  "de", "het", "een", "en", "van", "voor", "met", "op", "in", "te", "bij", "tot", "of", "per", "aan",
  "the", "and", "for", "with", "from", "shop", "online", "best", "set", "rm",
  "maat", "kleur", "klein", "groot", "zwart", "wit", "blauw", "rood", "groen",
]);

const COMMERCIAL_MODIFIERS = [
  "kopen", "bestellen", "prijs", "prijzen", "aanbieding", "sale", "winkel", "shop",
  "online", "goedkoop", "beste", "reviews", "ervaring", "vergelijk", "offerte",
];

const REPAIR_MODIFIERS = [
  "rubber", "vervangen", "onderdeel", "onderdelen", "reparatie", "repareren",
  "service", "klantenservice", "manual", "handleiding", "onderhoud", "garantie",
];

const ACCESSORY_MODIFIERS = [
  "accessoire", "accessoires", "hoes", "filter", "navulling", "deksel",
  "standaard", "beugel", "adapter", "reserve", "spare", "refill",
];

const WRONG_INTENT_MODIFIERS = [
  "gratis", "marktplaats", "tweedehands", "vacature", "jobs", "baan",
];

export interface ProductContextSource {
  productTitles?: string[];
  productTypes?: string[];
  productBrands?: string[];
  customLabels?: string[];
  customAttributes?: string[];
  merchantProducts?: Array<{
    offerId: string;
    title: string;
    brand?: string | null;
    productType?: string | null;
    customLabels?: string[];
    customAttributes?: string[];
    link?: string | null;
  }>;
  keywords?: string[];
  adCopyPhrases?: string[];
  strategicContextText?: string;
  targetedCountries?: string[];
}

export interface ProductContext {
  catalogPhrases: Set<string>;
  catalogTokens: Set<string>;
  catalogCompacts: Set<string>;
  keywordPhrases: Set<string>;
  keywordCompacts: Set<string>;
  sitePhrases: Set<string>;
  siteCompacts: Set<string>;
  strategicPhrases: Set<string>;
  strategicCompacts: Set<string>;
  productTypePhrases: Set<string>;
  productTypeCompacts: Set<string>;
  customLabelPhrases: Set<string>;
  customLabelCompacts: Set<string>;
  customAttributePhrases: Set<string>;
  customAttributeCompacts: Set<string>;
  linkPhrases: Set<string>;
  linkCompacts: Set<string>;
  entityIdsByPhrase: Map<string, Set<string>>;
  entityIdsByToken: Map<string, Set<string>>;
  entityIdsByCompact: Map<string, Set<string>>;
  targetedCountries: string[];
}

export interface ProductTermAssessment {
  productClassification: ProductClassification;
  soldByClient: boolean | "unknown";
  evidenceSource: EvidenceSource;
  evidenceSources: EvidenceSource[];
  recommendedScope: RecommendedScope;
  exclusionSafety: ExclusionSafety;
  matchedContext: string[];
  productContextStatus: "protected_relevant" | "relevant" | "review_first" | "not_sold";
  matchedCatalogEntityIds: string[];
  matchedAlias: string | null;
  supportedByCatalogEvidence: boolean;
  catalogEvidenceScore: number;
  matchConfidence: "high" | "medium" | "low";
  exclusionReasonType: "not_sold" | "variant_not_sold" | "wrong_intent" | "wrong_landing_page" | "wrong_routing" | "weak_performance_only" | "insufficient_evidence";
  reasoningLabel: string;
}

interface TermDecisionInput {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const baseTokens = normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  const variants = new Set<string>();
  for (const token of baseTokens) {
    variants.add(token);
    if (token.endsWith("en") && token.length > 5) variants.add(token.slice(0, -2));
    if (token.endsWith("s") && token.length > 4) variants.add(token.slice(0, -1));
  }
  return Array.from(variants);
}

function normalizeCompact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function addCompact(target: Set<string>, raw: string): string {
  const compact = normalizeCompact(raw);
  if (compact) target.add(compact);
  return compact;
}

function addPhraseVocabulary(target: Set<string>, tokensTarget: Set<string>, compactTarget: Set<string>, raw: string): void {
  const normalized = normalizeText(raw);
  if (!normalized) return;
  target.add(normalized);
  addCompact(compactTarget, raw);

  const tokens = tokenize(raw);
  for (const token of tokens) tokensTarget.add(token);

  if (tokens.length >= 2) {
    for (let i = 0; i < tokens.length - 1; i++) {
      target.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  if (tokens.length >= 3) {
    target.add(tokens.slice(0, 3).join(" "));
  }
}

function addIndexedPhrase(
  target: Set<string>,
  tokensTarget: Set<string>,
  compactTarget: Set<string>,
  phraseEntityIds: Map<string, Set<string>>,
  tokenEntityIds: Map<string, Set<string>>,
  compactEntityIds: Map<string, Set<string>>,
  raw: string,
  entityId: string
): void {
  const normalized = normalizeText(raw);
  if (!normalized) return;
  target.add(normalized);
  if (!phraseEntityIds.has(normalized)) phraseEntityIds.set(normalized, new Set());
  phraseEntityIds.get(normalized)!.add(entityId);
  const compact = addCompact(compactTarget, raw);
  if (compact) {
    if (!compactEntityIds.has(compact)) compactEntityIds.set(compact, new Set());
    compactEntityIds.get(compact)!.add(entityId);
  }

  const tokens = tokenize(raw);
  for (const token of tokens) {
    tokensTarget.add(token);
    if (!tokenEntityIds.has(token)) tokenEntityIds.set(token, new Set());
    tokenEntityIds.get(token)!.add(entityId);
  }
}

function hasAnyModifier(term: string, modifiers: string[]): boolean {
  return modifiers.some((modifier) => term.includes(modifier));
}

function bestPhraseMatch(term: string, phrases: Set<string>): string | null {
  const matches = Array.from(phrases).filter((phrase) => phrase && term.includes(phrase));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

function tokenOverlap(termTokens: string[], vocabulary: Set<string>): string[] {
  return termTokens.filter((token) => vocabulary.has(token));
}

function entityIdsFromMatches(
  matches: Array<string | null>,
  tokenMatches: string[],
  compactMatches: string[],
  context: ProductContext
): string[] {
  const ids = new Set<string>();
  for (const match of matches) {
    if (!match) continue;
    for (const id of context.entityIdsByPhrase.get(match) ?? []) ids.add(id);
  }
  for (const token of tokenMatches) {
    for (const id of context.entityIdsByToken.get(token) ?? []) ids.add(id);
  }
  for (const compact of compactMatches) {
    for (const id of context.entityIdsByCompact.get(compact) ?? []) ids.add(id);
  }
  return Array.from(ids);
}

export function buildProductContext(source: ProductContextSource): ProductContext {
  const catalogPhrases = new Set<string>();
  const catalogTokens = new Set<string>();
  const catalogCompacts = new Set<string>();
  const keywordPhrases = new Set<string>();
  const keywordCompacts = new Set<string>();
  const sitePhrases = new Set<string>();
  const siteCompacts = new Set<string>();
  const strategicPhrases = new Set<string>();
  const strategicCompacts = new Set<string>();
  const productTypePhrases = new Set<string>();
  const productTypeCompacts = new Set<string>();
  const customLabelPhrases = new Set<string>();
  const customLabelCompacts = new Set<string>();
  const customAttributePhrases = new Set<string>();
  const customAttributeCompacts = new Set<string>();
  const linkPhrases = new Set<string>();
  const linkCompacts = new Set<string>();
  const entityIdsByPhrase = new Map<string, Set<string>>();
  const entityIdsByToken = new Map<string, Set<string>>();
  const entityIdsByCompact = new Map<string, Set<string>>();

  for (const title of source.productTitles ?? []) {
    addPhraseVocabulary(catalogPhrases, catalogTokens, catalogCompacts, title);
  }
  for (const productType of source.productTypes ?? []) addPhraseVocabulary(productTypePhrases, catalogTokens, productTypeCompacts, productType);
  for (const brand of source.productBrands ?? []) addPhraseVocabulary(catalogPhrases, catalogTokens, catalogCompacts, brand);
  for (const label of source.customLabels ?? []) addPhraseVocabulary(customLabelPhrases, catalogTokens, customLabelCompacts, label);
  for (const attr of source.customAttributes ?? []) addPhraseVocabulary(customAttributePhrases, catalogTokens, customAttributeCompacts, attr);
  for (const keyword of source.keywords ?? []) {
    addPhraseVocabulary(keywordPhrases, catalogTokens, keywordCompacts, keyword);
  }
  for (const phrase of source.adCopyPhrases ?? []) {
    addPhraseVocabulary(sitePhrases, catalogTokens, siteCompacts, phrase);
  }
  for (const phrase of (source.strategicContextText || "").split(/[,\n.;]/g)) {
    addPhraseVocabulary(strategicPhrases, catalogTokens, strategicCompacts, phrase);
  }
  for (const product of source.merchantProducts ?? []) {
    addIndexedPhrase(catalogPhrases, catalogTokens, catalogCompacts, entityIdsByPhrase, entityIdsByToken, entityIdsByCompact, product.title, product.offerId);
    if (product.brand) addIndexedPhrase(catalogPhrases, catalogTokens, catalogCompacts, entityIdsByPhrase, entityIdsByToken, entityIdsByCompact, product.brand, product.offerId);
    if (product.productType) addIndexedPhrase(productTypePhrases, catalogTokens, productTypeCompacts, entityIdsByPhrase, entityIdsByToken, entityIdsByCompact, product.productType, product.offerId);
    for (const label of product.customLabels ?? []) addIndexedPhrase(customLabelPhrases, catalogTokens, customLabelCompacts, entityIdsByPhrase, entityIdsByToken, entityIdsByCompact, label, product.offerId);
    for (const attr of product.customAttributes ?? []) addIndexedPhrase(customAttributePhrases, catalogTokens, customAttributeCompacts, entityIdsByPhrase, entityIdsByToken, entityIdsByCompact, attr, product.offerId);
    if (product.link) addIndexedPhrase(linkPhrases, catalogTokens, linkCompacts, entityIdsByPhrase, entityIdsByToken, entityIdsByCompact, product.link, product.offerId);
  }

  return {
    catalogPhrases,
    catalogTokens,
    catalogCompacts,
    keywordPhrases,
    keywordCompacts,
    sitePhrases,
    siteCompacts,
    strategicPhrases,
    strategicCompacts,
    productTypePhrases,
    productTypeCompacts,
    customLabelPhrases,
    customLabelCompacts,
    customAttributePhrases,
    customAttributeCompacts,
    linkPhrases,
    linkCompacts,
    entityIdsByPhrase,
    entityIdsByToken,
    entityIdsByCompact,
    targetedCountries: source.targetedCountries ?? [],
  };
}

export function assessSearchTermAgainstProductContext(
  input: TermDecisionInput,
  context: ProductContext
): ProductTermAssessment {
  const normalizedTerm = normalizeText(input.searchTerm);
  const compactTerm = normalizeCompact(input.searchTerm);
  const termTokens = tokenize(input.searchTerm);
  const routeTokens = tokenize(`${input.campaignName} ${input.adGroupName}`);
  const matchedContext: string[] = [];

  const catalogMatch = bestPhraseMatch(normalizedTerm, context.catalogPhrases);
  const keywordMatch = bestPhraseMatch(normalizedTerm, context.keywordPhrases);
  const siteMatch = bestPhraseMatch(normalizedTerm, context.sitePhrases);
  const strategicMatch = bestPhraseMatch(normalizedTerm, context.strategicPhrases);
  const productTypeMatch = bestPhraseMatch(normalizedTerm, context.productTypePhrases);
  const customLabelMatch = bestPhraseMatch(normalizedTerm, context.customLabelPhrases);
  const customAttributeMatch = bestPhraseMatch(normalizedTerm, context.customAttributePhrases);
  const linkMatch = bestPhraseMatch(normalizedTerm, context.linkPhrases);
  const tokenMatches = tokenOverlap(termTokens, context.catalogTokens);
  const routeMatches = routeTokens.filter((token) => context.catalogTokens.has(token));
  const compactMatches = [
    context.catalogCompacts.has(compactTerm) ? compactTerm : null,
    context.productTypeCompacts.has(compactTerm) ? compactTerm : null,
    context.customLabelCompacts.has(compactTerm) ? compactTerm : null,
    context.customAttributeCompacts.has(compactTerm) ? compactTerm : null,
    context.keywordCompacts.has(compactTerm) ? compactTerm : null,
    context.siteCompacts.has(compactTerm) ? compactTerm : null,
    context.strategicCompacts.has(compactTerm) ? compactTerm : null,
    context.linkCompacts.has(compactTerm) ? compactTerm : null,
  ].filter((value): value is string => Boolean(value));
  const matchedCatalogEntityIds = entityIdsFromMatches(
    [catalogMatch, productTypeMatch, customLabelMatch, customAttributeMatch, linkMatch],
    tokenMatches,
    compactMatches,
    context
  );

  if (catalogMatch) matchedContext.push(`feed:${catalogMatch}`);
  if (keywordMatch) matchedContext.push(`keyword:${keywordMatch}`);
  if (siteMatch) matchedContext.push(`site:${siteMatch}`);
  if (strategicMatch) matchedContext.push(`context:${strategicMatch}`);
  if (productTypeMatch) matchedContext.push(`type:${productTypeMatch}`);
  if (customLabelMatch) matchedContext.push(`label:${customLabelMatch}`);
  if (customAttributeMatch) matchedContext.push(`attr:${customAttributeMatch}`);
  if (linkMatch) matchedContext.push(`link:${linkMatch}`);
  if (tokenMatches.length > 0) matchedContext.push(`tokens:${tokenMatches.slice(0, 4).join(",")}`);
  if (routeMatches.length > 0) matchedContext.push(`routing:${routeMatches.slice(0, 3).join(",")}`);
  if (compactMatches.length > 0) matchedContext.push(`compact:${compactMatches[0]}`);

  const evidenceSources = new Set<EvidenceSource>();
  if (catalogMatch || compactMatches.some((match) => context.catalogCompacts.has(match))) evidenceSources.add("feed_match");
  if (productTypeMatch || customLabelMatch || customAttributeMatch || linkMatch) evidenceSources.add("feed_match");
  if (siteMatch || keywordMatch) evidenceSources.add("site_match");
  if (strategicMatch) evidenceSources.add("strategic_context");
  if (tokenMatches.length > 0 || routeMatches.length > 0 || compactMatches.length > 0) evidenceSources.add("lexical_inference");
  if (evidenceSources.size === 0) evidenceSources.add("unknown");

  let hardCatalogEvidenceScore = 0;
  if (catalogMatch) hardCatalogEvidenceScore += normalizedTerm === catalogMatch ? 7 : 5;
  if (customLabelMatch) hardCatalogEvidenceScore += normalizedTerm === customLabelMatch ? 6 : 4;
  if (productTypeMatch) hardCatalogEvidenceScore += 4;
  if (customAttributeMatch) hardCatalogEvidenceScore += 3;
  if (linkMatch) hardCatalogEvidenceScore += 3;
  if (compactMatches.length > 0) hardCatalogEvidenceScore += 4;
  if (matchedCatalogEntityIds.length > 0) hardCatalogEvidenceScore += Math.min(3, matchedCatalogEntityIds.length);

  let softEvidenceScore = 0;
  if (keywordMatch) softEvidenceScore += 3;
  if (siteMatch) softEvidenceScore += 3;
  if (strategicMatch) softEvidenceScore += 2;
  if (tokenMatches.length >= 2) softEvidenceScore += 3;
  else if (tokenMatches.length === 1) softEvidenceScore += 1;
  if (routeMatches.length >= 1) softEvidenceScore += 1;

  const catalogEvidenceScore = hardCatalogEvidenceScore + softEvidenceScore;
  const supportedByCatalogEvidence = hardCatalogEvidenceScore >= 4 || matchedCatalogEntityIds.length > 0;
  const mixedProductEvidence = !supportedByCatalogEvidence && softEvidenceScore >= 3;
  const contextRich =
    context.catalogPhrases.size > 0 ||
    context.productTypePhrases.size > 0 ||
    context.customLabelPhrases.size > 0 ||
    context.sitePhrases.size > 0 ||
    context.keywordPhrases.size > 0;

  const soldByClient: boolean | "unknown" =
    supportedByCatalogEvidence
      ? true
      : mixedProductEvidence
        ? "unknown"
        : contextRich
        ? termTokens.length >= 2 && tokenMatches.length === 0 && compactMatches.length === 0
          ? false
          : "unknown"
        : "unknown";

  const detectedCountries = detectSearchTermCountries(input.searchTerm);
  const targetedCountries = context.targetedCountries.length > 0 ? context.targetedCountries : ["NL", "BE"];
  const wrongGeo = detectedCountries.every((country) => !targetedCountries.includes(country));

  if (wrongGeo && !supportedByCatalogEvidence && softEvidenceScore <= 1) {
      return {
        productClassification: "wrong_language_or_geo",
        soldByClient,
        evidenceSource: "lexical_inference",
        evidenceSources: Array.from(evidenceSources),
        recommendedScope: "campaign",
        exclusionSafety: "safe_to_exclude",
        matchedContext,
        productContextStatus: "not_sold",
        matchedCatalogEntityIds,
        matchedAlias: compactMatches[0] ?? null,
        supportedByCatalogEvidence,
        catalogEvidenceScore,
        matchConfidence: "high",
        exclusionReasonType: "not_sold",
        reasoningLabel: "Verkeerde taal of geo-context voor deze targeting.",
      };
    }

  const hasRepairIntent = hasAnyModifier(normalizedTerm, REPAIR_MODIFIERS);
  const hasAccessoryIntent = hasAnyModifier(normalizedTerm, ACCESSORY_MODIFIERS);
  const hasCommercialIntent = hasAnyModifier(normalizedTerm, COMMERCIAL_MODIFIERS);
  const hasBadIntent = hasAnyModifier(normalizedTerm, WRONG_INTENT_MODIFIERS);

  if (soldByClient === true) {
    const evidenceSource: EvidenceSource =
      catalogMatch ? "feed_match"
      : customLabelMatch || productTypeMatch || customAttributeMatch || linkMatch ? "feed_match"
      : siteMatch || keywordMatch ? "site_match"
      : strategicMatch ? "strategic_context"
      : "lexical_inference";

    if (hasRepairIntent) {
      return {
        productClassification: "repair_or_support_intent",
        soldByClient: true,
        evidenceSource,
        evidenceSources: Array.from(evidenceSources),
        recommendedScope: "adgroup",
        exclusionSafety: "safe_to_exclude_modifier_only",
        matchedContext,
        productContextStatus: "review_first",
        matchedCatalogEntityIds,
        matchedAlias: compactMatches[0] ?? null,
        supportedByCatalogEvidence,
        catalogEvidenceScore,
        matchConfidence: hardCatalogEvidenceScore >= 6 ? "high" : "medium",
        exclusionReasonType: "wrong_intent",
        reasoningLabel: "Relevant product, maar repair/support-intent vraagt modifier- of routingsturing.",
      };
    }

    if (hasAccessoryIntent) {
      return {
        productClassification: "accessory_or_spare_part",
        soldByClient: true,
        evidenceSource,
        evidenceSources: Array.from(evidenceSources),
        recommendedScope: "adgroup",
        exclusionSafety: "review_first",
        matchedContext,
        productContextStatus: "review_first",
        matchedCatalogEntityIds,
        matchedAlias: compactMatches[0] ?? null,
        supportedByCatalogEvidence,
        catalogEvidenceScore,
        matchConfidence: hardCatalogEvidenceScore >= 6 ? "high" : "medium",
        exclusionReasonType: "variant_not_sold",
        reasoningLabel: "Relevant assortiment, maar accessoire/spare-part intent moet apart beoordeeld worden.",
      };
    }

    if ((supportedByCatalogEvidence || tokenMatches.length >= 1 || routeMatches.length >= 1) && hasCommercialIntent) {
      return {
        productClassification: "core_product_high_intent",
        soldByClient: true,
        evidenceSource,
        evidenceSources: Array.from(evidenceSources),
        recommendedScope: "monitor_only",
        exclusionSafety: "unsafe_to_exclude",
        matchedContext,
        productContextStatus: "protected_relevant",
        matchedCatalogEntityIds,
        matchedAlias: compactMatches[0] ?? null,
        supportedByCatalogEvidence,
        catalogEvidenceScore,
        matchConfidence: "high",
        exclusionReasonType: "weak_performance_only",
        reasoningLabel: "Kernproduct met koopintentie; onderzoek uitvoering in plaats van uitsluiten.",
      };
    }

    if (supportedByCatalogEvidence || tokenMatches.length >= 2) {
      return {
        productClassification: catalogMatch === normalizedTerm || compactMatches.includes(compactTerm) ? "core_product_exact" : "core_product_broad",
        soldByClient: true,
        evidenceSource,
        evidenceSources: Array.from(evidenceSources),
        recommendedScope: "monitor_only",
        exclusionSafety: "unsafe_to_exclude",
        matchedContext,
        productContextStatus: "protected_relevant",
        matchedCatalogEntityIds,
        matchedAlias: compactMatches[0] ?? null,
        supportedByCatalogEvidence,
        catalogEvidenceScore,
        matchConfidence: hardCatalogEvidenceScore >= 6 ? "high" : "medium",
        exclusionReasonType: "weak_performance_only",
        reasoningLabel: "Relevant kernproduct; brede of zwakke performance is geen bewijs dat de term buiten assortiment valt.",
      };
    }

    if (tokenMatches.length >= 1 && hasCommercialIntent) {
      return {
        productClassification: "core_product_high_intent",
        soldByClient: true,
        evidenceSource,
        evidenceSources: Array.from(evidenceSources),
        recommendedScope: "monitor_only",
        exclusionSafety: "unsafe_to_exclude",
        matchedContext,
        productContextStatus: "relevant",
        matchedCatalogEntityIds,
        matchedAlias: compactMatches[0] ?? null,
        supportedByCatalogEvidence,
        catalogEvidenceScore,
        matchConfidence: "medium",
        exclusionReasonType: "wrong_routing",
        reasoningLabel: "Relevante productterm met koopintentie; eerst routing, prijs of LP controleren.",
      };
    }

    if (tokenMatches.length >= 1) {
      return {
        productClassification: "core_product_broad",
        soldByClient: true,
        evidenceSource,
        evidenceSources: Array.from(evidenceSources),
        recommendedScope: "monitor_only",
        exclusionSafety: "unsafe_to_exclude",
        matchedContext,
        productContextStatus: "relevant",
        matchedCatalogEntityIds,
        matchedAlias: compactMatches[0] ?? null,
        supportedByCatalogEvidence,
        catalogEvidenceScore,
        matchConfidence: "medium",
        exclusionReasonType: "wrong_routing",
        reasoningLabel: "Brede maar relevante productterm; behandel dit als kwaliteit-, routing- of LP-vraagstuk.",
      };
    }
  }

  if (soldByClient === false && hasBadIntent) {
    return {
      productClassification: "off_catalog",
      soldByClient: false,
      evidenceSource: "lexical_inference",
      evidenceSources: Array.from(evidenceSources),
      recommendedScope: "account",
      exclusionSafety: "safe_to_exclude",
      matchedContext,
      productContextStatus: "not_sold",
      matchedCatalogEntityIds,
      matchedAlias: compactMatches[0] ?? null,
      supportedByCatalogEvidence,
      catalogEvidenceScore,
      matchConfidence: "high",
      exclusionReasonType: "not_sold",
      reasoningLabel: "Niet passend bij assortiment of accountfocus.",
    };
  }

  const clearlyUnrelated =
    soldByClient === false &&
    !supportedByCatalogEvidence &&
    !mixedProductEvidence &&
    termTokens.length >= 2 &&
    tokenMatches.length === 0 &&
    compactMatches.length === 0 &&
    !hasCommercialIntent &&
    !hasRepairIntent &&
    !hasAccessoryIntent &&
    routeMatches.length === 0 &&
    contextRich;

  if (clearlyUnrelated) {
    return {
      productClassification: "off_catalog",
      soldByClient: false,
      evidenceSource: "unknown",
      evidenceSources: Array.from(evidenceSources),
      recommendedScope: "account",
      exclusionSafety: "safe_to_exclude",
      matchedContext,
      productContextStatus: "not_sold",
      matchedCatalogEntityIds,
      matchedAlias: compactMatches[0] ?? null,
      supportedByCatalogEvidence,
      catalogEvidenceScore,
      matchConfidence: "high",
      exclusionReasonType: "not_sold",
      reasoningLabel: "Geen catalogus-, site-, alias- of businesscontextmatch gevonden voor een duidelijke niet-passende term.",
    };
  }

  if (soldByClient === "unknown" || soldByClient === false) {
    return {
      productClassification: "ambiguous_needs_review",
      soldByClient: soldByClient === false ? "unknown" : soldByClient,
      evidenceSource: "unknown",
      evidenceSources: Array.from(evidenceSources),
      recommendedScope: "monitor_only",
      exclusionSafety: "review_first",
      matchedContext,
      productContextStatus: "review_first",
      matchedCatalogEntityIds,
      matchedAlias: compactMatches[0] ?? null,
      supportedByCatalogEvidence,
      catalogEvidenceScore,
      matchConfidence: "low",
      exclusionReasonType: "insufficient_evidence",
      reasoningLabel: "Onvoldoende context om een off-catalog of mismatch-oordeel hard te claimen.",
    };
  }

  return {
    productClassification: "adjacent_category",
    soldByClient,
    evidenceSource: tokenMatches.length > 0 ? "lexical_inference" : "unknown",
    evidenceSources: Array.from(evidenceSources),
    recommendedScope: "campaign",
    exclusionSafety: "review_first",
    matchedContext,
    productContextStatus: "review_first",
    matchedCatalogEntityIds,
    matchedAlias: compactMatches[0] ?? null,
    supportedByCatalogEvidence,
    catalogEvidenceScore,
    matchConfidence: tokenMatches.length >= 2 ? "medium" : "low",
    exclusionReasonType: "insufficient_evidence",
    reasoningLabel: "Term lijkt aanpalend of routinggevoelig, niet direct off-catalog.",
  };
}

type VerdictWithData = SearchTermVerdict & {
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
};

export function applyProductContextDecisioning<T extends VerdictWithData>(
  verdicts: T[],
  context: ProductContext
): T[] {
  for (const verdict of verdicts) {
    const assessment = assessSearchTermAgainstProductContext({
      searchTerm: verdict.searchTerm,
      campaignName: verdict.campaignName,
      adGroupName: verdict.adGroupName,
      clicks: verdict.clicks,
      cost: verdict.cost,
      conversions: verdict.conversions,
    }, context);

    verdict.productClassification = assessment.productClassification;
    verdict.soldByClient = assessment.soldByClient === "unknown" ? undefined : assessment.soldByClient;
    verdict.evidenceSource = assessment.evidenceSource;
    verdict.supportedByCatalogEvidence = assessment.supportedByCatalogEvidence;
    verdict.evidenceSources = assessment.evidenceSources;
    verdict.catalogEvidenceScore = assessment.catalogEvidenceScore;
    verdict.recommendedScope = assessment.recommendedScope;
    verdict.exclusionSafety = assessment.exclusionSafety;
    verdict.matchedContext = assessment.matchedContext;
    verdict.displayLabel = `Zoekterm: ${verdict.searchTerm}`;

    const isNegative = verdict.recommendedAction === "negative_exact" || verdict.recommendedAction === "negative_phrase";

    if (assessment.exclusionSafety === "unsafe_to_exclude") {
      if (isNegative) {
        verdict.saferAlternativeAction = verdict.recommendedAction;
        verdict.recommendedAction = verdict.conversions > 0 ? "keep" : "investigate";
      }
      verdict.verdict = verdict.conversions > 0 ? "relevant" : "partially_relevant";
      verdict.actionReadiness = "investigate_first";
      verdict.requiresHumanReview = verdict.conversions === 0;
      verdict.reason = `${assessment.reasoningLabel} Aanbevolen: structuur, bieding, feed of landingspagina verbeteren in plaats van de productstam uit te sluiten.`;
      continue;
    }

    if (assessment.exclusionSafety === "safe_to_exclude_modifier_only") {
      if (verdict.recommendedAction === "negative_phrase") {
        verdict.saferAlternativeAction = verdict.recommendedAction;
      }
      verdict.recommendedAction = "investigate";
      verdict.actionReadiness = "investigate_first";
      verdict.requiresHumanReview = true;
      verdict.reason = `${assessment.reasoningLabel} Sluit alleen modifiers of sub-intent uit, niet de productstam.`;
      continue;
    }

    if (assessment.exclusionSafety === "review_first") {
      if (isNegative) verdict.saferAlternativeAction = verdict.recommendedAction;
      if (isNegative) verdict.recommendedAction = "investigate";
      verdict.actionReadiness = "investigate_first";
      verdict.requiresHumanReview = true;
      verdict.reason = `${assessment.reasoningLabel} Review first voordat uitsluiting wordt doorgevoerd.`;
      continue;
    }

    if (assessment.exclusionSafety === "safe_to_exclude") {
      if (verdict.recommendedAction === "keep") verdict.recommendedAction = "negative_exact";
      verdict.verdict = "irrelevant";
      verdict.actionReadiness = verdict.recommendedAction === "negative_exact" ? "direct_action" : "investigate_first";
      verdict.reason = `${assessment.reasoningLabel} Uitsluiting is veilig op ${assessment.recommendedScope}-niveau.`;
    }
  }

  return verdicts;
}

export function summarizeProductContext(context: ProductContext): string {
  const feedTerms = Array.from(context.catalogPhrases).slice(0, 20).join(", ");
  const keywordTerms = Array.from(context.keywordPhrases).slice(0, 12).join(", ");
  const siteTerms = Array.from(context.sitePhrases).slice(0, 12).join(", ");
  const typeTerms = Array.from(context.productTypePhrases).slice(0, 12).join(", ");
  const labelTerms = Array.from(context.customLabelPhrases).slice(0, 12).join(", ");

  return [
    "## Product- en businesscontext",
    `- Feed/catalogusmatch: ${feedTerms || "geen expliciete feedtermen beschikbaar"}`,
    `- Producttypes / labels: ${typeTerms || labelTerms || "geen expliciete Merchant types of labels beschikbaar"}`,
    `- Keyword/site-context: ${keywordTerms || siteTerms || "geen expliciete keyword/site-termen beschikbaar"}`,
    `- Targetmarkten: ${(context.targetedCountries.length > 0 ? context.targetedCountries.join(", ") : "onbekend")}`,
    "- Kernregel: noem een zoekterm alleen irrelevante traffic als er geen catalogus-, label-, type-, site- of business-contextmatch is.",
  ].join("\n");
}
