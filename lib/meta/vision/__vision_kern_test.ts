// Test voor de M3 vision-kern: het semantic-schema en de pixel-core. Deterministisch.
// Draaien: npx tsx lib/meta/vision/__vision_kern_test.ts

import { CreativeVisionSchema, parseVisionResponse, buildVisionPrompt, VISION_PROMPT_VERSION, type CreativeVisionFeatures } from "./semantic";
import { analyzePixels, dominantColors, DARK_MODE_BRIGHTNESS, type RgbPixel } from "./pixel-core";
import { assertAttributeSource, InvalidAttributeSourceError } from "./attribute-source";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function geldigeFeatures(): CreativeVisionFeatures {
  return {
    style: "ugc",
    human_present: true,
    human_count: 1,
    face_close_up: true,
    gaze_at_camera: true,
    product_visible: true,
    product_prominence: "aanwezig",
    text_overlay_present: true,
    text_coverage_pct_estimate: 12,
    ocr_text: "Nu 20% korting",
    headline_in_visual: "Nu 20% korting",
    text_readability: "goed",
    logo_present: true,
    logo_position: "linksboven",
    cta_in_visual: true,
    hook_element: "gezicht met oogcontact vult het beeld",
    composition: "center",
    background: "clean",
    color_mood: "warm",
    emotion: "blij",
    claim_type: "aanbieding",
    safe_zone_risk: false,
    confidence: { text_coverage_pct_estimate: "estimate", style: "hoog" },
  };
}

// ── Het schema en de parse ──
assert(CreativeVisionSchema.safeParse(geldigeFeatures()).success, "een volledige, geldige feature-set parseert");
const parse = parseVisionResponse("```json\n" + JSON.stringify(geldigeFeatures()) + "\n```");
assert(parse.ok, "codefences worden gestript en de respons parseert");
const fouteStijl = { ...geldigeFeatures(), style: "cinematic" };
const parseFout = parseVisionResponse(JSON.stringify(fouteStijl));
assert(!parseFout.ok && parseFout.reason.includes("style"), "een waarde buiten de enum faalt met het veldpad in de reden (voedt de ene repair-call)");
const zonderEstimate = { ...geldigeFeatures(), confidence: { style: "hoog" } };
const parseEstimate = parseVisionResponse(JSON.stringify(zonderEstimate));
assert(!parseEstimate.ok && parseEstimate.reason.includes("estimate"), "de tekst-dekking moet als estimate gemarkeerd zijn, anders is de respons ongeldig");
assert(!parseVisionResponse("dit is geen json").ok, "rommel is geen geldige respons");

// ── De kleuren-no-go: structureel plus de guard ──
assert(!("dominant_colors" in geldigeFeatures()), "het vision-schema kent geen kleurveld: kleur-claims kunnen er structureel niet in");
let guardWerkt = false;
try {
  assertAttributeSource("dominant_colors", "vision");
} catch (e) {
  guardWerkt = e instanceof InvalidAttributeSourceError;
}
assert(guardWerkt, "de attribute-source-guard weigert een vision-claim op dominant_colors (kleur komt uit de pixel-laag)");

// ── De prompt ──
const prompt = buildVisionPrompt({ format: "single_image", adTitle: "Titel", adBody: "Body" });
assert(prompt.version === VISION_PROMPT_VERSION, "de vision-prompt is versievast");
assert(prompt.system.includes("geen kleuranalyse") && prompt.system.includes("estimate"), "de systeemprompt verbiedt kleuranalyse en eist de estimate-markering");
assert(prompt.user.includes("single_image") && prompt.user.includes("Titel"), "de ad-context reist mee voor OCR en claim-type");

// ── De pixel-core: de spec-fixtures ──
const rood: RgbPixel[] = Array.from({ length: 400 }, () => ({ r: 255, g: 0, b: 0 }));
const roodAnalyse = analyzePixels(rood);
assert(roodAnalyse.dominantColors[0].hex === "#f80808" && roodAnalyse.dominantColors[0].coveragePct === 100, "het rode vlak geeft een dominante kleur met volledige dekking (kwantisatie-midden)");
assert(Math.abs(roodAnalyse.avgBrightness - 29.9) < 0.2 && roodAnalyse.isDarkMode, "puur rood heeft een lage luminantie en telt als donker (Rec. 601)");
assert(roodAnalyse.contrast === 0 && roodAnalyse.saturation === 100, "een egaal vlak heeft nul contrast en rood is volledig verzadigd");
assert(DARK_MODE_BRIGHTNESS === 35, "de dark-mode-drempel staat op 35");

const witZwart: RgbPixel[] = [...Array.from({ length: 200 }, () => ({ r: 255, g: 255, b: 255 })), ...Array.from({ length: 200 }, () => ({ r: 0, g: 0, b: 0 }))];
const contrastAnalyse = analyzePixels(witZwart);
assert(Math.abs(contrastAnalyse.avgBrightness - 50) < 0.5 && Math.abs(contrastAnalyse.contrast - 50) < 0.5, "de wit-zwart-mix heeft brightness 50 en maximaal contrast");
assert(contrastAnalyse.dominantColors.length === 2 && contrastAnalyse.dominantColors[0].coveragePct === 50, "twee dominante kleuren met elk de helft van de dekking");

const grijs: RgbPixel[] = Array.from({ length: 100 }, () => ({ r: 128, g: 128, b: 128 }));
assert(analyzePixels(grijs).saturation === 0, "grijs is volledig onverzadigd");
assert(dominantColors([]).length === 0 && analyzePixels([]).avgBrightness === 0, "lege input degradeert netjes");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
