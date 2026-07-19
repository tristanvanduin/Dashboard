// Zelf-draaiende test voor de kanaal-afleiding van de inzichten-laag. Draait via tsx.
// Kern: de nieuwe signaal-bronnen mappen op hun kanaal, al het oudere op Google (de
// bewuste default), en sop_type gebruikt dezelfde sleutelruimte.

import { channelOfSource, channelOfSopType } from "./channel-of";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

console.log("bron -> kanaal:");
assert(channelOfSource("meta_signals") === "meta", "meta_signals => meta");
assert(channelOfSource("linkedin_signals") === "linkedin", "linkedin_signals => linkedin");
assert(channelOfSource("cross_channel") === "cross", "cross_channel => cross");
for (const s of ["analysis", "second_opinion", "search_terms", "budget_allocation", "bid_strategy", "impression_share", "rsa_insights", "landing_audit"]) {
  assert(channelOfSource(s) === "google", `${s} => google (Google-pijplijn)`);
}
assert(channelOfSource(null) === "google", "null => google (default)");
assert(channelOfSource(" Meta_Signals ") === "meta", "trim + case-ongevoelig");

console.log("sop_type -> kanaal:");
assert(channelOfSopType("monthly") === "google", "monthly => google");
assert(channelOfSopType("meta_monthly") === "meta", "meta_monthly (Meta-SOP) => meta");
assert(channelOfSopType("linkedin_monthly") === "linkedin", "linkedin_monthly (LinkedIn-SOP) => linkedin");
assert(channelOfSopType("meta_funnel") === "meta", "meta_funnel => meta");
assert(channelOfSopType("linkedin_icp") === "linkedin", "linkedin_icp => linkedin");
assert(channelOfSopType("meta_briefing") === "meta", "meta_briefing => meta");
assert(channelOfSopType("meta_creatives") === "meta", "meta_creatives => meta");
assert(channelOfSopType("linkedin_signals") === "linkedin", "linkedin_signals => linkedin");
assert(channelOfSopType("cross_channel") === "cross", "cross_channel => cross");

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle channel-of-tests geslaagd");
