// Test voor de M4-kern: selection, het briefing-contract en de designer-prompts.
// Deterministisch, geen IO. Draaien: npx tsx lib/meta/briefing/__briefing_kern_test.ts

import { selectBriefingPatterns, buildGapMatrix, pickExperiment, MAX_POSITIVE_PATTERNS, MAX_DONTS } from "./selection";
import { BriefingSchema, buildBriefingPrompt, BRIEFING_PROMPT_VERSION, type CreativeBriefing } from "./schema";
import { buildDesignerPrompt, buildDesignerPromptSet, DESIGNER_RATIOS } from "./designer-prompt";
import type { PatternAggregate } from "../vision/patterns";
import type { BriefingBrandContext } from "@/lib/branding/brand-guide";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function patroon(o: Partial<PatternAggregate> = {}): PatternAggregate {
  return {
    attribute: "style",
    value: "ugc",
    metric: "hook_rate",
    nAds: 5,
    impressions: 100000,
    conversions: 40,
    patternValue: 0.4,
    accountAvg: 0.3,
    liftPct: 0.33,
    evidenceLevel: "deterministic",
    ...o,
  };
}

// ── Selectie: gewicht-sortering en maxima ──
const veelPatronen = [
  patroon({ value: "ugc", liftPct: 0.2, impressions: 1000000 }),
  patroon({ value: "studio", liftPct: 0.5, impressions: 10000 }),
  patroon({ value: "meme", liftPct: -0.4, impressions: 100000 }),
  patroon({ attribute: "gaze_at_camera", value: "true", liftPct: 0.38, impressions: 412000 }),
  patroon({ attribute: "composition", value: "collage", liftPct: -0.2, impressions: 50000, evidenceLevel: "inferred" }),
];
const selectie = selectBriefingPatterns({ patterns: veelPatronen, replacements: [{ adId: "ad-1", reason: "winnaar maar vermoeid" }] });
assert(selectie.status === "voldoende_bewijs", "vier deterministic-patronen is voldoende bewijs");
if (selectie.status === "voldoende_bewijs") {
  assert(selectie.positives[0].pattern.attribute === "gaze_at_camera", "de sortering weegt lift maal log-impressies: 38 procent op 412k wint van 50 procent op 10k");
  assert(selectie.positives.every((s) => s.pattern.liftPct > 0) && selectie.donts.every((s) => s.pattern.liftPct < 0), "positieven en don'ts zijn gescheiden op de lift-richting");
  assert(!selectie.positives.concat(selectie.donts).some((s) => s.pattern.evidenceLevel === "inferred"), "inferred-patronen komen de briefing niet in");
  assert(selectie.replacements.length === 1, "de vervangingskandidaten reizen mee");
}
assert(MAX_POSITIVE_PATTERNS === 6 && MAX_DONTS === 3, "de spec-maxima staan op 6 en 3");

// ── Het insufficient-data-pad ──
const teWeinig = selectBriefingPatterns({ patterns: [patroon(), patroon({ value: "studio" })], replacements: [] });
assert(teWeinig.status === "onvoldoende_bewijs", "twee deterministic-patronen is onvoldoende voor concepten");
if (teWeinig.status === "onvoldoende_bewijs") {
  assert(teWeinig.deterministicCount === 2 && teWeinig.needed.includes("minstens 3"), "het pad benoemt de telling en wat er nodig is");
}

// ── De gap-matrix en het experiment ──
const metGat = [...veelPatronen, patroon({ attribute: "style", value: "3d", nAds: 1, liftPct: 0 })];
const gaps = buildGapMatrix(metGat);
assert(gaps.length === 1 && gaps[0].value === "3d", "een attribuut-waarde met 1 ad is een gat");
assert(gaps[0].reasoning.includes("bewezen relevant") && gaps[0].reasoning.includes("50%"), "de gap-redenatie draagt de tegenhanger-lift als leesbaar procent");
assert(pickExperiment(gaps)!.value === "3d", "het experiment kiest het gat met de sterkste tegenhanger-redenatie");

// ── Het briefing-schema: de geldige factory ──
function concept(o: Partial<CreativeBriefing["concepten"][number]> = {}): CreativeBriefing["concepten"][number] {
  return {
    naam: "UGC oogcontact",
    doelEnFunnelfase: "prospecting, koude doelgroep",
    format: "video",
    aantalVarianten: 2,
    specs: { ratio_1_1: "1080x1080", ratio_4_5: "1080x1350", ratio_9_16: "1080x1920, safe zones vrij" },
    hook: "gezicht met oogcontact in de eerste seconde",
    visueleRichting: { stijl: "ugc", mensProduct: "mens met product in hand", compositie: "center", kleurpaletHex: ["#f80808"] },
    tekstOverlay: { gebruiken: true, maxDekkingPct: 15, leesbaarheidEis: "goed leesbaar op mobiel" },
    copyRichtingEnCta: "direct, met Shop nu",
    referentieAds: ["ad-1"],
    referentiePatronen: ["gaze_at_camera=true"],
    testhypothese: { verwachting: "hogere hook rate", successMetric: "hook_rate", guardrailMetric: "cpa", meetvensterDagen: 14, accept: "hook rate stijgt", reject: "geen beweging" },
    isExperiment: false,
    experimentRedenatie: null,
    ...o,
  };
}
function briefing(concepten: CreativeBriefing["concepten"]): unknown {
  return {
    kop: { klant: "Minismus", periodeBasis: "2026-06 plus 90 dagen", doelstelling: "CPA 12,50", funnelfocus: "prospecting" },
    watWerkt: [{ richtlijn: "UGC met oogcontact: hook rate 38% boven gemiddelde (n=5, 412k impressies)", referentiePatroon: "gaze_at_camera=true" }],
    donts: [{ richtlijn: "meme-stijl: 40% onder gemiddelde", referentiePatroon: "style=meme" }],
    vervangingsurgentie: [{ adId: "ad-1", instructie: "vervang met 2 varianten op hetzelfde concept" }],
    concepten,
    productieChecklist: { aantallenPerConceptEnPlacement: "2 per concept per ratio", naamgevingsconventie: "conceptslug in adnaam", aanleverformaten: "mp4 en jpg" },
  };
}
const experiment = concept({ naam: "Onbewezen: 3d-stijl test", isExperiment: true, referentieAds: [], referentiePatronen: [], experimentRedenatie: "style is bewezen relevant; 3d is onbeproefd" });
const geldig = briefing([concept(), concept({ naam: "B" }), concept({ naam: "C" }), experiment]);
assert(BriefingSchema.safeParse(geldig).success, "een briefing met drie bewezen concepten plus het ene experiment parseert");

