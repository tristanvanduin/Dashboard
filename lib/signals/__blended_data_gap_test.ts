export {};
// Verificatie van de conversiewaarde-gap-detector (buildBlendedDataGapSignals): een kanaal dat
// wel materieel converteert en budget draagt maar €0 conversiewaarde meet, maakt blended ROAS
// onberekenbaar → gerichte tracking-nudge. Alleen als minstens één kanaal wél waarde meet.
// Draaien: npx tsx lib/signals/__blended_data_gap_test.ts

import { buildBlendedDataGapSignals, type ChannelValueAgg } from "./blended-data-gap";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const google = (v: Partial<ChannelValueAgg> = {}): ChannelValueAgg => ({ channel: "google_ads", conversions: 300, conversionValue: 40000, spend: 20000, ...v });
const meta = (v: Partial<ChannelValueAgg> = {}): ChannelValueAgg => ({ channel: "meta_ads", conversions: 200, conversionValue: 0, spend: 5000, ...v });

console.log("\n1. Google meet waarde, Meta niet → gap alleen voor Meta");
{
  const r = buildBlendedDataGapSignals([google(), meta()]);
  check("precies één signaal", r.triggered.length === 1, `triggered=${r.triggered.length}`);
  check("het gaat over Meta", r.triggered[0]?.id === "blended_datagap_meta_ads", r.triggered[0]?.id);
  check("categorie = conversie_meting", r.triggered[0]?.category === "conversie_meting");
  check("certainty = bewezen_binnen_platform (gemeten afwezigheid)", r.triggered[0]?.certainty === "bewezen_binnen_platform");
}

console.log("\n2. Alle kanalen zonder waarde → stil (waarschijnlijk bewust volume-sturing, geen gat)");
{
  const r = buildBlendedDataGapSignals([google({ conversionValue: 0 }), meta()]);
  check("geen signaal als niemand waarde meet", r.triggered.length === 0, `triggered=${r.triggered.length}`);
}

console.log("\n3. Kanaal met waarde → geen gap");
{
  const r = buildBlendedDataGapSignals([google(), meta({ conversionValue: 12000 })]);
  check("geen gap als Meta wel waarde meet", r.triggered.length === 0);
}

console.log("\n4. Te weinig volume/budget → ruis, geen oordeel");
{
  const r = buildBlendedDataGapSignals([google(), meta({ conversions: 5, spend: 100 })]);
  check("dunne data → geen signaal", r.triggered.length === 0, `triggered=${r.triggered.length}`);
  check("wel als onderzocht gemarkeerd (checked)", r.checked.includes("blended_conversion_value_gap"));
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
