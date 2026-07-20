// Zelf-draaiende test voor de action-gating (de veiligheidspoort). Draait via tsx.
// Kern: 'direct_action' mag alleen bij deterministisch + hoog vertrouwen; kleine bedragen en
// laag-vertrouwde/hypothese-aanbevelingen worden gedowngraded; en tegenstrijdige budgetacties
// op dezelfde entiteit vallen allebei terug naar 'investigate_first'. Een gat hier laat zwak
// bewijs door als directe actie — precies wat deze poort moet tegenhouden.

import { applyActionGating } from "./action-gating";
import type { Finding, Recommendation } from "../schema/analysis-schema";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const rec = (over: Record<string, unknown>): Recommendation => ({
  finding_index: null, source: "finding", hypothesis: "", action_readiness: "direct_action",
  evidence_level: "deterministic", confidence: "high", ...over,
} as unknown as Recommendation);

const finding = (over: Record<string, unknown>): Finding => ({
  entity_name: "Entiteit", current_value: 100, insight_type: "trend", confidence: "high", ...over,
} as unknown as Finding);

const readiness = (r: Recommendation): string => (r as Record<string, unknown>).action_readiness as string;

console.log("regel 1 — direct_action vereist deterministisch + hoog:");
{
  const ok = applyActionGating([], [rec({ evidence_level: "deterministic", confidence: "high" })]);
  assert(readiness(ok[0]) === "direct_action", "deterministisch + hoog blijft direct_action");
  const lowConf = applyActionGating([], [rec({ evidence_level: "deterministic", confidence: "medium" })]);
  assert(readiness(lowConf[0]) === "investigate_first", "medium vertrouwen => investigate_first");
  const inferred = applyActionGating([], [rec({ evidence_level: "inferred", confidence: "high" })]);
  assert(readiness(inferred[0]) === "investigate_first", "niet-deterministisch bewijs => investigate_first");
}

console.log("regel 2 — klein bedrag en laag-vertrouwde finding:");
{
  const small = applyActionGating(
    [finding({ current_value: 30, insight_type: "trend" })],
    [rec({ finding_index: 0 })]
  );
  assert(readiness(small[0]) === "monitor", "waste onder €50 (geen anomaly) => monitor");

  const anomaly = applyActionGating(
    [finding({ current_value: 30, insight_type: "anomaly" })],
    [rec({ finding_index: 0 })]
  );
  assert(readiness(anomaly[0]) === "direct_action", "klein bedrag maar anomaly => niet gedowngraded");

  const lowFinding = applyActionGating(
    [finding({ current_value: 100, confidence: "low" })],
    [rec({ finding_index: 0 })]
  );
  assert(readiness(lowFinding[0]) === "investigate_first", "laag-vertrouwde finding => investigate_first");
}

console.log("regel 3 — hypothese-bron:");
{
  const hyp = applyActionGating([], [rec({ source: "hypothesis" })]);
  assert(readiness(hyp[0]) === "strategic_hypothesis", "bron hypothese => strategic_hypothesis");
}

console.log("regel 4 — tegenstrijdige budgetacties op dezelfde entiteit:");
{
  const recs = applyActionGating(
    [finding({ entity_name: "Campagne X", current_value: 500 })],
    [
      rec({ finding_index: 0, hypothesis: "Verhoog budget voor deze campagne" }),
      rec({ finding_index: 0, hypothesis: "Verlaag budget voor deze campagne" }),
    ]
  );
  assert(readiness(recs[0]) === "investigate_first" && readiness(recs[1]) === "investigate_first",
    "budget omhoog + omlaag op dezelfde entiteit => beide investigate_first");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle action-gating-tests geslaagd");
