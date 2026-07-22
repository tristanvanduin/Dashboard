// Curated GreenTech demo-dataset — geserveerd vanuit de data-invoerpunten (client-data +
// overview) zodat de klant-cockpit (Overzicht/Campagnes/Prognose) en de portfolio-cel zonder
// Google Ads API of keys werken. Scoped op de demo-klant "demo-greentech" + de geo-clones
// (GRT/GRA/GRN, via campagnenamen). Puur presentatie; raakt geen echte data of berekening.
//
// De cijfers sluiten aan op scripts/demo/seed-demo-client.ts (dezelfde fictieve GreenTech-wereld),
// maar dit pad vraagt géén seed en géén backend — het is hardcoded voor review/presentatie.

export const DEMO_GREENTECH_ID = "demo-greentech";
export const DEMO_GREENTECH_NAME = "GreenTech (demo)";

// customerId komt binnen als clientId zonder "gads-"-prefix; de demo-klant heeft die prefix niet.
export function isGreentechDemo(customerId: string | null | undefined): boolean {
  if (!customerId) return false;
  return customerId.replace(/^gads-/, "") === DEMO_GREENTECH_ID;
}

interface Monthly { month: number; conversions: number; revenue: number; adSpend: number; impressions: number; clicks: number; ctr: number; avgCpc: number; conversionRate: number }
interface Weekly { week: number; month: number; conversions: number; revenue: number; adSpend: number }

const AOV = 120;
function months(base: { conv: number; spend: number; clicks: number; imp: number }): Monthly[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const s = 1 + 0.18 * Math.sin(((m - 3) / 12) * 2 * Math.PI); // lichte seizoensvorm, piek voorjaar
    const conversions = Math.round(base.conv * s);
    const adSpend = Math.round(base.spend * s);
    const clicks = Math.round(base.clicks * s);
    const impressions = Math.round(base.imp * s);
    const revenue = Math.round(conversions * AOV);
    return {
      month: m, conversions, revenue, adSpend, impressions, clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      avgCpc: clicks > 0 ? adSpend / clicks : 0,
      conversionRate: clicks > 0 ? conversions / clicks : 0,
    };
  });
}

function weeks(monthly: Monthly[], upToMonth: number): Weekly[] {
  const out: Weekly[] = [];
  for (const m of monthly.filter((x) => x.month <= upToMonth)) {
    for (let w = 1; w <= 4; w++) {
      out.push({ week: w, month: m.month, conversions: Math.round(m.conversions / 4), revenue: Math.round(m.revenue / 4), adSpend: Math.round(m.adSpend / 4) });
    }
  }
  return out;
}

// Groei-curve: 2024 < 2025 < 2026.
const BASE_2024 = { conv: 82, spend: 6800, clicks: 3900, imp: 78000 };
const BASE_2025 = { conv: 95, spend: 7400, clicks: 4300, imp: 85000 };
const BASE_2026 = { conv: 104, spend: 7900, clicks: 4600, imp: 90000 };
const REALIZED_MONTH = 6; // t/m juni "gerealiseerd"

const CAMPAIGN_DEFS = [
  { id: "demo-c-grt", name: "GRT | Search | NL", type: "SEARCH", share: 0.42, is: { sis: 0.55, budgetLost: 0.28, rankLost: 0.05, budget: 140, util: 0.97 } },
  { id: "demo-c-gra", name: "GRA | Search | US", type: "SEARCH", share: 0.33, is: { sis: 0.62, budgetLost: 0.04, rankLost: 0.22, budget: 100, util: 0.70 } },
  { id: "demo-c-brand", name: "GreenTech | Brand", type: "SEARCH", share: 0.10, is: { sis: 0.93, budgetLost: 0.01, rankLost: 0.03, budget: 20, util: 0.80 } },
  { id: "demo-c-grn", name: "GRN | Search | Canada", type: "SEARCH", share: 0.15, is: { sis: 0.48, budgetLost: 0.31, rankLost: 0.08, budget: 90, util: 0.95 } },
];

const monthKey = (m: number) => `2026-${String(m).padStart(2, "0")}`;

