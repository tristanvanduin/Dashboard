export {};
// Verificatie van F5 4c: het floor-scenario lowercasede de hele threadtitel mid-zin,
// waardoor entiteitsnamen als UK-MPC hun casing verloren. Ook de hypothese-success_next_month
// van hypothese 1 hergebruikt dit floor-scenario, dus de fix propageert daarheen.
// buildSuccessScenario zit in monthly-structured.ts (laadt niet standalone); getrouwe replica.
// tsc bevestigde 0 fouten in productiecode.
// Draaien: npx tsx lib/analysis/__success_scenario_casing_test.ts

type Thread = { title: string; monitoring_metrics: string[] };
let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}
function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// NIEUW (na de fix): titel mid-zin met eigen casing
const floorNew = (p: Thread) =>
  `De maand is beter als ${p.monitoring_metrics.slice(0, 2).join(" en ")} stabiliseren zonder nieuwe escalatie in ${p.title}.`;
// OUD (de bug): hele titel gelowercased
const floorOld = (p: Thread) =>
  `De maand is beter als ${p.monitoring_metrics.slice(0, 2).join(" en ")} stabiliseren zonder nieuwe escalatie in ${p.title.toLowerCase()}.`;

// De gelijkheidsguard exact zoals in de code
function resolveTarget(p: Thread, floor: string): string {
  let target = `Doelscenario: de primaire thread beweegt aantoonbaar richting herstel en minimaal twee ondersteunende threads blijven onder controle.`;
  if (normalizeText(floor) === normalizeText(target)) {
    const scaleMetric = p.monitoring_metrics?.[0] ?? "ROAS";
    target = `Doelscenario: ${scaleMetric} en volume bewegen aantoonbaar de goede kant op terwijl de ondersteunende threads onder controle blijven.`;
  }
  return target;
}

const thread: Thread = { title: "UK-MPC - Apple - Generic - Automated mist vraag", monitoring_metrics: ["ROAS", "CPA"] };

console.log("\n1. Het floor-scenario behoudt de casing van de entiteitsnamen");
const newFloor = floorNew(thread);
const oldFloor = floorOld(thread);
console.log("     nieuw: " + newFloor);
console.log("     oud:   " + oldFloor);
check("nieuw behoudt 'UK-MPC'", newFloor.includes("UK-MPC"));
check("nieuw behoudt 'Apple'", newFloor.includes("Apple"));
check("oud sloopte het naar 'uk-mpc' (bewijs van de bug)", oldFloor.includes("uk-mpc") && !oldFloor.includes("UK-MPC"));

console.log("\n2. De gelijkheidsguard herschrijft target alleen bij letterlijke samenval");
{
  // normaal verschillen floor en target structureel -> target ongewijzigd
  const target = resolveTarget(thread, newFloor);
  check("verschillende floor en target -> standaard target blijft", target.startsWith("Doelscenario: de primaire thread"));
  // forceer samenval: floor identiek aan de standaard target
  const collidingFloor = `Doelscenario: de primaire thread beweegt aantoonbaar richting herstel en minimaal twee ondersteunende threads blijven onder controle.`;
  const rewritten = resolveTarget(thread, collidingFloor);
  console.log("     bij samenval herschreven naar: " + rewritten);
  check("samenval -> target herschreven met scale-metric", rewritten !== collidingFloor && rewritten.includes("ROAS") && normalizeText(rewritten) !== normalizeText(collidingFloor));
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);