// Zelf-draaiende test voor de RSA-tekstverrijking. Draait via tsx.
// Kern: teksten extraheren uit {text}-arrays (camel/snake), de ad_id->tekst-map bouwen, en de
// lege tekstvelden van creative-rijen aanvullen zonder al-gevulde velden te overschrijven.

import { extractResponsiveTexts, buildAdTextMap, applyAdText, type AdRsaText } from "./google-ads-rsa-transform";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

console.log("extractResponsiveTexts:");
assert(JSON.stringify(extractResponsiveTexts([{ text: "A" }, { text: "" }, { text: "B" }])) === '["A","B"]', "trekt tekst, filtert leeg");
assert(extractResponsiveTexts(undefined).length === 0 && extractResponsiveTexts("x").length === 0, "niet-array => leeg");

console.log("buildAdTextMap (camel + snake):");
{
  const rows = [
    { adGroupAd: { ad: { id: "111", responsiveSearchAd: { headlines: [{ text: "Kop 1" }], descriptions: [{ text: "Beschr" }] }, finalUrls: ["https://x.nl/pad"] } } },
    { ad_group_ad: { ad: { id: "222", responsive_search_ad: { headlines: [{ text: "Kop 2" }], descriptions: [] }, final_urls: ["https://y.nl"] } } },
    { adGroupAd: { ad: {} } }, // geen id => overgeslagen
  ];
  const map = buildAdTextMap(rows);
  assert(map.size === 2, "twee ads met id");
  assert(map.get("111")!.headlines[0] === "Kop 1" && map.get("111")!.finalUrls[0] === "https://x.nl/pad", "camelCase gemapt");
  assert(map.get("222")!.headlines[0] === "Kop 2" && map.get("222")!.descriptions.length === 0, "snake_case gemapt, lege desc blijft leeg");
}

console.log("applyAdText:");
{
  const map = new Map<string, AdRsaText>([
    ["111", { headlines: ["Kop 1"], descriptions: ["Beschr"], finalUrls: ["x.nl"] }],
  ]);
  const creatives = [
    { adId: "111", headlines: [] as string[], descriptions: [] as string[], finalUrls: [] as string[], keep: "a" },
    { adId: "111", headlines: ["Al gevuld"], descriptions: ["D"], finalUrls: ["u"], keep: "b" },
    { adId: "999", headlines: [] as string[], descriptions: [] as string[], finalUrls: [] as string[], keep: "c" },
  ];
  const out = applyAdText(creatives, map);
  assert(out[0].headlines[0] === "Kop 1" && out[0].descriptions[0] === "Beschr", "lege velden aangevuld uit map");
  assert(out[0].keep === "a", "overige velden behouden");
  assert(out[1].headlines[0] === "Al gevuld", "reeds gevulde velden niet overschreven");
  assert(out[2].headlines.length === 0, "ad zonder map-entry blijft leeg");
}

console.log("gedeeltelijke aanvulling:");
{
  const map = new Map<string, AdRsaText>([["1", { headlines: ["H"], descriptions: ["D"], finalUrls: ["U"] }]]);
  const out = applyAdText([{ adId: "1", headlines: ["Bestaand"], descriptions: [], finalUrls: [] }], map);
  assert(out[0].headlines[0] === "Bestaand" && out[0].descriptions[0] === "D" && out[0].finalUrls[0] === "U", "vult alleen de lege velden aan");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle rsa-tekstverrijking-tests geslaagd");
