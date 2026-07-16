// Test voor X4 lens 3 (doelgroep- en boodschapsamenhang). Deterministisch, geen IO.
// Draaien: npx tsx lib/cross-channel/__audience_coherence_test.ts

import { audienceContradiction, creativeTransferCandidates, CONTRADICTION_THRESHOLD, type ConvertingSegment, type TargetProfile } from "./audience-coherence";
import { ATTRIBUTION_FOOTNOTE } from "./lens-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const icpProfiel: TargetProfile = {
  channel: "linkedin_ads",
  byDimension: { industry: ["software", "fintech"], seniority: ["director", "vp", "cxo"] },
};

// ── Tegenspraak op een gedeelde dimensie ──
const metaConverterend: ConvertingSegment[] = [
  { dimension: "industry", value: "Retail", conversionShare: 0.45 },
  { dimension: "industry", value: "Horeca", conversionShare: 0.25 },
  { dimension: "industry", value: "Software", conversionShare: 0.3 },
  { dimension: "age", value: "25-34", conversionShare: 0.6 },
];
const r = audienceContradiction({ channel: "meta_ads", segments: metaConverterend }, icpProfiel);
const flag = r.flags.find((f) => f.dimension === "industry");
assert(flag != null, "70 procent conversies buiten het ICP op industry geeft de tegenspraak-flag");
assert(flag!.outsideProfileSharePct === 70, "het buiten-profiel-aandeel is 70 procent (retail plus horeca)");
assert(flag!.convertingSegments.length === 3 && flag!.profileValues.includes("software"), "de flag draagt beide bronsegmenten (spec-eis)");
assert(flag!.detail.includes("tegenstrijdig doelgroepverhaal"), "de detail benoemt de strategische tegenspraak");
assert(r.attributionFootnote === ATTRIBUTION_FOOTNOTE, "lens 3 draagt de voetnoot");

// ── Degradatie: niet-gedeelde dimensies expliciet overgeslagen, beide richtingen ──
assert(r.comparedDimensions.length === 1 && r.comparedDimensions[0] === "industry", "alleen de gedeelde dimensie (industry) wordt vergeleken");
assert(r.skippedDimensions.some((s) => s.dimension === "age" && s.reason.includes("kent geen age")), "age heeft geen ICP-kant en wordt expliciet overgeslagen");
assert(r.skippedDimensions.some((s) => s.dimension === "seniority" && s.reason.includes("geen converterende segmenten")), "seniority heeft geen Meta-kant en wordt expliciet overgeslagen");

// ── Onder de drempel: geen flag ──
const consistent: ConvertingSegment[] = [
  { dimension: "industry", value: "Software", conversionShare: 0.55 },
  { dimension: "industry", value: "Fintech", conversionShare: 0.15 },
  { dimension: "industry", value: "Retail", conversionShare: 0.3 },
];
const rc = audienceContradiction({ channel: "meta_ads", segments: consistent }, icpProfiel);
assert(rc.flags.length === 0, "30 procent buiten profiel blijft onder de drempel van 50: geen flag");

// ── Case-ongevoelig ──
const caseTest = audienceContradiction({ channel: "meta_ads", segments: [{ dimension: "industry", value: "SOFTWARE", conversionShare: 0.9 }] }, icpProfiel);
assert(caseTest.flags.length === 0, "SOFTWARE matcht software: case-ongevoelig, geen valse tegenspraak");

// ── Geen gedeelde dimensies: alles degradeert, geen flags ──
const geenGedeeld = audienceContradiction({ channel: "meta_ads", segments: [{ dimension: "age", value: "25-34", conversionShare: 0.8 }] }, icpProfiel);
assert(geenGedeeld.flags.length === 0 && geenGedeeld.comparedDimensions.length === 0 && geenGedeeld.skippedDimensions.length === 3, "zonder gedeelde dimensie: geen vergelijking, alles expliciet overgeslagen");

// ── Creatieve overdracht: het M3-degradatiepad ──
const zonderM3 = creativeTransferCandidates(null, ["google_ads", "linkedin_ads"]);
assert(!zonderM3.available && zonderM3.degradedReason!.includes("M3"), "zonder M3-data degradeert de subcheck met een melding, hij blokkeert niet");
assert(zonderM3.hypotheses.length === 0, "zonder data geen hypothesen");
const leegM3 = creativeTransferCandidates([], ["google_ads"]);
assert(!leegM3.available, "een lege patroonlijst degradeert ook");

// ── Met M3-data: hard gelabelde hypothesen, nooit feiten ──
const metM3 = creativeTransferCandidates(
  [{ pattern: "ugc boven studio", evidence: "hogere hook rate en lagere CPA over drie maanden" }],
  ["google_ads", "linkedin_ads"]
);
assert(metM3.available && metM3.hypotheses.length === 1, "met M3-data komen de kandidaat-hypothesen");
assert(metM3.hypotheses[0].label === "hypothese", "de hypothese is hard gelabeld");
assert(metM3.hypotheses[0].statement.includes("ONBEWEZEN") && metM3.hypotheses[0].statement.includes("niet als feit"), "de statement zegt expliciet cross-channel onbewezen en niet als feit overnemen");

assert(CONTRADICTION_THRESHOLD === 0.5, "de tegenspraak-drempel is 50 procent");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
