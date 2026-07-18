// Zelf-draaiende test voor de signaal->wachtrij-mapper (SI8). Draait via tsx.
// Kern: het ICE-vertrouwen volgt het zekerheidslabel (nooit meer zekerheid dan de detector),
// aggregatie tot één voorstel, en leeg bij geen verhalen.

import { signalStoriesToHypotheses } from "./signals-to-hypotheses";
import type { SignalStory } from "@/lib/signals/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const story = (id: string, certainty: SignalStory["certainty"]): SignalStory => ({
  id, category: "cross_channel", scope: "test", story: `verhaal ${id}.`,
  actionDirection: `richting ${id}`, certainty, evidence: [{ metric: "m", value: 1 }],
});
const opts = { clientId: "c1", analysisId: null };

console.log("zekerheid -> vertrouwen:");
{
  const proven = signalStoriesToHypotheses([story("a", "bewezen_binnen_platform")], "meta_signals", opts);
  assert(proven[0].ice_confidence === 8, "bewezen_binnen_platform => vertrouwen 8");
  const ind = signalStoriesToHypotheses([story("a", "indicatie")], "linkedin_signals", opts);
  assert(ind[0].ice_confidence === 5, "indicatie => vertrouwen 5");
  const cand = signalStoriesToHypotheses([story("a", "verklaringskandidaat")], "cross_channel", opts);
  assert(cand[0].ice_confidence === 3, "verklaringskandidaat => vertrouwen 3");
  const mixed = signalStoriesToHypotheses([story("a", "verklaringskandidaat"), story("b", "indicatie")], "cross_channel", opts);
  assert(mixed[0].ice_confidence === 5, "gemengd: hoogste zekerheid bepaalt vertrouwen");
}

console.log("aggregatie en bron:");
{
  const rows = signalStoriesToHypotheses([story("a", "indicatie"), story("b", "indicatie"), story("c", "indicatie")], "meta_signals", opts);
  assert(rows.length === 1, "drie verhalen => één voorstel");
  assert(rows[0].source === "meta_signals", "bron meta_signals");
  assert(/3 gedetecteerd/.test(rows[0].hypothesis) && /Meta/.test(rows[0].hypothesis), "hypothese telt en labelt het kanaal");
  assert(rows[0].ice_impact === 7, "impact schaalt met aantal (3 => 7)");
  assert(/\[indicatie\]/.test(rows[0].rationale), "zekerheidslabel behouden in de rationale");
  assert(rows[0].ice_total === Math.round(((7 + 5 + 5) / 3) * 10) / 10, "ICE-totaal afgeleid");
}

console.log("leeg:");
{
  assert(signalStoriesToHypotheses([], "cross_channel", opts).length === 0, "geen verhalen => leeg (verversen)");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle signals-to-hypotheses-tests geslaagd");
