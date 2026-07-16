// Test voor de belofte-versus-levering-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__google_funnel_test.ts

import { detectBelofteVersusLevering, median, MIN_CLICKS_FOR_FUNNEL_STORY, MAX_FUNNEL_STORIES, type FunnelCampaignInput } from "./google-funnel";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ctr = clicks/impressions, cvr = conversions/clicks
function camp(campaignName: string, impressions: number, clicks: number, conversions: number): FunnelCampaignInput {
  return { campaignName, impressions, clicks, conversions };
}

// ── De mediaan ──
assert(median([1, 2, 3]) === 2 && median([1, 2, 3, 4]) === 2.5, "de mediaan werkt bij oneven en even lengtes");
assert(median([]) === null, "een lege lijst heeft geen mediaan");

// ── DE KERN: mediaan, niet gemiddelde ──
// Drie normale campagnes met CTR 0,05 en CVR 0,10, plus een uitschieter met CTR 0,50.
// Het GEMIDDELDE van de CTR's wordt daardoor ongeveer 0,16; de mediaan blijft 0,05. De
// verdachte campagne heeft CTR 0,10 (dubbel de mediaan) en CVR 0,05 (de helft).
const metUitschieter = [
  camp("Normaal A", 20000, 1000, 100),
  camp("Normaal B", 20000, 1000, 100),
  camp("Normaal C", 20000, 1000, 100),
  camp("Uitschieter", 2000, 1000, 100),
  camp("Verdacht", 10000, 1000, 50),
];
const uitschieterResultaat = detectBelofteVersusLevering(metUitschieter);
assert(uitschieterResultaat.triggered.some((s) => s.scope === "Verdacht"), "de verdachte campagne wordt gevonden ONDANKS een uitschieter die het gemiddelde zou kantelen: de mediaan blijft de norm");
assert(!uitschieterResultaat.triggered.some((s) => s.scope === "Uitschieter"), "de uitschieter zelf converteert op de mediaan en is dus geen kloof");

// ── Beide voorwaarden moeten gelden ──
const alleenHogeCtr = detectBelofteVersusLevering([
  camp("A", 20000, 1000, 100),
  camp("B", 20000, 1000, 100),
  camp("C", 20000, 1000, 100),
  camp("Hoge CTR", 5000, 1000, 100), // CTR ver boven de mediaan, CVR precies op de mediaan
]);
assert(alleenHogeCtr.triggered.length === 0, "een hoge CTR alleen is geen kloof: die campagne levert gewoon");

const alleenLageCvr = detectBelofteVersusLevering([
  camp("A", 20000, 1000, 100),
  camp("B", 20000, 1000, 100),
  camp("C", 20000, 1000, 100),
  camp("Lage CVR", 20000, 1000, 50), // CTR op de mediaan, CVR eronder
]);
assert(alleenLageCvr.triggered.length === 0, "een lage conversieratio alleen is geen belofte-kloof maar een ander verhaal");

// ── De klik-drempel beschermt oordeel EN norm ──
const kleineCampagne = detectBelofteVersusLevering([
  camp("A", 20000, 1000, 100),
  camp("B", 20000, 1000, 100),
  camp("C", 20000, 1000, 100),
  camp("Piepklein", 100, 50, 0), // zou triggeren, maar 50 klikken is ruis
]);
assert(!kleineCampagne.triggered.some((s) => s.scope === "Piepklein"), `onder ${MIN_CLICKS_FOR_FUNNEL_STORY} klikken geen oordeel: een conversieratio op 50 klikken is ruis`);

// ── De mediaan heeft een norm nodig ──
assert(detectBelofteVersusLevering([camp("A", 20000, 1000, 100), camp("B", 10000, 1000, 50)]).triggered.length === 0, "met twee campagnes is een mediaan een toevalligheid, geen norm");
assert(detectBelofteVersusLevering([]).triggered.length === 0 && detectBelofteVersusLevering([]).checked.length === 1, "een leeg account degradeert netjes en meldt wel dat er gecontroleerd is");

// ── Het verhaal zelf ──
const verhaal = uitschieterResultaat.triggered.find((s) => s.scope === "Verdacht")!;
assert(verhaal.certainty === "indicatie", "de zekerheid is BEWUST indicatie: de data toont de kloof, maar de oorzaak kan ook het aanbod of de doelgroep zijn");
assert(verhaal.actionDirection.includes("landing-audit"), "de actie wijst naar de landing-audit als bevestigingsbron, niet naar de biedingen");
assert(verhaal.story.includes("boven de account-mediaan") && verhaal.story.includes("onder de mediaan"), "het verhaal noemt beide kanten van de kloof");
assert(verhaal.evidence.length === 3 && verhaal.evidence[0].prev != null, "het bewijs draagt de campagnewaarde EN de mediaan als vergelijking");
assert(verhaal.category === "conversie_meting", "de categorie klopt met de bibliotheek");

// ── De begrenzing ──
const normaal = (n: number) => Array.from({ length: n }, (_, i) => camp(`Normaal ${i}`, 20000, 1000, 100));
const veelKloven = detectBelofteVersusLevering([
  ...normaal(6),
  camp("Kloof 1", 10000, 1000, 50), camp("Kloof 2", 10000, 1000, 40),
  camp("Kloof 3", 10000, 1000, 30), camp("Kloof 4", 10000, 1000, 20),
]);
assert(veelKloven.triggered.length === MAX_FUNNEL_STORIES, "de sectie blijft leesbaar: maximaal drie verhalen");
assert(veelKloven.triggered[0].scope === "Kloof 4", "de grootste kloof staat vooraan");

// ── De norm is het account zelf: een meerderheid IS de norm ──
// Vier kloven tegen drie normale campagnes maakt de kloof-CTR de mediaan, dus er is geen
// afwijking meer. Dat is geen bug maar de bedoeling: deze detector vindt UITSCHIETERS
// binnen een account, geen absolute waarheid. Ligt het hele account zo, dan is dat een
// accountbreed vraagstuk en geen campagne-signaal.
const meerderheid = detectBelofteVersusLevering([
  camp("A", 20000, 1000, 100), camp("B", 20000, 1000, 100), camp("C", 20000, 1000, 100),
  camp("Kloof 1", 10000, 1000, 50), camp("Kloof 2", 10000, 1000, 40),
  camp("Kloof 3", 10000, 1000, 30), camp("Kloof 4", 10000, 1000, 20),
]);
assert(meerderheid.triggered.length === 0, "als de meerderheid van het account de kloof heeft, IS dat de norm en triggert er niets: relatieve detectie doet precies dit");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
