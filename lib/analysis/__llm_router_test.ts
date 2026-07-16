// Verificatie van O4-kern (model-routing en fallback) met de ECHTE llm-router.
// Draaien: npx tsx lib/analysis/__llm_router_test.ts

import { resolveTier, resolveChain, callRouted, MODEL_CATALOG } from "./llm-router";
import type { OpenRouterResponse } from "./openrouter-client";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}
function fakeResp(model: string): OpenRouterResponse {
  return { output: "ok", model, tokensUsed: 1, promptTokens: 1, completionTokens: 0, latencyMs: 1, retries: 0, parseStatus: "not_json_mode" };
}

console.log("\n1. Tier-resolutie uit het label");
check("een stap-label zonder override krijgt heavy", resolveTier("monthly-step-3-findings") === "heavy");
check("een -full label krijgt heavy", resolveTier("monthly-full") === "heavy");
check("een als light gemarkeerde stap krijgt light", resolveTier("monthly-step-1-x", { 1: "light" }) === "light");
check("een onbekend label valt terug op heavy", resolveTier("iets-zonder-stap") === "heavy");

console.log("\n2. Modelketen per tier");
const heavy = resolveChain("monthly-step-3-x");
check("heavy primair is het sterke model", heavy.chain[0] === MODEL_CATALOG.strong);
check("heavy heeft een fallback erachter", heavy.chain.length >= 2 && heavy.chain[1] === MODEL_CATALOG.crossFallback);
const light = resolveChain("monthly-step-1-x", { 1: "light" });
check("light primair is het goedkope model", light.chain[0] === MODEL_CATALOG.cheap);
check("light valt terug op het sterke model", light.chain[1] === MODEL_CATALOG.strong);

console.log("\n3. Fallback-executor");
async function main() {
const calls: string[] = [];
const failFirst = async (req: { model?: string }) => {
  calls.push(req.model!);
  if (req.model === heavy.chain[0]) throw new Error("primair model faalt");
  return fakeResp(req.model!);
};
const r = await callRouted({ apiKey: "x", systemPrompt: "s", userMessage: "u", label: "monthly-step-3-x" }, failFirst as never);
check("probeert eerst het primaire model", calls[0] === heavy.chain[0]);
check("valt bij een fout terug naar het tweede model", r.model === heavy.chain[1]);

console.log("\n4. Happy path gebruikt alleen het primaire model");
const calls2: string[] = [];
let capturedTemp: number | undefined;
const okFirst = async (req: { model?: string; temperature?: number }) => { calls2.push(req.model!); capturedTemp = req.temperature; return fakeResp(req.model!); };
const r2 = await callRouted({ apiKey: "x", systemPrompt: "s", userMessage: "u", label: "monthly-step-3-x" }, okFirst as never);
check("één call, geen fallback", calls2.length === 1 && r2.model === heavy.chain[0]);
check("de router zet temperatuur 0 (deterministisch)", capturedTemp === 0);

console.log("\n5. Determinisme");
check("zelfde label kiest hetzelfde primaire model", resolveChain("monthly-step-3-x").chain[0] === resolveChain("monthly-step-3-x").chain[0]);

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
}
main();
