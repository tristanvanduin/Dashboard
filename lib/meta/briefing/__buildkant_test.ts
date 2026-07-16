// Test voor de M3/M4 build-kant-kernen: fatigue en de beide renders. Deterministisch.
// Draaien: npx tsx lib/meta/briefing/__buildkant_test.ts

import { aggregateAdWindow, buildFatigueInputs, FATIGUE_CTR_DROP, FATIGUE_MIN_FREQUENCY, type AdDailyRow } from "./fatigue";
import { flagFatiguedWinners } from "../vision/patterns";
import { renderBriefingMarkdown, renderInsufficientMarkdown } from "./render";
import { BriefingSchema, type CreativeBriefing } from "./schema";
import { selectBriefingPatterns } from "./selection";
import { checkSanitization } from "@/lib/eval/output-checks";
import type { BriefingBrandContext } from "@/lib/branding/brand-guide";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── De venster-aggregatie ──
const dagen: AdDailyRow[] = [
  { adId: "a", impressions: 4000, linkClicks: 80, conversions: 6, frequency: 3.5 },
  { adId: "a", impressions: 6000, linkClicks: 100, conversions: 4, frequency: 4.1 },
  { adId: "b", impressions: 8000, linkClicks: 240, conversions: 0, frequency: 1.2 },
];
const venster = aggregateAdWindow(dagen);
assert(venster.get("a")!.impressions === 10000 && venster.get("a")!.conversions === 10, "de dag-rijen sommeren per ad");
assert(venster.get("a")!.ctr === 0.018, "de venster-CTR is linkclicks gedeeld door impressies");
assert(venster.get("a")!.frequency === 3.9, "de frequency is impressie-gewogen gemiddeld (3,5 op 4k en 4,1 op 6k geeft 3,9)");

// ── De classificatie plus de integratie met flagFatiguedWinners ──
function summary(adId: string, ctr: number, freq: number, conv: number, impr = 10000) {
  return { adId, impressions: impr, ctr, frequency: freq, conversions: conv };
}
const recent = new Map([
  ["moe", summary("moe", 0.010, 3.8, 12)],
  ["fit", summary("fit", 0.020, 2.0, 8)],
  ["klein", summary("klein", 0.005, 5.0, 3, 2000)],
  ["nieuw", summary("nieuw", 0.015, 1.5, 5)],
]);
const prior = new Map([
  ["moe", summary("moe", 0.016, 3.0, 10)],
  ["fit", summary("fit", 0.021, 1.8, 9)],
  ["klein", summary("klein", 0.010, 4.0, 2)],
]);
const inputs = buildFatigueInputs(recent, prior);
const moe = inputs.find((i) => i.adId === "moe")!;
assert(moe.isWinner && moe.fatigueStatus === "vermoeid" && moe.ctrDeltaPct === -0.37, "een winnaar met 37 procent CTR-daling en frequency 3,8 is vermoeid");
assert(inputs.find((i) => i.adId === "fit")!.fatigueStatus === "gezond", "een stabiele winnaar is gezond");
assert(inputs.find((i) => i.adId === "klein")!.fatigueStatus === "onbekend", "onder het minimum-volume geen oordeel");
assert(inputs.find((i) => i.adId === "nieuw")!.fatigueStatus === "onbekend", "zonder prior-venster geen oordeel");
assert(FATIGUE_CTR_DROP === -0.25 && FATIGUE_MIN_FREQUENCY === 3, "de drempels staan op min 25 procent en frequency 3");
const vervanging = flagFatiguedWinners(inputs);
assert(vervanging.length === 1 && vervanging[0].adId === "moe", "de keten fatigue naar flagFatiguedWinners levert precies de vermoeide winnaar");