function campaignRows() {
  const cur = months(BASE_2026);
  const rows = [];
  for (const c of CAMPAIGN_DEFS) {
    for (const m of cur.filter((x) => x.month <= REALIZED_MONTH)) {
      const conversions = Math.round(m.conversions * c.share);
      const adSpend = Math.round(m.adSpend * c.share);
      const clicks = Math.round(m.clicks * c.share);
      const impressions = Math.round(m.impressions * c.share);
      rows.push({
        campaignId: c.id, campaignName: c.name, campaignStatus: "ENABLED", month: monthKey(m.month),
        conversions, revenue: Math.round(conversions * AOV), adSpend, impressions, clicks,
        ctr: impressions > 0 ? clicks / impressions : 0, avgCpc: clicks > 0 ? adSpend / clicks : 0,
        conversionRate: clicks > 0 ? conversions / clicks : 0,
      });
    }
  }
  return rows;
}

// Per-land maanddata voor de geo-mapping (demo): NL sterkst (thuismarkt), US medium, CA (GRN
// Canada) het zwakst op CPA — zodat de metric-selector iets te vertellen heeft (op conversies
// leidt NL; op CPA is Canada de duurste). Afgeleide velden uit de basiscijfers.
function demoCountryRow(countryCode: string, month: string, impressions: number, clicks: number, cost: number, conversions: number, conversionsValue: number) {
  return {
    countryCode, month, impressions, clicks, cost, conversions, conversionsValue,
    ctr: impressions > 0 ? clicks / impressions : 0,
    avgCpc: clicks > 0 ? cost / clicks : 0,
    costPerConversion: conversions > 0 ? cost / conversions : 0,
    conversionRate: clicks > 0 ? conversions / clicks : 0,
    roas: cost > 0 ? conversionsValue / cost : 0,
    campaignCount: 2, spendShare: 0,
  };
}
const DEMO_COUNTRY_MONTHLY = [
  demoCountryRow("NL", "2026-05-01", 44000, 2050, 3820, 76, 9880),
  demoCountryRow("NL", "2026-06-01", 45500, 2120, 3960, 79, 10270),
  demoCountryRow("NL", "2026-07-01", 43000, 2000, 3800, 75, 9750),
  demoCountryRow("US", "2026-05-01", 31000, 1360, 2980, 40, 5200),
  demoCountryRow("US", "2026-06-01", 32500, 1420, 3100, 42, 5460),
  demoCountryRow("US", "2026-07-01", 30500, 1350, 2950, 39, 5070),
  demoCountryRow("CA", "2026-05-01", 15500, 600, 1360, 14, 1400),
  demoCountryRow("CA", "2026-06-01", 16200, 630, 1420, 15, 1500),
  demoCountryRow("CA", "2026-07-01", 15000, 590, 1340, 14, 1400),
];

