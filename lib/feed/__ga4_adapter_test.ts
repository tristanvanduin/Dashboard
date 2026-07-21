export {};
// Verificatie van de GA4→feed-adapter (ga4SignalToFeedItem): een GA4-tracking-SignalStory wordt
// een correcte feed-kaart — cross-band, critical/issue, source tracking, en impactType volgt de
// certainty (indicatie → estimated, geen euro-waarde → telt niet mee in het gemeten euro-risico).
// Draaien: npx tsx lib/feed/__ga4_adapter_test.ts

import { ga4SignalToFeedItem } from "./adapters-ga4";
import { measuredRiskOpen } from "./feed-item";
import type { SignalStory } from "@/lib/signals/types";

const story: SignalStory = {
  id: "ga4_tracking_gap",
  category: "conversie_meting",
  scope: "GA4-website (alle kanalen)",
  story: "In GA4 vielen de key events weg terwijl de sessies doorliepen.",
  actionDirection: "controleer de GA4-tag",
  certainty: "indicatie",
  evidence: [{ metric: "sessies recent", value: "800" }],
};

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log("\n1. Mapping van een GA4-tracking-signaal naar een feed-kaart");
{
  const item = ga4SignalToFeedItem(story, "gads-123", "Klant X");
  check("id-vorm ga4:<client>:<verhaal>", item.id === "ga4:gads-123:ga4_tracking_gap", item.id);
  check("kanaal = cross (over de website, niet één advertentiekanaal)", item.channel === "cross");
  check("severity = critical (operationeel)", item.severity === "critical");
  check("type = issue", item.type === "issue");
  check("source = tracking", item.source === "tracking");
  check("impactType = estimated (certainty indicatie)", item.impactType === "estimated");
  check("impactDirection = risk", item.impactDirection === "risk");
  check("geen euro-waarde (GA4 levert geen euro)", item.impactValue === null);
  check("primaire actie = onderzoek", item.primaryAction.kind === "investigate");
  check("niet als mock gemarkeerd (echte adapter)", item.isMock === false);
}

console.log("\n2. Telt NIET mee in het gemeten euro-risico (geen valse zekerheid)");
{
  const item = ga4SignalToFeedItem(story, "gads-123", "Klant X");
  check("measuredRiskOpen negeert de GA4-kaart (estimated + geen waarde)", measuredRiskOpen([item]) === 0);
}

console.log("\n3. Bewezen-binnen-platform-signaal zou wél measured zijn");
{
  const proven: SignalStory = { ...story, certainty: "bewezen_binnen_platform" };
  const item = ga4SignalToFeedItem(proven, "gads-123", "Klant X");
  check("certainty bewezen → impactType measured", item.impactType === "measured");
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