// ── De briefing-render ──
const brand: BriefingBrandContext = { brandName: "Minismus", proposition: "p", keyMessages: [], brandColors: ["#08288c"], toneOfVoice: { dos: ["warm"], donts: ["schreeuwerig"] }, forbiddenWords: ["goedkoop"], mandatoryElements: [] };
function concept(naam: string, isExperiment = false): CreativeBriefing["concepten"][number] {
  return {
    naam: isExperiment ? `Onbewezen: ${naam}` : naam,
    doelEnFunnelfase: "prospecting",
    format: "video",
    aantalVarianten: 2,
    specs: { ratio_1_1: "1080x1080", ratio_4_5: "1080x1350", ratio_9_16: "1080x1920 safe zones vrij" },
    hook: "oogcontact in de eerste seconde",
    visueleRichting: { stijl: "ugc", mensProduct: "mens met product", compositie: "center", kleurpaletHex: ["#f80808"] },
    tekstOverlay: { gebruiken: true, maxDekkingPct: 15, leesbaarheidEis: "leesbaar op mobiel" },
    copyRichtingEnCta: "direct, Shop nu",
    referentieAds: isExperiment ? [] : ["ad-1"],
    referentiePatronen: isExperiment ? [] : ["gaze_at_camera=true"],
    testhypothese: { verwachting: "hogere hook rate", successMetric: "hook_rate", guardrailMetric: "cpa", meetvensterDagen: 14, accept: "stijgt", reject: "vlak" },
    isExperiment,
    experimentRedenatie: isExperiment ? "style is bewezen relevant; 3d is onbeproefd" : null,
  };
}
const briefing: CreativeBriefing = BriefingSchema.parse({
  kop: { klant: "Minismus", periodeBasis: "2026-06-01 tot 2026-06-30", doelstelling: "CPA-target 12.5", funnelfocus: "prospecting" },
  watWerkt: [{ richtlijn: "UGC met oogcontact: 38% boven gemiddelde (n=5, 412000 impressies)", referentiePatroon: "gaze_at_camera=true" }],
  donts: [{ richtlijn: "meme-stijl blijft achter", referentiePatroon: "style=meme" }],
  vervangingsurgentie: [{ adId: "moe", instructie: "vervang met 2 varianten op hetzelfde concept" }],
  concepten: [concept("A"), concept("B"), concept("C"), concept("3d-stijl", true)],
  productieChecklist: { aantallenPerConceptEnPlacement: "2 per ratio", naamgevingsconventie: "conceptslug in adnaam", aanleverformaten: "mp4 en jpg" },
});
const markdown = renderBriefingMarkdown(briefing, brand);
assert(markdown.includes("# Creative briefing: Minismus") && markdown.includes("## Wat werkt en waarom") && markdown.includes("## Concepten") && markdown.includes("## Productie-checklist"), "de markdown draagt de spec-secties");
assert(markdown.includes("[ONBEWEZEN TEST]") && markdown.includes("Waarom dit experiment"), "het experiment is gelabeld en draagt de gap-redenatie");
assert(markdown.includes("Referenties: ads ad-1"), "bewezen concepten dragen hun referenties");
assert(markdown.includes("Designer-prompts") && markdown.includes("--ar 9:16") && markdown.includes("Negative:") && markdown.includes("goedkoop"), "elke concept-sectie bevat de designer-prompt-set met negative en het Midjourney-suffix");
assert(markdown.includes("#f80808") && markdown.includes("#08288c"), "het gemeten palet en de merkkleur staan in de prompts");
assert(checkSanitization(markdown).passed, "de briefing-markdown is vrij van em-dashes en mojibake (onafhankelijke check)");

// ── De insufficient-render ──
const teWeinig = selectBriefingPatterns({ patterns: [], replacements: [{ adId: "moe", reason: "winnaar met 38% CTR-daling bij frequency 3.8" }] });
assert(teWeinig.status === "onvoldoende_bewijs", "zonder patronen is het pad onvoldoende bewijs");
if (teWeinig.status === "onvoldoende_bewijs") {
  const insufficientMarkdown = renderInsufficientMarkdown(teWeinig, { klant: "Minismus", periodeBasis: "2026-06" });
  assert(insufficientMarkdown.includes("Nog onvoldoende creative-bewijs") && insufficientMarkdown.includes("minstens 3"), "de pagina zegt eerlijk wat er nodig is");
  assert(insufficientMarkdown.includes("Wel al urgent") && insufficientMarkdown.includes("moe"), "de vervangingsurgentie staat er wel op");
  assert(insufficientMarkdown.includes("[ONBEWEZEN TEST, best practice]") && insufficientMarkdown.includes("geen accountbewijs"), "het generieke experiment is duidelijk gelabeld als best practice zonder accountbewijs");
  assert(checkSanitization(insufficientMarkdown).passed, "ook de insufficient-pagina is schoon");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
