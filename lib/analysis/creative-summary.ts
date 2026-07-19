// Deterministische creative-samenvatting en -aanbevelingen voor de Creative Performance-view.
// Puur: geen LLM, geen IO. Vat de creatives van een kanaal samen (totalen, beste/zwakste op
// CTR en CPA) en leidt concrete aanbevelingen af (pauzeer dure niet-converterende creatives,
// schaal bewezen winners). Ratio's UIT TOTALEN; drempels relatief t.o.v. de account-mediaan
// zodat het per kanaal en klant klopt. Los getest.

export interface CreativeRow {
  id: string;
  name: string;          // ad-naam of creative-titel
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}

export const MIN_IMPRESSIONS = 500;   // onder dit volume is een ratio ruis
export const WEAK_CTR_FRAC = 0.5;     // onder 50% van de mediaan-CTR = zwak
export const STRONG_CTR_FRAC = 1.3;   // boven 130% van de mediaan-CTR = sterk
export const HIGH_COST_ZERO_CONV = 50; // dure creative zonder conversies (in valuta) = pauzeerkandidaat

const ctrOf = (c: CreativeRow): number | null => (c.impressions > 0 ? c.clicks / c.impressions : null);
const cpaOf = (c: CreativeRow): number | null => (c.conversions > 0 ? c.cost / c.conversions : null);

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export interface CreativeRecommendation {
  kind: "pauzeer" | "schaal" | "vervang";
  creativeName: string;
  detail: string;
}

export interface CreativeSummary {
  count: number;
  totals: { impressions: number; clicks: number; cost: number; conversions: number; ctr: number | null; cpa: number | null };
  best: { name: string; ctr: number | null } | null;      // hoogste CTR (voldoende volume)
  worst: { name: string; ctr: number | null } | null;     // laagste CTR (voldoende volume)
  medianCtr: number | null;
  recommendations: CreativeRecommendation[];
  summaryText: string;
}

const pct = (v: number | null): string => (v == null ? "n.v.t." : `${Math.round(v * 1000) / 10}%`);
const eur = (v: number | null): string => (v == null ? "n.v.t." : `€${Math.round((v ?? 0) * 100) / 100}`);

export function summarizeCreatives(rows: CreativeRow[]): CreativeSummary {
  const totals = rows.reduce(
    (a, c) => ({ impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, cost: a.cost + c.cost, conversions: a.conversions + c.conversions }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
  );
  const totCtr = totals.impressions > 0 ? totals.clicks / totals.impressions : null;
  const totCpa = totals.conversions > 0 ? totals.cost / totals.conversions : null;

  // Alleen creatives met genoeg volume tellen mee voor de ratio-vergelijkingen.
  const rated = rows.filter((c) => c.impressions >= MIN_IMPRESSIONS && ctrOf(c) != null);
  const medianCtr = median(rated.map((c) => ctrOf(c)!));
  const byCtr = [...rated].sort((a, b) => (ctrOf(b) ?? 0) - (ctrOf(a) ?? 0));
  const best = byCtr[0] ? { name: byCtr[0].name, ctr: ctrOf(byCtr[0]) } : null;
  const worst = byCtr.length > 1 ? { name: byCtr[byCtr.length - 1].name, ctr: ctrOf(byCtr[byCtr.length - 1]) } : null;

  const recommendations: CreativeRecommendation[] = [];
  // 1. Dure creatives zonder conversies: pauzeer/herzien.
  for (const c of rows.filter((c) => c.conversions === 0 && c.cost >= HIGH_COST_ZERO_CONV).sort((a, b) => b.cost - a.cost).slice(0, 3)) {
    recommendations.push({ kind: "pauzeer", creativeName: c.name, detail: `${eur(c.cost)} kosten, nul conversies — herzie of pauzeer.` });
  }
  // 2. Zwakke CTR bij voldoende volume: vervang de creative.
  if (medianCtr != null) {
    for (const c of rated.filter((c) => (ctrOf(c) ?? 0) < medianCtr * WEAK_CTR_FRAC).sort((a, b) => (ctrOf(a) ?? 0) - (ctrOf(b) ?? 0)).slice(0, 2)) {
      recommendations.push({ kind: "vervang", creativeName: c.name, detail: `CTR ${pct(ctrOf(c))} ligt ver onder de mediaan (${pct(medianCtr)}) — ververs de creative.` });
    }
    // 3. Sterke CTR + converteert: schaal op.
    for (const c of rated.filter((c) => (ctrOf(c) ?? 0) >= medianCtr * STRONG_CTR_FRAC && c.conversions > 0).sort((a, b) => (ctrOf(b) ?? 0) - (ctrOf(a) ?? 0)).slice(0, 2)) {
      recommendations.push({ kind: "schaal", creativeName: c.name, detail: `CTR ${pct(ctrOf(c))} boven de mediaan met ${Math.round(c.conversions)} conversies (CPA ${eur(cpaOf(c))}) — geef meer budget of dupliceer het concept.` });
    }
  }

  const summaryText = rows.length === 0
    ? "Geen creative-data beschikbaar voor dit kanaal in de gekozen periode."
    : `${rows.length} creatives, samen ${eur(totals.cost)} kosten en ${Math.round(totals.conversions)} conversies (CTR ${pct(totCtr)}, CPA ${eur(totCpa)}).` +
      (best ? ` Sterkste op CTR: "${best.name}" (${pct(best.ctr)}).` : "") +
      (recommendations.some((r) => r.kind === "pauzeer") ? " Er zijn dure niet-converterende creatives die aandacht vragen." : "");

  return {
    count: rows.length,
    totals: { ...totals, ctr: totCtr, cpa: totCpa },
    best, worst, medianCtr, recommendations, summaryText,
  };
}
