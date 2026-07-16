// Test voor de X3-zelfcorrectie: de grounding-bron (system plus user), het kind-filter en
// de duplicate-guard. Deterministisch, geen LLM. Draaien: npx tsx lib/eval/__replay_filters_test.ts

import { replayFixtures, filterFixturesForReplay, type EvalFixtureRecord, type ReplayCallFn } from "./replay-core";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function fixture(step: number, kind: "step" | "checkpoint" | "repair" | undefined, system = "sys", user = "Data: 100 klikken."): EvalFixtureRecord {
  return { step, payload: { systemPrompt: system, userMessage: user, stepName: `s${step}`, sopType: "monthly", jsonMode: false, kind } };
}

async function main() {
  // ── De grounding-bron: een cijfer dat ALLEEN in de systemPrompt staat (runningContext)
  // mag geen false positive zijn. ──
  const systemContext = "Running context uit het checkpoint: de CPA daalde naar €42.";
  const echoCall: ReplayCallFn = async () => ({ output: "Zoals eerder vastgesteld staat de CPA op €42.", model: "m", promptTokens: 1, completionTokens: 1 });
  const run = await replayFixtures({ fixtures: [fixture(1, "step", systemContext, "Data: 100 klikken.")], model: "m", callFn: echoCall });
  const grounding = run.stepResults[0].checks.find((c) => c.check === "grounding")!;
  assert(grounding.passed, "een cijfer uit de systemPrompt (runningContext) is gegrond, geen false positive");

  // ── Het kind-filter: standaard alleen step. ──
  const mixed = [fixture(1, "step"), fixture(1.5 as unknown as number, "checkpoint"), fixture(2, "step"), fixture(2, "repair"), fixture(3, undefined)];
  const filtered = filterFixturesForReplay(mixed);
  assert(filtered.fixtures.length === 3 && filtered.excluded === 2, "checkpoint en repair worden standaard uitgesloten; kind-loos telt als step (backwards compat)");
  assert(filtered.fixtures.every((f) => (f.payload.kind ?? "step") === "step"), "de speelbare set bevat alleen step-fixtures");
  assert(filtered.duplicateSteps.length === 0, "een repair op hetzelfde stapnummer is geen duplicaat, want hij is uitgesloten");

  // ── include_kinds als bewuste uitbreiding. ──
  const withCheckpoints = filterFixturesForReplay(mixed, ["step", "checkpoint"]);
  assert(withCheckpoints.fixtures.length === 4 && withCheckpoints.excluded === 1, "include_kinds kan checkpoints bewust meenemen");

  // ── De duplicate-guard: twee step-fixtures op dezelfde stap. ──
  const doubled = filterFixturesForReplay([fixture(1, "step"), fixture(1, "step"), fixture(2, "step")]);
  assert(doubled.duplicateSteps.length === 1 && doubled.duplicateSteps[0] === 1, "een dubbele step-fixture wordt als duplicaat gemeld (verse fixture_set nodig)");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main();
