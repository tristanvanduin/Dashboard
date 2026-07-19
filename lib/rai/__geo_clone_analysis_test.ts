// Zelf-draaiende test voor de beursanalyse (fase 4). Draait via tsx.
// Kern: edities bouwen uit datums (venster na de vorige editie), de juiste huidige/vorige
// editie kiezen (cadans-bewust), editie-over-editie op gelijke afstand, projectie tegen het
// doel, de actionNeeded-drempels, en de expliciete degradatiepaden.

import { buildEditions, pickCurrentEdition, analyzeGeoClone } from "./geo-clone-analysis";
import type { CampaignMonthlyRow } from "./geo-clone-aggregate";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const row = (month: string, conversions: number, cost: number): CampaignMonthlyRow => ({
  campaign_name: "GRT | Search", month, conversions, cost, impressions: 1000, clicks: 100, conversions_value: 0,
});

console.log("edities bouwen:");
{
  const eds = buildEditions("GRT", "annual", [
    { date: "2026-06-10", label: "2026" },
    { date: "2025-06-12", label: "2025" },
  ]);
  assert(eds.length === 2 && eds[0].editionId === "2025" && eds[1].editionId === "2026", "gesorteerd op datum, labels als id");
  assert(eds[1].campaignStartDate === "2025-06-16", "venster 2026 begint net na de vorige editie (12 juni + 3 beursdagen + 1)");
  assert(eds[0].campaignStartDate === "2024-06-12", "eerste editie: venster een cadans-lengte terug");
  assert(pickCurrentEdition(eds, "2026-03-01")!.editionId === "2026", "peildatum voor de beurs kiest de komende editie");
  assert(pickCurrentEdition(eds, "2026-08-01")!.editionId === "2026", "peildatum na de laatste beurs kiest de laatste (evaluatie)");
}

console.log("volledige analyse (aanloop achter, spend gelijk):");
{
  // Vorige editie (2025): aanloop dec 2024 - mei 2025, 60 conversies opgebouwd op D-100.
  // Huidige editie (2026): aanloop tot peildatum 2026-03-01 (D-101), maar maar 30 conversies.
  const rows: CampaignMonthlyRow[] = [
    row("2024-12-01", 10, 1000), row("2025-01-01", 15, 1000), row("2025-02-01", 20, 1000),
    row("2025-03-01", 15, 1000), row("2025-04-01", 20, 1000), row("2025-05-01", 20, 1000),
    // Zelfde spend-tempo als vorig jaar (~1333/maand ≈ 4000 op D-101) maar half zoveel conversies.
    row("2025-12-01", 10, 1400), row("2026-01-01", 10, 1400), row("2026-02-01", 10, 1400),
  ];
  const res = analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech Amsterdam", rows, cadence: "annual",
    editions: [{ date: "2025-06-12", label: "2025" }, { date: "2026-06-10", label: "2026" }],
    conversionsTarget: 120, asOfDate: "2026-03-01",
  });
  assert(res.currentEditionId === "2026" && res.previousEditionId === "2025", "huidige en vorige editie correct");
  assert(res.previousEditionGapDays != null && Math.abs(res.previousEditionGapDays - 363) <= 2 && res.cadenceMatches, "gap ~1 jaar, past bij annual");
  assert(res.conversions !== null && res.conversions.comparable, "editie-over-editie vergelijkbaar");
  assert(res.conversions!.currentCumulative === 30, "huidige opbouw 30 conversies");
  assert(res.conversions!.deltaPct != null && res.conversions!.deltaPct < -0.15, "materieel achter op de vorige editie");
  assert(res.actionNeeded === true, "materieel achter => actionNeeded");
  assert(/effectiviteitsvraag/.test(res.markdown), "spend-gelijk-maar-achter wordt geduid als effectiviteitsvraag");
  assert(res.forecast !== null && res.forecast.method !== "geen_basis", "projectie heeft een basis");
  assert(/week-tempo overgeslagen/.test(res.markdown), "maand-granulariteit expliciet gedegradeerd");
}

console.log("degradatiepaden:");
{
  const geenEdities = analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech", rows: [row("2026-01-01", 5, 100)], cadence: "annual",
    editions: [], conversionsTarget: null, asOfDate: "2026-03-01",
  });
  assert(geenEdities.currentEditionId === null && /stel de edities in/.test(geenEdities.markdown), "geen edities: expliciete verwijzing naar instellingen");
  assert(geenEdities.actionNeeded === false, "geen analyse => geen actie-claim");

  const geenData = analyzeGeoClone({
    geoClone: "ICC", fairLabel: "Interclean China", rows: [row("2026-01-01", 5, 100)], cadence: "annual",
    editions: [{ date: "2026-09-01", label: "2026" }], conversionsTarget: 100, asOfDate: "2026-03-01",
  });
  assert(/geen campagnedata voor ICC/.test(geenData.markdown), "geen matchende campagnes: expliciet");

  const eersteEditie = analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech", rows: [row("2026-01-01", 50, 100)], cadence: "annual",
    editions: [{ date: "2026-06-10", label: "2026" }], conversionsTarget: null, asOfDate: "2026-03-01",
  });
  assert(eersteEditie.previousEditionId === null && /eerste geconfigureerde editie/.test(eersteEditie.markdown), "eerste editie eerlijk benoemd");
  assert(/geen conversie-doel/.test(eersteEditie.markdown), "ontbrekend doel expliciet gedegradeerd");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle geo-clone-analyse-tests geslaagd");
