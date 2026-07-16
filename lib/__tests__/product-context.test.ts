/**
 * Tests for deterministic product relevance and exclusion safety.
 * Run with: npx tsx lib/__tests__/product-context.test.ts
 */

import { applyProductContextDecisioning, buildProductContext } from "../analysis/product-context";
import type { SearchTermVerdict } from "../schema/search-term-schema";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

type TestVerdict = SearchTermVerdict & {
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
};

function verdict(overrides: Partial<TestVerdict> = {}): TestVerdict {
  return {
    searchTerm: "douchewisser",
    relevanceScore: 2,
    verdict: "irrelevant" as const,
    recommendedAction: "negative_exact" as const,
    reason: "0 conversies",
    confidence: "medium" as const,
    campaignName: "Catch-all",
    adGroupName: "Generic",
    clicks: 18,
    cost: 64,
    conversions: 0,
    conversionsValue: 0,
    ...overrides,
  };
}

const context = buildProductContext({
  productTitles: [
    "Zwarte douchewisser premium",
    "Decanteerkaraf glas 1 liter",
    "Karaf met deksel",
    "WC rolhouder mat zwart",
  ],
  productTypes: ["Badkamer > Douchewissers", "Wonen > Karaffen", "Badkamer > Toiletrolhouders"],
  customLabels: ["douchetrekker", "wc rolhouder", "decanter"],
  keywords: [
    "douchewisser",
    "karaf",
    "decanteerkaraf",
    "wc rolhouder",
  ],
  adCopyPhrases: [
    "Bestel jouw douchewisser online",
    "Ontdek onze karaffen collectie",
    "WC rolhouder voor badkamer en toilet",
  ],
  merchantProducts: [
    {
      offerId: "sku-1",
      title: "Zwarte douchewisser premium",
      productType: "Badkamer > Douchewissers",
      customLabels: ["douchetrekker"],
    },
    {
      offerId: "sku-2",
      title: "Decanteerkaraf glas 1 liter",
      productType: "Wonen > Karaffen",
      customLabels: ["decanter"],
    },
    {
      offerId: "sku-3",
      title: "WC rolhouder mat zwart",
      productType: "Badkamer > Toiletrolhouders",
      customLabels: ["toiletrolhouder", "wc-rolhouder"],
    },
  ],
  strategicContextText: "De klant verkoopt douchewissers en karaffen in Nederland en België.",
  targetedCountries: ["NL", "BE"],
});

console.log("\n=== Product Context Tests ===\n");

console.log("1. Sold core product should NOT be excluded");
{
  const [result] = applyProductContextDecisioning([verdict()], context);
  assert(result.productClassification === "core_product_exact" || result.productClassification === "core_product_broad", `expected core classification, got ${result.productClassification}`);
  assert(result.exclusionSafety === "unsafe_to_exclude", `expected unsafe_to_exclude, got ${result.exclusionSafety}`);
  assert(result.supportedByCatalogEvidence === true, "strong merchant/title evidence should mark supportedByCatalogEvidence");
  assert(result.recommendedAction !== "negative_exact" && result.recommendedAction !== "negative_phrase", `sold product should not remain negative, got ${result.recommendedAction}`);
}

console.log("2. Sold product with repair modifier may be partially excluded");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "douchewisser rubber vervangen" })], context);
  assert(result.productClassification === "repair_or_support_intent", `expected repair_or_support_intent, got ${result.productClassification}`);
  assert(result.exclusionSafety === "safe_to_exclude_modifier_only", `expected modifier-only safety, got ${result.exclusionSafety}`);
}

console.log("2b. Sold alias term should NOT be excluded");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "douchetrekker" })], context);
  assert(result.productClassification === "core_product_exact" || result.productClassification === "core_product_broad", `expected sold alias classification, got ${result.productClassification}`);
  assert(result.exclusionSafety === "unsafe_to_exclude", `expected unsafe_to_exclude for alias term, got ${result.exclusionSafety}`);
  assert(result.recommendedAction !== "negative_exact" && result.recommendedAction !== "negative_phrase", "sold alias must not remain a hard negative");
}

console.log("2c. Sold subtype alias should NOT be marked off-catalog");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "decanter" })], context);
  assert(result.productClassification !== "off_catalog", `sold subtype alias should not be off_catalog, got ${result.productClassification}`);
  assert(result.exclusionSafety !== "safe_to_exclude", `sold subtype alias should not be safe_to_exclude, got ${result.exclusionSafety}`);
}

