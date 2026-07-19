// ============================================================================
// DEMO-KLANT TEARDOWN — verwijdert ALLES van demo-greentech in een keer.
// Spiegel van seed-demo-client.ts: zelfde tabellenlijst, plus de klantenlijst-entry en de
// analyse-uitvoer/wachtrij-rijen die de demo intussen heeft gegenereerd.
//
//   npx tsx scripts/demo/teardown-demo-client.ts          # via supabase-js (env nodig)
//   npx tsx scripts/demo/teardown-demo-client.ts --sql    # print SQL (Management API)
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const DEMO_CLIENT = "demo-greentech";

// Alle tabellen die de seed vult PLUS alles wat analyses op de demo-klant erbij schrijven.
const TABLES = [
  "ads_campaign_monthly", "ads_account_monthly", "ads_account_weekly", "ads_campaign_impression_share",
  "ads_search_terms_wasteful", "google_ads_ad_meta", "google_ads_rsa_assets",
  "meta_connections", "meta_campaigns", "meta_ads", "meta_ad_daily", "meta_campaign_daily", "meta_account_daily",
  "linkedin_connections", "linkedin_campaigns", "linkedin_campaign_daily", "linkedin_account_daily", "linkedin_demographic_daily",
  "client_settings", "geo_clone_settings", "client_sync_status",
  // Door analyses/wachtrij gegenereerd:
  "sop_analysis_output", "sop_insights", "sop_recommendations", "sop_tasks",
  "sprint_hypotheses", "sprint_items", "search_term_analysis",
];

function printSql() {
  console.log(`-- DEMO-TEARDOWN voor ${DEMO_CLIENT}`);
  for (const t of TABLES) console.log(`delete from ${t} where client_id='${DEMO_CLIENT}';`);
  console.log(`delete from linkedin_urn_labels where urn like 'urn:li:function:demo-%';`);
  console.log(`update app_settings set value = coalesce((select jsonb_agg(e) from jsonb_array_elements(value) e where e->>'id' <> '${DEMO_CLIENT}'), '[]'::jsonb), updated_at=now() where key='api_clients';`);
}

async function run() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Zet NEXT_PUBLIC_SUPABASE_URL en een key in de omgeving (of gebruik --sql)."); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  for (const t of TABLES) {
    const { error } = await db.from(t).delete().eq("client_id", DEMO_CLIENT);
    console.log(error ? `✗ ${t}: ${error.message}` : `✓ ${t}`);
  }
  await db.from("linkedin_urn_labels").delete().like("urn", "urn:li:function:demo-%");
  const { data } = await db.from("app_settings").select("value").eq("key", "api_clients").maybeSingle();
  if (Array.isArray(data?.value)) {
    const next = (data!.value as { id?: string }[]).filter((c) => c.id !== DEMO_CLIENT);
    await db.from("app_settings").upsert({ key: "api_clients", value: next, updated_at: new Date().toISOString() });
    console.log("✓ demo-klant uit de klantenlijst verwijderd");
  }
  console.log("\nDemo-klant volledig opgeruimd.");
}

if (process.argv[2] === "--sql") printSql();
else run();
