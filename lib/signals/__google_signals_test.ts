// Test voor de signaal-engine plus categorie A en B (Google). Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__google_signals_test.ts

import { mergeDetections } from "./types";
import { detectConcurrentiedruk, detectBrandOnderVuur, detectPmaxKannibalisatie, tokenOverlapRatio, type AuctionCampaignInput } from "./google-auction-competition";
import { detectMarktShiftBevestigd, detectSeizoenspatroon } from "./google-demand";
import type { DemandShareDecomposition } from "@/lib/analysis/metric-cross-checks";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function campagne(o: Partial<AuctionCampaignInput> = {}): AuctionCampaignInput {
  return {
    campaignName: "Search NL",
    isBranded: false,
    impressionShare: 0.4, prevImpressionShare: 0.5,
    rankLostIs: 0.3, prevRankLostIs: 0.2,
    cpc: 1.15, prevCpc: 1.0,
    impressions: 10000, prevImpressions: 10000,
    spendWeightedQs: 7.2, prevSpendWeightedQs: 7.4,
    ownChanges: [],
    ...o,
  };
}

// ── A1: concurrentiedruk-toename ──
const druk = detectConcurrentiedruk(campagne());
assert(druk.triggered.length === 1 && druk.triggered[0].id === "concurrentiedruk_toename", "vijf metrics samen triggeren het concurrentiedruk-verhaal");
assert(druk.triggered[0].certainty === "bewezen_binnen_platform", "zonder eigen wijzigingen is het bewezen binnen het platform");
assert(druk.triggered[0].evidence.length === 5, "het evidence-spoor draagt alle vijf de metrics");
assert(druk.triggered[0].story.includes("concurrent"), "het verhaal benoemt de concurrent");

// De eigen-wijziging-uitsluiting: met een budgetwijziging degradeert het naar indicatie
const eigenWijziging = detectConcurrentiedruk(campagne({ ownChanges: [{ resource_type: "CAMPAIGN_BUDGET", campaign_name: "Search NL" }] }));
assert(eigenWijziging.triggered[0].certainty === "indicatie", "met een eigen budgetwijziging degradeert het verhaal naar indicatie");
assert(eigenWijziging.triggered[0].story.includes("eigen handelen is niet uit te sluiten"), "de degradatie legt uit waarom");
// Een niet-relevante wijziging (AD_GROUP) telt niet als eigen veiling-handelen
assert(detectConcurrentiedruk(campagne({ ownChanges: [{ resource_type: "AD_GROUP", campaign_name: "Search NL" }] })).triggered[0].certainty === "bewezen_binnen_platform", "een adgroup-wijziging is geen bod- of budgetwijziging");

// QS niet stabiel (gedaald): het verhaal triggert NIET, want dan is het een kwaliteitsverhaal
assert(detectConcurrentiedruk(campagne({ spendWeightedQs: 5.5, prevSpendWeightedQs: 7.4 })).triggered.length === 0, "een dalende QS blokkeert het concurrentie-verhaal (dat is categorie C)");
// Kleine IS-beweging: geen trigger, maar wel gecheckt
const klein = detectConcurrentiedruk(campagne({ impressionShare: 0.48 }));
assert(klein.triggered.length === 0 && klein.checked.includes("concurrentiedruk_toename"), "onder de drempel geen trigger, maar het verhaal staat wel als gecheckt");

// ── A2: brand onder vuur ──
const brand = detectBrandOnderVuur(campagne({ isBranded: true }));
assert(brand.triggered.length === 1 && brand.triggered[0].id === "brand_onder_vuur", "branded IS-daling plus CPC-stijging plus aanwezige vraag: brand onder vuur");
assert(detectBrandOnderVuur(campagne({ isBranded: false })).triggered.length === 0, "op een niet-branded campagne bestaat dit verhaal niet");
assert(detectBrandOnderVuur(campagne({ isBranded: true, impressions: 8000 })).triggered.length === 0, "met wegvallende vraag (impressies min twintig procent) triggert het niet; dan is het de markt");

