// Zelf-draaiende test voor de contradictie-resolver. Draait via tsx.
// Kern: twee aanbevelingen die elkaar tegenspreken (budget omhoog vs omlaag op dezelfde
// entiteit, of exact dezelfde actie dubbel) worden samengevoegd tot één; niet-botsende blijven
// naast elkaar; de hoogste prioriteit wint als primair; en taken met dezelfde signatuur
// de-dupliceren op de kortste deadline. Botsende adviezen naast elkaar ondermijnen vertrouwen.

import { recommendationConflicts, resolveContradictions, normalizeBusinessTarget, type RecommendationLike, type TaskLike } from "./contradiction-resolver";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const r = (over: Partial<RecommendationLike>): RecommendationLike => ({
  phase: "immediate", ice_total: 5, rationale: "Reden", measurement_metric: "cpa",
  dependencies: [], action_intent_class: "budget_expand", action_unit_key: "campaign:X",
  primary_entity_scope: "campaign", primary_entity_key: "X", canonical_entity_name: "Campagne X", ...over,
});

const t = (over: Partial<TaskLike>): TaskLike => ({
  owner: "specialist", action_type: "budget", action_intent_class: "budget_expand", action_unit_key: "campaign:X",
  primary_entity_scope: "campaign", primary_entity_key: "X", phase: "immediate", due_date_days: 7,
  priority: "high", title: "Titel", description: "Beschrijving", ...over,
});

console.log("conflictdetectie:");
{
  assert(recommendationConflicts(r({ action_intent_class: "budget_expand" }), r({ action_intent_class: "budget_reduce" })),
    "budget_expand vs budget_reduce op dezelfde entiteit => conflict");
  assert(recommendationConflicts(r({}), r({})), "exact dezelfde actie dubbel => conflict");
  assert(!recommendationConflicts(r({ action_unit_key: "campaign:X", primary_entity_key: "X" }), r({ action_unit_key: "campaign:Y", primary_entity_key: "Y" })),
    "zelfde actie op verschillende entiteiten => geen conflict");
}

console.log("normalizeBusinessTarget:");
{
  assert(normalizeBusinessTarget({ action_intent_class: "geo_reallocation", action_unit_key: "geo:NL", primary_entity_scope: "campaign", primary_entity_key: "X" }) === "geo::NL",
    "geo_reallocation normaliseert op het land, niet op de campagne");
  assert(normalizeBusinessTarget({ action_intent_class: "budget_expand", action_unit_key: "campaign:X", primary_entity_scope: "campaign", primary_entity_key: "X" }) === "campaign::X",
    "gewone actie normaliseert op scope::key");
}

console.log("oplossen:");
{
  const { recommendations } = resolveContradictions(
    [
      r({ action_intent_class: "budget_expand", ice_total: 10, rationale: "Schaal op" }),
      r({ action_intent_class: "budget_reduce", ice_total: 5, rationale: "Schaal af" }),
      r({ action_intent_class: "budget_expand", action_unit_key: "campaign:Y", primary_entity_key: "Y", canonical_entity_name: "Campagne Y", rationale: "Andere campagne" }),
    ],
    []
  );
  assert(recommendations.length === 2, "botsend paar samengevoegd tot één; niet-botsende blijft => 2");
  assert(recommendations[0].action_intent_class === "budget_expand", "hoogste prioriteit (ice 10) blijft primair");
}

console.log("taak-dedup:");
{
  const { tasks } = resolveContradictions(
    [],
    [
      t({ due_date_days: 7, description: "Eerste" }),
      t({ due_date_days: 3, description: "Tweede" }),
    ]
  );
  assert(tasks.length === 1, "gelijke signatuur => één taak");
  assert(tasks[0].due_date_days === 3, "de-dup houdt de kortste deadline aan");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle contradiction-resolver-tests geslaagd");
