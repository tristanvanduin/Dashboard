// Zelf-draaiende test voor de Meta funnel-drop-off-facts. Draait via tsx.
// Kern: rates uit venstertotalen, materiele verslechtering wordt de "worst", fasen zonder
// data degraderen expliciet, en te weinig fasen betekent eerlijk "niet uitvoerbaar".

import { analyzeMetaFunnel, renderMetaFunnelMarkdown, type MetaFunnelDailyRow } from "./meta-funnel-facts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const day = (date: string, over: Partial<MetaFunnelDailyRow>): MetaFunnelDailyRow => ({ date, ...over });

console.log("verslechterde checkout-fase:");
{
  const rows: MetaFunnelDailyRow[] = [];
  for (let d = 55; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const recent = d < 28;
    // Landing->winkelwagen zakt van 20% naar 10% in het recente venster; rest stabiel.
    rows.push(day(date, { impressions: 5000, link_clicks: 50, landing_page_views: 30, add_to_cart: recent ? 3 : 6, initiate_checkout: recent ? 2 : 4, conversions: recent ? 1 : 2 }));
  }
  const f = analyzeMetaFunnel(rows);
  assert(f.available, "funnel beschikbaar");
  assert(f.worst !== null && f.worst.from === "landingspagina-views" && f.worst.to === "winkelwagen", "landing->winkelwagen is de grootste verslechtering");
  assert(f.worst!.deltaPct != null && f.worst!.deltaPct < -0.4, "relatief verval ~-50%");
  const md = renderMetaFunnelMarkdown(f);
  assert(/grootste materiele verslechtering/.test(md) && /landingspagina-views → winkelwagen/.test(md), "markdown markeert de fase");
}

console.log("degradatiepaden:");
{
  // Leadgen zonder e-commerce-events: winkelwagen/checkout ontbreken, funnel werkt op de rest.
  const rows: MetaFunnelDailyRow[] = [];
  for (let d = 55; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    rows.push(day(date, { impressions: 3000, link_clicks: 30, landing_page_views: 20, conversions: 2 }));
  }
  const f = analyzeMetaFunnel(rows);
  assert(f.available && f.skippedStages.includes("winkelwagen") && f.skippedStages.includes("checkout gestart"), "ontbrekende fasen expliciet overgeslagen");
  assert(f.stages.some((s) => s.from === "landingspagina-views" && s.to === "conversies"), "keten sluit over de ontbrekende fasen heen");
  assert(f.worst === null, "stabiele funnel: geen worst");

  const leeg = analyzeMetaFunnel([]);
  assert(!leeg.available && /geen Meta-dagdata/.test(leeg.degradedReason ?? ""), "leeg: eerlijk niet uitvoerbaar");

  const alleenImp = analyzeMetaFunnel([day("2026-07-01", { impressions: 1000 })]);
  assert(!alleenImp.available, "één fase met data: niet uitvoerbaar");
}

console.log("ruis-drempel:");
{
  // Zelfde relatieve val maar met te weinig volume: geen materieel oordeel.
  const rows: MetaFunnelDailyRow[] = [];
  for (let d = 55; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const recent = d < 28;
    rows.push(day(date, { impressions: 100, link_clicks: 4, landing_page_views: 3, add_to_cart: recent ? 0.3 : 0.6, conversions: 0.1 }));
  }
  const f = analyzeMetaFunnel(rows);
  assert(f.worst === null, "onder het volume-minimum geen worst-claim");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle meta-funnel-facts-tests geslaagd");
