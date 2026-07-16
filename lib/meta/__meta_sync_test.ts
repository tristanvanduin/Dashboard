// Test van de Meta-sync-vensters en rij-mapping.
// Draaien: npx tsx lib/meta/__meta_sync_test.ts
import { todayUTC, addDaysISO, trailingWindow, backfillWindow, monthlyChunks } from "./sync-windows";
import { metaDailyToDbRow, metaBreakdownToDbRow, META_DAILY_CONFLICT } from "./rows";
import { mapInsightsRow } from "./transform";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("1. addDaysISO over maand- en jaargrenzen");
check("een dag terug over jaargrens", addDaysISO("2026-01-01", -1) === "2025-12-31");
check("een dag vooruit over maandgrens", addDaysISO("2026-02-28", 1) === "2026-03-01");
check("28 terug", addDaysISO("2026-05-28", -27) === "2026-05-01");

console.log("\n2. trailingWindow (28-daagse attributie-herstatement)");
const tw = trailingWindow("2026-05-28", 28);
check("until is endDate", tw.until === "2026-05-28");
check("since is 28 dagen inclusief", tw.since === "2026-05-01", JSON.stringify(tw));

console.log("\n3. backfillWindow (13 maanden)");
const bw = backfillWindow("2026-05-15", 13);
check("since is eerste dag 13 maanden terug", bw.since === "2025-05-01", JSON.stringify(bw));
check("until is endDate", bw.until === "2026-05-15");

console.log("\n4. monthlyChunks (geclamped op de randen)");
const chunks = monthlyChunks("2026-04-10", "2026-06-05");
check("drie maand-chunks", chunks.length === 3, JSON.stringify(chunks));
check("eerste chunk start op since, niet maandbegin", chunks[0].since === "2026-04-10" && chunks[0].until === "2026-04-30");
check("middelste chunk volledige maand", chunks[1].since === "2026-05-01" && chunks[1].until === "2026-05-31");
check("laatste chunk eindigt op until, niet maandeinde", chunks[2].since === "2026-06-01" && chunks[2].until === "2026-06-05");

console.log("\n5. todayUTC formaat");
check("YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(todayUTC()));

console.log("\n6. metaDailyToDbRow mapping");
const dayRow = mapInsightsRow({
  date_start: "2026-05-01", ad_id: "ad_1", impressions: "1000", inline_link_clicks: "50", spend: "100",
  actions: [{ action_type: "purchase", value: "5" }], action_values: [{ action_type: "purchase", value: "500" }],
});
const db = metaDailyToDbRow(dayRow, "client_x");
check("client_id gezet", db.client_id === "client_x");
check("snake_case datum en entity", db.date === "2026-05-01" && db.entity_id === "ad_1");
check("metriek gemapt", db.link_clicks === 50 && db.spend === 100 && db.conversions === 5);
check("afgeleide cpa gemapt", db.cpa === 20);
check("geen rankings zonder optie", db.quality_ranking === undefined);
const dbRank = metaDailyToDbRow(dayRow, "client_x", { includeRankings: true });
check("rankings met optie aanwezig (ook als null)", "quality_ranking" in dbRank);

console.log("\n7. metaBreakdownToDbRow mapping");
const bd = metaBreakdownToDbRow(dayRow, "client_x", { level: "campaign", entityId: "camp_1", breakdownType: "gender", breakdownValue: "female" });
check("breakdown dimensie gezet", bd.breakdown_type === "gender" && bd.breakdown_value === "female");
check("breakdown level en entity", bd.level === "campaign" && bd.entity_id === "camp_1");
check("breakdown subset metriek", bd.impressions === 1000 && bd.spend === 100);

console.log("\n8. conflict-sleutels matchen de unique-constraints");
check("daily conflict key", META_DAILY_CONFLICT === "client_id,date,entity_id");

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
