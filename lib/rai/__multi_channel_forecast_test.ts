// Test voor de universele multi-channel event-forecast. Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__multi_channel_forecast_test.ts

import { forecastAllChannels, type ChannelForecastInput } from "./multi-channel-forecast";
import type { Edition, DailyPoint } from "./event-time-axis";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Zelfde beurs (gelijke fairStartDate) voor elk kanaal; venster 45 dagen.
const curEd: Edition = { editionId: "2026", campaignStartDate: "2026-03-01", fairStartDate: "2026-04-15", fairEndDate: "2026-04-17" };
const prevEd: Edition = { editionId: "2025", campaignStartDate: "2025-03-01", fairStartDate: "2025-04-15", fairEndDate: "2025-04-17" };

// Vorige editie per kanaal: opbouw die versnelt naar de beurs. Cum tot D-15 = 2000, eind = 5000.
const prevPoints: DailyPoint[] = [
  { date: "2025-03-08", value: 500 },   // D-38
  { date: "2025-03-22", value: 700 },   // D-24
  { date: "2025-03-31", value: 800 },   // D-15
  { date: "2025-04-08", value: 1500 },  // D-7
  { date: "2025-04-13", value: 1500 },  // D-2  -> eind 5000
];
const mk = (channel: string, curCumTo15: number, target: number | null, prev = prevPoints): ChannelForecastInput => ({
  channel,
  current: { edition: curEd, points: [{ date: "2026-03-31", value: curCumTo15 }] }, // alles op D-15
  previous: prev ? { edition: prevEd, points: prev } : null,
  target,
});

// ── Drie kanalen op D-15: elk ratio 2,5 (5000/2000). Totaal = som van de projecties ──
const asOf = "2026-03-31";
const res = forecastAllChannels([
  mk("google_ads", 2400, 5500),   // 2400*2.5 = 6000
  mk("meta_ads", 800, 2000),      // 800*2.5  = 2000
  mk("linkedin_ads", 400, 1000),  // 400*2.5  = 1000
], asOf);

assert(res.perChannel.length === 3 && res.blended.channelsWithProjection === 3, "alle drie de kanalen leveren een projectie");
assert(res.blended.daysToFairNow === 15, "het totaal ankert op dezelfde dagen-tot-beurs (D-15)");
assert(res.blended.currentCumulative === 3600, "de huidige stand telt over de kanalen (2400+800+400)");
assert(res.blended.projectedFinal === 9000, "de beursprojectie is de som van de kanaal-projecties (6000+2000+1000)");
assert(res.blended.target === 8500, "het totaal-doel telt op als élk kanaal een doel heeft (5500+2000+1000)");
assert(res.blended.projectedVsTargetPct !== null && Math.abs(res.blended.projectedVsTargetPct - 1.059) < 0.01 && res.blended.willHitTarget === true, "totaal versus totaal-doel gehaald");
assert(res.blended.confidence === "gemiddeld", "de zekerheid is de zwakste schakel (D-15 = gemiddeld voor elk)");

// ── Eén kanaal zonder basis: degradeert expliciet, telt niet mee, totaal draait door ──
const resDeg = forecastAllChannels([
  mk("google_ads", 2400, 5500),                              // projectie 6000
  { channel: "meta_ads", current: { edition: curEd, points: [] }, previous: null, target: 2000 }, // geen basis
], asOf);
assert(resDeg.blended.channelsWithProjection === 1 && resDeg.blended.channelsTotal === 2, "een kanaal zonder basis wordt niet meegeteld maar wel geteld als totaal");
assert(resDeg.blended.projectedFinal === 6000, "alleen het kanaal met projectie draagt bij aan het totaal");
assert(resDeg.blended.note.includes("gedegradeerd"), "het gedegradeerde kanaal staat expliciet in de note");

// ── Zwakste schakel bepaalt de zekerheid: één laag-zeker kanaal trekt het totaal omlaag ──
// Extreme ramp bij één kanaal ver van de beurs -> restvolume-anker (laag). asOf D-30.
const rampPrev: DailyPoint[] = [
  { date: "2025-03-06", value: 20 }, { date: "2025-03-31", value: 180 }, { date: "2025-04-13", value: 4800 },
];
const resZwak = forecastAllChannels([
  mk("google_ads", 2400, 5500, prevPoints),  // op D-30: prevAtX gezond -> gemiddeld
  { channel: "meta_ads", current: { edition: curEd, points: [{ date: "2026-03-10", value: 40 }] }, previous: { edition: prevEd, points: rampPrev }, target: 2000 }, // laag
], "2026-03-16");
assert(resZwak.blended.confidence === "laag", "het totaal erft de laagste zekerheid van de bijdragende kanalen");

// ── Geen enkel kanaal met basis: totaal is geen_basis, geen projectie ──
const resLeeg = forecastAllChannels([
  { channel: "google_ads", current: { edition: curEd, points: [] }, previous: null, target: 5500 },
], asOf);
assert(resLeeg.blended.projectedFinal === null && resLeeg.blended.confidence === "geen_basis", "zonder enige projectie is er geen totaal");

// ── Deels ontbrekende targets: geen totaal-doelpercentage (eerlijke noemer) ──
const resGeenDoel = forecastAllChannels([
  mk("google_ads", 2400, 5500),
  mk("meta_ads", 800, null),
], asOf);
assert(resGeenDoel.blended.projectedFinal === 8000 && resGeenDoel.blended.target === null && resGeenDoel.blended.projectedVsTargetPct === null, "zonder doel op elk bijdragend kanaal geen totaal-doelpercentage");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
