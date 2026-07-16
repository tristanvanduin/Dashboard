// Test voor X4 lens 4 en 5 (meetconsistentie en blended betrouwbaarheid). Deterministisch.
// Draaien: npx tsx lib/cross-channel/__measurement_reliability_test.ts

import { measurementConsistency, blendedReliability, OVERCLAIM_TOLERANCE, type ChannelMeasurementInput } from "./measurement-reliability";
import { ATTRIBUTION_FOOTNOTE } from "./lens-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function kanaal(o: Partial<ChannelMeasurementInput> & { channel: ChannelMeasurementInput["channel"] }): ChannelMeasurementInput {
  return { hasTarget: true, targetPlausible: true, conversionsTracked: true, trackingHealthy: true, attributionWindow: "click_30d", ...o };
}

// ── Lens 4: gezonde set ──
const gezond = measurementConsistency([kanaal({ channel: "google_ads" }), kanaal({ channel: "meta_ads" })]);
assert(gezond.issues.length === 0 && gezond.blendedConclusionsReliable, "twee gezonde kanalen: geen issues, blended betrouwbaar");
assert(gezond.attributionFootnote === ATTRIBUTION_FOOTNOTE, "lens 4 draagt de voetnoot");

// ── Geen target: hard ──
const geenTarget = measurementConsistency([kanaal({ channel: "google_ads" }), kanaal({ channel: "meta_ads", hasTarget: false, targetPlausible: null })]);
assert(geenTarget.issues.some((i) => i.kind === "geen_target" && i.severity === "hard"), "geen target is een hard issue");
assert(!geenTarget.blendedConclusionsReliable, "een hard issue maakt blended conclusies onbetrouwbaar");

// ── Implausibel target: zacht ──
const implausibel = measurementConsistency([kanaal({ channel: "google_ads", targetPlausible: false }), kanaal({ channel: "meta_ads" })]);
assert(implausibel.issues.some((i) => i.kind === "target_niet_plausibel" && i.severity === "zacht"), "een implausibel target is een zacht issue");
assert(implausibel.blendedConclusionsReliable, "alleen zachte issues laten de blended betrouwbaarheid staan");

// ── Geen tracking: hard plus blind kanaal ──
const blind = measurementConsistency([kanaal({ channel: "google_ads" }), kanaal({ channel: "linkedin_ads", conversionsTracked: false, trackingHealthy: null })]);
assert(blind.blindChannels.includes("linkedin_ads"), "een kanaal zonder tracking vliegt blind");
assert(blind.issues.some((i) => i.kind === "geen_tracking" && i.severity === "hard") && !blind.blendedConclusionsReliable, "geen tracking is hard en ondermijnt de blend");

// ── Ongezonde tracking: hard ──
const ongezond = measurementConsistency([kanaal({ channel: "google_ads", trackingHealthy: false }), kanaal({ channel: "meta_ads" })]);
assert(ongezond.issues.some((i) => i.kind === "tracking_ongezond" && i.severity === "hard"), "een trackingbreuk is een hard issue");

// ── Verschillende vensters: zacht, kanaal-overstijgend ──
const vensters = measurementConsistency([kanaal({ channel: "google_ads", attributionWindow: "click_30d" }), kanaal({ channel: "meta_ads", attributionWindow: "click_7d_view_1d" })]);
const vensterIssue = vensters.issues.find((i) => i.kind === "vensters_onvergelijkbaar");
assert(vensterIssue != null && vensterIssue.severity === "zacht" && vensterIssue.channel === null, "verschillende vensters zijn een zacht kanaal-overstijgend punt");
assert(vensterIssue!.detail.includes("click_30d") && vensterIssue!.detail.includes("click_7d_view_1d"), "de detail benoemt beide vensters");
// Onbekende vensters geven geen venster-oordeel
const onbekendVenster = measurementConsistency([kanaal({ channel: "google_ads", attributionWindow: null }), kanaal({ channel: "meta_ads", attributionWindow: "click_7d_view_1d" })]);
assert(!onbekendVenster.issues.some((i) => i.kind === "vensters_onvergelijkbaar"), "een venster-oordeel vergt minstens twee bekende vensters");

// ── Lens 5: zonder anker is de som een bovengrens ──
const conv = [{ channel: "google_ads" as const, conversions: 120 }, { channel: "meta_ads" as const, conversions: 80 }];
const bovengrens = blendedReliability(conv, null);
assert(bovengrens.blendedSum === 200 && bovengrens.interpretation === "som_is_bovengrens", "zonder anker: de som is expliciet een bovengrens");
assert(bovengrens.overAttributionPct === null, "zonder anker geen marge-getal");
assert(bovengrens.attributionFootnote === ATTRIBUTION_FOOTNOTE, "de voetnoot is het hoofdproduct van lens 5");

// ── Overclaim: marge als kanttekening ──
const overclaim = blendedReliability(conv, 150);
assert(overclaim.interpretation === "kanalen_overclaimen", "som 200 tegen anker 150 is overclaimen");
assert(overclaim.overAttributionPct !== null && Math.abs(overclaim.overAttributionPct - 33.3) < 0.2, "de over-attributie-marge is circa 33 procent");
assert(overclaim.detail.includes("geen exacte verdeling"), "de marge wordt als indicatie gebracht, nooit als harde verdeling");

// ── Consistent binnen de tolerantie ──
const consistent = blendedReliability(conv, 195);
assert(consistent.interpretation === "som_consistent_met_anker", "som 200 tegen anker 195 valt binnen de tolerantie");

// ── Anker boven de som ──
const meer = blendedReliability(conv, 260);
assert(meer.interpretation === "anker_boven_som" && meer.detail.includes("organisch"), "een anker boven de som wijst op niet-getrackte paden");

assert(OVERCLAIM_TOLERANCE === 0.1, "de overclaim-tolerantie is 10 procent");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
