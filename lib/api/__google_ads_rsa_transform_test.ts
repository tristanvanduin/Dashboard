// Test voor de RSA-sync-mappers. Deterministisch, geen IO.
// Draaien: npx tsx lib/api/__google_ads_rsa_transform_test.ts

import { mapRsaAssetApiRow, mapAdMetaApiRow, rsaAssetToDbRow, adMetaToDbRow } from "./google-ads-rsa-transform";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── De camelCase-respons (REST-standaard) ──
const camelRow = {
  campaign: { name: "Search NL" },
  adGroup: { name: "Adgroup A" },
  adGroupAd: { ad: { id: "111" } },
  asset: { id: "222", textAsset: { text: "Same day shipment" } },
  adGroupAdAssetView: { fieldType: "HEADLINE", pinnedField: "HEADLINE_1", performanceLabel: "BEST" },
  metrics: { impressions: "12000", clicks: 300, conversions: 5.5, costMicros: 1234560 },
  segments: { month: "2026-06-01" },
};
const camel = mapRsaAssetApiRow(camelRow)!;
assert(camel.adId === "111" && camel.assetId === "222" && camel.month === "2026-06-01", "de camelCase-respons mapt de sleutels");
assert(camel.impressions === 12000 && camel.cost === 1.23456, "string-getallen parsen en micros delen door een miljoen");
assert(camel.pinnedField === "HEADLINE_1" && camel.performanceLabel === "BEST", "een echte pin en een bekend label blijven staan");

// ── De snake_case-variant vangt dezelfde velden ──
const snakeRow = {
  campaign: { name: "Search NL" },
  ad_group: { name: "Adgroup A" },
  ad_group_ad: { ad: { id: "111" } },
  asset: { id: "222", text_asset: { text: "Kop" } },
  ad_group_ad_asset_view: { field_type: "DESCRIPTION", pinned_field: "UNSPECIFIED", performance_label: "PINNED_WEIRD" },
  metrics: { impressions: 100, clicks: 1, conversions: 0, cost_micros: 500000 },
  segments: { month: "2026-05-01" },
};
const snake = mapRsaAssetApiRow(snakeRow)!;
assert(snake.fieldType === "DESCRIPTION" && snake.cost === 0.5, "de snake_case-respons mapt via dezelfde vangst");
assert(snake.pinnedField === null, "UNSPECIFIED-pin wordt null");
assert(snake.performanceLabel === "UNKNOWN", "een onbekend label valt terug op UNKNOWN (de tabel-check staat dat toe)");

// ── Weigeringen ──
assert(mapRsaAssetApiRow({ ...camelRow, adGroupAdAssetView: { fieldType: "SITELINK" } }) === null, "andere veldtypes dan HEADLINE en DESCRIPTION doen niet mee");
assert(mapRsaAssetApiRow({ ...camelRow, segments: {} }) === null, "zonder maand geen rij (verplichte sleutel)");
assert(mapRsaAssetApiRow({ ...camelRow, asset: { id: "222", textAsset: {} } }) === null, "zonder assettekst geen rij");

// ── Ad-meta ──
const meta = mapAdMetaApiRow({
  campaign: { name: "Search NL" },
  adGroup: { name: "Adgroup A" },
  adGroupAd: { status: "ENABLED", ad: { id: "111", type: "RESPONSIVE_SEARCH_AD", finalUrls: ["https://voorbeeld.nl/case", "https://voorbeeld.nl/alt"] } },
})!;
assert(meta.finalUrl === "https://voorbeeld.nl/case" && meta.status === "ENABLED" && meta.adType === "RESPONSIVE_SEARCH_AD", "de eerste final URL plus type en status mappen");
assert(mapAdMetaApiRow({ adGroupAd: { ad: { id: "112", finalUrls: [] } } })!.finalUrl === null, "een lege final_urls-lijst geeft null");
assert(mapAdMetaApiRow({ adGroupAd: { ad: {} } }) === null, "zonder ad-id geen meta-rij");

// ── De database-rijen ──
const dbAsset = rsaAssetToDbRow({ ...camel, conversions: 5.555 }, "klant-1");
assert(dbAsset.client_id === "klant-1" && dbAsset.field_type === "HEADLINE" && dbAsset.asset_text === "Same day shipment", "de asset-db-rij draagt de 020-kolomnamen");
assert(dbAsset.conversions === 5.56 && dbAsset.cost === 1.23 && dbAsset.impressions === 12000, "conversies en kosten ronden op twee decimalen, impressies op heel");
const dbMeta = adMetaToDbRow(meta, "klant-1");
assert(dbMeta.final_url === "https://voorbeeld.nl/case" && dbMeta.ad_id === "111", "de meta-db-rij draagt de 020-kolomnamen");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
