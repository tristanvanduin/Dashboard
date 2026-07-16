// Test voor de M3 ATTRIBUTE_SOURCE-guard. Deterministisch, geen IO.
// Draaien: npx tsx lib/meta/vision/__attribute_source_test.ts

import { assertAttributeSource, InvalidAttributeSourceError, ATTRIBUTE_SOURCE } from "./attribute-source";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Correcte toewijzingen gaan zonder fout ──
try { assertAttributeSource("dominant_colors", "pixel"); assert(true, "dominant_colors uit pixel is correct"); } catch { assert(false, "dominant_colors uit pixel had niet mogen falen"); }
try { assertAttributeSource("style", "vision"); assert(true, "style uit vision is correct"); } catch { assert(false, "style uit vision had niet mogen falen"); }

// ── Kleur-claim uit vision: hard geblokkeerd ──
for (const attr of ["dominant_colors", "avg_brightness", "contrast", "saturation", "is_dark_mode"]) {
  let threw = false;
  try { assertAttributeSource(attr, "vision"); } catch (e) { threw = e instanceof InvalidAttributeSourceError; }
  assert(threw, `${attr} uit vision wordt geblokkeerd (kleur-claim moet uit pixel)`);
}

// ── color_mood is een sfeerlabel, geen hex-claim: blijft terecht vision ──
try { assertAttributeSource("color_mood", "vision"); assert(true, "color_mood is geen kleur-claim en mag uit vision"); } catch { assert(false, "color_mood had niet moeten falen"); }

// ── Verkeerde bron voor een niet-kleur-attribuut ──
let threwWrongSource = false;
try { assertAttributeSource("style", "pixel"); } catch (e) { threwWrongSource = e instanceof InvalidAttributeSourceError; }
assert(threwWrongSource, "style uit pixel is fout (hoort bij vision)");

// ── Onbekend attribuut ──
let threwUnknown = false;
try { assertAttributeSource("niet_bestaand_veld", "vision"); } catch (e) { threwUnknown = e instanceof InvalidAttributeSourceError; }
assert(threwUnknown, "een onbekend attribuut geeft een fout");

// ── De kaart dekt alle attributen uit de M3-spec ──
assert(Object.keys(ATTRIBUTE_SOURCE).length >= 27, "de kaart dekt alle pixel- en vision-attributen uit de spec");
assert(Object.values(ATTRIBUTE_SOURCE).filter((s) => s === "pixel").length === 8, "acht attributen zijn pixel-laag");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
