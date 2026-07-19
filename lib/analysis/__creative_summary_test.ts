// Zelf-draaiende test voor de creative-samenvatting. Draait via tsx.
// Kern: totalen + ratio's uit totalen, beste/zwakste op CTR met volume-drempel, en de drie
// aanbevelingssoorten (pauzeer dure niet-converterende, vervang zwakke CTR, schaal sterke).

import { summarizeCreatives, type CreativeRow } from "./creative-summary";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const c = (id: string, over: Partial<CreativeRow>): CreativeRow => ({ id, name: id, impressions: 1000, clicks: 20, cost: 50, conversions: 2, ...over });

console.log("lege invoer:");
{
  const s = summarizeCreatives([]);
  assert(s.count === 0 && s.recommendations.length === 0, "leeg => geen aanbevelingen");
  assert(/Geen creative-data/.test(s.summaryText), "eerlijke lege tekst");
}

console.log("totalen + beste/zwakste:");
{
  const rows = [
    c("A", { impressions: 2000, clicks: 100, cost: 100, conversions: 10 }), // CTR 5%
    c("B", { impressions: 2000, clicks: 40, cost: 100, conversions: 5 }),   // CTR 2%
    c("C", { impressions: 2000, clicks: 20, cost: 100, conversions: 3 }),   // CTR 1%
  ];
  const s = summarizeCreatives(rows);
  assert(s.totals.impressions === 6000 && s.totals.clicks === 160, "totalen gesommeerd");
  assert(Math.abs((s.totals.ctr ?? 0) - 160 / 6000) < 1e-9, "CTR uit totalen");
  assert(s.best?.name === "A" && s.worst?.name === "C", "beste en zwakste op CTR");
}

console.log("aanbevelingen:");
{
  const rows = [
    c("Duur-nul", { impressions: 3000, clicks: 60, cost: 200, conversions: 0 }),   // pauzeer
    c("Zwak", { impressions: 4000, clicks: 8, cost: 80, conversions: 1 }),         // CTR 0.2% zwak
    c("Sterk", { impressions: 4000, clicks: 320, cost: 100, conversions: 20 }),    // CTR 8% sterk
    c("Midden", { impressions: 4000, clicks: 160, cost: 100, conversions: 8 }),    // CTR 4% mediaan
  ];
  const s = summarizeCreatives(rows);
  assert(s.recommendations.some((r) => r.kind === "pauzeer" && r.creativeName === "Duur-nul"), "dure nul-conversie => pauzeer");
  assert(s.recommendations.some((r) => r.kind === "vervang" && r.creativeName === "Zwak"), "zwakke CTR => vervang");
  assert(s.recommendations.some((r) => r.kind === "schaal" && r.creativeName === "Sterk"), "sterke CTR + conversies => schaal");
  assert(/aandacht vragen/.test(s.summaryText), "summary benoemt de pauzeerkandidaat");
}

console.log("volume-drempel:");
{
  // Hoge CTR maar te weinig volume: telt niet mee als beste (ruis).
  const rows = [
    c("Ruis", { impressions: 100, clicks: 50, cost: 10, conversions: 1 }),        // CTR 50% maar <500 imp
    c("Echt", { impressions: 3000, clicks: 120, cost: 100, conversions: 6 }),     // CTR 4%
  ];
  const s = summarizeCreatives(rows);
  assert(s.best?.name === "Echt", "onder volume-minimum telt niet als beste");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle creative-summary-tests geslaagd");
