// Test voor de conversie-tracking-gap-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__tracking_gap_test.ts

import { buildTrackingGapSignals, type TrackingGapRow, TG_RECENT_DAYS, TG_BASELINE_DAYS } from "./tracking-gap";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
const opts = { channelLabel: "Meta", idPrefix: "meta_budget" };
const day = (agoDays: number): string => new Date(Date.now() - agoDays * 86_400_000).toISOString().slice(0, 10);

// Basislijn: 28 dagen, 100 klikken + 3 conversies/dag (gezond, ~3% CVR). Recent 7 dagen: 100
// klikken/dag maar 0 conversies => verwacht ~21, kreeg 0 => tracking-gap.
const gap: TrackingGapRow[] = [];
for (let a = TG_RECENT_DAYS; a < TG_RECENT_DAYS + TG_BASELINE_DAYS; a++) gap.push({ date: day(a), clicks: 100, conversions: 3 });
for (let a = 0; a < TG_RECENT_DAYS; a++) gap.push({ date: day(a), clicks: 100, conversions: 0 });
const res = buildTrackingGapSignals(gap, opts);
const t = res.triggered.find((s) => s.id === "meta_budget_tracking_gap");
assert(t !== undefined, "recente nul na een gezonde basislijn = tracking-gap");
assert(t!.story.includes("kapotte conversie-tracking") && t!.certainty === "indicatie", "het verhaal wijst op tracking, als indicatie");
assert(t!.category === "conversie_meting", "categorie conversie-meting");

// Gezond recent: geen alarm.
const healthy: TrackingGapRow[] = [];
for (let a = 0; a < TG_RECENT_DAYS + TG_BASELINE_DAYS; a++) healthy.push({ date: day(a), clicks: 100, conversions: 3 });
assert(buildTrackingGapSignals(healthy, opts).triggered.length === 0, "een gezond recent venster triggert niets");

// Dunne lead-data (nul is normaal): geen vals alarm. Basislijn te weinig conversies.
const thin: TrackingGapRow[] = [];
for (let a = TG_RECENT_DAYS; a < TG_RECENT_DAYS + TG_BASELINE_DAYS; a++) thin.push({ date: day(a), clicks: 100, conversions: 0.2 });
for (let a = 0; a < TG_RECENT_DAYS; a++) thin.push({ date: day(a), clicks: 100, conversions: 0 });
const thinRes = buildTrackingGapSignals(thin, opts);
assert(thinRes.triggered.length === 0 && thinRes.checked.includes("meta_budget_tracking_gap"), "dunne lead-data waar nul normaal is: geen alarm");

// Weinig recente klikken: verwacht laag, geen alarm (geen verrassende nul).
const lowTraffic: TrackingGapRow[] = [];
for (let a = TG_RECENT_DAYS; a < TG_RECENT_DAYS + TG_BASELINE_DAYS; a++) lowTraffic.push({ date: day(a), clicks: 100, conversions: 3 });
for (let a = 0; a < TG_RECENT_DAYS; a++) lowTraffic.push({ date: day(a), clicks: 3, conversions: 0 });
assert(buildTrackingGapSignals(lowTraffic, opts).triggered.length === 0, "weinig recent verkeer: nul is niet verrassend, geen alarm");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
