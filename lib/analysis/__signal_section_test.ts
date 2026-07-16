// Test voor de A-track signaal-sectie. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__signal_section_test.ts

import { buildGoogleSignalsSection, buildCampaignInputs, downgradeWithoutChangeHistory, type SignalSectionInput, type CampaignIsRow } from "./signal-section";
import { checkSanitization } from "@/lib/eval/output-checks";
import type { SignalStory } from "@/lib/signals/types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function isRow(o: Partial<CampaignIsRow> & { month: string }): CampaignIsRow {
  return {
    campaign_name: "Search NL",
    impressions: 100000,
    clicks: 2000,
    cost: 4000,
    search_impression_share: 0.6,
    search_budget_lost_is: 0.02,
    search_rank_lost_is: 0.1,
    budget_utilization: 0.7,
    ...o,
  };
}

function basis(over: Partial<SignalSectionInput> = {}): SignalSectionInput {
  return {
    periodMonth: "2026-06",
    prevMonth: "2026-05",
    campaignIs: [isRow({ month: "2026-06" }), isRow({ month: "2026-05" })],
    campaignMonthly: [],
    keywords: [
      { campaign_name: "Search NL", month: "2026-06", cost: 1000, quality_score: 7 },
      { campaign_name: "Search NL", month: "2026-05", cost: 1000, quality_score: 7 },
    ],
    yoyImpressionsDeltaFraction: null,
    schedule: [],
    networks: [],
    pmaxCampaignNames: [],
    devices: [],
    searchTerms: [],
    negatives: [],
    searchTermsVolume: null,
    prevSearchTermsVolume: null,
    changeHistory: [],
    hasPmaxCampaign: true,
    ...over,
  };
}

// De campagne onder druk: IS zakt 20 punten, rangverlies stijgt, CPC plus 50 procent,
// QS stabiel, impressies stabiel. Dat is ruim boven elke materialiteitsdrempel.
const onderDruk: Partial<SignalSectionInput> = {
  campaignIs: [
    isRow({ month: "2026-06", search_impression_share: 0.4, search_rank_lost_is: 0.35, cost: 6000, clicks: 2000 }),
    isRow({ month: "2026-05", search_impression_share: 0.6, search_rank_lost_is: 0.1, cost: 4000, clicks: 2000 }),
  ],
};

// ── De mapping ──
const inputs = buildCampaignInputs(basis());
assert(inputs.length === 1 && inputs[0].cpc === 2 && inputs[0].prevCpc === 2, "de cpc komt uit kosten gedeeld door klikken, voor beide maanden");
assert(inputs[0].spendWeightedQs === 7 && inputs[0].prevSpendWeightedQs === 7, "de QS is spend-gewogen per campagne en per maand");
assert(inputs[0].ownChanges.length === 0, "een lege change-history betekent echt geen wijzigingen (niet hetzelfde als een ontbrekende bron)");
assert(buildCampaignInputs(basis({ changeHistory: null }))[0].ownChanges.length === 0, "een ontbrekende bron levert geen synthetische events; de degradatie gebeurt op sectie-niveau");
assert(buildCampaignInputs(basis({ campaignIs: [isRow({ month: "2026-06", campaign_name: "Brand NL" }), isRow({ month: "2026-05", campaign_name: "Brand NL" })] }))[0].isBranded, "de brand-heuristiek herkent de campagnenaam");

// ── Het trigger-pad ──
const druk = buildGoogleSignalsSection(basis(onderDruk));
assert(druk.triggeredCount >= 1 && druk.section.includes("Getriggerde signalen"), "IS-daling plus rangverlies plus CPC-stijging bij stabiele QS zonder eigen wijzigingen triggert een signaal");
assert(druk.section.includes("VERPLICHT") && druk.section.includes("weerleg"), "de adresseer-of-weerleg-instructie staat hard in de sectie");
assert(druk.section.includes("Bewijs:") && druk.section.includes("Betekenis:"), "elk verhaal draagt zijn bewijs en zijn betekenis");
assert(druk.section.includes("bewezen_binnen_platform"), "met een geladen change-history zonder relevante wijzigingen mag het verhaal bewezen claimen");

