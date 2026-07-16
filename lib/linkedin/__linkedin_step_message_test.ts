// Test voor de LinkedIn per-stap data-prompt-builder (L2 route-wiring). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_step_message_test.ts

import { buildLinkedinStepMessage, linkedinStepName } from "./step-message";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const facts = { latest_month: "2026-03", target_gap: { status: "OP SCHEMA" }, pivots: [{ spendInIcpPct: 0.67 }] };
const msg = buildLinkedinStepMessage(5, facts, "urn:li:sponsoredAccount:1");

assert(msg.includes("Demografie en ICP-fit"), "message bevat de stap-naam");
assert(msg.includes("urn:li:sponsoredAccount:1"), "message bevat de client");
assert(msg.includes("stap 5"), "message benoemt het stapnummer");
assert(/exacte.*getallen|reken/i.test(msg), "message instrueert met aangeleverde getallen te rekenen");
assert(/leidt CPL/i.test(msg) && /niet ROAS/i.test(msg), "message benadrukt dat CPL leidt, niet ROAS");
assert(msg.includes("2026-03") && msg.includes("OP SCHEMA") && msg.includes("0.67"), "message bevat de voorgerekende feiten");
assert(linkedinStepName(1) === "Account Performance", "stapnaam 1 correct");
assert(linkedinStepName(9) === "Hypotheses en Sprintplanning", "stapnaam 9 correct");
assert(linkedinStepName(99).includes("99"), "onbekende stap valt terug op generieke naam");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
