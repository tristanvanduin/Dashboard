// Zelf-draaiende test voor de geo-clone-aggregator (Fase 1c). Draait via tsx.
// Controleert: filteren op geo-clone via de catalogus, per-maand sommeren, ratio's uit
// maandtotalen (niet uit gemiddelde deelwaarden), totalen uit maandtotalen, en lege invoer.

import { aggregateCampaignMonthlyByGeoClone, type CampaignMonthlyRow } from "./geo-clone-aggregate";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error("  ✗ " + msg);
  } else {
    console.log("  ✓ " + msg);
  }
}
function close(a: number | null, b: number, msg: string) {
  // De aggregator rondt ratio's op 4 decimalen af; tolerantie navenant.
  assert(a !== null && Math.abs(a - b) < 5e-5, `${msg} (kreeg ${a}, verwacht ${b})`);
}

// GRT = GreenTech Amsterdam (bevestigd). Twee GRT-campagnes over twee maanden, plus één
// AQM-campagne die NIET mee mag tellen en één onbekende campagne die genegeerd wordt.
const rows: CampaignMonthlyRow[] = [
  { campaign_name: "GRT | Search | NL", month: "2026-01-01", impressions: 1000, clicks: 100, cost: 200, conversions: 10, conversions_value: 800 },
  { campaign_name: "GRT | Display", month: "2026-01-01", impressions: 500, clicks: 20, cost: 50, conversions: 2, conversions_value: 100 },
  { campaign_name: "GRT | Search | NL", month: "2026-02-01", impressions: 2000, clicks: 300, cost: 400, conversions: 20, conversions_value: 2000 },
  { campaign_name: "AQM | Search", month: "2026-01-01", impressions: 9999, clicks: 9999, cost: 9999, conversions: 999, conversions_value: 9999 },
  { campaign_name: "Brand generic", month: "2026-01-01", impressions: 111, clicks: 11, cost: 11, conversions: 1, conversions_value: 11 },
];

console.log("aggregateCampaignMonthlyByGeoClone (GRT):");
const grt = aggregateCampaignMonthlyByGeoClone(rows, "GRT");

assert(grt.months.length === 2, "twee maanden");
assert(grt.months[0].month === "2026-01-01" && grt.months[1].month === "2026-02-01", "maanden gesorteerd oplopend");
assert(grt.campaignCount === 2, "twee unieke GRT-campagnes (geen dubbeltelling van dezelfde naam)");

// Januari: som van de twee GRT-rijen (AQM en generic niet meegeteld).
const jan = grt.months[0];
assert(jan.impressions === 1500 && jan.clicks === 120 && jan.cost === 250 && jan.conversions === 12 && jan.conversionsValue === 900, "januari-sommen alleen GRT");
close(jan.cpa, 250 / 12, "januari CPA uit totalen");
close(jan.roas, 900 / 250, "januari ROAS uit totalen");
close(jan.ctr, 120 / 1500, "januari CTR uit totalen");

// Totalen over beide maanden.
const t = grt.totals;
assert(t.impressions === 3500 && t.clicks === 420 && t.cost === 650 && t.conversions === 32 && t.conversionsValue === 2900, "totalen over beide maanden");
close(t.cpa, 650 / 32, "totaal CPA uit totalen (niet gemiddelde van maand-CPA's)");
close(t.roas, 2900 / 650, "totaal ROAS uit totalen");
close(t.ctr, 420 / 3500, "totaal CTR uit totalen");

console.log("lege / geen-match gevallen:");
const empty = aggregateCampaignMonthlyByGeoClone([], "GRT");
assert(empty.months.length === 0 && empty.campaignCount === 0, "lege invoer geeft leeg resultaat");
assert(empty.totals.cpa === null && empty.totals.roas === null && empty.totals.ctr === null, "lege totalen: ratio's null (geen deling door nul)");

const noMatch = aggregateCampaignMonthlyByGeoClone(rows, "ICC");
assert(noMatch.months.length === 0 && noMatch.campaignCount === 0, "geo-clone zonder campagnes geeft leeg resultaat");

if (failed > 0) {
  console.error(`\n${failed} assertie(s) gefaald`);
  process.exit(1);
}
console.log("\nalle geo-clone-aggregate-tests geslaagd");