// ── De kritische degradatie ──
const zonderBron = buildGoogleSignalsSection(basis({ ...onderDruk, changeHistory: null }));
assert(zonderBron.triggeredCount >= 1, "dezelfde beweging triggert nog steeds");
assert(!zonderBron.section.includes("bewezen_binnen_platform"), "zonder change-history-bron claimt GEEN enkel verhaal bewezen");
assert(zonderBron.section.includes("wijzigingshistorie is niet beschikbaar"), "de degradatie zegt expliciet waarom de zekerheid lager is");
const nep: SignalStory[] = [{ id: "x", category: "veiling_concurrentie", scope: "s", story: "S.", actionDirection: "a", certainty: "bewezen_binnen_platform", evidence: [] }];
assert(downgradeWithoutChangeHistory(nep)[0].certainty === "indicatie", "de downgrade zet bewezen om naar indicatie");
assert(downgradeWithoutChangeHistory([{ ...nep[0], certainty: "indicatie" }])[0].story === "S.", "een verhaal dat al indicatie is blijft ongemoeid");

// ── De eerlijkheids-lijsten ──
const rustig = buildGoogleSignalsSection(basis());
assert(rustig.uncontrollable.some((u) => u.includes("PMax")) && rustig.uncontrollable.some((u) => u.includes("zoektermvolume")), "PMax-labels en maandvolume staan als niet controleerbaar met reden");
assert(buildGoogleSignalsSection(basis({ hasPmaxCampaign: false })).uncontrollable.every((u) => !u.includes("PMax")), "zonder PMax-campagne geen PMax-melding");
assert(rustig.section.includes("Gecontroleerd, niet getriggerd") && rustig.checkedIds.length > 0, "de gecontroleerd-lijst toont wat er onderzocht is");

// ── De cross-checks ──
assert(rustig.section.includes("Vraag versus aandeel") && rustig.section.includes("Rangverlies-oorzaak") && rustig.section.includes("CPC-druk"), "de drie account-cross-checks staan in de sectie");
assert(!rustig.section.includes("undefined"), "geen enkele cross-check rendert undefined (tsc ving dit; de labels alleen checken was te zwak)");
const budget = buildGoogleSignalsSection(basis({ campaignIs: [isRow({ month: "2026-06", search_budget_lost_is: 0.25, budget_utilization: 0.98 }), isRow({ month: "2026-05" })] }));
assert(budget.section.includes("Budgetverlies") && budget.section.includes("25"), "budget-verlies boven de drempel komt met percentage in de cross-checks");
assert(!rustig.section.includes("Budgetverlies"), "twee procent budget-verlies blijft onder de drempel en haalt de sectie niet");

// ── Seizoen: de yoy-fractie ──
const seizoen = buildGoogleSignalsSection(basis({
  campaignIs: [isRow({ month: "2026-06", impressions: 60000 }), isRow({ month: "2026-05", impressions: 100000 })],
  yoyImpressionsDeltaFraction: 0.15,
}));
assert(seizoen.triggeredCount >= 1, "een MoM-daling van veertig procent met een YoY-plus van vijftien procent triggert het seizoensverhaal");
assert(buildGoogleSignalsSection(basis({ yoyImpressionsDeltaFraction: null })).checkedIds.length > 0, "zonder yoy-waarde blijft de seizoensdetector netjes stil maar wordt hij wel gemeld als gecontroleerd");

// ── De funnel-check landt in de sectie ──
const cm = (campaign_name: string, month: string, impressions: number, clicks: number, conversions: number, cost = 1000) => ({ campaign_name, month, impressions, clicks, conversions, cost });
const funnel = buildGoogleSignalsSection(basis({
  campaignMonthly: [
    cm("Normaal A", "2026-06", 20000, 1000, 100),
    cm("Normaal B", "2026-06", 20000, 1000, 100),
    cm("Normaal C", "2026-06", 20000, 1000, 100),
    cm("Belofte-kloof", "2026-06", 10000, 1000, 50),
    cm("Vorige maand", "2026-05", 10000, 1000, 10),
  ],
}));
assert(funnel.section.includes("Belofte-kloof") && funnel.section.includes("landing-audit"), "de belofte-versus-levering-check landt in de sectie en wijst naar de landing-audit");
assert(funnel.checkedIds.includes("belofte_versus_levering"), "de check staat in de gecontroleerd-lijst");
assert(rustig.checkedIds.includes("belofte_versus_levering"), "ook zonder campagne-maanddata meldt hij dat er gecontroleerd is");

