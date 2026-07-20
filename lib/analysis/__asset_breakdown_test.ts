// Zelf-draaiende test voor de RSA-asset-uitsplitsing. Draait via tsx.
// Kern: aggregatie over maanden, het dominante performance-label uit de maand met het meeste
// volume, het oordeel (sterk/zwak/neutraal) uit Google's label + CTR-mediaan binnen het veldtype,
// de sterkste headline, en de zwakke/LOW-assets als vervangkandidaten.

import { analyzeAssetBreakdown, MIN_ASSET_IMPRESSIONS, type AssetRow } from "./asset-breakdown";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const a = (assetText: string, fieldType: string, performanceLabel: string, impressions: number, clicks: number): AssetRow =>
  ({ assetText, fieldType, performanceLabel, impressions, clicks });

console.log("oordeel per headline:");
{
  const rows = [
    a("Beste kop", "HEADLINE", "GOOD", 2000, 200),   // CTR 10%
    a("Matige kop", "HEADLINE", "GOOD", 2000, 100),  // CTR 5% (mediaan)
    a("Zwakke kop", "HEADLINE", "LOW", 2000, 40),    // CTR 2% + LOW-label
  ];
  const b = analyzeAssetBreakdown(rows);
  const byText = new Map(b.headlines.map((h) => [h.assetText, h]));
  assert(byText.get("Beste kop")?.verdict === "sterk", "CTR ruim boven mediaan => sterk");
  assert(byText.get("Matige kop")?.verdict === "neutraal", "CTR op de mediaan => neutraal");
  assert(byText.get("Zwakke kop")?.verdict === "zwak", "LOW-label + lage CTR => zwak");
  assert(b.bestHeadline?.assetText === "Beste kop", "sterkste headline correct benoemd");
  assert(b.weakAssets.some((s) => s.assetText === "Zwakke kop"), "zwakke asset als vervangkandidaat");
  assert(b.headlines[0].assetText === "Beste kop", "gesorteerd op CTR aflopend");
}

console.log("dominant label uit de maand met meeste volume:");
{
  const rows = [
    a("Kop", "HEADLINE", "LOW", 500, 10),    // kleine maand, LOW
    a("Kop", "HEADLINE", "BEST", 1500, 150), // grote maand, BEST => dominant
  ];
  const b = analyzeAssetBreakdown(rows);
  assert(b.headlines[0].impressions === 2000 && b.headlines[0].label === "BEST", "aggregatie + dominant label = BEST");
  assert(b.headlines[0].verdict === "sterk", "BEST-label => sterk");
}

console.log("descriptions apart + volume-drempel:");
{
  const rows = [
    a("Beste desc", "DESCRIPTION", "BEST", 2000, 160),
    a("Dunne desc", "DESCRIPTION", "GOOD", MIN_ASSET_IMPRESSIONS - 50, 30), // onder drempel
  ];
  const b = analyzeAssetBreakdown(rows);
  assert(b.descriptions.length === 2 && b.headlines.length === 0, "descriptions los van headlines");
  assert(b.descriptions.find((d) => d.assetText === "Dunne desc")?.verdict === "te_weinig_data", "onder volume-drempel => te weinig data");
}

console.log("lege invoer:");
{
  const b = analyzeAssetBreakdown([]);
  assert(b.headlines.length === 0 && b.bestHeadline === null && /Geen asset-data/.test(b.summaryText), "leeg => eerlijke lege staat");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle asset-breakdown-tests geslaagd");
