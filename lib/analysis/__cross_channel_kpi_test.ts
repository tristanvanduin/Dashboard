// Test voor de cross-channel KPI-verhoudingen + pacing. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__cross_channel_kpi_test.ts

import { buildCrossChannelKpiRelations, blendKpiWindows, blendedPacing } from "./cross-channel-kpi";
import type { KpiWindow } from "./kpi-relations";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Blend: som over kanalen, kanaal-eigen ratio-metrics blijven weg ──
const a: KpiWindow = { label: "r", impressions: 10000, clicks: 500, cost: 1000, conversions: 20, conversionsValue: 2400, impressionShare: 0.5 };
const b: KpiWindow = { label: "r", impressions: 8000, clicks: 300, cost: 600, conversions: 15, conversionsValue: 1800, avgFrequency: 2.2 };
const blended = blendKpiWindows([a, b], "blended-recent");
assert(blended.impressions === 18000 && blended.clicks === 800 && blended.cost === 1600 && blended.conversions === 35, "blend telt de kernmetrics op");
assert(blended.conversionsValue === 4200, "conversiewaarde telt op waar aanwezig");
assert(blended.impressionShare === undefined && blended.avgFrequency === undefined, "kanaal-eigen ratio-metrics (IS/frequentie) blenden niet");

// ── CPA-decompositie op blended totaal: getriggerd, maar geplafonneerd op indicatie ──
// recent blended: cost 1600, clicks 800, conv 35 (CPC 2.0, CVR gelijk aan prior)
// prior  blended: cost 1200, clicks 800, conv 35 (CPC 1.5)  -> CPA +33%, driver = CPC
const recentCh: KpiWindow[] = [
  { label: "recent", impressions: 10000, clicks: 500, cost: 1000, conversions: 20 },
  { label: "recent", impressions: 8000, clicks: 300, cost: 600, conversions: 15 },
];
const priorCh: KpiWindow[] = [
  { label: "vorige", impressions: 10000, clicks: 500, cost: 700, conversions: 20 },
  { label: "vorige", impressions: 8000, clicks: 300, cost: 500, conversions: 15 },
];
const res = buildCrossChannelKpiRelations(recentCh, priorCh, { recent: "juni", prior: "mei" });
const cpa = res.triggered.find((s) => s.id === "kpi_cpa_decompositie_cross");
assert(cpa !== undefined, "de blended CPA-decompositie triggert op de mediamix");
assert(cpa!.certainty === "indicatie", "cross-channel is nooit bewezen_binnen_platform: geplafonneerd op indicatie");
assert(cpa!.category === "cross_channel" && cpa!.scope.startsWith("blended"), "het verhaal is als cross-channel/blended gemarkeerd");
assert(cpa!.story.includes("attributie"), "de attributie-voetnoot staat in het verhaal");
assert(res.checked.every((c) => c.endsWith("_cross")), "de gecheckte ids zijn cross-onderscheiden");

// ── Minder dan twee kanalen: geen cross-channel-verhaal ──
const solo = buildCrossChannelKpiRelations([recentCh[0]], [priorCh[0]]);
assert(solo.triggered.length === 0, "met één kanaal is er geen cross-channel-beeld");

// ── Blended pacing: som over kanalen, tempo vs vorige maand ──
const pacing = blendedPacing([
  { channel: "google_ads", mtdSpend: 1200, mtdConv: 30, prevMtdSpend: 1000, prevMtdConv: 28 },
  { channel: "meta_ads", mtdSpend: 400, mtdConv: 12, prevMtdSpend: 300, prevMtdConv: 10 },
]);
assert(pacing.mtdSpend === 1600 && pacing.prevMtdSpend === 1300, "pacing telt de spend over de kanalen op");
assert(pacing.spendPacePct !== null && Math.abs(pacing.spendPacePct - 1.231) < 0.01, "het blended spend-tempo is mtd/prevMtd");
assert(pacing.runningAhead === true, "meer dan 15% boven vorige maand telt als 'loopt voor'");
assert(pacing.channels === 2, "het aantal bijdragende kanalen staat erin");

// ── Pacing zonder vorige-maand-basis: geen valse precisie ──
const pacingNoBase = blendedPacing([
  { channel: "linkedin_ads", mtdSpend: 200, mtdConv: 5, prevMtdSpend: 0, prevMtdConv: 0 },
]);
assert(pacingNoBase.spendPacePct === null && pacingNoBase.runningAhead === null, "zonder vorige-maand-spend geen tempo-oordeel");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