// ── Winner starves landt in de sectie ──
// De IS-tabel levert het budget-verlies, de maandtabel de kosten en conversies.
const starve = buildGoogleSignalsSection(basis({
  campaignIs: [
    isRow({ month: "2026-06", campaign_name: "Winnaar", search_budget_lost_is: 0.3 }),
    isRow({ month: "2026-06", campaign_name: "Groeier", search_budget_lost_is: 0 }),
    isRow({ month: "2026-05", campaign_name: "Winnaar" }),
  ],
  campaignMonthly: [
    cm("Norm A", "2026-06", 20000, 1000, 50, 1000), cm("Norm A", "2026-05", 20000, 1000, 50, 1000),
    cm("Norm B", "2026-06", 20000, 1000, 50, 1000), cm("Norm B", "2026-05", 20000, 1000, 50, 1000),
    cm("Winnaar", "2026-06", 20000, 1000, 100, 1000), cm("Winnaar", "2026-05", 20000, 1000, 100, 1000),
    cm("Groeier", "2026-06", 20000, 1000, 37, 1500), cm("Groeier", "2026-05", 20000, 1000, 40, 1000),
  ],
}));
assert(starve.section.includes("Winnaar tegenover Groeier") || starve.checkedIds.includes("winner_starves"), "winner starves draait mee in de sectie");
assert(starve.section.includes("budgetplafond"), "het verdringingsverhaal landt met zijn kern in de sectie");
assert(rustig.checkedIds.includes("winner_starves"), "ook zonder de data meldt hij dat er gecontroleerd is");

// ── Marktshift: drie onafhankelijke bronnen ──
// De decompositie moet markt_kromp zeggen (impressies fors omlaag bij een STIJGEND
// aandeel), de zoektermen moeten meebewegen, en de yoy ook. Alle drie of niets.
const marktKrimp = {
  campaignIs: [
    isRow({ month: "2026-06", impressions: 50000, search_impression_share: 0.7 }),
    isRow({ month: "2026-05", impressions: 100000, search_impression_share: 0.6 }),
  ],
};
const drieBronnen = buildGoogleSignalsSection(basis({ ...marktKrimp, searchTermsVolume: 50000, prevSearchTermsVolume: 100000, yoyImpressionsDeltaFraction: -0.3 }));
assert(drieBronnen.checkedIds.includes("markt_shift_bevestigd"), "de marktshift-detector draait mee");
assert(drieBronnen.triggeredCount >= 1, "met alle drie de bronnen eensluidend triggert de marktshift-bevestiging echt (en landt hij dus voor de merge)");
assert(drieBronnen.section.toLowerCase().includes("markt"), "het marktverhaal staat in de sectie");

// Een tegenspreking laat hem zwijgen: dat is de hele bedoeling van drie bronnen.
const tegenspraak = buildGoogleSignalsSection(basis({ ...marktKrimp, searchTermsVolume: 100000, prevSearchTermsVolume: 100000, yoyImpressionsDeltaFraction: -0.3 }));
assert(tegenspraak.triggeredCount === 0, "als de zoektermen NIET meebewegen, blijft de bevestiging uit: drie bronnen betekent drie bronnen");
assert(tegenspraak.checkedIds.includes("markt_shift_bevestigd"), "maar hij staat wel in de gecontroleerd-lijst: onderzocht en niet bevestigd is zelf een uitkomst");

// Een ontbrekende derde bron laat hem zwijgen, EN meldt eerlijk waarom.
const tweeBronnen = buildGoogleSignalsSection(basis({ ...marktKrimp, searchTermsVolume: null, prevSearchTermsVolume: null, yoyImpressionsDeltaFraction: -0.3 }));
assert(tweeBronnen.uncontrollable.some((u) => u.includes("zoektermvolumes")), "zonder zoektermvolumes meldt de sectie eerlijk dat de derde bevestigingsbron ontbreekt");
assert(tweeBronnen.triggeredCount === 0, "en dan claimt hij niets");

// ── Schedule-waste landt in de sectie ──
const schedule = buildGoogleSignalsSection(basis({
  schedule: [
    { day_of_week: "MONDAY", hour_of_day: 9, cost: 500, clicks: 200, conversions: 20 },
    { day_of_week: "SUNDAY", hour_of_day: 2, cost: 60, clicks: 40, conversions: 0 },
    { day_of_week: "SUNDAY", hour_of_day: 3, cost: 60, clicks: 40, conversions: 0 },
  ],
}));
assert(schedule.section.includes("zondag") && schedule.section.includes("terugkijkperiode"), "de schedule-waste-check landt met zijn attributie-waarschuwing in de sectie");
assert(rustig.checkedIds.includes("schedule_waste"), "ook zonder schema-data meldt hij dat er gecontroleerd is");

