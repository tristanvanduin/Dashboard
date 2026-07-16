export {};
// Verificatie van F3 4a (generieke repair-loop), pure logica. Getrouwe replica van de helpers
// uit app/api/analysis/monthly/route.ts (laadt niet standalone), met contrast oud versus nieuw.
// Draaien: npx tsx lib/analysis/__step_repair_test.ts

const HEAVY_WARNING_MATCHERS = [
  "Wiskundige inconsistentie",
  "Verwacht 3 findings",
  "Narratief bevat geen concrete cijfers",
  "AC-08",
  "Claim-consistentie",
];
type Validation = { stepNumber: number; valid: boolean; warnings: string[]; errors: string[] };

function countHeavyWarnings(v: Validation): number {
  return v.warnings.filter((w) => HEAVY_WARNING_MATCHERS.some((m) => w.includes(m))).length;
}
function shouldRepairStep(v: Validation, errorsOnly: boolean): boolean {
  if (v.errors.length > 0) return true;
  if (errorsOnly) return false;
  return countHeavyWarnings(v) >= 2;
}
function buildStepRepairUserMessage(message: string, v: Validation, runningContext: string, promptNote?: string): string {
  const feedbackLines = [...v.errors, ...v.warnings].slice(0, 12);
  return `${message}\n\n## REPAIR FEEDBACK\nJe vorige output is afgekeurd. Los exact deze punten op en lever opnieuw volledig JSON:\n${feedbackLines.map((l) => `- ${l}`).join("\n")}\n\n## Data beschikbaarheid voor deze stap\n${promptNote || "Geen extra data-opmerking."}\n\n## Running context uit laatste checkpoint\n${runningContext}`;
}
type StepAttempt = { id: string; validation: Validation };
function pickBetterStepAttempt(original: StepAttempt, repaired: StepAttempt): StepAttempt {
  if (repaired.validation.errors.length !== original.validation.errors.length) {
    return repaired.validation.errors.length < original.validation.errors.length ? repaired : original;
  }
  const rh = countHeavyWarnings(repaired.validation), oh = countHeavyWarnings(original.validation);
  if (rh !== oh) return rh < oh ? repaired : original;
  return original;
}

const V = (errors: string[], warnings: string[]): Validation => ({ stepNumber: 1, valid: errors.length === 0, errors, warnings });

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("\n1. shouldRepairStep: drempels");
check("een error -> repair", shouldRepairStep(V(["Geen JSON-object gevonden in step output"], []), false));
check("twee zware warnings -> repair", shouldRepairStep(V([], ["Verwacht 3 findings, kreeg 2", "Narratief bevat geen concrete cijfers"]), false));
check("een zware warning alleen -> geen repair", !shouldRepairStep(V([], ["Verwacht 3 findings, kreeg 2"]), false));
check("een lichte warning -> geen repair", !shouldRepairStep(V([], ["Cross-reference context ontbreekt vanuit vorige stapconclusie"]), false));
check("OUD gedrag (alleen stap 12) ving deze 2 zware warnings NIET, NIEUW wel", shouldRepairStep(V([], ["Wiskundige inconsistentie: X", "Verwacht 3 findings, kreeg 1"]), false));

console.log("\n2. Kostenrem (errorsOnly na 5 repairs)");
check("errorsOnly: drie zware warnings -> geen repair meer", !shouldRepairStep(V([], ["Wiskundige inconsistentie: X", "Verwacht 3 findings, kreeg 1", "Narratief bevat geen concrete cijfers"]), true));
check("errorsOnly: een error -> nog steeds repair", shouldRepairStep(V(["Geen JSON-object gevonden in step output"], []), true));

console.log("\n3. F4-koppeling: claim-warning telt als zwaar");
check("een claim-warning + een andere zware -> repair", shouldRepairStep(V([], ["Claim-consistentie: waarde 1.4 voor X wijkt af van 5.43", "Narratief bevat geen concrete cijfers"]), false));
check("claim-warning telt mee in countHeavyWarnings", countHeavyWarnings(V([], ["Claim-consistentie: waarde 1.4 voor X wijkt af van 5.43"])) === 1);

console.log("\n4. buildStepRepairUserMessage");
{
  const msg = buildStepRepairUserMessage("Analyseer stap 2.", V(["Geen JSON-object gevonden"], ["Verwacht 3 findings, kreeg 1"]), "ctx", "note");
  check("bevat het REPAIR FEEDBACK blok", /## REPAIR FEEDBACK/.test(msg));
  check("bevat de letterlijke errorregel", /- Geen JSON-object gevonden/.test(msg));
  check("bevat de letterlijke warningregel", /- Verwacht 3 findings, kreeg 1/.test(msg));
  const many = buildStepRepairUserMessage("x", V(Array.from({ length: 20 }, (_, i) => `err${i}`), []), "ctx");
  const feedbackCount = (many.match(/- err\d+/g) || []).length;
  check("maximaal 12 feedbackregels", feedbackCount === 12, "kreeg " + feedbackCount);
}

console.log("\n5. pickBetterStepAttempt: geen verslechtering (convergentie-garantie)");
{
  const orig2err = { id: "orig", validation: V(["e1", "e2"], []) };
  const repaired0err = { id: "repaired", validation: V([], []) };
  check("repair met minder errors wint", pickBetterStepAttempt(orig2err, repaired0err).id === "repaired");
  const orig0err = { id: "orig", validation: V([], []) };
  const repaired2err = { id: "repaired", validation: V(["e1", "e2"], []) };
  check("repair die SLECHTER is (meer errors) wordt verworpen, origineel blijft", pickBetterStepAttempt(orig0err, repaired2err).id === "orig");
  const origHeavy2 = { id: "orig", validation: V([], ["Wiskundige inconsistentie: X", "Verwacht 3 findings, kreeg 1"]) };
  const repairedHeavy0 = { id: "repaired", validation: V([], ["Cross-reference context ontbreekt"]) };
  check("gelijke errors, repair met minder zware warnings wint", pickBetterStepAttempt(origHeavy2, repairedHeavy0).id === "repaired");
  const a = { id: "orig", validation: V([], ["Cross-reference context ontbreekt"]) };
  const b = { id: "repaired", validation: V([], ["Cross-reference context ontbreekt"]) };
  check("gelijke kwaliteit -> origineel behouden (geen churn)", pickBetterStepAttempt(a, b).id === "orig");
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);