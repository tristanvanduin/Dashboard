// Test voor de LinkedIn prepared-compute rekenkern (L2). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_compute_test.ts

import { deriveFromRows, aggregateMonthly, computeMoMChain, trendDirection, computeVsAverage, type LinkedInComputeRow, type MonthlyMetrics } from "./prepared-compute";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function approx(a: number | null, b: number, label: string): void {
  assert(a != null && Math.abs(a - b) < 1e-6, `${label} (kreeg ${a}, verwacht ${b})`);
}

function row(date: string, impressions: number, clicks: number, spend: number, leads: number, form_opens: number, conversions = 0): LinkedInComputeRow {
  return { date, impressions, clicks, spend, leads, form_opens, conversions, conversion_value: 0 };
}

const rows: LinkedInComputeRow[] = [
  row("2026-02-10", 5000, 100, 200, 4, 20, 3),
  row("2026-02-20", 5000, 100, 200, 6, 30, 3),
  row("2026-03-10", 6000, 150, 300, 8, 40, 4),
  row("2026-03-20", 6000, 150, 300, 12, 60, 4),
];

// deriveFromRows over februari: afgeleiden uit sommen
const feb = deriveFromRows(rows.slice(0, 2));
assert(feb.impressions === 10000 && feb.clicks === 200 && feb.leads === 10 && feb.form_opens === 50, "sommen van tellingen");
approx(feb.spend, 400, "spend gesommeerd");
approx(feb.ctr_pct, 2, "CTR = clicks/impressions in procenten");
approx(feb.cpc, 2, "CPC = spend/clicks");
approx(feb.cpm, 40, "CPM = spend/impressions*1000");
approx(feb.cpl, 40, "CPL = spend/leads");
approx(feb.open_rate_pct, 25, "open rate = form opens/clicks");
approx(feb.form_completion_rate_pct, 20, "form completion rate = leads/form opens");
approx(feb.cvr_pct, 3, "CVR = conversions/clicks");

// Discipline: CPL uit sommen, niet het gemiddelde van dagelijkse CPL's
// dag1 CPL = 200/4 = 50, dag2 CPL = 200/6 = 33,33; gemiddelde zou 41,67 zijn, som-CPL is 40
approx(feb.cpl, 40, "CPL wordt uit sommen herberekend, niet als ratio-gemiddelde");

// Maandaggregatie
const monthly = aggregateMonthly(rows);
assert(monthly.length === 2, "twee maanden geaggregeerd");
assert(monthly[0].month === "2026-02" && monthly[1].month === "2026-03", "maanden gesorteerd");
approx(monthly[1].cpl, 30, "maart CPL = 600/20");

// MoM-keten: LinkedIn-volgorde (Leads eerst) en deltas
const mom = computeMoMChain(monthly);
assert(mom.latest_month === "2026-03" && mom.previous_month === "2026-02", "MoM-maanden");
assert(mom.chain[0].metric === "Leads", "keten begint met Leads (LinkedIn-volgorde)");
assert(mom.chain.map((c) => c.metric).join(",") === "Leads,Form completion rate,Form opens,Clicks,CPC,Spend,Impressions,CTR", "volledige LinkedIn-keten in volgorde");
approx(mom.chain[0].delta_pct, 100, "Leads MoM +100%");
assert(mom.chain[0].direction === "stijgt", "Leads stijgt");
const cpcFact = mom.chain.find((c) => c.metric === "CPC");
assert(cpcFact?.direction === "vlak" && cpcFact?.delta_pct === 0, "CPC vlak (2,0 naar 2,0)");
const ctrFact = mom.chain.find((c) => c.metric === "CTR");
approx(ctrFact?.delta_pct ?? null, 25, "CTR MoM +25% (2,0 naar 2,5)");

// Trendrichting
const upTrend: MonthlyMetrics[] = monthly;
assert(trendDirection(upTrend, "leads", 2) === "stijgt", "leads-trend stijgt over 2 maanden");
assert(trendDirection(upTrend, "cpc", 2) === "vlak", "cpc-trend vlak");

// Versus-gemiddelde
const vs = computeVsAverage("CPL", 30, 40);
assert(vs.position === "onder" && vs.delta_pct === -25, "CPL 30 ligt 25% onder het gemiddelde van 40");
const vsEqual = computeVsAverage("CTR", 2, 2);
assert(vsEqual.position === "gelijk", "gelijke waarde geeft positie gelijk");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