// ── Netwerk-lek landt in de sectie, en PMax valt af ──
const netwerkRijen = [
  { campaign_name: "Search NL", month: "2026-06", network_type: "SEARCH", cost: 800, clicks: 400, conversions: 40 },
  { campaign_name: "Search NL", month: "2026-06", network_type: "CONTENT", cost: 200, clicks: 200, conversions: 2 },
];
const lek = buildGoogleSignalsSection(basis({ networks: netwerkRijen }));
assert(lek.section.includes("display-netwerk") && lek.section.includes("Search NL"), "de netwerk-lek-check landt in de sectie");
const pmaxAf = buildGoogleSignalsSection(basis({ networks: netwerkRijen, pmaxCampaignNames: ["Search NL"] }));
assert(!pmaxAf.section.includes("display-netwerk"), "een PMax-campagne valt af: daar horen meerdere netwerken");
assert(rustig.checkedIds.includes("netwerk_lek"), "ook zonder netwerkdata meldt hij dat er gecontroleerd is");

// ── LP-breuk landt in de sectie ──
const gezakteCampagnes = ["A", "B", "C", "D"].flatMap((n) => [
  cm(n, "2026-06", 20000, 1000, 50), // cvr 5 procent
  cm(n, "2026-05", 20000, 1000, 100), // cvr 10 procent, ctr identiek
]);
const lpBreuk = buildGoogleSignalsSection(basis({ campaignMonthly: gezakteCampagnes }));
assert(lpBreuk.section.includes("niet spontaan gelijktijdig"), "de LP-breuk-check landt met zijn redenering in de sectie");
assert(lpBreuk.section.includes("conversiemeting"), "en stuurt naar de meting voordat er aan campagnes gesleuteld wordt");
assert(rustig.checkedIds.includes("lp_breuk_versus_kanaal"), "ook zonder de data meldt hij dat er gecontroleerd is");

// ── Broad-drift landt in de sectie ──
const st = (month: string, match_type: string, cost: number, clicks: number, conversions: number) => ({ month, match_type, cost, clicks, conversions });
const broadDrift = buildGoogleSignalsSection(basis({
  searchTerms: [
    st("2026-05", "BROAD", 200, 200, 10), st("2026-05", "EXACT", 800, 800, 80),
    st("2026-06", "BROAD", 400, 400, 10), st("2026-06", "EXACT", 600, 600, 60),
  ],
}));
assert(broadDrift.section.includes("broad") && broadDrift.section.includes("BEDOELD"), "de broad-drift-check landt in de sectie en stelt de vraag aan de specialist");
assert(broadDrift.section.includes("dominante type"), "de nuance over het dominante match-type reist mee naar de prompt");
assert(rustig.checkedIds.includes("broad_drift"), "ook zonder zoektermdata meldt hij dat er gecontroleerd is");

// ── De conflictchecker landt in de sectie ──
const conflict = buildGoogleSignalsSection(basis({
  keywords: [
    { campaign_name: "Search NL", month: "2026-06", cost: 100, quality_score: 7, ad_group_name: "Schoenen", keyword_text: "goedkope schoenen", match_type: "EXACT", conversions: 12 },
  ],
  negatives: [
    { level: "shared_set", campaign_name: "Search NL", ad_group_name: "", list_name: "Merk-uitsluitingen", keyword_text: "goedkope", match_type: "BROAD" },
  ],
}));
assert(conflict.section.includes("goedkope schoenen") && conflict.section.includes("Merk-uitsluitingen"), "het conflict landt in de sectie MET de bron-lijst erbij");
assert(conflict.section.includes("volledig stil"), "en benoemt dat een exact-zoekwoord volledig stilstaat");
assert(rustig.checkedIds.includes("negative_conflict"), "ook zonder negatives meldt hij dat er gecontroleerd is");

// ── Schoon ──
assert(checkSanitization(druk.section).passed && checkSanitization(zonderBron.section).passed, "de sectie is vrij van em-dashes en mojibake");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
