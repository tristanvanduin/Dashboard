// Zelf-draaiende test voor de cross-channel-detectors. Draait via tsx.
// Per detector: de trigger-conditie, het stil-blijven, en de zekerheids-plafonds (nooit
// "bewezen_binnen_platform" over kanalen heen — de attributie-regel).

import {
  detectSeedHarvest,
  detectCplArbitrage,
  detectBlendedMixShift,
  buildCrossChannelSignals,
  type ChannelMonthlyInput,
} from "./cross-channel";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const row = (channel: string, month: string, over: Partial<ChannelMonthlyInput> = {}): ChannelMonthlyInput => ({
  channel, month, impressions: 0, clicks: 0, spend: 0, conversions: 0, leads: 0, ...over,
});

console.log("zaai-oogst:");
{
  // Social +50% vertoningen, brand +20% klikken => verklaringskandidaat (meebewegen).
  const social = [
    row("linkedin_ads", "2026-04", { impressions: 10000 }), row("meta_ads", "2026-04", { impressions: 10000 }),
    row("linkedin_ads", "2026-05", { impressions: 10000 }), row("meta_ads", "2026-05", { impressions: 10000 }),
    row("linkedin_ads", "2026-06", { impressions: 20000 }), row("meta_ads", "2026-06", { impressions: 10000 }),
  ];
  const brandUp = [{ month: "2026-04", clicks: 1000 }, { month: "2026-05", clicks: 1000 }, { month: "2026-06", clicks: 1200 }];
  const up = detectSeedHarvest(social, brandUp);
  assert(up.triggered.length === 1, "zaai+oogst triggert");
  assert(up.triggered[0].certainty === "verklaringskandidaat", "zekerheid is verklaringskandidaat (nooit bewezen)");
  assert(/brand-groei niet automatisch/.test(up.triggered[0].actionDirection), "waarschuwt tegen verkeerde attributie");

  // Social +50% maar brand -20% => zaait-zonder-oogst.
  const brandDown = [{ month: "2026-04", clicks: 1000 }, { month: "2026-05", clicks: 1000 }, { month: "2026-06", clicks: 800 }];
  const down = detectSeedHarvest(social, brandDown);
  assert(down.triggered.length === 1 && /geen meetbare merk-oogst/.test(down.triggered[0].story), "zaait-zonder-oogst triggert met eigen verhaal");

  // Geen zaai-golf (+10%) => stil, wel gecheckt.
  const flat = social.map((r) => ({ ...r, impressions: r.month === "2026-06" ? 11000 : 10000 }));
  const quiet = detectSeedHarvest(flat, brandUp);
  assert(quiet.triggered.length === 0 && quiet.checked.includes("cross_zaai_oogst"), "geen golf => stil maar gecheckt");

  // Te weinig historie => stil.
  const short = detectSeedHarvest(social.slice(0, 2), brandUp.slice(0, 1));
  assert(short.triggered.length === 0, "minder dan 3 maanden => geen oordeel");
}

console.log("CPL-arbitrage:");
{
  // LinkedIn €50/lead, Google €20/lead, LinkedIn draagt 60% spend => indicatie richting Google.
  const rows = [
    row("google_ads", "2026-06", { spend: 2000, leads: 100 }),
    row("linkedin_ads", "2026-06", { spend: 3000, leads: 60 }),
  ];
  const res = detectCplArbitrage(rows);
  assert(res.triggered.length === 1, "arbitrage triggert");
  assert(res.triggered[0].certainty === "indicatie", "zekerheid is indicatie");
  assert(/lead-kwaliteit/.test(res.triggered[0].story + res.triggered[0].actionDirection), "benoemt de lead-kwaliteit-aanname");

  // Te weinig leads op een kanaal => stil.
  const thin = detectCplArbitrage([row("google_ads", "2026-06", { spend: 200, leads: 5 }), row("linkedin_ads", "2026-06", { spend: 3000, leads: 60 })]);
  assert(thin.triggered.length === 0, "onder lead-minimum => stil");

  // Prijsverschil te klein (80%) => stil.
  const close = detectCplArbitrage([row("google_ads", "2026-06", { spend: 4000, leads: 100 }), row("linkedin_ads", "2026-06", { spend: 3000, leads: 60 })]);
  assert(close.triggered.length === 0, "CPL boven 60%-drempel => stil");
}

console.log("mix-shift (Simpson):");
{
  // Elk kanaal stabiel (CPA google 20, linkedin 100) maar gewicht verschuift naar linkedin
  // => blended CPA stijgt fors zonder dat een kanaal verslechtert.
  const rows = [
    row("google_ads", "2026-04", { spend: 8000, conversions: 400 }), row("linkedin_ads", "2026-04", { spend: 2000, conversions: 20 }),
    row("google_ads", "2026-05", { spend: 8000, conversions: 400 }), row("linkedin_ads", "2026-05", { spend: 2000, conversions: 20 }),
    row("google_ads", "2026-06", { spend: 3000, conversions: 150 }), row("linkedin_ads", "2026-06", { spend: 7000, conversions: 70 }),
  ];
  const res = detectBlendedMixShift(rows);
  assert(res.triggered.length === 1, "mix-shift triggert");
  assert(/mix-verschuiving/.test(res.triggered[0].story), "verhaal benoemt de mix, niet de kanalen");
  assert(res.triggered[0].certainty === "indicatie", "zekerheid is indicatie");

  // Zelfde blended stijging maar door echte kanaal-verslechtering => stil (dat is geen mix-verhaal).
  const worse = [
    row("google_ads", "2026-04", { spend: 8000, conversions: 400 }), row("linkedin_ads", "2026-04", { spend: 2000, conversions: 20 }),
    row("google_ads", "2026-05", { spend: 8000, conversions: 400 }), row("linkedin_ads", "2026-05", { spend: 2000, conversions: 20 }),
    row("google_ads", "2026-06", { spend: 8000, conversions: 250 }), row("linkedin_ads", "2026-06", { spend: 2000, conversions: 15 }),
  ];
  assert(detectBlendedMixShift(worse).triggered.length === 0, "kanaal-verslechtering => geen mix-claim");

  // Eén kanaal actief => stil.
  const single = rows.filter((r) => r.channel === "google_ads");
  assert(detectBlendedMixShift(single).triggered.length === 0, "één kanaal => geen mix-oordeel");
}

console.log("bundel:");
{
  const merged = buildCrossChannelSignals({ channels: [], brand: [] });
  assert(merged.triggered.length === 0 && merged.checked.length === 3, "lege invoer: 0 getriggerd, 3 gecheckt");
  assert(merged.checked.includes("cross_zaai_oogst") && merged.checked.includes("cross_cpl_arbitrage") && merged.checked.includes("cross_mix_shift"), "alle drie de ids gecheckt");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle cross-channel-signaal-tests geslaagd");
