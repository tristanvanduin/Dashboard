export {};
// Verificatie van G3 Pad B (co-primaire threads), pure logica. Getrouwe replica van de co-primaire-
// detectie en priority-toekenning uit createThreads (monthly-structured.ts, niet geexporteerd),
// met contrast oud versus nieuw. Draaien: npx tsx lib/analysis/__g3_coprimary_test.ts

type Group = { executiveScore: number; severity: "critical" | "high" | "medium" | "low" | "positive" };

const computeCoPrimary = (groups: Group[]) =>
  groups.length >= 2 &&
  (groups[0].severity === "critical" || groups[0].severity === "high") &&
  groups[0].severity === groups[1].severity &&
  Math.abs(groups[0].executiveScore - groups[1].executiveScore) <= Math.abs(groups[0].executiveScore) * 0.1;

const prioritiesOld = (groups: Group[]) => groups.map((_, index) => index + 1);
const prioritiesNew = (groups: Group[]) => {
  const co = computeCoPrimary(groups);
  return groups.map((_, index) => (co ? (index <= 1 ? 1 : 2) : index + 1));
};

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}
const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

console.log("\n1. Twee even-sterke high-severity threads -> co-primair [1,1,2]");
{
  const groups: Group[] = [
    { executiveScore: 100, severity: "high" },
    { executiveScore: 95, severity: "high" },
    { executiveScore: 40, severity: "medium" },
  ];
  check("OUD rangschikte ze kunstmatig als [1,2,3]", eq(prioritiesOld(groups), [1, 2, 3]));
  check("NIEUW maakt de top twee co-primair [1,1,2]", eq(prioritiesNew(groups), [1, 1, 2]));
  console.log("     OUD: [" + prioritiesOld(groups) + "]  NIEUW: [" + prioritiesNew(groups) + "]");
}

console.log("\n2. Tweede thread te ver eronder (20 procent) -> geen co-primair");
{
  const groups: Group[] = [{ executiveScore: 100, severity: "high" }, { executiveScore: 80, severity: "high" }];
  check("[1,2], niet co-primair", eq(prioritiesNew(groups), [1, 2]));
}

console.log("\n3. Verschillende severity-klasse -> geen co-primair");
{
  const groups: Group[] = [{ executiveScore: 100, severity: "high" }, { executiveScore: 98, severity: "medium" }];
  check("[1,2], niet co-primair ondanks dichte score", eq(prioritiesNew(groups), [1, 2]));
}

console.log("\n4. Twee medium threads dicht bijeen -> geen co-primair (niet materieel genoeg)");
{
  const groups: Group[] = [{ executiveScore: 50, severity: "medium" }, { executiveScore: 49, severity: "medium" }];
  check("[1,2], medium telt niet als co-primair", eq(prioritiesNew(groups), [1, 2]));
}

console.log("\n5. Nooit een waaier: bij drie threads blijft de derde secundair");
{
  const groups: Group[] = [
    { executiveScore: 100, severity: "critical" },
    { executiveScore: 96, severity: "critical" },
    { executiveScore: 94, severity: "critical" },
  ];
  const p = prioritiesNew(groups);
  check("derde thread is NIET priority 1 (geen waaier)", p[2] !== 1, "p=[" + p + "]");
  check("resultaat is [1,1,2]", eq(p, [1, 1, 2]));
}

console.log("\n6. Negatieve scores: relatieve marge werkt nog");
{
  const groups: Group[] = [{ executiveScore: -50, severity: "high" }, { executiveScore: -48, severity: "high" }];
  check("dicht bijeen (diff 2 <= 5) -> co-primair [1,1]", eq(prioritiesNew(groups), [1, 1]));
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);