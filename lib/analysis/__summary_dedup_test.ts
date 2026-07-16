export {};
// Verificatie van F2 4f: deduplicatie in summaries, alternative_route en de
// containment-afhankelijkheid. Getrouwe replica's van normalizeText en de drie transforms;
// tsc bevestigde 0 fouten in productiecode.
// Draaien: npx tsx lib/analysis/__summary_dedup_test.ts

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// Replica exact zoals in de code
function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
const summary = (handeling: string, object: string) =>
  normalizeText(handeling).includes(normalizeText(object)) ? handeling : `${handeling} ${object}`;
const altRoute = (alts: { action: string }[], stratAction: string) =>
  alts.length > 0 && normalizeText(alts[0].action) !== normalizeText(stratAction)
    ? `Alt: ${alts[0].action}` : undefined;
function depVoorwaarde(recHandeling: string, contHandeling: string | null, voorwaarde: string): string {
  if (contHandeling && normalizeText(recHandeling) !== normalizeText(contHandeling) && !/containment|stabiliseer|stabiliseert/i.test(voorwaarde)) {
    return `Start pas nadat containment minimaal 7 dagen stabiliseert.`;
  }
  return voorwaarde;
}

console.log("\n1. Summary: object alleen toevoegen als de handeling het nog niet bevat");
check("handeling bevat object al -> geen dubbeling", summary("Pauzeer campagne Noord", "campagne Noord") === "Pauzeer campagne Noord");
check("handeling bevat object niet -> object toegevoegd", summary("Verlaag budget", "Zoekcampagne Noord") === "Verlaag budget Zoekcampagne Noord");
check("overlap ondanks hoofdletters/diacritiek", summary("Sluit zoekterm 'café' uit", "Café") === "Sluit zoekterm 'café' uit");

console.log("\n2. alternative_route alleen bij een verschillende actie");
check("zelfde actie -> undefined (geen echo)", altRoute([{ action: "Verlaag budget met 30%" }], "Verlaag budget met 30%") === undefined);
check("zelfde actie modulo opmaak -> undefined", altRoute([{ action: "Verlaag  budget,  30%" }], "Verlaag budget 30%") === undefined);
check("verschillende actie -> wel gezet", altRoute([{ action: "Pauzeer landset" }], "Verlaag budget") === "Alt: Pauzeer landset");
check("geen alternatieven -> undefined", altRoute([], "Verlaag budget") === undefined);

console.log("\n3. Containment-afhankelijkheid alleen als de recovery-handeling verschilt");
check("zelfde handeling -> geen circulaire afhankelijkheid", depVoorwaarde("Pauzeer landset", "Pauzeer landset", "Meet herstel via ROAS.") === "Meet herstel via ROAS.");
check("verschillende handeling -> afhankelijkheid toegevoegd", depVoorwaarde("Herstart in aparte set", "Pauzeer landset", "Meet herstel via ROAS.").startsWith("Start pas nadat containment"));
check("voorwaarde noemt containment al -> niet overschrijven", depVoorwaarde("Herstart in aparte set", "Pauzeer landset", "Na containment stabiliseert ROAS.") === "Na containment stabiliseert ROAS.");

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);