// Zelf-draaiende test voor de kanaal-signaal-data-shapers. Draait via tsx.
// Kern: venster-splitsing op de laatste DATA-datum (niet vandaag), sommen per entiteit,
// ratio's uit venstertotalen, impressie-gewogen frequency, en prior-waarden voor de trend.

import { splitWindows, shapeMetaAdInputs, shapeLinkedInInputs, type MetaDailyRow, type LinkedInDailyRow } from "./channel-signal-data";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}
function close(a: number | null, b: number, msg: string) {
  assert(a !== null && Math.abs(a - b) < 1e-9, `${msg} (kreeg ${a}, verwacht ${b})`);
}

console.log("venster-splitsing:");
{
  const rows = [
    { date: "2026-05-01" }, // prior (dag 28 terug vanaf 2026-06-25 is 2026-05-29; 05-01 valt vóór prior-start? prior = 04-30..05-28; 05-01 zit erin)
    { date: "2026-05-20" },
    { date: "2026-06-10" },
    { date: "2026-06-25" }, // anker
    { date: "2026-03-01" }, // te oud: buiten beide vensters
  ];
  const w = splitWindows(rows);
  assert(w.anchor === "2026-06-25", "anker is de laatste data-datum");
  assert(w.recent.length === 2, "recent venster: 06-10 en 06-25");
  assert(w.prior.length === 2, "prior venster: 05-01 en 05-20");
  assert(splitWindows([]).anchor === null, "leeg blijft leeg");
}

console.log("meta-shaper:");
{
  const rows: MetaDailyRow[] = [
    // recent (anker 2026-06-28): twee dagen van ad A
    { entity_id: "a", date: "2026-06-28", impressions: 1000, link_clicks: 20, spend: 100, conversions: 5, frequency: 2, hook_rate: 0.3 },
    { entity_id: "a", date: "2026-06-27", impressions: 3000, link_clicks: 30, spend: 200, conversions: 5, frequency: 4, hook_rate: 0.1 },
    // prior: ad A met hogere CTR (trend omlaag)
    { entity_id: "a", date: "2026-05-20", impressions: 1000, link_clicks: 50, spend: 100, conversions: 10 },
  ];
  const inputs = shapeMetaAdInputs(rows, new Map([["a", { adName: "Ad A", campaignName: "Camp" }]]));
  assert(inputs.length === 1 && inputs[0].adName === "Ad A", "één ad, naam geresolved");
  close(inputs[0].linkCtr, 50 / 4000, "CTR uit venstertotalen (niet gemiddelde van dagen)");
  close(inputs[0].frequency, (2 * 1000 + 4 * 3000) / 4000, "frequency impressie-gewogen");
  close(inputs[0].hookRate, (0.3 * 1000 + 0.1 * 3000) / 4000, "hook-rate impressie-gewogen");
  close(inputs[0].cpa, 300 / 10, "CPA uit venstertotalen");
  close(inputs[0].prevLinkCtr ?? null, 50 / 1000, "prior-CTR uit prior-venster");
  close(inputs[0].prevCpa ?? null, 100 / 10, "prior-CPA uit prior-venster");
}

console.log("linkedin-shaper:");
{
  const rows: LinkedInDailyRow[] = [
    { entity_urn: "urn:c:1", date: "2026-06-28", impressions: 2000, clicks: 40, spend: 300, one_click_leads: 6, one_click_lead_form_opens: 30, video_starts: 100, video_completions: 40 },
    { entity_urn: "urn:c:1", date: "2026-06-20", impressions: 2000, clicks: 20, spend: 300, one_click_leads: 4, one_click_lead_form_opens: 30 },
    { entity_urn: "urn:c:1", date: "2026-05-15", impressions: 1000, clicks: 30, spend: 200, one_click_leads: 10, one_click_lead_form_opens: 20 },
  ];
  const inputs = shapeLinkedInInputs(rows, new Map([["urn:c:1", "ABM campagne"]]));
  assert(inputs.length === 1 && inputs[0].name === "ABM campagne", "één campagne, naam geresolved");
  close(inputs[0].ctr, 60 / 4000, "CTR uit venstertotalen");
  close(inputs[0].cpl, 600 / 10, "CPL uit venstertotalen");
  close(inputs[0].formCompletionRate, 10 / 60, "form-completion = leads/opens over het venster");
  close(inputs[0].videoCompletionRate, 40 / 100, "video-completion uit venstertotalen");
  close(inputs[0].prevCpl ?? null, 200 / 10, "prior-CPL uit prior-venster");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle channel-signal-data-tests geslaagd");
