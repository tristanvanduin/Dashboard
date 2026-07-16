// Test voor de LinkedIn sync-vensters en Restli-encoding (L1). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_sync_prep_test.ts

import { trailingWindow, backfillWindow, addDaysISO, monthlyChunks, todayUTC } from "./sync-windows";
import { encodeRestliList, encodeDateRange, splitFieldSets, buildAnalyticsQuery } from "./restli";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// --- sync-vensters ---
const trailing = trailingWindow("2026-03-31");
assert(trailing.until === "2026-03-31", "trailing eindigt op endDate");
assert(trailing.since === "2026-03-02", "trailing strekt 30 dagen terug (inclusief)");
assert(trailingWindow("2026-03-31", 30).since === "2026-03-02", "default trailing is 30 dagen");

const backfill = backfillWindow("2026-03-15");
assert(backfill.since === "2025-03-01", "backfill start 13 maanden terug op de eerste");
assert(backfill.until === "2026-03-15", "backfill eindigt op endDate");

assert(addDaysISO("2026-01-01", -1) === "2025-12-31", "addDaysISO over jaargrens");
assert(addDaysISO("2026-02-28", 1) === "2026-03-01", "addDaysISO over maandgrens");

const chunks = monthlyChunks("2026-01-15", "2026-03-10");
assert(chunks.length === 3, "drie maand-chunks");
assert(chunks[0].since === "2026-01-15" && chunks[0].until === "2026-01-31", "eerste chunk geclamped op vensterstart");
assert(chunks[2].since === "2026-03-01" && chunks[2].until === "2026-03-10", "laatste chunk geclamped op venstereinde");

assert(/^\d{4}-\d{2}-\d{2}$/.test(todayUTC()), "todayUTC levert ISO-datum");

// --- Restli-encoding ---
const list = encodeRestliList(["urn:li:sponsoredCampaign:123", "urn:li:sponsoredCampaign:456"]);
assert(list === "List(urn%3Ali%3AsponsoredCampaign%3A123,urn%3Ali%3AsponsoredCampaign%3A456)", "List() met URL-gecodeerde URNs");
assert(encodeRestliList([]) === "List()", "lege List()");
assert(!list.includes(":"), "geen rauwe dubbele punten in de List()");
assert(list.includes("%3A"), "URN-dubbelepunten gecodeerd als %3A");

const dr = encodeDateRange({ year: 2026, month: 3, day: 1 }, { year: 2026, month: 3, day: 31 });
assert(dr === "(start:(year:2026,month:3,day:1),end:(year:2026,month:3,day:31))", "dateRange-objectsyntax");

const fields = Array.from({ length: 25 }, (_, i) => `field${i + 1}`);
const sets = splitFieldSets(fields, 20);
assert(sets.length === 2, "25 velden in twee sets bij limiet 20");
assert(sets[0].length === 20 && sets[1].length === 5, "sets van 20 en 5");
assert(sets.flat().length === 25 && new Set(sets.flat()).size === 25, "geen veld verloren of gedupliceerd");
assert(splitFieldSets(["a", "b"], 20).length === 1, "onder de limiet blijft een set");

const query = buildAnalyticsQuery({
  pivot: "CAMPAIGN",
  dateRange: { start: { year: 2026, month: 3, day: 1 }, end: { year: 2026, month: 3, day: 31 } },
  fields: ["impressions", "clicks", "costInLocalCurrency"],
  campaigns: ["urn:li:sponsoredCampaign:123"],
});
assert(query.includes("q=analytics") && query.includes("timeGranularity=DAILY"), "query bevat de finder en granulariteit");
assert(query.includes("pivot=CAMPAIGN"), "query bevat de pivot");
assert(query.includes("dateRange=(start:(year:2026"), "query bevat de dateRange-syntax");
assert(query.includes("fields=impressions,clicks,costInLocalCurrency"), "query bevat de velden-projectie");
assert(query.includes("campaigns=List(urn%3Ali%3AsponsoredCampaign%3A123)"), "query bevat de gecodeerde entiteit-List");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
