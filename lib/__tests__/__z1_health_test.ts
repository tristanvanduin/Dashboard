// Test voor W1.4 (Z1): health-engine plus run-logger plus het data_health_fail-event.
// Deterministisch, geen IO. Draaien: npx tsx lib/__tests__/__z1_health_test.ts

import { evaluateChannelHealth, assembleClientHealth, failingChannels, SYNC_STALE_FAIL_HOURS, SYNC_STALE_WARN_HOURS } from "../health";
import { createRunLogger, buildLogRecord, redactFields } from "../log";
import { buildSlackPayload, shouldSendAlert, type AlertEvent } from "../notifications";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const now = new Date("2026-07-03T12:00:00Z");
const urenGeleden = (u: number) => new Date(now.getTime() - u * 3_600_000).toISOString();

// ── Health: sync-versheid ──
const vers = evaluateChannelHealth({ channel: "google_ads", connected: true, lastSuccessfulSyncAt: urenGeleden(10), now });
assert(vers.checks.find((c) => c.key === "sync_freshness")?.status === "ok", "recente sync is ok");
const laat = evaluateChannelHealth({ channel: "google_ads", connected: true, lastSuccessfulSyncAt: urenGeleden(SYNC_STALE_WARN_HOURS + 1), now });
assert(laat.checks.find((c) => c.key === "sync_freshness")?.status === "warn", "een cyclus te laat is warn");
const stuk = evaluateChannelHealth({ channel: "google_ads", connected: true, lastSuccessfulSyncAt: urenGeleden(SYNC_STALE_FAIL_HOURS + 1), now });
assert(stuk.checks.find((c) => c.key === "sync_freshness")?.status === "fail", "twee cycli te laat is fail");
const nooit = evaluateChannelHealth({ channel: "google_ads", connected: true, lastSuccessfulSyncAt: null, now });
assert(nooit.checks.find((c) => c.key === "sync_freshness")?.status === "fail", "nooit gesynct is fail");

// ── Health: dataset-compleetheid ──
const compleet = evaluateChannelHealth({ channel: "google_ads", connected: true, datasetsAvailable: 18, datasetsTotal: 18, now });
assert(compleet.checks.find((c) => c.key === "datasets")?.status === "ok", "alle datasets aanwezig is ok");
const deels = evaluateChannelHealth({ channel: "google_ads", connected: true, datasetsAvailable: 15, datasetsTotal: 18, now });
assert(deels.checks.find((c) => c.key === "datasets")?.status === "warn", "ontbrekende datasets is warn");
const geenDataset = evaluateChannelHealth({ channel: "google_ads", connected: true, datasetsAvailable: 0, datasetsTotal: 18, now });
assert(geenDataset.checks.find((c) => c.key === "datasets")?.status === "fail", "nul datasets is fail");

// ── Health: volume beide richtingen ──
const inLijn = evaluateChannelHealth({ channel: "meta_ads", connected: true, recentRowCount: 700, baselineDailyAvg: 100, now });
assert(inLijn.checks.find((c) => c.key === "volume")?.status === "ok", "dagvolume in lijn is ok");
const gedaald = evaluateChannelHealth({ channel: "meta_ads", connected: true, recentRowCount: 210, baselineDailyAvg: 100, now });
assert(gedaald.checks.find((c) => c.key === "volume")?.status === "warn", "dagvolume 70 procent gedaald is warn");
const gestegen = evaluateChannelHealth({ channel: "meta_ads", connected: true, recentRowCount: 1400, baselineDailyAvg: 100, now });
assert(gestegen.checks.find((c) => c.key === "volume")?.status === "warn", "dagvolume verdubbeld is ook warn");
const nulRijen = evaluateChannelHealth({ channel: "meta_ads", connected: true, recentRowCount: 0, baselineDailyAvg: 100, now });
assert(nulRijen.checks.find((c) => c.key === "volume")?.status === "fail", "nul rijen is fail");

