export {};
// Verificatie van de GA4 CRO-detector (buildGa4CroSignals): welk PAID-kanaal converteert op de
// site materieel onder het site-gemiddelde (landingpage-fit)? Alarm alleen bij een echte kloof,
// stil bij een gezonde mix, en "other" (organisch/direct) wordt nooit zelf beoordeeld.
// Draaien: npx tsx lib/ga4/__ga4_cro_test.ts

import { buildGa4CroSignals, buildGa4DeviceCroSignals, GA4_CRO_WINDOW_DAYS, GA4_DEV_WINDOW_DAYS } from "./signals";
import { buildGa4DemoRows } from "@/lib/demo/ga4-demo";
import type { Ga4DailyRow, Ga4Channel, Ga4Device } from "./types";

const day = (ageDays: number): string => new Date(Date.now() - ageDays * 86_400_000).toISOString().slice(0, 10);

// Bouwt een vlakke reeks binnen het venster met vaste sessies+ratio per kanaal.
function flat(spec: { channel: Ga4Channel; sessions: number; rate: number }[]): Ga4DailyRow[] {
  const out: Ga4DailyRow[] = [];
  for (let a = 0; a < GA4_CRO_WINDOW_DAYS; a++) {
    for (const s of spec) {
      out.push({ date: day(a), channel: s.channel, sessions: s.sessions, engagedSessions: Math.round(s.sessions * 0.6), keyEvents: Math.round(s.sessions * s.rate), funnel: {} });
    }
  }
  return out;
}

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log("\n1. Meta ver onder het site-gemiddelde → alarm alleen voor Meta");
{
  const r = buildGa4CroSignals(flat([
    { channel: "google", sessions: 220, rate: 0.055 },
    { channel: "meta", sessions: 90, rate: 0.018 },
    { channel: "linkedin", sessions: 40, rate: 0.045 },
    { channel: "other", sessions: 160, rate: 0.02 },
  ]));
  check("precies één signaal", r.triggered.length === 1, `triggered=${r.triggered.length}`);
  check("het gaat over Meta", r.triggered[0]?.id === "ga4_cro_gap_meta", r.triggered[0]?.id);
  check("categorie = cross_channel", r.triggered[0]?.category === "cross_channel");
  check("certainty = indicatie", r.triggered[0]?.certainty === "indicatie");
}

console.log("\n2. Gezonde, gelijkmatige mix → stil");
{
  const r = buildGa4CroSignals(flat([
    { channel: "google", sessions: 220, rate: 0.04 },
    { channel: "meta", sessions: 90, rate: 0.038 },
    { channel: "linkedin", sessions: 40, rate: 0.042 },
  ]));
  check("geen alarm bij gelijkmatige mix", r.triggered.length === 0, `triggered=${r.triggered.length}`);
}

console.log("\n3. 'other' (organisch) laag → wordt niet beoordeeld");
{
  const r = buildGa4CroSignals(flat([
    { channel: "google", sessions: 220, rate: 0.04 },
    { channel: "other", sessions: 400, rate: 0.002 },
  ]));
  check("other triggert geen paid-CRO-signaal", r.triggered.every((s) => !s.id.includes("other")));
}

console.log("\n4. Demodata: de Meta-CRO-kloof is zichtbaar in demo-greentech");
{
  const r = buildGa4CroSignals(buildGa4DemoRows(new Date()));
  check("demo triggert de Meta-CRO-kloof", r.triggered.some((s) => s.id === "ga4_cro_gap_meta"), `ids=${r.triggered.map((s) => s.id).join(",")}`);
}

// ── Device-kloof (mobile vs desktop) ────────────────────────────────────────
function flatDevice(spec: { channel: Ga4Channel; device: Ga4Device; sessions: number; rate: number }[]): Ga4DailyRow[] {
  const out: Ga4DailyRow[] = [];
  for (let a = 0; a < GA4_DEV_WINDOW_DAYS; a++) {
    for (const s of spec) {
      out.push({ date: day(a), channel: s.channel, device: s.device, sessions: s.sessions, engagedSessions: Math.round(s.sessions * 0.6), keyEvents: Math.round(s.sessions * s.rate), funnel: {} });
    }
  }
  return out;
}

console.log("\n5. Mobiel converteert ver onder desktop (paid) → device-alarm");
{
  const r = buildGa4DeviceCroSignals(flatDevice([
    { channel: "google", device: "desktop", sessions: 140, rate: 0.06 },
    { channel: "google", device: "mobile", sessions: 120, rate: 0.02 },
    { channel: "meta", device: "desktop", sessions: 40, rate: 0.05 },
    { channel: "meta", device: "mobile", sessions: 40, rate: 0.015 },
  ]));
  check("precies één device-signaal", r.triggered.length === 1, `triggered=${r.triggered.length}`);
  check("het gaat over mobiel", r.triggered[0]?.id === "ga4_cro_device_mobile", r.triggered[0]?.id);
  check("categorie = cross_channel", r.triggered[0]?.category === "cross_channel");
}

console.log("\n6. Mobiel ~gelijk aan desktop → stil");
{
  const r = buildGa4DeviceCroSignals(flatDevice([
    { channel: "google", device: "desktop", sessions: 140, rate: 0.05 },
    { channel: "google", device: "mobile", sessions: 120, rate: 0.048 },
  ]));
  check("geen device-alarm bij gelijke ratio", r.triggered.length === 0, `triggered=${r.triggered.length}`);
}

console.log("\n7. Rijen zonder device → geen device-oordeel (backward-compatible)");
{
  const r = buildGa4DeviceCroSignals(flatDevice([]).concat([
    { date: day(1), channel: "google", sessions: 500, engagedSessions: 300, keyEvents: 2, funnel: {} },
  ]));
  check("geen device-signaal zonder device-veld", r.triggered.length === 0);
}

console.log("\n8. Demodata: de mobiele CRO-kloof is zichtbaar in demo-greentech");
{
  const r = buildGa4DeviceCroSignals(buildGa4DemoRows(new Date()));
  check("demo triggert de mobiele device-kloof", r.triggered.some((s) => s.id === "ga4_cro_device_mobile"), `ids=${r.triggered.map((s) => s.id).join(",")}`);
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
