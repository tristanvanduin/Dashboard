// Verificatie van de RSA-sync (categorie G / W1): controleert of google_ads_rsa_assets en
// google_ads_ad_meta gevuld zijn na een sync, plus de sync-administratie in sync_runs.
//
// Gebruik:
//   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
//     node scripts/verify-rsa-sync.mjs [client_id]
//
// Zonder client_id checkt hij globaal; met client_id scoped op die klant. Exit 0 = alle
// kritieke checks groen, exit 1 = minstens een kritieke check rood. WARN/INFO raken de exit
// code niet. Leest alleen (geen writes), dus veilig zo vaak als je wilt.

import { createClient } from "@supabase/supabase-js";

const clientId = process.argv[2] || null;
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Gebruik: SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... node scripts/verify-rsa-sync.mjs [client_id]");
  process.exit(1);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const scope = clientId ? ` (client_id=${clientId})` : " (alle klanten)";

let hardFail = false;
const line = (icon, label, detail) => console.log(`${icon}  ${label}${detail ? " — " + detail : ""}`);
const PASS = (l, d) => line("✅", l, d);
const FAIL = (l, d) => { hardFail = true; line("❌", l, d); };
const WARN = (l, d) => line("⚠️", l, d);
const INFO = (l, d) => line("ℹ️", l, d);

// Telt rijen met optionele filters. Retourneert null bij een query-fout.
async function count(table, filters = []) {
  let q = db.from(table).select("*", { count: "exact", head: true });
  if (clientId) q = q.eq("client_id", clientId);
  for (const f of filters) q = f(q);
  const { count: c, error } = await q;
  if (error) { FAIL(`query op ${table} faalde`, error.message); return null; }
  return c ?? 0;
}

console.log(`\n=== RSA-sync verificatie${scope} ===\n`);

// ── Kritieke check 1: assets aanwezig ────────────────────────────────────────────────
const assets = await count("google_ads_rsa_assets");
if (assets === null) { /* al gemeld */ }
else if (assets > 0) PASS("google_ads_rsa_assets gevuld", `${assets} rijen`);
else FAIL("google_ads_rsa_assets is leeg", "sync heeft geen RSA-assets geschreven");

// ── Kritieke check 2: ad-metadata aanwezig ───────────────────────────────────────────
const meta = await count("google_ads_ad_meta");
if (meta === null) { /* al gemeld */ }
else if (meta > 0) PASS("google_ads_ad_meta gevuld", `${meta} rijen`);
else FAIL("google_ads_ad_meta is leeg", "sync heeft geen ad-metadata geschreven");

// ── Kwaliteit: field_type-dekking (beide HEADLINE en DESCRIPTION verwacht) ────────────
if (assets > 0) {
  const heads = await count("google_ads_rsa_assets", [(q) => q.eq("field_type", "HEADLINE")]);
  const descs = await count("google_ads_rsa_assets", [(q) => q.eq("field_type", "DESCRIPTION")]);
  if (heads > 0 && descs > 0) PASS("field_type-dekking", `HEADLINE ${heads}, DESCRIPTION ${descs}`);
  else WARN("field_type onvolledig", `HEADLINE ${heads}, DESCRIPTION ${descs} (verwacht beide > 0)`);

  // performance_label: bruikbaar zodra er labels zijn die niet UNKNOWN/PENDING zijn.
  const labeled = await count("google_ads_rsa_assets", [(q) => q.not("performance_label", "in", "(UNKNOWN,PENDING)")]);
  if (labeled > 0) PASS("performance_label bruikbaar", `${labeled} assets met BEST/GOOD/LOW/LEARNING`);
  else WARN("performance_label nog leeg", "alle labels UNKNOWN/PENDING (normaal vlak na de sync of bij weinig verkeer)");
}

// ── Kwaliteit: final_url-dekking op ad-metadata ──────────────────────────────────────
if (meta > 0) {
  const withUrl = await count("google_ads_ad_meta", [(q) => q.not("final_url", "is", null)]);
  const pct = Math.round((withUrl / meta) * 100);
  if (withUrl > 0) PASS("final_url-dekking", `${withUrl}/${meta} (${pct}%) ads met een final_url`);
  else WARN("final_url ontbreekt overal", "de landing-audit heeft final_url nodig");
}

// ── Sanity: assets verwijzen naar bekende ads (sampled anti-join) ─────────────────────
if (assets > 0 && meta > 0) {
  let sampleQ = db.from("google_ads_rsa_assets").select("ad_id").limit(200);
  if (clientId) sampleQ = sampleQ.eq("client_id", clientId);
  const { data: sample, error: sErr } = await sampleQ;
  if (sErr) WARN("sanity-check overgeslagen", sErr.message);
  else {
    const ids = [...new Set((sample ?? []).map((r) => r.ad_id))];
    let metaQ = db.from("google_ads_ad_meta").select("ad_id").in("ad_id", ids);
    if (clientId) metaQ = metaQ.eq("client_id", clientId);
    const { data: known, error: kErr } = await metaQ;
    if (kErr) WARN("sanity-check overgeslagen", kErr.message);
    else {
      const knownSet = new Set((known ?? []).map((r) => r.ad_id));
      const orphans = ids.filter((id) => !knownSet.has(id)).length;
      if (orphans === 0) PASS("referentiele sanity", `alle ${ids.length} gesamplede ad_ids bestaan in ad_meta`);
      else INFO("enkele assets zonder ad_meta", `${orphans}/${ids.length} gesamplede ad_ids ontbreken in ad_meta (aparte queries, kleine mismatch kan)`);
    }
  }
}

// ── Sync-administratie: laatste run en de twee RSA-datasets ───────────────────────────
let runQ = db.from("sync_runs").select("id, status, started_at, dataset_results, client_id").order("started_at", { ascending: false }).limit(1);
if (clientId) runQ = runQ.eq("client_id", clientId);
const { data: runs, error: runErr } = await runQ;
if (runErr) WARN("sync_runs niet leesbaar", runErr.message);
else if (!runs || runs.length === 0) WARN("geen sync_runs gevonden", "is de sync al een keer gedraaid?");
else {
  const run = runs[0];
  INFO("laatste sync-run", `${run.started_at} — status ${run.status}`);
  const results = Array.isArray(run.dataset_results) ? run.dataset_results : [];
  for (const name of ["google_ads_rsa_assets", "google_ads_ad_meta"]) {
    const r = results.find((d) => d && d.name === name);
    if (!r) WARN(`${name} niet in laatste run`, "dataset stond niet in dataset_results");
    else if (r.success) PASS(`${name} in laatste run`, `${r.rows} rijen geschreven`);
    else FAIL(`${name} faalde in laatste run`, r.error || "onbekende fout");
  }
}

console.log(`\n=== ${hardFail ? "❌ ROOD: minstens een kritieke check faalde" : "✅ GROEN: alle kritieke checks geslaagd"} ===\n`);
process.exit(hardFail ? 1 : 0);
