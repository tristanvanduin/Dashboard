import assert from "node:assert/strict";

import { shouldRepairStep12Runtime } from "@/app/api/analysis/monthly/route";

console.log("1. Step 12 runtime repair triggers on empty output");
{
  const shouldRepair = shouldRepairStep12Runtime({
    stepNumber: 12,
    stepName: "Checkout, Schedule & Network Performance",
    output: "",
    model: "test-model",
    tokensUsed: 0,
    saved: true,
    latencyMs: 0,
    retries: 0,
  }, {
    stepNumber: 12,
    valid: false,
    warnings: [],
    errors: ["Geen JSON-object gevonden in step output"],
  });

  assert.equal(shouldRepair, true);
}

console.log("2. Step 12 runtime repair triggers on malformed no-JSON output");
{
  const shouldRepair = shouldRepairStep12Runtime({
    stepNumber: 12,
    stepName: "Checkout, Schedule & Network Performance",
    output: "Narratieve tekst zonder JSON",
    model: "test-model",
    tokensUsed: 0,
    saved: true,
    latencyMs: 0,
    retries: 0,
  }, {
    stepNumber: 12,
    valid: false,
    warnings: [],
    errors: ["Geen JSON-object gevonden in step output"],
  });

  assert.equal(shouldRepair, true);
}

console.log("3. Step 12 runtime repair stays off for valid parsed output");
{
  const shouldRepair = shouldRepairStep12Runtime({
    stepNumber: 12,
    stepName: "Checkout, Schedule & Network Performance",
    output: "{\"narrative\":\"ok\"}",
    model: "test-model",
    tokensUsed: 0,
    saved: true,
    latencyMs: 0,
    retries: 0,
  }, {
    stepNumber: 12,
    valid: true,
    warnings: [],
    errors: [],
  });

  assert.equal(shouldRepair, false);
}

console.log("4. Non-step-12 outputs never trigger the runtime repair");
{
  const shouldRepair = shouldRepairStep12Runtime({
    stepNumber: 11,
    stepName: "Geo",
    output: "",
    model: "test-model",
    tokensUsed: 0,
    saved: true,
    latencyMs: 0,
    retries: 0,
  }, {
    stepNumber: 11,
    valid: false,
    warnings: [],
    errors: ["Geen JSON-object gevonden in step output"],
  });

  assert.equal(shouldRepair, false);
}
