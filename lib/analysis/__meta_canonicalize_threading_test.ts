// Test van de canonicalize-alias-threading (gevouwen C1-rest). Bewijst dat de adapter-aliases
// gebonden door normalizeMetricName, normalizeFindings en canonicalizeFindings stromen, en dat
// de default de Google-constanten houdt (geen regressie, gedekt door de suite). Geen live data.
// Draaien: npx tsx lib/analysis/__meta_canonicalize_threading_test.ts

import { canonicalizeFindings, normalizeMetricName } from "./canonicalize";
import { metaAdsAdapter } from "./adapters/meta-ads";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// 1. normalizeMetricName met Meta-aliases normaliseert Meta-varianten.
assert(normalizeMetricName("link click-through", metaAdsAdapter.metricAliases) === "Link CTR", "Meta-alias: link click-through naar Link CTR");
assert(normalizeMetricName("hook rate", metaAdsAdapter.metricAliases) === "Hook rate", "Meta-alias: hook rate naar Hook rate");
assert(normalizeMetricName("thruplay rate", metaAdsAdapter.metricAliases) === "Hold rate", "Meta-alias: thruplay rate naar Hold rate");

// 2. De default (zonder Meta-aliases) kent deze Meta-specifieke mapping niet.
assert(normalizeMetricName("link click-through") !== "Link CTR", "default Google-aliases mappen link click-through niet naar Link CTR");

// 3. canonicalizeFindings voert de Meta-aliases door tot canonical_metric.
const findings = [
  { entity_type: "ad", entity_name: "Ad A", metric: "link click-through", cause: "test", evidence_level: "confirmed", current_value: 2, previous_value: 1 },
  { entity_type: "ad", entity_name: "Ad B", metric: "hook rate", cause: "test", evidence_level: "confirmed", current_value: 30, previous_value: 25 },
] as unknown as Parameters<typeof canonicalizeFindings>[0];

const withMeta = canonicalizeFindings(findings, {}, { metricAliases: metaAdsAdapter.metricAliases });
const metricA = withMeta.findings.find((f) => f.entity_name === "Ad A")?.canonical_metric;
assert(metricA === "Link CTR", "canonicalizeFindings normaliseert link click-through naar Link CTR via Meta-aliases");

const withDefault = canonicalizeFindings(findings, {});
const metricADefault = withDefault.findings.find((f) => f.entity_name === "Ad A")?.canonical_metric;
assert(metricADefault !== "Link CTR", "zonder Meta-aliases blijft de Meta-variant ongemapt (default Google)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
