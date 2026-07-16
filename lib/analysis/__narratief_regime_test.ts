// Verificatie van F1 (narratief-regime ontward). De AC-06-flip wordt op de ECHTE
// validateStepOutput getest (step-validator.ts heeft alleen type-imports). De
// sanitizers zitten in route.ts (laadt niet standalone), dus die worden met
// getrouwe replica's oud-versus-nieuw aangetoond.
// Draaien: npx tsx lib/analysis/__narratief_regime_test.ts
import { validateStepOutput } from "./step-validator";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// --- Replica's van de OUDE en NIEUWE sanitizeStepNarrative ---
function oldSanitizeNarrative(s: string): string {
  return s
    .replace(/In stap \d+\s+stelden we vast dat[^.]*\.\s*/gi, "")
    .replace(/In de vorige stap\s+(stelden|zagen|concludeerden) we[^.]*\.\s*/gi, "")
    .replace(/^\s*\n+/, "")
    .trim();
}
function newSanitizeNarrative(s: string): string {
  return s.replace(/^\s*\n+/, "").trim();
}

console.log("\n1. De decimaal-etende strip-regex: oud corrumpeert een getal, nieuw behoudt het");
{
  const narrative = "In stap 6 stelden we vast dat de waarde 4.6 bedroeg. De rest van de analyse volgt hier.";
  const oud = oldSanitizeNarrative(narrative);
  const nieuw = newSanitizeNarrative(narrative);
  console.log("     oud:    " + oud);
  console.log("     nieuw:  " + nieuw);
  check("oud: het getal 4.6 is kapot (4. opgegeten, begint met '6')", !oud.includes("4.6") && /^6\b/.test(oud));
  check("nieuw: 4.6 behouden, volledige tekst intact", nieuw.includes("4.6") && nieuw === narrative.trim());
}

// --- Replica's van de kapotte vs gefixte character class ---
console.log("\n2. De kapotte character class: nieuw matcht de drie vervoegingen correct");
{
  const newClass = () => /\bonderzoe(?:k|kt|ken)\b/gi;
  const oldClass = () => /\bonderzoe[k|kt|ken]+\b/gi;
  check("nieuw matcht onderzoek/onderzoekt/onderzoeken", "onderzoek onderzoekt onderzoeken".replace(newClass(), "X") === "X X X");
  // de oude class is een tekenset {k,|,t,e,n} met +, en over-matcht gibberish dat de nieuwe terecht laat staan
  check("oude class over-matcht 'onderzoektt' (gibberish), nieuwe niet",
    "onderzoektt".replace(oldClass(), "X") === "X" && "onderzoektt".replace(newClass(), "X") === "onderzoektt");
}

// --- ECHTE validateStepOutput voor de AC-06-flip ---
function makeOutput(narrative: string) {
  return {
    narrative,
    log_entries: ["Een log entry met cijfer 4.6%."],
    top_3_findings: [
      { entity_type: "campaign", entity_name: "Campagne A", metric: "cpa", evidence_level: "confirmed", current_value: 10, previous_value: 8 },
      { entity_type: "campaign", entity_name: "Campagne B", metric: "roas", evidence_level: "confirmed", current_value: 3, previous_value: 4 },
      { entity_type: "campaign", entity_name: "Campagne C", metric: "ctr", evidence_level: "confirmed", current_value: 2, previous_value: 2 },
    ],
    actions: [],
  } as unknown as Parameters<typeof validateStepOutput>[1];
}
const ac06 = (r: { warnings: string[] }) => r.warnings.some((w) => w.startsWith("AC-06"));

console.log("\n3. AC-06 omgedraaid op de ECHTE validateStepOutput");
{
  const recap = validateStepOutput(6, makeOutput("In stap 5 stelden we vast dat de CPA 4.6 was, een verslechtering van 3.2x."), "vorige conclusie");
  const direct = validateStepOutput(6, makeOutput("De CPA steeg naar 4.6 deze maand, een verslechtering met 3.2x impact."), "vorige conclusie");
  check("een recap-opener triggert nu AC-06", ac06(recap), recap.warnings.join(" | "));
  check("een direct narratief triggert AC-06 NIET", !ac06(direct), direct.warnings.join(" | "));
}

console.log("\n4. Coherentie: de drie bronnen wijzen nu dezelfde kant op");
{
  // discipline verbiedt de opener (prompt), AC-06 vlagt hem als hij toch verschijnt (validator),
  // sanitizer corrumpeert geen decimalen meer (code). Geen van de drie eist de opener nog.
  const direct = validateStepOutput(6, makeOutput("De ROAS daalde naar 3.2x door een hogere CPA van 4.6."), "vorige conclusie");
  check("een net, direct narratief met decimalen passeert zonder AC-06 en blijft intact", !ac06(direct) && newSanitizeNarrative("De ROAS daalde naar 3.2x door een hogere CPA van 4.6.").includes("4.6"));
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
