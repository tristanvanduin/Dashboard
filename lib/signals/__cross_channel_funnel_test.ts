// Zelf-draaiende test voor de cross-channel-funnel-detectors. Draait via tsx.
// Per detector: trigger, stil-blijven, ruis-drempels, en het zekerheids-plafond (indicatie).
// Plus de kanaal-funnel-configs (LinkedIn/Google) als regressie op de gedeelde kern.

import { detectBlendedFunnelDrop, detectFunnelLaggard, detectFunnelDivergence } from "./cross-channel-funnel";
import type { ChannelMonthlyInput } from "./cross-channel";
import { analyzeLinkedInFunnel } from "../analysis/linkedin-funnel-facts";
import { analyzeGoogleFunnel } from "../analysis/google-funnel-facts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const row = (channel: string, month: string, over: Partial<ChannelMonthlyInput> = {}): ChannelMonthlyInput => ({
  channel, month, impressions: 100000, clicks: 2000, spend: 1000, conversions: 100, leads: 0, ...over,
});

console.log("blended totaal-funnel:");
{
  // Klik->conversie zakt blended van 5% naar 3.5% (-30%).
  const rows = [
    row("google_ads", "2026-04"), row("google_ads", "2026-05"),
    row("google_ads", "2026-06", { conversions: 70 }),
  ];
  const res = detectBlendedFunnelDrop(rows);
  assert(res.triggered.length === 1, "blended drop triggert");
  assert(res.triggered[0].certainty === "indicatie", "zekerheid is indicatie");
  assert(/klik → conversie/.test(res.triggered[0].story), "benoemt de lekkende fase");
  assert(/per kanaal/.test(res.triggered[0].actionDirection), "verwijst naar de kanaal-detectie");

  const stable = detectBlendedFunnelDrop([row("google_ads", "2026-04"), row("google_ads", "2026-05"), row("google_ads", "2026-06")]);
  assert(stable.triggered.length === 0 && stable.checked.length === 1, "stabiel => stil maar gecheckt");
  assert(detectBlendedFunnelDrop(rows.slice(0, 2)).triggered.length === 0, "minder dan 3 maanden => stil");
}

console.log("fase-achterblijver:");
{
  // LinkedIn (leads tellen als conversies) op 1% klik->lead; Google op 5% => achterblijver.
  const rows = [
    row("google_ads", "2026-06"),
    row("linkedin_ads", "2026-06", { clicks: 1000, conversions: 0, leads: 10 }),
  ];
  const res = detectFunnelLaggard(rows);
  assert(res.triggered.length === 1 && /linkedin_ads/.test(res.triggered[0].scope), "linkedin is achterblijver");
  assert(/ander probleem/.test(res.triggered[0].story), "duidt klik-kwaliteit vs klik-volume");
  assert(/post-klik/.test(res.triggered[0].actionDirection), "richting: post-klik-keten");

  const close = detectFunnelLaggard([row("google_ads", "2026-06"), row("linkedin_ads", "2026-06", { clicks: 1000, conversions: 0, leads: 25 })]);
  assert(close.triggered.length === 0, "boven de 40%-drempel => stil");
  const thin = detectFunnelLaggard([row("google_ads", "2026-06"), row("linkedin_ads", "2026-06", { clicks: 50, conversions: 0, leads: 1 })]);
  assert(thin.triggered.length === 0, "onder klik-minimum => stil");
}

console.log("divergentie:");
{
  // Meta zakt -40% op klik->conversie; Google stabiel => kanaal-specifiek verhaal.
  const rows = [
    row("google_ads", "2026-04"), row("google_ads", "2026-05"), row("google_ads", "2026-06"),
    row("meta_ads", "2026-04", { conversions: 200 }), row("meta_ads", "2026-05", { conversions: 200 }),
    row("meta_ads", "2026-06", { conversions: 120 }),
  ];
  const res = detectFunnelDivergence(rows);
  assert(res.triggered.length === 1 && /meta_ads/.test(res.triggered[0].scope), "meta divergeert");
  assert(/niet marktbreed/.test(res.triggered[0].story), "duiding: kanaal-specifiek, niet de markt");

  // Beide kanalen zakken => geen divergentie-claim (dat is marktbreed of accountbreed).
  const both = detectFunnelDivergence([
    row("google_ads", "2026-04"), row("google_ads", "2026-05"), row("google_ads", "2026-06", { conversions: 60 }),
    row("meta_ads", "2026-04", { conversions: 200 }), row("meta_ads", "2026-05", { conversions: 200 }), row("meta_ads", "2026-06", { conversions: 120 }),
  ]);
  assert(both.triggered.length === 0, "beide zakken => geen divergentie-verhaal");
}

console.log("kanaal-funnels op de gedeelde kern:");
{
  const days: { date: string; impressions: number; clicks: number; one_click_lead_form_opens: number; one_click_leads: number }[] = [];
  for (let d = 55; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const recent = d < 28;
    // Opens ruim boven het volume-minimum (200 per venster), leads zakken van 30% naar 10%.
    days.push({ date, impressions: 2000, clicks: 40, one_click_lead_form_opens: 10, one_click_leads: recent ? 1 : 3 });
  }
  const li = analyzeLinkedInFunnel(days);
  assert(li.available && li.worst !== null && li.worst.to === "leads", "linkedin: form->lead-verval gedetecteerd");
  assert(li.skippedStages.includes("landingspagina-klikken"), "ontbrekende linkedin-fase expliciet overgeslagen");

  const weeks: { date: string; impressions: number; clicks: number; conversions: number }[] = [];
  for (let w = 7; w >= 0; w--) {
    const date = new Date(Date.now() - w * 7 * 86400000).toISOString().slice(0, 10);
    weeks.push({ date, impressions: 50000, clicks: 2500, conversions: w < 4 ? 75 : 125 });
  }
  const g = analyzeGoogleFunnel(weeks);
  assert(g.available && g.worst !== null && g.worst.from === "klikken", "google: klik->conversie-verval op weekdata");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle cross-channel-funnel-tests geslaagd");
