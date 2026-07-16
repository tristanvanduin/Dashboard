// Standalone verificatie van de eerlijke ICE-ranking (rankRecommendationsByIce).
// Draaien: npx tsx lib/analysis/__ice_honest_test.ts
import { rankRecommendationsByIce } from "./thread-synthesis";

type Rec = { ice_impact: number; ice_confidence: number; ice_ease: number; ice_total: number };

function rec(impact: number, confidence: number, ease: number): Rec {
  return {
    ice_impact: impact,
    ice_confidence: confidence,
    ice_ease: ease,
    ice_total: Number(((impact + confidence + ease) / 3).toFixed(1)),
  };
}

// Exacte kopie van de OUDE enforceIceSpread-logica, puur voor contrast.
function oldEnforceIceSpread<T extends Rec>(recommendations: T[]): T[] {
  if (recommendations.length === 0) return recommendations;
  const ranked = [...recommendations].sort((a, b) => b.ice_total - a.ice_total);
  ranked.forEach((r, index) => {
    let impact = r.ice_impact, confidence = r.ice_confidence, ease = r.ice_ease;
    if (index === 0) { impact = Math.max(impact, 8.5); confidence = Math.max(confidence, 7.5); ease = Math.max(ease, 7); }
    else if (index === ranked.length - 1) { impact = Math.min(impact, 5.5); confidence = Math.min(confidence, 5.5); ease = Math.min(ease, 5.5); }
    else { impact = Math.min(impact, 7.5); confidence = Math.min(confidence, 7); ease = Math.min(ease, 6.5); }
    r.ice_impact = Number(impact.toFixed(1)); r.ice_confidence = Number(confidence.toFixed(1));
    r.ice_ease = Number(ease.toFixed(1)); r.ice_total = Number(((impact + confidence + ease) / 3).toFixed(1));
  });
  const hi = ranked[0], lo = ranked[ranked.length - 1];
  if (hi && lo && hi.ice_total - lo.ice_total < 2) {
    hi.ice_impact = Math.min(10, Math.max(hi.ice_impact, lo.ice_total + 3));
    hi.ice_confidence = Math.min(10, Math.max(hi.ice_confidence, 8));
    hi.ice_ease = Math.min(10, Math.max(hi.ice_ease, 7.5));
    hi.ice_total = Number(((hi.ice_impact + hi.ice_confidence + hi.ice_ease) / 3).toFixed(1));
    lo.ice_impact = Math.max(3, Math.min(lo.ice_impact, 5));
    lo.ice_confidence = Math.max(3, Math.min(lo.ice_confidence, 5));
    lo.ice_ease = Math.max(3, Math.min(lo.ice_ease, 5));
    lo.ice_total = Number(((lo.ice_impact + lo.ice_confidence + lo.ice_ease) / 3).toFixed(1));
  }
  return ranked;
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
}

console.log("\n1. Dicht-bij-elkaar scorende aanbevelingen blijven dicht bij elkaar (geen geforceerd gat van 2.0)");
{
  const close = [rec(6.5, 6, 6), rec(6, 6, 6), rec(5.5, 6, 6.5)];
  const honest = rankRecommendationsByIce(close.map((r) => ({ ...r })));
  const oldOut = oldEnforceIceSpread(close.map((r) => ({ ...r })));
  const honestGap = honest[0].ice_total - honest[honest.length - 1].ice_total;
  const oldGap = oldOut[0].ice_total - oldOut[oldOut.length - 1].ice_total;
  console.log(`     eerlijk gat = ${honestGap.toFixed(1)} | oude (geforceerde) gat = ${oldGap.toFixed(1)}`);
  check("eerlijk gat blijft klein (< 1.0)", honestGap < 1.0, `gat was ${honestGap.toFixed(1)}`);
  check("oude logica forceerde een gat >= 2.0 (bewijs van de bug)", oldGap >= 2.0, `oud gat ${oldGap.toFixed(1)}`);
}

console.log("\n2. Een echt zwakke topaanbeveling houdt zijn lage score (wordt NIET naar 8.5 gefloord)");
{
  const weak = [rec(4, 4, 4), rec(3.5, 4, 3.5), rec(3, 3, 3)];
  const honest = rankRecommendationsByIce(weak.map((r) => ({ ...r })));
  const oldOut = oldEnforceIceSpread(weak.map((r) => ({ ...r })));
  console.log(`     eerlijk top impact = ${honest[0].ice_impact} | oude top impact = ${oldOut[0].ice_impact}`);
  check("eerlijk: top impact blijft 4 (de echte score)", honest[0].ice_impact === 4, `was ${honest[0].ice_impact}`);
  check("oude logica floorde de zwakke top naar 8.5 (bewijs van de bug)", oldOut[0].ice_impact === 8.5, `oud ${oldOut[0].ice_impact}`);
}

console.log("\n3. De volgorde op echte ICE-score klopt");
{
  const mixed = [rec(5, 5, 5), rec(9, 8, 8), rec(3, 3, 3)];
  const honest = rankRecommendationsByIce(mixed.map((r) => ({ ...r })));
  check("aflopend gesorteerd op ice_total", honest[0].ice_total >= honest[1].ice_total && honest[1].ice_total >= honest[2].ice_total);
  check("de echt sterkste staat bovenaan", honest[0].ice_impact === 9);
}

console.log("\n4. De input wordt niet gemuteerd (puur)");
{
  const input = [rec(4, 4, 4)];
  const before = input[0].ice_impact;
  rankRecommendationsByIce(input);
  check("input.ice_impact onveranderd (geen floor-mutatie)", input[0].ice_impact === before, `was ${input[0].ice_impact}`);
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
