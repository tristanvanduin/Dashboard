export {};
// Verificatie van de GA4 tracking-break-detector (buildGa4TrackingSignals): alarm alleen bij een
// VERRASSENDE nul (key events ~0 recent terwijl de basislijn materieel converteerde en de sessies
// doorlopen), en stil bij een gezonde site of een te dunne basislijn.
// Draaien: npx tsx lib/ga4/__ga4_signals_test.ts

import { buildGa4TrackingSignals, GA4_TG_RECENT_DAYS, GA4_TG_BASELINE_DAYS } from "./signals";
import type { Ga4DailyRow, Ga4Channel } from "./types";

const day = (ageDays: number): string => new Date(Date.now() - ageDays * 86_400_000).toISOString().slice(0, 10);

// Bouwt een reeks: recent-venster (0..RECENT) met recSessions/recKey per dag, basislijn erna.
function rows(opts: { recSessionsPerDay: number; recKeyPerDay: number; baseSessionsPerDay: number; baseKeyPerDay: number }): Ga4DailyRow[] {
  const out: Ga4DailyRow[] = [];
  const mk = (age: number, sessions: number, key: number): Ga4DailyRow => ({
    date: day(age), channel: "google" as Ga4Channel, sessions, engagedSessions: Math.round(sessions * 0.6), keyEvents: key,
    funnel: { session_start: sessions, form_submit: key },
  });
  for (let a = 0; a < GA4_TG_RECENT_DAYS; a++) out.push(mk(a, opts.recSessionsPerDay, opts.recKeyPerDay));
  for (let a = GA4_TG_RECENT_DAYS; a < GA4_TG_RECENT_DAYS + GA4_TG_BASELINE_DAYS; a++) out.push(mk(a, opts.baseSessionsPerDay, opts.baseKeyPerDay));
  return out;
}

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log("\n1. Verrassende nul → alarm");
{
  // Basislijn: 30 sessies/dag × 28 = 840 sessies, 2 key/dag × 28 = 56 key events (ratio ~6,7%).
  // Recent: sessies lopen door, key events op 0. Verwacht ~ 0.067 × (30×4) = 8 → boven de drempel.
  const r = buildGa4TrackingSignals(rows({ recSessionsPerDay: 30, recKeyPerDay: 0, baseSessionsPerDay: 30, baseKeyPerDay: 2 }));
  check("detector triggert", r.triggered.length === 1, `triggered=${r.triggered.length}`);
  check("categorie = conversie_meting", r.triggered[0]?.category === "conversie_meting");
  check("certainty = indicatie (nooit als bewijs verkocht)", r.triggered[0]?.certainty === "indicatie");
  check("checked bevat het verhaal-id", r.checked.includes("ga4_tracking_gap"));
}

console.log("\n2. Gezonde site (key events lopen door) → stil");
{
  const r = buildGa4TrackingSignals(rows({ recSessionsPerDay: 30, recKeyPerDay: 2, baseSessionsPerDay: 30, baseKeyPerDay: 2 }));
  check("geen alarm", r.triggered.length === 0, `triggered=${r.triggered.length}`);
  check("verhaal is wel onderzocht (checked)", r.checked.includes("ga4_tracking_gap"));
}

console.log("\n3. Te dunne basislijn (site converteert normaal nauwelijks) → stil");
{
  // Basislijn key events onder de drempel: 0..1/dag → nul is daar normaal, geen alarm.
  const r = buildGa4TrackingSignals(rows({ recSessionsPerDay: 30, recKeyPerDay: 0, baseSessionsPerDay: 5, baseKeyPerDay: 0 }));
  check("geen alarm bij dunne basislijn", r.triggered.length === 0, `triggered=${r.triggered.length}`);
}

console.log("\n4. Lege input → geen crash, geen alarm");
{
  const r = buildGa4TrackingSignals([]);
  check("leeg → geen alarm", r.triggered.length === 0);
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
