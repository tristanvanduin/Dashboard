// Test van de Meta-transform. Draaien: npx tsx lib/meta/__meta_transform_test.ts
import { parseNum, mapActions, mapInsightsRow } from "./transform";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("1. parseNum (Meta geeft strings)");
check("string naar getal", parseNum("361324") === 361324);
check("decimaal", parseNum("5339.5") === 5339.5);
check("lege string naar null", parseNum("") === null);
check("niet-numeriek naar null", parseNum("n/a") === null);
check("null naar null", parseNum(null) === null);

console.log("\n2. mapActions (dubbeltelling vermijden)");
const a = mapActions([
  { action_type: "purchase", value: "10" },
  { action_type: "omni_purchase", value: "10" },
  { action_type: "lead", value: "3" },
]);
check("purchase een keer geteld (geen omni-dubbel)", a.conversions === 10, JSON.stringify(a));
check("lead geteld", a.leads === 3);
const a2 = mapActions([{ action_type: "some_unknown", value: "99" }]);
check("onbekend action_type genegeerd", a2.conversions === 0 && a2.leads === 0);
check("lege actions geeft nullen", mapActions(undefined).conversions === 0);

console.log("\n3. mapInsightsRow afgeleide metrieken");
const row = mapInsightsRow({
  date_start: "2026-05-01", ad_id: "ad_1",
  impressions: "1000", inline_link_clicks: "50", spend: "100",
  actions: [{ action_type: "purchase", value: "5" }],
  action_values: [{ action_type: "purchase", value: "500" }],
  video_3sec_watched_actions: [{ action_type: "video_view", value: "400" }],
  video_thruplay_watched_actions: [{ action_type: "video_view", value: "100" }],
});
check("ctr_link = link_clicks/impressions", row.ctrLink === 0.05, String(row.ctrLink));
check("cpc_link = spend/link_clicks", row.cpcLink === 2, String(row.cpcLink));
check("cpa = spend/conversions", row.cpa === 20, String(row.cpa));
check("roas = value/spend", row.roas === 5, String(row.roas));
check("hook_rate = 3s/impressions", row.hookRate === 0.4, String(row.hookRate));
check("hold_rate = thruplay/3s", row.holdRate === 0.25, String(row.holdRate));
check("conversies getypeerd", row.conversions === 5);
check("conversiewaarde uit action_values", row.conversionValue === 500);
check("entityId uit ad_id", row.entityId === "ad_1");
check("datum overgenomen", row.date === "2026-05-01");

console.log("\n4. Deling door nul geeft null, geen Infinity of NaN");
const zero = mapInsightsRow({ ad_id: "ad_0", impressions: "0", inline_link_clicks: "0", spend: "0", actions: [] });
check("ctr bij 0 impressies naar null", zero.ctrLink === null);
check("cpc bij 0 link_clicks naar null", zero.cpcLink === null);
check("cpa bij 0 conversies naar null", zero.cpa === null);
check("roas bij 0 spend naar null", zero.roas === null);
check("hold bij 0 video3s naar null", zero.holdRate === null);
check("conversies blijft 0, geen null", zero.conversions === 0);

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
