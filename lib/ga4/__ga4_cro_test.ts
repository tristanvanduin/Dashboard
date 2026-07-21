export {};
// Verificatie van de GA4 CRO-detector (buildGa4CroSignals): welk PAID-kanaal converteert op de
// site materieel onder het site-gemiddelde (landingpage-fit)? Alarm alleen bij een echte kloof,
// stil bij een gezonde mix, en "other" (organisch/direct) wordt nooit zelf beoordeeld.
// Draaien: npx tsx lib/ga4/__ga4_cro_test.ts

import { buildGa4CroSignals, buildGa4DeviceCroSignals, buildGa4LandingPageCroSignals, GA4_CRO_WINDOW_DAYS, GA4_DEV_WINDOW_DAYS, GA4_LP_WINDOW_DAYS } from "./signals";
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

// ── Landingpage-kloof ───────────────────────────────────────────────────────
function flatLp(spec: { channel: Ga4Channel; landingPage: string; sessions: number; rate: number }[]): Ga4DailyRow[] {
  const out: Ga4DailyRow[] = [];
  for (let a = 0; a < GA4_LP_WINDOW_DAYS; a++) {
    for (const s of spec) {
      out.push({ date: day(a), channel: s.channel, landingPage: s.landingPage, sessions: s.sessions, engagedSessions: Math.round(s.sessions * 0.6), keyEvents: Math.round(s.sessions * s.rate), funnel: {} });
    }
  }
  return out;
}

console.log("\n9. Eén landingpage converteert ver onder de paid-site → alarm alleen voor die pagina");
{
  const r = buildGa4LandingPageCroSignals(flatLp([
    { channel: "google", landingPage: "/aanmelden", sessions: 120, rate: 0.02 },
    { channel: "google", landingPage: "/oplossingen", sessions: 120, rate: 0.06 },
    { channel: "meta", landingPage: "/oplossingen", sessions: 40, rate: 0.055 },
  ]));
  check("precies één landingpage-signaal", r.triggered.length === 1, `triggered=${r.triggered.length}`);
  check("het gaat over /aanmelden", r.triggered[0]?.id === "ga4_cro_lp_aanmelden", r.triggered[0]?.id);
  check("categorie = cross_channel", r.triggered[0]?.category === "cross_channel");
  check("certainty = indicatie", r.triggered[0]?.certainty === "indicatie");
}

console.log("\n10. Pagina's die gelijkmatig converteren → stil");
{
  const r = buildGa4LandingPageCroSignals(flatLp([
    { channel: "google", landingPage: "/aanmelden", sessions: 120, rate: 0.04 },
    { channel: "google", landingPage: "/oplossingen", sessions: 120, rate: 0.042 },
  ]));
  check("geen alarm bij gelijkmatige pagina's", r.triggered.length === 0, `triggered=${r.triggered.length}`);
}

console.log("\n11. Slechts één landingpage → geen oordeel (die pagina ís het gemiddelde)");
{
  const r = buildGa4LandingPageCroSignals(flatLp([
    { channel: "google", landingPage: "/aanmelden", sessions: 400, rate: 0.001 },
  ]));
  check("geen landingpage-signaal met één pagina", r.triggered.length === 0, `triggered=${r.triggered.length}`);
}

console.log("\n12. 'other' (organisch) op een zwakke pagina → wordt niet beoordeeld (alleen paid)");
{
  const r = buildGa4LandingPageCroSignals(flatLp([
    { channel: "google", landingPage: "/oplossingen", sessions: 400, rate: 0.05 },
    { channel: "other", landingPage: "/blog", sessions: 400, rate: 0.001 },
  ]));
  check("other-pagina triggert geen paid-landingpage-signaal", r.triggered.every((s) => !s.id.includes("blog")), `ids=${r.triggered.map((s) => s.id).join(",")}`);
}

console.log("\n13. Rijen zonder landingPage → geen landingpage-oordeel (backward-compatible)");
{
  const r = buildGa4LandingPageCroSignals([
    { date: day(1), channel: "google", sessions: 500, engagedSessions: 300, keyEvents: 2, funnel: {} },
    { date: day(2), channel: "meta", sessions: 500, engagedSessions: 300, keyEvents: 25, funnel: {} },
  ]);
  check("geen landingpage-signaal zonder landingPage-veld", r.triggered.length === 0);
}

console.log("\n14. Demodata: de landingpage-CRO-kloof is zichtbaar in demo-greentech");
{
  const r = buildGa4LandingPageCroSignals(buildGa4DemoRows(new Date()));
  check("demo triggert de /aanmelden-landingpage-kloof", r.triggered.some((s) => s.id === "ga4_cro_lp_aanmelden"), `ids=${r.triggered.map((s) => s.id).join(",")}`);
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