// ── Health: gisteren, coverage, token, enrichment ──
assert(evaluateChannelHealth({ channel: "meta_ads", connected: true, yesterdayPresent: false, now }).status === "fail", "geen gisteren-data is fail");
assert(evaluateChannelHealth({ channel: "linkedin_ads", connected: true, coveragePct: 30, now }).checks[0].status === "warn", "lage coverage is warn");
assert(evaluateChannelHealth({ channel: "meta_ads", connected: true, tokenStatus: "expired", now }).status === "fail", "verlopen token is fail");
assert(evaluateChannelHealth({ channel: "meta_ads", connected: true, tokenStatus: "expiring", now }).status === "warn", "verlopend token is warn");
assert(evaluateChannelHealth({ channel: "google_ads", connected: true, enrichmentDegraded: true, now }).checks[0].status === "warn", "gedegradeerde enrichment is warn");

// ── Health: no-go geen ruis bij niet-gekoppeld ──
const los = evaluateChannelHealth({ channel: "linkedin_ads", connected: false, lastSuccessfulSyncAt: null, now });
assert(los.checks.length === 0 && los.status === "ok", "niet-gekoppeld kanaal levert geen checks en telt als ok");

// ── Health: overall-rollup en failing-kanalen ──
const gezond = evaluateChannelHealth({ channel: "google_ads", connected: true, lastSuccessfulSyncAt: urenGeleden(5), now });
const kapot = evaluateChannelHealth({ channel: "meta_ads", connected: true, yesterdayPresent: false, now });
const klant = assembleClientHealth("minismus", [gezond, kapot]);
assert(klant.status === "fail", "de overall is de slechtste kanaalstatus");
assert(failingChannels(klant).length === 1 && failingChannels(klant)[0] === "meta_ads", "failing-kanalen geeft alleen de fail-kanalen voor de O3-sweep");

// ── Logger: verplichte run_key ──
let gooide = false;
try { createRunLogger({ run_key: "" }); } catch { gooide = true; }
assert(gooide, "createRunLogger zonder run_key faalt");
assert(typeof createRunLogger({ run_key: "job-1" }).info === "function", "met run_key komt er een logger");

// ── Logger: recordvorm en redactie ──
const record = buildLogRecord("warn", { run_key: "job-1", client_id: "minismus", channel: "google_ads" }, "stap traag", { step: "Account Performance", ms: 44000 }, now);
assert(record.level === "warn" && record.run_key === "job-1" && record.client_id === "minismus", "record draagt niveau en context");
assert(record.msg === "stap traag" && record.step === "Account Performance" && record.ms === 44000, "record draagt msg en extra velden");
assert(record.ts === now.toISOString(), "record heeft een stabiele ISO-tijd");
const geredigeerd = buildLogRecord("info", { run_key: "job-1" }, "auth", { access_token: "geheim", nested: { api_key: "x", n: 1 } }, now);
assert(geredigeerd.access_token === "[REDACTED]", "een token-veld wordt geredigeerd");
assert((geredigeerd.nested as { api_key: string; n: number }).api_key === "[REDACTED]" && (geredigeerd.nested as { n: number }).n === 1, "redactie werkt diep en laat gewone velden staan");
assert((redactFields({ password: "p", ok: "zichtbaar" }).password) === "[REDACTED]" && redactFields({ ok: "zichtbaar" }).ok === "zichtbaar", "redactFields raakt alleen secret-achtige sleutels");