// ── A3: PMax-kannibalisatie ──
assert(tokenOverlapRatio(["hardloopschoenen heren", "running shoes"], ["hardloopschoenen kopen", "beste hardloopschoenen heren"]) >= 0.5, "de token-overlap vindt de gedeelde kerntermen");
assert(tokenOverlapRatio([], ["iets"]) === 0, "zonder labels is de overlap nul");
const kanni = detectPmaxKannibalisatie({
  searchCampaignName: "Search NL", pmaxCampaignName: "PMax NL",
  pmaxCategoryLabels: ["hardloopschoenen heren", "hardloopschoenen dames"],
  searchTerms: ["hardloopschoenen kopen", "hardloopschoenen heren maat 43", "dames hardloopschoenen"],
  searchImpressions: 8000, prevSearchImpressions: 10000,
  pmaxImpressions: 12000, prevPmaxImpressions: 10000,
});
assert(kanni.triggered.length === 1 && kanni.triggered[0].id === "pmax_kannibalisatie", "overlap plus tegengestelde impressie-beweging: kannibalisatie");
assert(kanni.triggered[0].certainty === "indicatie", "kannibalisatie blijft een indicatie, want Google toont de verdringing niet exact");
const geenOverlap = detectPmaxKannibalisatie({
  searchCampaignName: "s", pmaxCampaignName: "p",
  pmaxCategoryLabels: ["tuinmeubelen"], searchTerms: ["hardloopschoenen kopen"],
  searchImpressions: 8000, prevSearchImpressions: 10000, pmaxImpressions: 12000, prevPmaxImpressions: 10000,
});
assert(geenOverlap.triggered.length === 0, "zonder token-overlap geen kannibalisatie-verhaal, ook al bewegen de impressies");

// ── B1: markt-shift bevestigd ──
const decompKromp: DemandShareDecomposition = { verdict: "markt_kromp", impressionsDeltaPct: -0.3, marketEffect: -3000, shareEffect: 0, detail: "" };
const bevestigd = detectMarktShiftBevestigd({ scope: "account", decomposition: decompKromp, searchTermsVolume: 45000, prevSearchTermsVolume: 52000, yoyImpressionsPct: -0.12 });
assert(bevestigd.triggered.length === 1 && bevestigd.triggered[0].certainty === "bewezen_binnen_platform", "drie bevestigende bronnen: bewezen marktkrimp");
assert(bevestigd.triggered[0].story.includes("geen prestatieprobleem"), "het verhaal beschermt tegen onterecht ingrijpen");
const nietBevestigd = detectMarktShiftBevestigd({ scope: "account", decomposition: decompKromp, searchTermsVolume: 52000, prevSearchTermsVolume: 52000, yoyImpressionsPct: -0.12 });
assert(nietBevestigd.triggered.length === 0, "zonder de zoektermen-bevestiging triggert het bevestigde verhaal niet (de decompositie zelf blijft de indicatie)");
const aandeelDecomp: DemandShareDecomposition = { verdict: "aandeel_verloren", impressionsDeltaPct: -0.3, marketEffect: 0, shareEffect: -3000, detail: "" };
assert(detectMarktShiftBevestigd({ scope: "account", decomposition: aandeelDecomp, searchTermsVolume: 45000, prevSearchTermsVolume: 52000, yoyImpressionsPct: -0.12 }).triggered.length === 0, "een aandeel-verdict is geen markt-verhaal");

// ── B2: seizoenspatroon ──
const seizoen = detectSeizoenspatroon({ scope: "account", momDeltaPct: -0.2, yoySameMonthDeltaPct: 0.1 });
assert(seizoen.triggered.length === 1 && seizoen.triggered[0].id === "seizoensdip_geen_trendbreuk", "MoM omlaag maar YoY omhoog: seizoensdip");
const maskering = detectSeizoenspatroon({ scope: "account", momDeltaPct: 0.15, yoySameMonthDeltaPct: -0.2 });
assert(maskering.triggered.length === 1 && maskering.triggered[0].id === "stijging_maskeert_yoy_daling", "MoM omhoog maar YoY omlaag: de stijging maskeert een daling");
assert(maskering.triggered[0].story.includes("maskeert"), "het maskeringsverhaal benoemt het gevaar van de groene maandcijfers");
assert(detectSeizoenspatroon({ scope: "account", momDeltaPct: -0.2, yoySameMonthDeltaPct: null }).triggered.length === 0, "zonder YoY-data geen seizoensoordeel");

// ── Het frame: mergeDetections ──
const samen = mergeDetections([druk, brand, kanni, bevestigd, seizoen]);
assert(samen.triggered.length === 5, "de merge verzamelt alle getriggerde verhalen");
assert(samen.checked.length >= 6, "de merge verzamelt ook alle gecheckte verhalen (inclusief de stille)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
