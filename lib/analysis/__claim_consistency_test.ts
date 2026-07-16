// Verificatie van F4 hoofd (claim-consistentie) op het broedservice-scenario uit de spec.
// Importeert de ECHTE module (geen replica). canonicalize.ts laadt standalone onder tsx.
// Draaien: npx tsx lib/analysis/__claim_consistency_test.ts

import { buildCanonicalMetricMap, validateFindingClaims } from "./claim-consistency";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// Canonical: de campagne draaide vorige maand op cost 4145 met omzet 22507 -> ROAS 5.43,
// en 50 conversies -> CPA 82.9. (De productgroep Standard had spend 232; die hoort NIET de
// campagnewaarde te zijn.)
const campaignRows = [
  { campaign_name: "PMAX Broedmachine @ Best Sellers", month: "2025-04", cost: 4145, conversions: 50, conversions_value: 22507, clicks: 1200 },
  { campaign_name: "PMAX Broedmachine @ Best Sellers", month: "2025-03", cost: 3900, conversions: 48, conversions_value: 20000, clicks: 1100 },
  { campaign_name: "Search Generic", month: "2025-04", cost: 800, conversions: 20, conversions_value: 2400, clicks: 600 },
];
const accountRows = [
  { month: "2025-04", cost: 4945, conversions: 70, conversions_value: 24907, clicks: 1800 },
];
const map = buildCanonicalMetricMap(campaignRows, accountRows, "2025-01", "2025-04");

console.log("\n1. De canonical map klopt op de echte velden");
const roas = map.get("PMAX Broedmachine @ Best Sellers::ROAS");
const cpa = map.get("PMAX Broedmachine @ Best Sellers::CPA");
console.log("     campagne ROAS=" + (roas?.toFixed(2)) + ", CPA=" + (cpa?.toFixed(1)));
check("campagne ROAS canonical ~5.43", roas !== undefined && Math.abs(roas - 5.43) < 0.05, "roas=" + roas);
check("campagne CPA canonical ~82.9", cpa !== undefined && Math.abs(cpa - 82.9) < 0.5, "cpa=" + cpa);
check("alleen de laatste maand telt (maart genegeerd)", roas !== undefined && Math.abs(roas - 22507 / 4145) < 0.001);

console.log("\n2. Stap 6 claimt de productgroep-ROAS als campagnewaarde -> scope_mismatch");
{
  const issues = validateFindingClaims(6, [
    { entity_name: "PMAX Broedmachine @ Best Sellers", entity_type: "campaign", metric: "ROAS", current_value: 1.40 },
  ], map);
  check("een issue gevonden", issues.length === 1, "n=" + issues.length);
  check("type is scope_mismatch (stap 6 is sub-scope)", issues[0]?.type === "scope_mismatch");
  check("boodschap noemt sub-scope en de canonical waarde", /sub-scope/.test(issues[0]?.message || "") && /5\.43/.test(issues[0]?.message || ""));
  console.log("     " + issues[0]?.message);
}

console.log("\n3. Correcte en binnen-tolerantie claims geven geen issue");
{
  const correct = validateFindingClaims(2, [
    { entity_name: "PMAX Broedmachine @ Best Sellers", entity_type: "campaign", metric: "ROAS", current_value: 5.43 },
  ], map);
  check("correcte ROAS 5.43 in stap 2 -> geen issue", correct.length === 0);
  const withinTol = validateFindingClaims(2, [
    { entity_name: "PMAX Broedmachine @ Best Sellers", entity_type: "campaign", metric: "ROAS", current_value: 5.0 },
  ], map);
  check("ROAS 5.0 (8 procent afwijking, binnen 35) -> geen issue", withinTol.length === 0);
}

console.log("\n4. Andere stappen en scopes");
{
  // stap 2 is geen sub-scope -> value_error in plaats van scope_mismatch
  const valueErr = validateFindingClaims(2, [
    { entity_name: "PMAX Broedmachine @ Best Sellers", entity_type: "campaign", metric: "CPA", current_value: 580 },
  ], map);
  check("grove CPA-afwijking in stap 2 -> value_error", valueErr[0]?.type === "value_error", JSON.stringify(valueErr));
  // keyword-finding wordt niet getoetst (alleen campaign/account)
  const keyword = validateFindingClaims(6, [
    { entity_name: "broedmachine kopen", entity_type: "keyword", metric: "ROAS", current_value: 0.5 },
  ], map);
  check("keyword-scope wordt overgeslagen", keyword.length === 0);
  // entiteit niet in de map -> overgeslagen
  const unknown = validateFindingClaims(6, [
    { entity_name: "Niet Bestaande Campagne", entity_type: "campaign", metric: "ROAS", current_value: 0.1 },
  ], map);
  check("onbekende entiteit -> overgeslagen", unknown.length === 0);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
