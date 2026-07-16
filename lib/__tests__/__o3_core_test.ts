// Test voor de O3-kern (W1.3): notifications plus scheduler-beslislogica. Deterministisch, geen IO.
// Draaien: npx tsx lib/__tests__/__o3_core_test.ts

import { buildSlackPayload, shouldSendAlert, dedupeKey, DEDUPE_WINDOW_HOURS, type AlertEvent } from "../notifications";
import { isDueToday, dataCompleteForMonth, retryDecision, isStaleRunning, nextStepToRun, PUMP_BATCH_SIZE, STALE_RUNNING_MINUTES } from "../scheduler/core";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Notifications ──
const blocked: AlertEvent = { type: "analysis_blocked", clientId: "minismus", channel: "google_ads", kernfeit: "Gate weigerde op 2 redenen", link: "https://app/x" };
const payload = buildSlackPayload(blocked);
assert(payload.text.includes("Analyse geblokkeerd"), "payload bevat de kop van het eventtype");
assert(payload.text.includes("klant: minismus") && payload.text.includes("kanaal: google_ads"), "payload bevat klant en kanaal");
assert(payload.text.includes("Gate weigerde op 2 redenen") && payload.text.includes("<https://app/x|open>"), "payload bevat kernfeit en link");
const kaal = buildSlackPayload({ type: "sync_failed", kernfeit: "Google-sync gaf 500" });
assert(kaal.text.includes("Sync mislukt") && !kaal.text.includes("klant:"), "payload zonder klant laat het veld weg");

assert(dedupeKey(blocked) === "minismus:analysis_blocked", "dedupe-key is client plus type");
assert(dedupeKey({ type: "sync_failed", kernfeit: "x" }) === "-:sync_failed", "dedupe-key zonder klant gebruikt een streepje");

const nu = new Date("2026-07-03T12:00:00Z");
const vijfUurGeleden = new Date(nu.getTime() - 5 * 3_600_000);
const zevenUurGeleden = new Date(nu.getTime() - 7 * 3_600_000);
const syncEvent: AlertEvent = { type: "sync_failed", clientId: "a", kernfeit: "x" };
assert(shouldSendAlert(syncEvent, null, nu) === true, "eerste alert gaat altijd door");
assert(shouldSendAlert(syncEvent, vijfUurGeleden, nu) === false, "binnen het 6-uursvenster gededupet");
assert(shouldSendAlert(syncEvent, zevenUurGeleden, nu) === true, "na het venster weer toegestaan");
assert(shouldSendAlert({ type: "analysis_completed", kernfeit: "x" }, vijfUurGeleden, nu) === true, "analysis_completed wordt nooit gededupet");
assert(shouldSendAlert(blocked, vijfUurGeleden, nu) === true, "analysis_blocked wordt nooit gededupet");
assert(DEDUPE_WINDOW_HOURS === 6, "het venster is 6 uur conform de spec");

// ── Scheduler: due-berekening met clamp ──
const schema31 = { enabled: true, day_of_month: 31 };
assert(isDueToday(schema31, new Date(2026, 3, 30)) === true, "day 31 in april clampt naar 30 april");
assert(isDueToday(schema31, new Date(2026, 3, 29)) === false, "29 april is niet due bij day 31");
assert(isDueToday(schema31, new Date(2026, 1, 28)) === true, "day 31 in februari 2026 clampt naar 28");
assert(isDueToday({ enabled: true }, new Date(2026, 6, 2)) === true, "default day_of_month is 2");
assert(isDueToday({ enabled: false, day_of_month: 2 }, new Date(2026, 6, 2)) === false, "disabled is nooit due");
assert(isDueToday(null, new Date(2026, 6, 2)) === false, "geen schema is nooit due");

// ── Datacompleetheid ──
assert(dataCompleteForMonth("2026-06-30", "2026-06-30") === true, "data tot en met periodEnd is compleet");
assert(dataCompleteForMonth("2026-06-29", "2026-06-30") === false, "een dag te weinig is incompleet");
assert(dataCompleteForMonth(null, "2026-06-30") === false, "geen data is incompleet");

// ── Retry ──
const gefaaldOm = new Date("2026-07-03T11:00:00Z");
assert(retryDecision("failed", 0, gefaaldOm, new Date("2026-07-03T11:31:00Z")) === "requeue", "failed met attempts 0 na 31 minuten wordt gerequeued");
assert(retryDecision("failed", 0, gefaaldOm, new Date("2026-07-03T11:10:00Z")) === "none", "binnen de wachttijd nog niets doen");
assert(retryDecision("failed", 1, gefaaldOm, new Date("2026-07-03T13:00:00Z")) === "final", "een tweede mislukking is definitief");
assert(retryDecision("completed", 0, null, nu) === "none", "completed heeft geen retry");

// ── Stale ──
const kwartierGeleden = new Date(nu.getTime() - (STALE_RUNNING_MINUTES + 1) * 60_000);
const netGestart = new Date(nu.getTime() - 5 * 60_000);
assert(isStaleRunning("running", kwartierGeleden, nu) === true, "running zonder voortgang na 16 minuten is stale");
assert(isStaleRunning("running", netGestart, nu) === false, "running met recente voortgang is niet stale");
assert(isStaleRunning("pending", kwartierGeleden, nu) === false, "alleen running kan stale zijn");

// ── Idempotente stap-selectie plus batchgrootte ──
assert(nextStepToRun(13, new Set()) === 1, "verse run begint bij stap 1");
assert(nextStepToRun(13, new Set([1, 2, 3])) === 4, "hervat na de laatst opgeslagen sectie");
assert(nextStepToRun(13, new Set([1, 3])) === 2, "een gat wordt eerst gedicht");
assert(nextStepToRun(3, new Set([1, 2, 3])) === null, "alles opgeslagen betekent afronden");
assert(PUMP_BATCH_SIZE === 5, "batchgrootte 5 conform de p90-meting");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
