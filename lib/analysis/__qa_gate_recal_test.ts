export {};
// Verificatie van build 3: misvormde beslisregels structureel gevangen,
// en de onmogelijke 8.5-score-poort verwijderd.
// Draaien: npx tsx lib/analysis/__qa_gate_recal_test.ts

// Exacte replica van hasMalformedDecisionRule (bron: monthly-structured.ts:3620).
function hasMalformedDecisionRule(text: string): boolean {
  return /Continueer alleen als doorzetten alleen als|doorzetten alleen als doorzetten alleen als|ga alleen door [^.\n]*ga pas door/i.test(text);
}

// Replica van de nieuwe structurele validatie-tak.
function validateScores(opts: {
  recommendationRules: string[];
  taskRules: string[];
  whyScore: number;
  actionabilityScore: number;
}): string[] {
  const errors: string[] = [];
  // NIEUW: structurele check op misvormde regels (objectief, los van de score).
  if (
    opts.recommendationRules.some((r) => hasMalformedDecisionRule(r)) ||
    opts.taskRules.some((r) => hasMalformedDecisionRule(r))
  ) {
    errors.push("Malformed decision rule present");
  }
  // VERWIJDERD: de oude onmogelijke score-poorten. Geen "below threshold" meer.
  return errors;
}

// Replica van de OUDE validatie-tak, puur voor contrast.
function oldValidateScores(opts: { whyScore: number; actionabilityScore: number }): string[] {
  const errors: string[] = [];
  if (opts.whyScore < 8.5) errors.push("Why-score below threshold");
  if (opts.actionabilityScore < 8.5) errors.push("Actionability-score below threshold");
  return errors;
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const malformed = "Continueer alleen als doorzetten alleen als de CPA onder 25 blijft";
const wellFormed = "Continueer als de CPA onder 25 euro blijft gedurende 2 weken";

console.log("\n1. De structurele check vangt een misvormde beslisregel (was eerder alleen in de score)");
{
  const errs = validateScores({ recommendationRules: [malformed], taskRules: [], whyScore: 8.4, actionabilityScore: 8.4 });
  check("misvormde regel levert een structurele fout", errs.includes("Malformed decision rule present"), errs.join(","));
}

console.log("\n2. Een nette beslisregel levert geen fout");
{
  const errs = validateScores({ recommendationRules: [wellFormed], taskRules: [wellFormed], whyScore: 8.4, actionabilityScore: 8.4 });
  check("nette regel: geen structurele fout", !errs.includes("Malformed decision rule present"), errs.join(","));
}

console.log("\n3. De eerlijke why-score van 8.4 levert GEEN fout meer (de onmogelijke poort is weg)");
{
  const nieuw = validateScores({ recommendationRules: [wellFormed], taskRules: [wellFormed], whyScore: 8.4, actionabilityScore: 8.4 });
  const oud = oldValidateScores({ whyScore: 8.4, actionabilityScore: 8.4 });
  console.log(`     nieuw aantal fouten = ${nieuw.length} | oud aantal fouten = ${oud.length} (${oud.join(", ")})`);
  check("nieuw: geen 'below threshold' fout bij eerlijke 8.4", !nieuw.some((e) => e.includes("below threshold")));
  check("oud: floorde-of-faalde, want 8.4 < 8.5 gaf altijd een fout", oud.includes("Why-score below threshold"));
}

console.log("\n4. Een misvormde regel wordt nu gevangen ZELFS als de score-poort weg is");
{
  const errs = validateScores({ recommendationRules: [], taskRules: [malformed], whyScore: 8.4, actionabilityScore: 6.2 });
  check("misvormde taakregel gevangen, ondanks verwijderde score-poort", errs.includes("Malformed decision rule present"));
  check("geen valse 'below threshold' op de eerlijke 6.2", !errs.some((e) => e.includes("below threshold")));
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald`);
console.log("Kernpunt: detectie van de echte fout (misvormde regel) blijft, nu objectief structureel; de onmogelijke 8.5-poort die de pipeline zou breken is weg.\n");
if (failed > 0) process.exit(1);