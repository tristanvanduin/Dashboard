export {};
// Verificatie van F5 4a (backstop): de containsUngroundedNumber-guard die in de QA een red
// flag zet als de finale laag een percentage of eurobedrag bevat dat niet herleidbaar is tot
// de echte finding-data. De finale laag is al kwalitatief; deze guard vangt regressie of
// LLM-injectie. De helpers zitten in monthly-structured.ts (laadt niet standalone); getrouwe
// replica's. tsc bevestigde 0 fouten in productiecode.
// Draaien: npx tsx lib/analysis/__ongegrond_getal_test.ts

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// Replica exact zoals in de code
function containsUngroundedNumber(text: string, allowedNumbers: number[]): boolean {
  const allowed = new Set(allowedNumbers.map((value) => Math.round(value)));
  const found: number[] = [];
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|procent)/gi)) {
    found.push(Math.round(parseFloat(match[1].replace(",", "."))));
  }
  for (const match of text.matchAll(/(?:€|EUR)\s*(\d+(?:[.,]\d+)?)/gi)) {
    found.push(Math.round(parseFloat(match[1].replace(",", "."))));
  }
  return found.some((value) => !Number.isNaN(value) && !allowed.has(value));
}
type Finding = { current_value: number | null; previous_value: number | null; change_pct: number | null };
function groundedNumbersFromCluster(findings: Finding[]): number[] {
  const numbers: number[] = [];
  for (const finding of findings) {
    if (typeof finding.current_value === "number") numbers.push(finding.current_value);
    if (typeof finding.previous_value === "number") numbers.push(finding.previous_value);
    if (typeof finding.change_pct === "number") numbers.push(Math.abs(finding.change_pct));
  }
  return numbers;
}

console.log("\n1. Vuurt op een niet-herleidbaar percentage, niet op een gegrond percentage");
check("'daling van 40 procent' zonder bron -> vuurt", containsUngroundedNumber("daling van 40 procent", []) === true);
check("'daling van 40 procent' met 40 in de data -> vuurt niet", containsUngroundedNumber("daling van 40 procent", [40]) === false);
check("'Lost IS van 23 procent' met 23 in de data -> vuurt niet", containsUngroundedNumber("tot circa 23 procent extra volume", [23]) === false);
check("percentage met '%' telt ook", containsUngroundedNumber("stijging van 40%", [23]) === true);

console.log("\n2. Vuurt op een niet-herleidbaar eurobedrag, niet op een gegrond bedrag");
check("'EUR 398' niet in de data -> vuurt", containsUngroundedNumber("besparing van EUR 398 per maand", [100]) === true);
check("'EUR 398' wel in de data -> vuurt niet", containsUngroundedNumber("besparing van EUR 398 per maand", [398]) === false);
check("euroteken telt ook", containsUngroundedNumber("besparing van € 250", [398]) === true);

console.log("\n3. Vensters en kwalitatieve tekst triggeren niet");
check("'meetbaar binnen 1-2 weken' -> geen trigger", containsUngroundedNumber("meetbaar binnen 1-2 weken", []) === false);
check("'binnen 7 dagen' -> geen trigger", containsUngroundedNumber("stop binnen 7 dagen", []) === false);
check("kwalitatieve claim zonder cijfers -> geen trigger", containsUngroundedNumber("CPA beweegt richting target", []) === false);

console.log("\n4. De QA-red-flag-scan over de finale aanbevelingen");
{
  type Rec = { doel: string; voorwaarde: string; risico: string };
  const findings: Finding[] = [
    { current_value: 23, previous_value: 31, change_pct: -8 }, // Lost IS 23
    { current_value: 398, previous_value: 420, change_pct: -5 }, // spend 398
  ];
  const allowed = groundedNumbersFromCluster(findings);
  const scan = (recs: Rec[]) => recs.some((r) =>
    containsUngroundedNumber(r.doel, allowed) || containsUngroundedNumber(r.voorwaarde, allowed) || containsUngroundedNumber(r.risico, allowed));
  const fabricated: Rec[] = [{ doel: "Reductie van CPA met minimaal 40 procent", voorwaarde: "Bevestig binnen 1-2 weken", risico: "Tijdelijke learning reset" }];
  const grounded: Rec[] = [{ doel: "tot circa 23 procent extra volume, begrensd door 23 procent budget-IS-verlies", voorwaarde: "Bevestig binnen 1-2 weken", risico: "Beperkte extra spend" }];
  check("aanbeveling met verzonnen 40 procent -> red flag", scan(fabricated) === true);
  check("aanbeveling met gegronde 23 procent -> geen red flag", scan(grounded) === false);
  check("besparing EUR 398 die in findings staat -> geen red flag", scan([{ doel: "besparing van EUR 398 per maand", voorwaarde: "x", risico: "y" }]) === false);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);