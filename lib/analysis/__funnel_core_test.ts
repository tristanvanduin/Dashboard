// Zelf-draaiende test voor de gedeelde funnel-drop-off-kern (Meta + LinkedIn + Google leunen
// hier allemaal op — één bug raakt drie kanalen). Draait via tsx. Kern: overgangs-rates UIT
// venstertotalen, de materieel verslechterde fase met ruis-/volume-drempel, fasen zonder data
// die expliciet worden overgeslagen (nooit stiekem 0%), en de eerlijke degradatie bij te weinig.

import { analyzeFunnel, renderFunnelMarkdown, type FunnelStageDef } from "./funnel-core";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

interface Row { date: string; impressions: number; clicks: number; conversions: number; leads: number }
const day = (d: number): string => `2026-06-${String(d).padStart(2, "0")}`;
const stageDefs: FunnelStageDef<Row>[] = [
  { key: "imp", label: "Impressies", value: (r) => r.impressions },
  { key: "clk", label: "Klikken", value: (r) => r.clicks },
  { key: "cnv", label: "Conversies", value: (r) => r.conversions },
  { key: "led", label: "Leads", value: (r) => r.leads },
];

console.log("materiele verslechtering met volume:");
{
  // 14 dagen; recent (dag 8-14) halveert de klik-rate t.o.v. prior (dag 1-7), met ruim volume.
  const rows: Row[] = [];
  for (let d = 1; d <= 14; d++) {
    const recent = d >= 8;
    rows.push({ date: day(d), impressions: 100, clicks: recent ? 10 : 20, conversions: recent ? 1 : 2, leads: 0 });
  }
  const f = analyzeFunnel(rows, stageDefs, { windowDays: 7 });
  assert(f.available, "funnel uitvoerbaar");
  assert(f.stages.length === 2, "twee overgangen tussen drie actieve fasen");
  assert(f.worst?.from === "Impressies" && f.worst?.to === "Klikken", "grootste materiele verslechtering = Impressies → Klikken");
  assert(f.worst != null && Math.abs((f.worst.deltaPct ?? 0) - -0.5) < 1e-9, "rate halveerde: -50% uit venstertotalen");
  assert(f.skippedStages.includes("Leads"), "fase zonder data (Leads) wordt expliciet overgeslagen");

  const md = renderFunnelMarkdown(f, { title: "Test-funnel", windowNote: "recent vs prior" });
  assert(/Impressies → Klikken/.test(md) && /Duiding/.test(md), "markdown benoemt de overgang en duidt de verslechtering");
}

console.log("volume-drempel houdt ruis tegen:");
{
  // Zelfde halvering, maar recent instap-volume onder de drempel (< 200): geen 'worst'.
  const rows: Row[] = [];
  for (let d = 1; d <= 14; d++) {
    const recent = d >= 8;
    rows.push({ date: day(d), impressions: 20, clicks: recent ? 1 : 2, conversions: 0, leads: 0 });
  }
  const f = analyzeFunnel(rows, stageDefs, { windowDays: 7 });
  assert(f.available && f.worst === null, "verval onder volume-minimum telt niet als materieel");
}

console.log("eerlijke degradatie:");
{
  assert(analyzeFunnel([], stageDefs).available === false, "geen dagdata => niet uitvoerbaar");
  const onlyOne: Row[] = [{ date: day(10), impressions: 100, clicks: 0, conversions: 0, leads: 0 }];
  const f = analyzeFunnel(onlyOne, stageDefs, { windowDays: 7 });
  assert(f.available === false, "minder dan twee actieve fasen => niet uitvoerbaar");
  assert(f.skippedStages.includes("Klikken") && f.skippedStages.includes("Conversies"), "lege fasen worden benoemd, niet als 0% meegeteld");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle funnel-core-tests geslaagd");
