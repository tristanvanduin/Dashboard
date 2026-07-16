import { resolveContradictions } from "../analysis/contradiction-resolver";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("\n=== Contradiction Resolver Tests ===\n");

console.log("1. Recommendation variants collapse on business target");
{
  const resolved = resolveContradictions(
    [
      {
        phase: "short_term" as const,
        ice_total: 6,
        confidence: "medium" as const,
        rationale: "Herverdeel Duitsland-budget op campagneniveau.",
        measurement_metric: "ROAS per land",
        dependencies: ["Controleer marges"],
        action_intent_class: "geo_reallocation",
        action_unit_key: "geo_reallocation:de",
        primary_entity_scope: "country",
        primary_entity_key: "country::de",
        canonical_entity_name: "Land: Duitsland",
      },
      {
        phase: "immediate" as const,
        ice_total: 8,
        confidence: "high" as const,
        rationale: "Bundel Duitsland-sanering rond de hoofdmarkt in plaats van losse scope-acties.",
        measurement_metric: "CPA per land",
        dependencies: ["Check voorraad"],
        action_intent_class: "geo_reallocation",
        action_unit_key: "geo_reallocation:de",
        primary_entity_scope: "ad_group",
        primary_entity_key: "ad_group::shopping_testers_rm::de",
        canonical_entity_name: "Ad group: DE",
      },
    ],
    []
  );

  assert(resolved.recommendations.length === 1, `expected one deduped geo recommendation, got ${resolved.recommendations.length}`);
  assert(resolved.recommendations[0]?.phase === "immediate", "best recommendation should keep strongest phase");
  assert(resolved.recommendations[0]?.dependencies.includes("Controleer marges"), "merged recommendation should retain original dependency");
  assert(resolved.recommendations[0]?.dependencies.includes("Check voorraad"), "merged recommendation should retain stronger variant dependency");
}

console.log("2. Tasks collapse on action unit");
{
  const resolved = resolveContradictions(
    [],
    [
      {
        owner: "Ranking Masters",
        action_type: "budget",
        action_intent_class: "geo_reallocation",
        action_unit_key: "geo_reallocation:de",
        primary_entity_scope: "country",
        primary_entity_key: "country::de",
        phase: "short_term" as const,
        due_date_days: 10,
        priority: "medium" as const,
        title: "Heralloceer geo-budget rond Duitsland",
        description: "Verplaats budget van DE naar sterkere markten.",
      },
      {
        owner: "Ranking Masters",
        action_type: "budget",
        action_intent_class: "geo_reallocation",
        action_unit_key: "geo_reallocation:de",
        primary_entity_scope: "campaign",
        primary_entity_key: "campaign::de_core",
        phase: "immediate" as const,
        due_date_days: 5,
        priority: "high" as const,
        title: "Heralloceer geo budget rond Duitsland",
        description: "Consolideer dezelfde geo-actie op threadniveau.",
      },
    ]
  );

  assert(resolved.tasks.length === 1, `expected one deduped task, got ${resolved.tasks.length}`);
  assert(resolved.tasks[0]?.due_date_days === 5, "earlier/higher-priority task should survive");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