assert(!BriefingSchema.safeParse(briefing([concept(), concept({ naam: "B" }), concept({ naam: "C" })])).success, "zonder experiment faalt de briefing (precies een is verplicht)");
assert(!BriefingSchema.safeParse(briefing([concept(), concept({ naam: "B" }), experiment, { ...experiment, naam: "Onbewezen: tweede" }])).success, "twee experimenten falen ook");
const guardrailGelijk = concept({ testhypothese: { verwachting: "x", successMetric: "cpa", guardrailMetric: "CPA", meetvensterDagen: 14, accept: "a", reject: "r" } });
assert(!BriefingSchema.safeParse(briefing([guardrailGelijk, concept({ naam: "B" }), concept({ naam: "C" }), experiment])).success, "een guardrail gelijk aan de success-metric faalt (F5, hoofdletterongevoelig)");
assert(!BriefingSchema.safeParse(briefing([concept({ referentieAds: [] }), concept({ naam: "B" }), concept({ naam: "C" }), experiment])).success, "een bewezen concept zonder referentie-ads faalt");
assert(!BriefingSchema.safeParse(briefing([concept(), concept({ naam: "B" }), concept({ naam: "C" }), concept({ naam: "zonder label", isExperiment: true, referentieAds: [], referentiePatronen: [], experimentRedenatie: "reden" })])).success, "een experiment zonder onbewezen in de naam faalt (test-label verplicht)");

// ── De builder-prompt ──
if (selectie.status === "voldoende_bewijs") {
  const prompt = buildBriefingPrompt({
    selection: selectie,
    brand: { brandName: "Minismus", proposition: "p", keyMessages: [], brandColors: ["#08288c"], toneOfVoice: { dos: ["direct"], donts: [] }, forbiddenWords: [], mandatoryElements: [] },
    kop: { klant: "Minismus", periodeBasis: "2026-06", doelstelling: "CPA 12,50", funnelfocus: "prospecting" },
  });
  assert(prompt.version === BRIEFING_PROMPT_VERSION, "de builder-prompt is versievast");
  assert(prompt.system.includes("FORMULEERT") && prompt.system.includes("onbewezen"), "de systeemprompt eist formuleren-uitsluitend en het experiment-label");
  assert(prompt.user.includes('"liftPct":38'), "de lift reist als leesbaar procent (38) mee in de input");
}

// ── De designer-prompts ──
const brand: BriefingBrandContext = { brandName: "Minismus", proposition: "p", keyMessages: [], brandColors: ["#08288c"], toneOfVoice: { dos: ["warm"], donts: ["schreeuwerig"] }, forbiddenWords: ["goedkoop"], mandatoryElements: [] };
const dp = buildDesignerPrompt({ conceptNaam: "UGC oogcontact", stijl: "ugc", mensProduct: "mens met product", compositie: "center", hook: "oogcontact", kleurpaletHex: ["#f80808"], achtergrond: "clean", isExperiment: false }, brand, "9:16");
assert(dp.positive.includes("ugc-stijl") && dp.positive.includes("#f80808") && dp.positive.includes("Minismus") && dp.positive.includes("#08288c"), "de positive draagt stijl, palet-hex, merknaam en merkkleur");
assert(dp.negative.includes("goedkoop") && dp.negative.includes("schreeuwerig") && dp.negative.includes("watermerken"), "de negative draagt verboden woorden, tone-donts en de standaarduitsluitingen");
assert(dp.positive.includes("safe zones") && dp.midjourneySuffix === " --ar 9:16", "9:16 krijgt de safe-zone-zin en het Midjourney-suffix");
const dpVierkant = buildDesignerPrompt({ conceptNaam: "x", stijl: "studio", mensProduct: "product", compositie: "thirds", hook: "h", kleurpaletHex: ["#ffffff"], isExperiment: true }, brand, "1:1");
assert(!dpVierkant.positive.includes("safe zones") && dpVierkant.label === "ONBEWEZEN TEST", "1:1 heeft geen safe-zone-zin en het experiment draagt het test-label");
assert(buildDesignerPromptSet({ conceptNaam: "x", stijl: "ugc", mensProduct: "m", compositie: "center", hook: "h", kleurpaletHex: ["#f80808"], isExperiment: false }, brand).length === DESIGNER_RATIOS.length, "de set levert een prompt per ratio");
assert(dp.positive === buildDesignerPrompt({ conceptNaam: "UGC oogcontact", stijl: "ugc", mensProduct: "mens met product", compositie: "center", hook: "oogcontact", kleurpaletHex: ["#f80808"], achtergrond: "clean", isExperiment: false }, brand, "9:16").positive, "dezelfde input geeft exact dezelfde prompt (deterministisch, geen LLM)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
