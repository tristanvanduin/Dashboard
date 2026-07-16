// Test voor de LP-breuk-versus-kanaal-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__google_conversion_test.ts

import { detectLpBreukVersusKanaal, concentratedDevice, BREACH_MIN_CLICKS, BREACH_MIN_CAMPAIGNS, type BreachCampaignInput, type BreachDeviceInput } from "./google-conversion";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Een campagne waarvan de conversieratio halveert (10 naar 5 procent) bij een stabiele CTR.
function gezakt(campaignName: string): BreachCampaignInput {
  return { campaignName, impressions: 20000, clicks: 1000, conversions: 50, prevImpressions: 20000, prevClicks: 1000, prevConversions: 100 };
}
// Een campagne die gewoon stabiel is.
function stabiel(campaignName: string): BreachCampaignInput {
  return { campaignName, impressions: 20000, clicks: 1000, conversions: 100, prevImpressions: 20000, prevClicks: 1000, prevConversions: 100 };
}
function device(name: string, conversions: number, prevConversions: number, clicks = 1000): BreachDeviceInput {
  return { device: name, impressions: 20000, clicks, conversions, prevImpressions: 20000, prevClicks: clicks, prevConversions };
}

const overalGezakt = [gezakt("A"), gezakt("B"), gezakt("C"), gezakt("D")];
const verspreid = [device("MOBILE", 50, 60), device("DESKTOP", 50, 60), device("TABLET", 50, 60)];
const opMobiel = [device("MOBILE", 20, 80), device("DESKTOP", 100, 100), device("TABLET", 50, 50)];

// ── Sitewide of meting ──
const sitewide = detectLpBreukVersusKanaal({ campaigns: overalGezakt, devices: verspreid });
assert(sitewide.triggered.length === 1, "een conversiedaling bij alle campagnes met een stabiele CTR triggert");
const s = sitewide.triggered[0];
assert(s.scope === "alle campagnes en alle apparaten", "zonder concentratie is de scope het hele account");
assert(s.story.includes("niet spontaan gelijktijdig") && s.story.includes("meting"), "het verhaal legt de redenering uit: gedeelde bestemming en meting");
assert(s.actionDirection.includes("conversiemeting") && s.actionDirection.includes("niet aan de campagnes"), "de actie verbiedt expliciet om eerst aan de campagnes te sleutelen");
assert(s.certainty === "indicatie", "de zekerheid blijft indicatie: of het de pagina of de meting is, is van buiten het kanaal niet te zien");
assert(s.category === "conversie_meting", "de categorie klopt met de bibliotheek");

// ── De apparaat-splitsing: de andere eigenaar ──
const opApparaat = detectLpBreukVersusKanaal({ campaigns: overalGezakt, devices: opMobiel });
assert(opApparaat.triggered[0].scope.includes("MOBILE"), "een geconcentreerde daling wijst het apparaat aan");
assert(opApparaat.triggered[0].story.includes("ervaringskloof"), "en noemt het een ervaringskloof in plaats van een meting-vraag");
assert(opApparaat.triggered[0].actionDirection.includes("formulier"), "de actie stuurt naar de pagina op dat apparaat");
assert(concentratedDevice(opMobiel)!.device === "MOBILE", "de concentratie-functie wijst het apparaat met de meeste gemiste conversies aan");
assert(concentratedDevice(verspreid) === null, "een gelijkmatig verspreide daling levert geen concentratie");
assert(concentratedDevice([]) === null, "zonder apparaatdata geen concentratie");

// ── BEIDE voorwaarden zijn nodig ──
const ctrZaktMee = [
  { campaignName: "A", impressions: 40000, clicks: 1000, conversions: 50, prevImpressions: 20000, prevClicks: 1000, prevConversions: 100 },
  { campaignName: "B", impressions: 40000, clicks: 1000, conversions: 50, prevImpressions: 20000, prevClicks: 1000, prevConversions: 100 },
  { campaignName: "C", impressions: 40000, clicks: 1000, conversions: 50, prevImpressions: 20000, prevClicks: 1000, prevConversions: 100 },
];
assert(detectLpBreukVersusKanaal({ campaigns: ctrZaktMee, devices: verspreid }).triggered.length === 0, "zakt de CTR mee, dan is er iets met de advertenties of de veiling: dat is WEL een kanaalverhaal en geen LP-breuk");

const eenSlechte = detectLpBreukVersusKanaal({ campaigns: [gezakt("A"), stabiel("B"), stabiel("C"), stabiel("D")], devices: verspreid });
assert(eenSlechte.triggered.length === 0, "een enkele campagne die zakt is geen sitewide patroon: het gaat juist om de GELIJKTIJDIGHEID");

// ── De drempels ──
assert(detectLpBreukVersusKanaal({ campaigns: [gezakt("A"), gezakt("B")], devices: verspreid }).triggered.length === 0, `met minder dan ${BREACH_MIN_CAMPAIGNS} campagnes is "alle campagnes" geen patroon maar toeval`);
const teKlein = [1, 2, 3, 4].map((i) => ({ campaignName: `K${i}`, impressions: 2000, clicks: BREACH_MIN_CLICKS - 1, conversions: 2, prevImpressions: 2000, prevClicks: BREACH_MIN_CLICKS - 1, prevConversions: 10 }));
assert(detectLpBreukVersusKanaal({ campaigns: teKlein, devices: verspreid }).triggered.length === 0, `onder ${BREACH_MIN_CLICKS} klikken per campagne is de conversieratio ruis`);

// ── De degradaties ──
assert(detectLpBreukVersusKanaal({ campaigns: [], devices: [] }).triggered.length === 0, "een leeg account degradeert netjes");
assert(detectLpBreukVersusKanaal({ campaigns: [], devices: [] }).checked.length === 1, "en meldt wel dat er gecontroleerd is");
assert(detectLpBreukVersusKanaal({ campaigns: overalGezakt, devices: [] }).triggered[0].scope === "alle campagnes en alle apparaten", "zonder apparaatdata valt de detector terug op het sitewide-verhaal in plaats van te zwijgen");
const nieuwAccount = [1, 2, 3].map((i) => ({ campaignName: `N${i}`, impressions: 20000, clicks: 1000, conversions: 50, prevImpressions: 0, prevClicks: 0, prevConversions: 0 }));
assert(detectLpBreukVersusKanaal({ campaigns: nieuwAccount, devices: verspreid }).triggered.length === 0, "zonder vorige maand is er niets om tegen te vergelijken");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
