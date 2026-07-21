// Test voor de demografie-drift-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__demographic_drift_test.ts

import { buildDemographicDriftSignals, type DemographicDriftRow } from "./demographic-drift";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const asOf = "2026-02-01";
// Helper: een aantal leads op een gegeven aantal dagen geleden.
const day = (agoDays: number): string => new Date(Date.parse(asOf) - agoDays * 86_400_000).toISOString().slice(0, 10);
const rows: DemographicDriftRow[] = [];
const add = (dimension: string, value: string, agoDays: number, leads: number) => rows.push({ dimension, value, date: day(agoDays), leads });

// Prior venster (28-56 dagen): Sales domineert (30 leads), Marketing klein (5).
add("functie", "Sales", 40, 30);
add("functie", "Marketing", 40, 5);
// Recent venster (0-28 dagen): kantelt — Sales zakt (8), Marketing stijgt (27).
add("functie", "Sales", 10, 8);
add("functie", "Marketing", 10, 27);

const res = buildDemographicDriftSignals(rows, asOf);
const daling = res.triggered.find((s) => s.id === "demographic_drift_daling_functie");
const stijging = res.triggered.find((s) => s.id === "demographic_drift_stijging_functie");

// Prior: Sales 30/35 = 86%, Marketing 5/35 = 14%. Recent: Sales 8/35 = 23%, Marketing 27/35 = 77%.
assert(daling !== undefined, "een wegzakkend converterend segment wordt gemarkeerd");
assert(daling!.scope.includes("Sales") && daling!.story.includes("droogt op"), "de daling benoemt het segment");
assert(daling!.certainty === "indicatie", "een mix-verschuiving is een indicatie, geen bewijs van oorzaak");
assert(stijging !== undefined && stijging!.scope.includes("Marketing"), "een opkomend segment wordt gemarkeerd");

// ── Stabiele mix: geen drift ──
const stable: DemographicDriftRow[] = [];
stable.push({ dimension: "seniority", value: "Senior", date: day(40), leads: 20 });
stable.push({ dimension: "seniority", value: "Mid", date: day(40), leads: 18 });
stable.push({ dimension: "seniority", value: "Senior", date: day(10), leads: 21 });
stable.push({ dimension: "seniority", value: "Mid", date: day(10), leads: 19 });
const stableRes = buildDemographicDriftSignals(stable, asOf);
assert(stableRes.triggered.length === 0, "een stabiele mix triggert geen drift");
assert(stableRes.checked.includes("demographic_drift_seniority"), "de dimensie is wel gecontroleerd");

// ── Te weinig leads per venster: geen oordeel ──
const thin: DemographicDriftRow[] = [
  { dimension: "industrie", value: "Software", date: day(40), leads: 3 },
  { dimension: "industrie", value: "Finance", date: day(10), leads: 4 },
];
const thinRes = buildDemographicDriftSignals(thin, asOf);
assert(thinRes.triggered.length === 0, "onder de venster-lead-drempel geen drift-oordeel");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
