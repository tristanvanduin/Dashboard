import { StepOutputSchema, normalizeEvidenceBasis, type StepOutput } from "../schema/analysis-schema";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`  FAIL: ${label}`);
}

function buildValidOutput(): StepOutput {
  return {
    narrative: "In stap 4 stelden we vast dat branded vraag stabiel bleef; hier zien we dat Search ROAS 3.4x bedroeg versus 2.8x vorige maand (+21%) bij een spend van €2400.",
    log_entries: ["Werkwijze A uitgevoerd: keyword buckets en match types gevalideerd."],
    top_3_findings: [
      {
        step: 5,
        issue_cluster: "search_budget_cap",
        entity_type: "campaign",
        entity_name: "Brand Search NL",
        metric: "Search IS",
        current_value: 62,
        previous_value: 48,
        change_pct: 29,
        severity: "high",
        insight_type: "opportunity",
        is_seasonal: false,
        is_structural: true,
        cause: "Budgetlimiet remt verdere vraagopvang.",
        action_required: true,
        evidence_level: "deterministic",
        confidence: "high",
        benchmark_type: "previous_month",
      },
      {
        step: 5,
        issue_cluster: "performance_winner",
        entity_type: "keyword",
        entity_name: "[broedmachine kopen]",
        metric: "ROAS",
        current_value: 4.1,
        previous_value: 3.2,
        change_pct: 28,
        severity: "positive",
        insight_type: "positive",
        is_seasonal: false,
        is_structural: true,
        cause: "Exact verkeer bleef efficiënt na biedingsaanpassing.",
        action_required: false,
        evidence_level: "deterministic",
        confidence: "high",
        benchmark_type: "campaign_average",
      },
      {
        step: 5,
        issue_cluster: "product_mix",
        entity_type: "product",
        entity_name: "SKU-123",
        metric: "CPA",
        current_value: 18,
        previous_value: 25,
        change_pct: -28,
        severity: "positive",
        insight_type: "trend",
        is_seasonal: false,
        is_structural: true,
        cause: "Prijspositie en feedmatch verbeterden tegelijk.",
        action_required: false,
        evidence_level: "inferred",
        confidence: "medium",
        benchmark_type: "previous_month",
      },
    ],
    status: "OP SCHEMA",
    actions: [
      {
        actie: "Verhoog dagbudget met 15% op Brand Search NL",
        campagne: "Brand Search NL",
        deadline: "deze_week",
        verwachte_impact: "Meer impression share en circa 8 extra conversies bij gelijkblijvende CPA.",
      },
    ],
    step_conclusion: "Keyword-vraag is gezond, maar budget begrenst het volume in branded search.",
  };
}

console.log("\n=== Step Output Schema Tests ===\n");

console.log("1. Valide step output wordt geaccepteerd");
{
  const result = StepOutputSchema.safeParse(buildValidOutput());
  assert(result.success, "valid output should parse");
}

console.log("2. Output zonder narrative wordt gereject");
{
  const invalid = { ...buildValidOutput() } as Partial<StepOutput>;
  delete invalid.narrative;
  const result = StepOutputSchema.safeParse(invalid);
  assert(!result.success, "missing narrative should fail");
}

console.log("3. Output met meer dan 3 findings wordt gereject");
{
  const valid = buildValidOutput();
  const invalid = { ...valid, top_3_findings: [...valid.top_3_findings, valid.top_3_findings[0]] };
  const result = StepOutputSchema.safeParse(invalid);
  assert(!result.success, ">3 findings should fail");
}

console.log("4. Output met verboden woord in actie wordt gereject");
{
  const valid = buildValidOutput();
  const invalid = {
    ...valid,
    actions: [{
      actie: "Optimaliseer Brand Search NL",
      campagne: "Brand Search NL",
      deadline: "direct" as const,
      verwachte_impact: "Betere performance.",
    }],
  };
  const result = StepOutputSchema.safeParse(invalid);
  assert(!result.success, "forbidden action verb should fail");
}

console.log("5. Output zonder step_conclusion wordt gereject");
{
  const invalid = { ...buildValidOutput() } as Partial<StepOutput>;
  delete invalid.step_conclusion;
  const result = StepOutputSchema.safeParse(invalid);
  assert(!result.success, "missing step_conclusion should fail");
}

console.log("6. evidence_basis: optioneel (backward-compatible) en gevalideerd");
{
  const withoutBasis = buildValidOutput();
  assert(withoutBasis.evidence_basis === undefined, "buildValidOutput heeft geen evidence_basis");
  assert(StepOutputSchema.safeParse(withoutBasis).success, "output zonder evidence_basis blijft geldig");

  const withBasis = { ...buildValidOutput(), evidence_basis: "ga4" as const };
  const parsed = StepOutputSchema.safeParse(withBasis);
  assert(parsed.success, "output mét geldige evidence_basis is geldig");
  assert(parsed.success && parsed.data.evidence_basis === "ga4", "evidence_basis wordt bewaard (niet gestript)");

  const invalidBasis = { ...buildValidOutput(), evidence_basis: "verzonnen" };
  assert(!StepOutputSchema.safeParse(invalidBasis).success, "onbekende evidence_basis-waarde wordt gereject");
}

console.log("7. normalizeEvidenceBasis: ontbrekend/ongeldig → platform, geldig → passthrough");
{
  assert(normalizeEvidenceBasis(undefined) === "platform", "ontbrekend → platform");
  assert(normalizeEvidenceBasis("onzin") === "platform", "ongeldig → platform");
  assert(normalizeEvidenceBasis("ga4") === "ga4", "geldig ga4 → ga4");
  assert(normalizeEvidenceBasis("combined") === "combined", "geldig combined → combined");
  assert(normalizeEvidenceBasis("estimated") === "estimated", "geldig estimated → estimated");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