console.log("3. Off-catalog term can be excluded");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "autostoel baby", cost: 91 })], context);
  assert(result.productClassification === "off_catalog", `expected off_catalog, got ${result.productClassification}`);
  assert(result.exclusionSafety === "safe_to_exclude", `expected safe_to_exclude, got ${result.exclusionSafety}`);
}

console.log("4. Core high-intent term with 0 conversions triggers investigation");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "douchewisser kopen" })], context);
  assert(result.productClassification === "core_product_high_intent", `expected core_product_high_intent, got ${result.productClassification}`);
  assert(result.recommendedAction === "investigate", `expected investigate, got ${result.recommendedAction}`);
}

console.log("5. Ambiguous term should not become hard negative");
{
  const unknownContext = buildProductContext({ targetedCountries: ["NL"] });
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "glasreiniger" })], unknownContext);
  assert(result.productClassification === "ambiguous_needs_review", `expected ambiguous_needs_review, got ${result.productClassification}`);
  assert(result.exclusionSafety === "review_first", `expected review_first, got ${result.exclusionSafety}`);
  assert(result.recommendedAction !== "negative_exact" && result.recommendedAction !== "negative_phrase", "ambiguous term should not be hard negative");
}

console.log("5a. Mixed evidence should fall back to review_first instead of safe exclude");
{
  const mixedContext = buildProductContext({
    productTitles: ["Premium badkamer wisser"],
    customLabels: ["badkamerwisser"],
    strategicContextText: "De klant verkoopt badkameraccessoires.",
    targetedCountries: ["NL"],
  });
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "badkamer wisser" })], mixedContext);
  assert(result.exclusionSafety !== "safe_to_exclude", `mixed evidence should not be safe_to_exclude, got ${result.exclusionSafety}`);
  assert(result.exclusionSafety === "review_first" || result.exclusionSafety === "unsafe_to_exclude", `mixed evidence should become review_first or protected, got ${result.exclusionSafety}`);
}

console.log("5b. Zero conversions alone is insufficient for irrelevance");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "toiletrolhouder", conversions: 0, cost: 42 })], context);
  assert(result.productClassification !== "off_catalog", `0 conv alias term should not become off_catalog, got ${result.productClassification}`);
  assert(result.exclusionSafety !== "safe_to_exclude", `0 conv alias term should not become safe_to_exclude, got ${result.exclusionSafety}`);
}

console.log("6. Wrong-language term in NL campaign can be excluded");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "duschabzieher kaufen", cost: 74 })], context);
  assert(result.productClassification === "core_product_high_intent" || result.productClassification === "core_product_broad" || result.productClassification === "wrong_language_or_geo" || result.exclusionSafety === "safe_to_exclude", `expected either protected sold alias or wrong-language safe exclude, got ${result.productClassification}/${result.exclusionSafety}`);
}

console.log("7. Sold products should not be called irrelevant without evidence");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "karaf" })], context);
  assert(!/irrelevant/i.test(result.reason), `sold product reason should avoid irrelevance claim, got "${result.reason}"`);
}

console.log("8. WC rolhouder must be protected as real assortment product");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "wc rolhouder" })], context);
  assert(result.productClassification === "core_product_exact" || result.productClassification === "core_product_broad", `wc rolhouder should be relevant, got ${result.productClassification}`);
  assert(result.exclusionSafety === "unsafe_to_exclude", `wc rolhouder must be protected, got ${result.exclusionSafety}`);
}

console.log("8b. Compact or hyphen variants should be protected via dynamic title/label normalization");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "wc-rolhouder" })], context);
  assert(result.productClassification !== "off_catalog", `compact variant should not be off_catalog, got ${result.productClassification}`);
  assert(result.exclusionSafety !== "safe_to_exclude", `compact variant should not be safe_to_exclude, got ${result.exclusionSafety}`);
}

console.log("9. Decanteerkaraf should not become off-catalog when Merchant data confirms it");
{
  const [result] = applyProductContextDecisioning([verdict({ searchTerm: "decanteerkaraf" })], context);
  assert(result.productClassification !== "off_catalog", `decanteerkaraf should not be off_catalog, got ${result.productClassification}`);
  assert(result.exclusionSafety !== "safe_to_exclude", `decanteerkaraf should not be safe_to_exclude, got ${result.exclusionSafety}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
