// Test voor de Meta per-stap data-prompt-builder (M2 route-wiring). Deterministisch, geen IO.
// Draaien: npx tsx lib/meta/__meta_step_message_test.ts

import { buildMetaStepMessage, metaStepName } from "./step-message";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const facts = { latest_month: "2026-03", target: { status: "OP SCHEMA" }, mom_chain: [{ metric: "Conversies", delta_pct: -25 }] };
const msg = buildMetaStepMessage(1, facts, "act-123");

assert(msg.includes("Account Performance"), "message bevat de stap-naam");
assert(msg.includes("act-123"), "message bevat de client");
assert(msg.includes("stap 1"), "message benoemt het stapnummer");
assert(/exacte.*getallen|reken/i.test(msg), "message instrueert met aangeleverde getallen te rekenen");
assert(msg.includes("2026-03") && msg.includes("OP SCHEMA") && msg.includes("-25"), "message bevat de voorgerekende feiten");
assert(metaStepName(4) === "Creative Performance", "metaStepName geeft de juiste naam voor stap 4");
assert(metaStepName(99).includes("99"), "metaStepName valt terug op een generieke naam");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