// ── Nieuw eventtype ──
const healthEvent: AlertEvent = { type: "data_health_fail", clientId: "minismus", channel: "meta_ads", kernfeit: "geen data van gisteren" };
assert(buildSlackPayload(healthEvent).text.includes("Data-health-check faalt"), "het data_health_fail-event heeft een kop");
assert(shouldSendAlert(healthEvent, new Date(now.getTime() - 5 * 3_600_000), now) === false, "data_health_fail volgt de 6-uurs dedupe (geen altijd-sturen)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

// ── Conversietracking-gezondheid (hefboom 4, complementair aan health-score) ──
import { evaluateConversionTrackingQuality } from "../health";
{
  let p2 = 0, f2 = 0;
  const a2 = (c: boolean, l: string) => { if (c) p2++; else { f2++; console.error(`  FAIL: ${l}`); } };
  const pt = (period: string, conversions: number) => ({ period, conversions });

  // Alles nul: geen registratie
  const geen = evaluateConversionTrackingQuality({ series: [pt("2026-01", 0), pt("2026-02", 0)], hasPrimaryAction: true, conversionLagConfigured: true });
  a2(geen.some((c) => c.key === "conv_recorded" && c.status === "fail"), "alles nul: geen conversies geregistreerd (fail)");

  // Wegval naar nul: trackingbreuk
  const breuk = evaluateConversionTrackingQuality({ series: [pt("2026-01", 50), pt("2026-02", 45), pt("2026-03", 0)], hasPrimaryAction: true, conversionLagConfigured: true });
  a2(breuk.some((c) => c.key === "conv_break" && c.status === "fail"), "wegval naar nul na conversies: trackingbreuk (fail)");

  // Gezonde reeks met volledige config: ok
  const gezond = evaluateConversionTrackingQuality({ series: [pt("2026-01", 50), pt("2026-02", 55), pt("2026-03", 48)], hasPrimaryAction: true, conversionLagConfigured: true });
  a2(gezond.length === 1 && gezond[0].status === "ok", "gezonde reeks plus config: ok");

  // Config-gaten: warns, complementair aan health-score
  const config = evaluateConversionTrackingQuality({ series: [pt("2026-01", 50), pt("2026-02", 55), pt("2026-03", 48)], hasPrimaryAction: false, conversionLagConfigured: false });
  a2(config.some((c) => c.key === "conv_primary_action" && c.status === "warn"), "geen primaire actie: warn");
  a2(config.some((c) => c.key === "conv_lag" && c.status === "warn"), "geen conversievertraging: warn");

  // Een normale dip (niet nul) is GEEN trackingbreuk hier (dat doet health-score als performance-anomalie)
  const dip = evaluateConversionTrackingQuality({ series: [pt("2026-01", 50), pt("2026-02", 45), pt("2026-03", 30)], hasPrimaryAction: true, conversionLagConfigured: true });
  a2(!dip.some((c) => c.key === "conv_break"), "een dip zonder wegval is geen trackingbreuk (geen dubbeling met health-score)");

  console.log(`\n=== Conversietracking: ${p2} passed, ${f2} failed ===\n`);
  if (f2 > 0) process.exit(1);
}

// ── Conversion-lag-guard (de vals-alarm-fix) ──
{
  let p3 = 0, f3 = 0;
  const a3 = (c: boolean, l: string) => { if (c) p3++; else { f3++; console.error(`  FAIL: ${l}`); } };
  const pt = (period: string, conversions: number) => ({ period, conversions });
  const reeks = [pt("2026-04", 50), pt("2026-05", 45), pt("2026-06", 0)];

  // Binnen het lag-venster: warn in plaats van vals alarm. Juni-conversies rijpen tot 15 juli (lag 14).
  const binnenLag = evaluateConversionTrackingQuality({ series: reeks, hasPrimaryAction: true, conversionLagConfigured: true, conversionLagDays: 14, asOfDate: "2026-07-03" });
  const b = binnenLag.find((c) => c.key === "conv_break");
  a3(b != null && b.status === "warn" && b.detail.includes("conversielag"), "een nul-maand binnen het lag-venster is een warn met uitleg, geen vals breuk-alarm");

  // Buiten het lag-venster: het harde alarm blijft.
  const buitenLag = evaluateConversionTrackingQuality({ series: reeks, hasPrimaryAction: true, conversionLagConfigured: true, conversionLagDays: 14, asOfDate: "2026-07-20" });
  a3(buitenLag.some((c) => c.key === "conv_break" && c.status === "fail"), "voorbij het lag-venster blijft de breuk een hard alarm");

  // Zonder lag-info: conservatief het huidige gedrag (fail).
  const zonderLag = evaluateConversionTrackingQuality({ series: reeks, hasPrimaryAction: true, conversionLagConfigured: true });
  a3(zonderLag.some((c) => c.key === "conv_break" && c.status === "fail"), "zonder lag-info blijft het gedrag ongewijzigd conservatief");

  // Een gezonde reeks met lag-params blijft ok.
  const gezond3 = evaluateConversionTrackingQuality({ series: [pt("2026-04", 50), pt("2026-05", 45), pt("2026-06", 48)], hasPrimaryAction: true, conversionLagConfigured: true, conversionLagDays: 14, asOfDate: "2026-07-03" });
  a3(gezond3.length === 1 && gezond3[0].status === "ok", "een gezonde reeks blijft ok met de lag-parameters");

  console.log(`\n=== Conversion-lag-guard: ${p3} passed, ${f3} failed ===\n`);
  if (f3 > 0) process.exit(1);
}
