// Algemene post-sync health-check over ALLE datasets. Leest de sync-administratie
// (sync_runs.dataset_results + client_sync_status) en oordeelt per klant of de laatste
// sync gezond was: geen gefaalde datasets, op tijd, en volledig.
//
// Gebruik:
//   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
//     node scripts/verify-sync-health.mjs [client_id]
//
// Zonder client_id checkt hij elke klant in client_sync_status. Exit 0 = alle klanten groen,
// exit 1 = minstens een klant met een kritieke bevinding. Alleen-lezen.
//
// Versheid-drempels gelijk aan lib/health.ts: >= 48u sinds de laatste geslaagde sync is fout,
// >= 30u een waarschuwing.

import { createClient } from "@supabase/supabase-js";

const SYNC_STALE_FAIL_HOURS = 48;
const SYNC_STALE_WARN_HOURS = 30;

const onlyClient = process.argv[2] || null;
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Gebruik: SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... node scripts/verify-sync-health.mjs [client_id]");
  process.exit(1);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

let anyHardFail = false;
const icon = { ok: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };

// Bepaal de te checken klanten.
async function resolveClients() {
  if (onlyClient) return [onlyClient];
  const { data, error } = await db.from("client_sync_status").select("client_id");
  if (error) { console.error("Kon client_sync_status niet lezen:", error.message); process.exit(1); }
  return (data ?? []).map((r) => r.client_id).sort();
}

function hoursSince(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

async function checkClient(clientId) {
  const findings = []; // {level, label, detail}
  const add = (level, label, detail) => findings.push({ level, label, detail });

  // ── client_sync_status ─────────────────────────────────────────────────────────────
  const { data: css } = await db
    .from("client_sync_status")
    .select("last_sync_status, last_successful_sync_at, datasets_available, datasets_total, freshness_status")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!css) {
    add("warn", "geen client_sync_status", "sync heeft de status nog niet weggeschreven");
  } else {
    // Versheid
    const uren = hoursSince(css.last_successful_sync_at);
    if (uren === null) add("fail", "nog nooit succesvol gesynct", "last_successful_sync_at is leeg");
    else if (uren >= SYNC_STALE_FAIL_HOURS) add("fail", "sync verouderd", `laatste geslaagde sync ${Math.round(uren)}u geleden (>= ${SYNC_STALE_FAIL_HOURS}u)`);
    else if (uren >= SYNC_STALE_WARN_HOURS) add("warn", "sync loopt achter", `laatste geslaagde sync ${Math.round(uren)}u geleden (>= ${SYNC_STALE_WARN_HOURS}u)`);
    else add("ok", "versheid", `laatste geslaagde sync ${Math.round(uren)}u geleden`);

    // Compleetheid
    const avail = css.datasets_available ?? 0;
    const total = css.datasets_total ?? 0;
    if (total > 0 && avail < total) add("warn", "datasets onvolledig", `${avail}/${total} datasets geslaagd bij de laatste run`);
    else if (total > 0) add("ok", "datasets compleet", `${avail}/${total} geslaagd`);
    if (css.freshness_status && css.freshness_status !== "fresh" && css.freshness_status !== "ok") {
      add("warn", "freshness_status", String(css.freshness_status));
    }
  }

  // ── laatste sync_run + per-dataset uitsplitsing ──────────────────────────────────────
  const { data: runs, error: runErr } = await db
    .from("sync_runs")
    .select("status, started_at, dataset_results")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(1);

  if (runErr) {
    add("warn", "sync_runs niet leesbaar", runErr.message);
  } else if (!runs || runs.length === 0) {
    add("fail", "geen sync-run gevonden", "is de sync ooit gedraaid voor deze klant?");
  } else {
    const run = runs[0];
    if (run.status === "failed") add("fail", "laatste run mislukt", `status failed op ${run.started_at}`);
    else if (run.status === "partial") add("warn", "laatste run partieel", `status partial op ${run.started_at}`);
    else add("ok", "laatste run", `status ${run.status} op ${run.started_at}`);

    const results = Array.isArray(run.dataset_results) ? run.dataset_results : [];
    const failed = results.filter((d) => d && d.success === false);
    const empty = results.filter((d) => d && d.success === true && (d.rows ?? 0) === 0);
    const okCount = results.filter((d) => d && d.success === true).length;

    add("info", "datasets in laatste run", `${okCount}/${results.length} geslaagd`);
    for (const d of failed) add("fail", `dataset gefaald: ${d.name}`, d.error || "onbekende fout");
    if (empty.length > 0) {
      add("warn", "datasets met 0 rijen", empty.map((d) => d.name).join(", ") + " (kan legitiem zijn: bv. geen PMax of geen breakdowns)");
    }
  }

  return findings;
}

console.log(`\n=== Post-sync health-check ${onlyClient ? `(client_id=${onlyClient})` : "(alle klanten)"} ===`);

const clients = await resolveClients();
if (clients.length === 0) {
  console.log("\nGeen klanten gevonden in client_sync_status.\n");
  process.exit(1);
}

let greenClients = 0;
for (const clientId of clients) {
  const findings = await checkClient(clientId);
  const clientFail = findings.some((f) => f.level === "fail");
  if (clientFail) anyHardFail = true; else greenClients += 1;

  console.log(`\n${clientFail ? "❌" : "✅"} ${clientId}`);
  for (const f of findings) {
    console.log(`   ${icon[f.level]} ${f.label}${f.detail ? " — " + f.detail : ""}`);
  }
}

console.log(`\n=== ${greenClients}/${clients.length} klanten groen ===`);
console.log(`=== ${anyHardFail ? "❌ ROOD: minstens een klant heeft een kritieke bevinding" : "✅ GROEN: alle klanten gezond"} ===\n`);
process.exit(anyHardFail ? 1 : 0);
