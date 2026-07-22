export {};
// Verificatie van de budget-vs-efficiëntie-reconciliatie (isEfficiencyBottleneck): meer budget is
// niet de oplossing als het account achterloopt ÉN de CPA materieel boven het doel ligt. Voorkomt
// dat de tool "+X% budget" adviseert terwijl efficiency de bottleneck is.
// Draaien: npx tsx lib/__tests__/budget-reconciliation.test.ts

import { isEfficiencyBottleneck, CPA_INEFFICIENT_MARGIN } from "../forecast";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log(`\nDrempel: CPA > doel × ${CPA_INEFFICIENT_MARGIN}`);

console.log("\n1. Achter op doel + CPA ver boven doel → efficiëntie-bottleneck");
check("CPA 76 vs doel 60 (27% boven) → true", isEfficiencyBottleneck(true, 76, 60) === true);

console.log("\n2. Achter op doel maar CPA op/onder doel → geen efficiëntie-bottleneck (budget kan legitiem zijn)");
check("CPA 58 vs doel 60 → false", isEfficiencyBottleneck(true, 58, 60) === false);
check("CPA precies op doel → false", isEfficiencyBottleneck(true, 60, 60) === false);
check("CPA net binnen de marge (65 vs 60 = 8%) → false", isEfficiencyBottleneck(true, 65, 60) === false);

console.log("\n3. Op koers (niet achter) → nooit een bottleneck-signaal, ongeacht CPA");
check("niet achter, CPA hoog → false", isEfficiencyBottleneck(false, 120, 60) === false);

console.log("\n4. Geen CPA-doel ingesteld → geen oordeel (geen valse claim)");
check("cpaTarget null → false", isEfficiencyBottleneck(true, 120, null) === false);
check("cpaTarget 0 → false", isEfficiencyBottleneck(true, 120, 0) === false);

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
