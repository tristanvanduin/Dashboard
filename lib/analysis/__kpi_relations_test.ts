// Zelf-draaiende test voor de KPI-verhoudingen-detectors (K1-K8). Draait via tsx.
// Per detector: de trigger, het stil-blijven, de ruis-drempels, en voor de decomposities de
// rekenkundige juistheid (log-aandelen sommen tot de beweging; dominante driver klopt).

import {
  decomposeCpa, detectPromiseGap, detectSaturation, detectReachDilution,
  detectValueMix, detectFrequencyDrivenGrowth, detectPaidVisibility, detectVanityEngagement,
  buildKpiRelations, type KpiWindow,
} from "./kpi-relations";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const win = (label: string, over: Partial<KpiWindow> = {}): KpiWindow => ({
  label, impressions: 100000, clicks: 2000, cost: 4000, conversions: 100, ...over,
});

console.log("[K1] CPA-decompositie:");
{
  // CPC gelijk (€2), CVR halveert (5% -> 2.5%) => CPA x2, volledig CVR-gedreven.
  const cvr = decomposeCpa(win("jun", { clicks: 2000, cost: 4000, conversions: 50 }), win("mei"));
  assert(cvr.triggered.length === 1, "materiele CPA-beweging triggert");
  assert(/SLECHTER CONVERTEERT/.test(cvr.triggered[0].story) && /100%/.test(cvr.triggered[0].story), "CVR als dominante driver, aandeel ~100%");
  assert(/landing\/doelgroep/.test(cvr.triggered[0].actionDirection), "actierichting: landing, niet bieden");
  assert(cvr.triggered[0].certainty === "bewezen_binnen_platform", "arithmetiek op eigen data is bewezen");

  // CVR gelijk, CPC +50% => prijs-gedreven.
  const cpc = decomposeCpa(win("jun", { cost: 6000 }), win("mei"));
  assert(cpc.triggered.length === 1 && /KLIK duurder/.test(cpc.triggered[0].story), "CPC als dominante driver");
  assert(/veiling/.test(cpc.triggered[0].actionDirection), "actierichting: veiling");

  assert(decomposeCpa(win("jun", { cost: 4200 }), win("mei")).triggered.length === 0, "kleine beweging (5%) => stil");
  assert(decomposeCpa(win("jun", { conversions: 5, cost: 8000 }), win("mei", { conversions: 8 })).triggered.length === 0, "onder conversie-minimum => stil");
}

console.log("[K2] belofte-kloof:");
{
  const res = detectPromiseGap(win("jun", { clicks: 2600, conversions: 104 }), win("mei"));
  // CTR +30%, CVR: 104/2600=4% vs 100/2000=5% => -20%.
  assert(res.triggered.length === 1 && /belofte-kloof/.test(res.triggered[0].story), "CTR op, CVR neer => triggert");
  assert(detectPromiseGap(win("jun", { clicks: 2600, conversions: 130 }), win("mei")).triggered.length === 0, "CTR op met CVR gelijk => stil");
}

console.log("[K3] verzadiging:");
{
  const geen = detectSaturation(win("jun", { cost: 6000, conversions: 100 }), win("mei"));
  assert(geen.triggered.length === 1 && /zonder extra conversies/.test(geen.triggered[0].story), "spend +50% zonder extra conversies");
  const marg = detectSaturation(win("jun", { cost: 6000, conversions: 110 }), win("mei"));
  // marginale CPA = 2000/10 = 200 vs gemiddeld ~54.5 => >2x.
  assert(marg.triggered.length === 1 && /marginale CPA/.test(marg.triggered[0].story), "marginale CPA ver boven gemiddeld");
  assert(detectSaturation(win("jun", { cost: 6000, conversions: 150 }), win("mei")).triggered.length === 0, "extra spend die evenredig levert => stil");
  assert(detectSaturation(win("jun", { cost: 4400 }), win("mei")).triggered.length === 0, "spend +10% onder drempel => stil");
}

console.log("[K4] bereik-verdunning:");
{
  const res = detectReachDilution(win("jun", { impressions: 150000, clicks: 2400 }), win("mei"));
  // imp +50%, CTR 1.6% vs 2% => -20%.
  assert(res.triggered.length === 1 && /verbreding/.test(res.triggered[0].story), "imp op, CTR neer => triggert");
  assert(detectReachDilution(win("jun", { impressions: 150000, clicks: 3000 }), win("mei")).triggered.length === 0, "imp op met CTR gelijk => stil");
}

console.log("[K5] waarde-mix:");
{
  const res = detectValueMix(win("jun", { conversions: 102, conversionsValue: 6000 }), win("mei", { conversionsValue: 10000 }));
  assert(res.triggered.length === 1 && /mix\/AOV/.test(res.triggered[0].story), "volume stabiel, waarde/conv -40% => triggert");
  assert(detectValueMix(win("jun", { conversions: 150, conversionsValue: 9000 }), win("mei", { conversionsValue: 10000 })).triggered.length === 0, "volume +50% => geen mix-verhaal (volume beweegt zelf)");
  assert(detectValueMix(win("jun"), win("mei")).triggered.length === 0, "zonder waarde-data => stil (gecheckt)");
}

console.log("[K6] herhaling vs bereik:");
{
  const res = detectFrequencyDrivenGrowth(win("jun", { impressions: 150000, avgFrequency: 4.2 }), win("mei", { avgFrequency: 3.0 }));
  // ln(4.2/3)/ln(1.5) = 0.336/0.405 = ~83% frequentie-gedreven.
  assert(res.triggered.length === 1 && /herhaling/.test(res.triggered[0].story), "groei gedragen door frequentie => triggert");
  assert(res.triggered[0].certainty === "verklaringskandidaat", "dag-gemiddelde proxy => verklaringskandidaat");
  assert(/benadering/.test(res.triggered[0].story), "proxy expliciet benoemd");
  const reach = detectFrequencyDrivenGrowth(win("jun", { impressions: 150000, avgFrequency: 3.1 }), win("mei", { avgFrequency: 3.0 }));
  assert(reach.triggered.length === 0, "groei uit nieuw bereik => stil");
}

console.log("[K7] dure zichtbaarheid:");
{
  const res = detectPaidVisibility(win("jun", { cost: 5000, impressionShare: 0.62 }), win("mei", { impressionShare: 0.55 }));
  assert(res.triggered.length === 1 && /premie/.test(res.triggered[0].story), "IS +7pt met CPC +25% => triggert");
  assert(detectPaidVisibility(win("jun", { cost: 5000, impressionShare: 0.56 }), win("mei", { impressionShare: 0.55 })).triggered.length === 0, "IS +1pt => stil");
}

console.log("[K8] vanity-engagement:");
{
  const res = detectVanityEngagement(win("jun", { engagement: 3000, conversions: 80 }), win("mei", { engagement: 2000 }));
  assert(res.triggered.length === 1 && /koopt niet/.test(res.triggered[0].story), "engagement +50% met conversies -20% => triggert");
  assert(detectVanityEngagement(win("jun", { engagement: 3000, conversions: 120 }), win("mei", { engagement: 2000 })).triggered.length === 0, "beide omhoog => stil");
}

console.log("bundel:");
{
  const merged = buildKpiRelations(win("jun"), win("mei"));
  assert(merged.checked.length === 8, "alle acht verhoudingen gecheckt");
  assert(merged.triggered.length === 0, "identieke vensters: alles stil");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle kpi-verhoudingen-tests geslaagd");
