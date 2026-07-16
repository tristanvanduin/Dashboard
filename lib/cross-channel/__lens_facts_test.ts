// Test voor de X4 pure kern (lens 1 en lens 6). Deterministisch, geen IO.
// Draaien: npx tsx lib/cross-channel/__lens_facts_test.ts

import { marginalEuroAcrossChannels, concentrationAcrossChannels, ATTRIBUTION_FOOTNOTE, type ChannelBudgetSnapshot } from "./lens-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function kanaal(overrides: Partial<ChannelBudgetSnapshot> & { channel: ChannelBudgetSnapshot["channel"] }): ChannelBudgetSnapshot {
  return {
    spend: 1000,
    efficiencyMetric: "cpa",
    efficiencyVsTargetPct: 1.0,
    allocation: { campaignsAnalysed: 5, scaleUp: 0, scaleDown: 0, hold: 5, hasTarget: true },
    scaleUpCandidates: [],
    budgetConstrained: false,
    saturated: false,
    ...overrides,
  };
}

// ── Lens 1: het klassieke contrast levert de flag ──
const contrast = marginalEuroAcrossChannels([
  kanaal({ channel: "google_ads", efficiencyVsTargetPct: 1.2, budgetConstrained: true }), // efficient plus afgeknepen
  kanaal({ channel: "meta_ads", efficiencyVsTargetPct: 0.8, saturated: true, spend: 2000 }), // mist target plus verzadigd
]);
assert(contrast.direction === "verschuif_over_kanalen", "efficient-en-afgeknepen naast verzadigd-en-inefficient: verschuif over kanalen");
assert(contrast.fromChannel === "meta_ads" && contrast.toChannel === "google_ads", "de richting klopt: van Meta naar Google");
assert(contrast.attributionFootnote === ATTRIBUTION_FOOTNOTE, "de attributie-voetnoot hangt verplicht aan de uitkomst");

// ── Geen contrast: geen flag ──
const geenContrast = marginalEuroAcrossChannels([
  kanaal({ channel: "google_ads", efficiencyVsTargetPct: 1.1 }),
  kanaal({ channel: "meta_ads", efficiencyVsTargetPct: 1.05 }),
]);
assert(geenContrast.direction === "geen_verschuiving", "twee gezonde kanalen zonder budget-beperking: geen verschuiving");
assert(geenContrast.attributionFootnote === ATTRIBUTION_FOOTNOTE, "ook zonder flag draagt de uitkomst de voetnoot");

// ── Verzadigde bestemming telt niet ──
const verzadigdeBestemming = marginalEuroAcrossChannels([
  kanaal({ channel: "google_ads", efficiencyVsTargetPct: 1.2, budgetConstrained: true, saturated: true }),
  kanaal({ channel: "meta_ads", efficiencyVsTargetPct: 0.8 }),
]);
assert(verzadigdeBestemming.direction !== "verschuif_over_kanalen", "een verzadigd kanaal is geen geldige bestemming, ook al is het efficient en afgeknepen");

// ── Twee lagen: eerst binnen het kanaal ──
const binnenKanaal = marginalEuroAcrossChannels([
  kanaal({ channel: "google_ads", allocation: { campaignsAnalysed: 6, scaleUp: 2, scaleDown: 1, hold: 3, hasTarget: true } }),
  kanaal({ channel: "meta_ads" }),
]);
assert(binnenKanaal.direction === "eerst_binnen_kanaal", "zonder kanaal-contrast maar met interne herallocatie: eerst binnen het kanaal");
assert(binnenKanaal.perChannelFirst.length === 1 && binnenKanaal.perChannelFirst[0].channel === "google_ads", "de interne verschuiving wordt per kanaal benoemd");

// Bij een echt kanaal-contrast worden de interne moves meegegeven als eerste laag
const beideLagen = marginalEuroAcrossChannels([
  kanaal({ channel: "google_ads", efficiencyVsTargetPct: 1.2, budgetConstrained: true, allocation: { campaignsAnalysed: 6, scaleUp: 2, scaleDown: 1, hold: 3, hasTarget: true } }),
  kanaal({ channel: "linkedin_ads", efficiencyVsTargetPct: 0.7, spend: 3000 }),
]);
assert(beideLagen.direction === "verschuif_over_kanalen" && beideLagen.perChannelFirst.length === 1, "bij een kanaal-contrast blijft de interne herallocatie de eerste laag in het advies");

// ── Degradatie: minder dan twee kanalen ──
const een = marginalEuroAcrossChannels([kanaal({ channel: "google_ads" })]);
assert(een.direction === "onvoldoende_basis", "een kanaal geeft onvoldoende basis, geen audit-flag");

// ── Lens 6: concentratie ──
const conc = concentrationAcrossChannels([
  { channel: "google_ads", spend: 8500, topCampaign: { name: "Brand NL", spend: 5200 } },
  { channel: "meta_ads", spend: 1000 },
  { channel: "linkedin_ads", spend: 500 },
]);
assert(conc.totalSpend === 10000, "de totale spend wordt correct opgeteld");
assert(conc.flags.some((f) => f.kind === "kanaal_afhankelijkheid" && f.detail.includes("google_ads") && f.sharePct === 85), "85 procent in een kanaal geeft de kanaal-afhankelijkheidsflag");
assert(conc.flags.some((f) => f.kind === "campagne_afhankelijkheid" && f.detail.includes("Brand NL") && f.sharePct === 52), "een campagne met 52 procent van de blend geeft de campagne-afhankelijkheidsflag");
assert(conc.attributionFootnote === ATTRIBUTION_FOOTNOTE, "lens 6 draagt de voetnoot");

// Gezonde verdeling: geen flags
const gezond = concentrationAcrossChannels([
  { channel: "google_ads", spend: 4000, topCampaign: { name: "A", spend: 1500 } },
  { channel: "meta_ads", spend: 3500 },
  { channel: "linkedin_ads", spend: 2500 },
]);
assert(gezond.flags.length === 0, "een gezonde verdeling geeft geen concentratie-flags");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