// De volledige respons zoals /api/google-ads/client-data die teruggeeft (mock-variant).
export function buildGreentechClientData(customerId: string) {
  const cur = months(BASE_2026);
  const target = { conversions: 1500, revenue: 180000, adSpend: 100000 };
  const campaigns = campaignRows();
  const impressionShare = CAMPAIGN_DEFS.map((c) => {
    const monthTotal = months(BASE_2026)[REALIZED_MONTH - 1];
    return {
      campaignId: c.id, campaignName: c.name, campaignType: c.type,
      cost: Math.round(monthTotal.adSpend * c.share), conversions: Math.round(monthTotal.conversions * c.share),
      searchImpressionShare: c.is.sis, searchBudgetLostIS: c.is.budgetLost, searchRankLostIS: c.is.rankLost,
      dailyBudget: c.is.budget, budgetUtilization: c.is.util,
    };
  });
  return {
    customerId,
    currentYear: 2026,
    realizedThroughMonth: REALIZED_MONTH,
    targetCurrentYear: target,
    historicalYears: [
      { year: 2024, monthly: months(BASE_2024), weekly: weeks(months(BASE_2024), 12) },
      { year: 2025, monthly: months(BASE_2025), weekly: weeks(months(BASE_2025), 12) },
    ],
    currentYearMonthly: cur.filter((m) => m.month <= REALIZED_MONTH),
    currentYearWeekly: weeks(cur, REALIZED_MONTH),
    campaigns,
    campaignsHistorical: [],
    impressionShare,
    conversionActions: [
      { id: "demo-ca-lead", name: "Stand-aanvraag", category: "SUBMIT_LEAD_FORM", status: "ENABLED", type: "WEBPAGE", primaryForGoal: true },
      { id: "demo-ca-reg", name: "Bezoekersregistratie", category: "SIGNUP", status: "ENABLED", type: "WEBPAGE", primaryForGoal: true },
    ],
    accountStructure: {
      campaigns: CAMPAIGN_DEFS.map((c) => ({
        id: c.id, name: c.name, type: c.type, biddingStrategy: "MAXIMIZE_CONVERSIONS", purpose: "demand_capture",
        bucketLabel: null, adGroupCount: 3, assetGroupCount: 0, hasFeed: false, productGroupCount: 0,
        cost30d: Math.round(cur[REALIZED_MONTH - 1].adSpend * c.share), conversions30d: Math.round(cur[REALIZED_MONTH - 1].conversions * c.share),
        impressions30d: Math.round(cur[REALIZED_MONTH - 1].impressions * c.share),
      })),
      detectedStrategy: ["MAXIMIZE_CONVERSIONS"],
    },
    wastefulSearchTerms: [
      { searchTerm: "greentech festival tickets", campaignName: "GRT | Search | NL", adGroupName: "GRT Generiek", clicks: 34, cost: 78 },
      { searchTerm: "gratis kas bouwen", campaignName: "GRT | Search | NL", adGroupName: "GRT Generiek", clicks: 21, cost: 41 },
    ],
    campaignCountryMap: { "GRT | Search | NL": "NL", "GRA | Search | US": "US", "GreenTech | Brand": "NL", "GRN | Search | Canada": "CA" },
    campaignCountryShares: { "GRT | Search | NL": { NL: 1 }, "GRA | Search | US": { US: 1 }, "GreenTech | Brand": { NL: 1 }, "GRN | Search | Canada": { CA: 1 } },
    detectedCountries: ["NL", "US", "CA"],
    countryMonthlyData: DEMO_COUNTRY_MONTHLY,
    adGroupBleeders: [],
    adGroupPerformance: [],
    productBleeders: [],
    productPerformance: [],
    changeHistory: [],
  };
}

// De overview-vorm zoals /api/google-ads/overview per account teruggeeft (mock-variant).
export function buildGreentechOverview(customerId: string) {
  const cur = months(BASE_2026);
  const prev = months(BASE_2025);
  const sum = (arr: Monthly[], upto: number, key: keyof Monthly) => arr.filter((m) => m.month <= upto).reduce((s, m) => s + (m[key] as number), 0);
  const ytdConv = sum(cur, REALIZED_MONTH, "conversions");
  const ytdRev = sum(cur, REALIZED_MONTH, "revenue");
  const ytdSpend = sum(cur, REALIZED_MONTH, "adSpend");
  const prevConv = sum(prev, REALIZED_MONTH, "conversions");
  const prevRev = sum(prev, REALIZED_MONTH, "revenue");
  const prevSpend = sum(prev, REALIZED_MONTH, "adSpend");
  const pct = (c: number, p: number) => (p > 0 ? ((c - p) / p) * 100 : null);
  const last = cur[REALIZED_MONTH - 1];
  return {
    customerId,
    ytd: { conversions: ytdConv, revenue: ytdRev, adSpend: ytdSpend, roas: ytdSpend > 0 ? ytdRev / ytdSpend : 0, cpa: ytdConv > 0 ? ytdSpend / ytdConv : 0 },
    yoy: { convChange: pct(ytdConv, prevConv), revChange: pct(ytdRev, prevRev), spendChange: pct(ytdSpend, prevSpend) },
    lastMonth: { month: REALIZED_MONTH, conversions: last.conversions, revenue: last.revenue, adSpend: last.adSpend, prevYearConv: prev[REALIZED_MONTH - 1].conversions },
    monthlyConversions: cur.filter((m) => m.month <= REALIZED_MONTH).map((m) => m.conversions),
  };
}
