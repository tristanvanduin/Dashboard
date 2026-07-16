/**
 * Campaign Analysis Engine
 *
 * Analyzes campaign-level data to produce specific, actionable findings.
 * Every finding is aware of the campaign's purpose — brand campaigns are
 * never suggested as scale targets, awareness campaigns are evaluated on
 * CPM/CTR/reach instead of ROAS, etc.
 *
 * The engine evaluates each campaign on ALL available metrics that are
 * relevant for its purpose (see PURPOSE_EVAL_CRITERIA in campaign-types.ts).
 */

import {
  type CampaignData,
  type CampaignPurpose,
  type CampaignMonthlyMetrics,
  type ClientCampaignData,
  isScalable,
  isRoasRelevant,
  hasNaturallyHighRoas,
  PURPOSE_LABELS,
  PURPOSE_EVAL_CRITERIA,
  getPurposeFocus,
} from "./campaign-types";
import { computeForecast } from "./forecast";
import type { ClientHistoricalData } from "./types";
import { getClientSettings } from "./client-settings";

// ── Finding types ───────────────────────────────────────────────────────────

export type FindingSeverity = "critical" | "warning" | "positive" | "info";

export type FindingCategory =
  | "bleeder"
  | "declining"
  | "cpa-issue"
  | "trend-break"
  | "budget-opportunity"
  | "brand-protection"
  | "pmax-concern"
  | "ctr-issue"
  | "ctr-fatigue"
  | "conv-rate-issue"
  | "cpc-rising"
  | "volume-drop"
  | "awareness-inefficiency"
  | "remarketing-fatigue"
  | "category-underperform"
  | "shopping-efficiency"
  | "manual-check";

export interface CampaignFinding {
  severity: FindingSeverity;
  category: FindingCategory;
  campaignName: string;
  campaignType: string;
  purpose: CampaignPurpose;
  purposeLabel: string;
  description: string;
  action: string;
  impactScore: number;
}

export interface AccountAnalysis {
  findings: CampaignFinding[];
  topSpenders: CampaignSummary[];
  bleeders: CampaignSummary[];
  declining: CampaignSummary[];
  scaleOpportunities: CampaignSummary[];
  /** Manual checks that need to happen in Google Ads UI */
  manualChecks: ManualCheck[];
  accountTotals: {
    totalSpend: number;
    totalConversions: number;
    totalRevenue: number;
    avgRoas: number;
    avgCpa: number;
    avgRoasNonBrand: number;
    avgCpaNonBrand: number;
    avgCtr: number;
    avgConvRate: number;
    avgCpc: number;
  };
}

export interface CampaignSummary {
  name: string;
  type: string;
  purpose: CampaignPurpose;
  purposeLabel: string;
  totalSpend: number;
  totalConversions: number;
  totalRevenue: number;
  totalImpressions: number;
  totalClicks: number;
  roas: number;
  cpa: number;
  avgCtr: number;
  avgConvRate: number;
  avgCpc: number;
  cpm: number;
  momChange: number;
  /** MoM change in CTR */
  ctrTrend: number;
  /** MoM change in CPC */
  cpcTrend: number;
  /** MoM change in conversion rate */
  convRateTrend: number;
  /** MoM change in impressions */
  impressionTrend: number;
  spendShare: number;
}

export interface ManualCheck {
  campaignName: string;
  purpose: CampaignPurpose;
  purposeLabel: string;
  metric: string;
  label: string;
  why: string;
  howToCheck: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function pct(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)}%`;
}

function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function trend(first: number, last: number): number {
  return first > 0 ? ((last - first) / first) * 100 : 0;
}

function summarize(campaign: CampaignData, totalSpend: number): CampaignSummary {
  const months = campaign.monthly;
  const spend = months.reduce((s, m) => s + m.adSpend, 0);
  const conv = months.reduce((s, m) => s + m.conversions, 0);
  const rev = months.reduce((s, m) => s + m.revenue, 0);
  const impr = months.reduce((s, m) => s + m.impressions, 0);
  const clicks = months.reduce((s, m) => s + m.clicks, 0);

  const first = months[0];
  const last = months[months.length - 1];

  return {
    name: campaign.campaignName,
    type: campaign.campaignType,
    purpose: campaign.purpose,
    purposeLabel: PURPOSE_LABELS[campaign.purpose],
    totalSpend: spend,
    totalConversions: conv,
    totalRevenue: rev,
    totalImpressions: impr,
    totalClicks: clicks,
    roas: spend > 0 ? rev / spend : 0,
    cpa: conv > 0 ? spend / conv : spend,
    avgCtr: impr > 0 ? clicks / impr : 0,
    avgConvRate: clicks > 0 ? conv / clicks : 0,
    avgCpc: clicks > 0 ? spend / clicks : 0,
    cpm: impr > 0 ? (spend / impr) * 1000 : 0,
    momChange: months.length >= 2 ? trend(first.conversions, last.conversions) : 0,
    ctrTrend: months.length >= 2 ? trend(first.ctr, last.ctr) : 0,
    cpcTrend: months.length >= 2 ? trend(first.avgCpc, last.avgCpc) : 0,
    convRateTrend: months.length >= 2 ? trend(first.conversionRate, last.conversionRate) : 0,
    impressionTrend: months.length >= 2 ? trend(first.impressions, last.impressions) : 0,
    spendShare: totalSpend > 0 ? (spend / totalSpend) * 100 : 0,
  };
}

// ── CTR benchmarks per purpose ──────────────────────────────────────────────

const CTR_BENCHMARKS: Record<CampaignPurpose, { low: number; good: number }> = {
  brand:       { low: 0.08, good: 0.12 },   // Brand CTR should be >8%, good >12%
  generic:     { low: 0.02, good: 0.04 },   // Generic >2%, good >4%
  category:    { low: 0.025, good: 0.05 },  // Category similar to generic
  shopping:    { low: 0.01, good: 0.025 },  // Shopping lower, >1%, good >2.5%
  pmax:        { low: 0.015, good: 0.03 },  // PMax mixed, >1.5%
  remarketing: { low: 0.003, good: 0.008 }, // Display remarketing >0.3%
  awareness:   { low: 0.003, good: 0.006 }, // Display/Video awareness >0.3%
  competitor:  { low: 0.01, good: 0.025 },  // Competitor lower, >1%
};

const CONV_RATE_BENCHMARKS: Record<CampaignPurpose, { low: number; good: number }> = {
  brand:       { low: 0.05, good: 0.10 },   // Brand should convert >5%
  generic:     { low: 0.015, good: 0.03 },  // Generic >1.5%
  category:    { low: 0.015, good: 0.035 }, // Category similar
  shopping:    { low: 0.01, good: 0.025 },  // Shopping >1%
  pmax:        { low: 0.01, good: 0.025 },  // PMax >1%
  remarketing: { low: 0.02, good: 0.05 },   // Remarketing should be higher >2%
  awareness:   { low: 0, good: 0 },          // Not relevant for awareness
  competitor:  { low: 0.005, good: 0.015 },  // Competitor low, >0.5%
};

// ── Main analysis ───────────────────────────────────────────────────────────

export function analyzeClientCampaigns(clientId: string, clientData?: ClientHistoricalData, campaignData?: ClientCampaignData): AccountAnalysis {
  const campaigns = campaignData?.campaigns ?? [];
  if (!clientData) {
    throw new Error(`[analyzeClientCampaigns] clientData is required for "${clientId}".`);
  }
  const data = clientData;
  const forecast = computeForecast(data);
  const settings = getClientSettings(clientId);
  const kpi = settings.kpiTargets;

  const activeCampaigns = campaigns.filter((c) => c.status === "ENABLED");

  // ── Account totals ──
  const totalSpend = activeCampaigns.reduce((s, c) =>
    s + c.monthly.reduce((ms, m) => ms + m.adSpend, 0), 0);
  const totalConv = activeCampaigns.reduce((s, c) =>
    s + c.monthly.reduce((ms, m) => ms + m.conversions, 0), 0);
  const totalRev = activeCampaigns.reduce((s, c) =>
    s + c.monthly.reduce((ms, m) => ms + m.revenue, 0), 0);
  const totalImpr = activeCampaigns.reduce((s, c) =>
    s + c.monthly.reduce((ms, m) => ms + m.impressions, 0), 0);
  const totalClicks = activeCampaigns.reduce((s, c) =>
    s + c.monthly.reduce((ms, m) => ms + m.clicks, 0), 0);

  const nonBrandCampaigns = activeCampaigns.filter((c) => !hasNaturallyHighRoas(c.purpose));
  const nbSpend = nonBrandCampaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.adSpend, 0), 0);
  const nbConv = nonBrandCampaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.conversions, 0), 0);
  const nbRev = nonBrandCampaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.revenue, 0), 0);

  const accountTotals = {
    totalSpend, totalConversions: totalConv, totalRevenue: totalRev,
    avgRoas: totalSpend > 0 ? totalRev / totalSpend : 0,
    avgCpa: totalConv > 0 ? totalSpend / totalConv : 0,
    avgRoasNonBrand: nbSpend > 0 ? nbRev / nbSpend : 0,
    avgCpaNonBrand: nbConv > 0 ? nbSpend / nbConv : 0,
    avgCtr: totalImpr > 0 ? totalClicks / totalImpr : 0,
    avgConvRate: totalClicks > 0 ? totalConv / totalClicks : 0,
    avgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
  };

  // ── Summaries ──
  const summaries = activeCampaigns.map((c) => summarize(c, totalSpend));
  const topSpenders = [...summaries].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 3);

  const bleeders = summaries.filter((s) =>
    isRoasRelevant(s.purpose) && !hasNaturallyHighRoas(s.purpose) &&
    s.roas < accountTotals.avgRoasNonBrand * 0.7 && s.totalSpend > totalSpend * 0.05
  );
  const declining = summaries.filter((s) => s.momChange < -15);
  const scaleOpportunities = summaries.filter((s) =>
    isScalable(s.purpose) && s.roas > accountTotals.avgRoasNonBrand * 1.2 && s.totalConversions > 0
  );

  const findings: CampaignFinding[] = [];
  const manualChecks: ManualCheck[] = [];

  // ══════════════════════════════════════════════════════════════════════════
  // Evaluate each campaign on ALL relevant criteria for its purpose
  // ══════════════════════════════════════════════════════════════════════════

  for (const campaign of activeCampaigns) {
    const s = summarize(campaign, totalSpend);
    const months = campaign.monthly;
    if (months.length < 2) continue;

    const purpose = campaign.purpose;
    const criteria = PURPOSE_EVAL_CRITERIA[purpose];

    // Collect manual checks for unavailable metrics
    for (const criterion of criteria) {
      if (!criterion.available && criterion.checkInAds) {
        manualChecks.push({
          campaignName: campaign.campaignName,
          purpose,
          purposeLabel: PURPOSE_LABELS[purpose],
          metric: criterion.metric,
          label: criterion.label,
          why: criterion.why,
          howToCheck: criterion.checkInAds,
        });
      }
    }

    // ── ROAS evaluation (non-awareness, non-competitor where strategic) ──
    if (isRoasRelevant(purpose) && !hasNaturallyHighRoas(purpose)) {
      if (s.roas < accountTotals.avgRoasNonBrand * 0.7 && s.totalSpend > totalSpend * 0.05) {
        findings.push({
          severity: s.roas < accountTotals.avgRoasNonBrand * 0.4 ? "critical" : "warning",
          category: "bleeder",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `ROAS ${s.roas.toFixed(2)} vs non-brand gem. ${accountTotals.avgRoasNonBrand.toFixed(2)}. Spend ${fmt(s.totalSpend)} (${Math.round(s.spendShare)}%) voor ${s.totalConversions} conversies.`,
          action: purpose === "pmax"
            ? `Check Search Term Insights — PMax steelt mogelijk branded traffic. Vergelijk met brand-exclusie.`
            : `Verlaag budget of pauzeer. Verschuif naar ${scaleOpportunities.length > 0 ? `"${scaleOpportunities[0].name}" (${scaleOpportunities[0].purposeLabel})` : "schaalbare non-brand campagnes"}.`,
          impactScore: s.totalSpend * (1 - s.roas / Math.max(accountTotals.avgRoasNonBrand, 0.1)),
        });
      }
    }

    // ── CTR evaluation (all purposes have CTR benchmarks) ──
    const ctrBench = CTR_BENCHMARKS[purpose];
    if (s.avgCtr < ctrBench.low && s.totalImpressions > 500) {
      const advice: Record<CampaignPurpose, string> = {
        brand: "Advertentieteksten verouderd? Of bieden concurrenten op je merk met betere copy?",
        generic: "Advertentietekst matcht niet met zoekintentie. Test nieuwe headlines en descriptions.",
        category: "Copy is niet relevant genoeg voor dit segment. Maak advertenties specifieker.",
        shopping: "Productafbeeldingen, titels, of prijzen zijn niet aantrekkelijk. Optimaliseer feed.",
        pmax: "Assets presteren slecht. Check asset group rating en vervang underperformers.",
        remarketing: "Ad fatigue — doelgroep ziet dezelfde ads te vaak. Vernieuw creatives.",
        awareness: "Creative werkt niet. Test andere visuals, video hooks, of targeting.",
        competitor: "Advertentie is niet overtuigend genoeg vs concurrent. Benadruk USPs sterker.",
      };
      findings.push({
        severity: s.avgCtr < ctrBench.low * 0.5 ? "warning" : "info",
        category: "ctr-issue",
        campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
        description: `CTR van ${pct1(s.avgCtr)} is onder benchmark (${pct1(ctrBench.low)} minimum voor ${s.purposeLabel}).`,
        action: advice[purpose],
        impactScore: s.totalSpend * (ctrBench.low - s.avgCtr) / Math.max(ctrBench.low, 0.001),
      });
    }

    // ── CTR trend (declining = fatigue or relevance loss) ──
    if (s.ctrTrend < -15 && s.totalImpressions > 500) {
      const fatigueAdvice: Record<CampaignPurpose, string> = {
        brand: "Brand CTR daalt — check of concurrenten recenter/beter adverteren op je merk.",
        generic: "Relevantie daalt. Check zoektermrapport voor irrelevante queries die CTR drukken.",
        category: "CTR daalt in deze categorie. Vernieuw advertentieteksten met actuele USPs.",
        shopping: "Feed aantrekkelijkheid daalt. Check prijsconcurrentie en afbeeldingen.",
        pmax: "Google plaatst ads op minder relevante plaatsingen. Check asset kwaliteit.",
        remarketing: "Ad fatigue: doelgroep reageert niet meer. Vernieuw creatives direct.",
        awareness: "Creative vermoeidheid. Wissel visuals/video en test nieuwe doelgroepen.",
        competitor: "Concurrent heeft mogelijk ads verbeterd. Herzie je propositie.",
      };
      findings.push({
        severity: purpose === "remarketing" || purpose === "awareness" ? "warning" : "info",
        category: "ctr-fatigue",
        campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
        description: `CTR daalt ${pct(s.ctrTrend)} van Jan→Mrt (${pct1(months[0].ctr)} → ${pct1(months[months.length - 1].ctr)}).`,
        action: fatigueAdvice[purpose],
        impactScore: Math.abs(s.ctrTrend) * s.spendShare * 0.5,
      });
    }

    // ── Conversion Rate evaluation (not for awareness) ──
    const crBench = CONV_RATE_BENCHMARKS[purpose];
    if (crBench.low > 0 && s.avgConvRate < crBench.low && s.totalClicks > 100) {
      const crAdvice: Record<CampaignPurpose, string> = {
        brand: "Branded bezoekers converteren niet — landingspagina of aanbod probleem. Urgente check.",
        generic: "Lage conversieratio wijst op slechte landingspagina, verkeerde targeting, of te breed zoekverkeer.",
        category: "Categorie-specifieke pagina converteert slecht. Check of de pagina matcht met het zoekwoord.",
        shopping: "Product pagina's converteren onder benchmark. Check prijs, reviews, en voorraad.",
        pmax: "PMax converteert onder benchmark — mogelijk te brede targeting. Check doelgroep signalen.",
        remarketing: "Remarketing converteert slecht — lijsten zijn te breed of te oud. Verfijn segmenten.",
        awareness: "",
        competitor: "Verwacht lager, maar <0.5% = overweeg of de investering het waard is.",
      };
      findings.push({
        severity: s.avgConvRate < crBench.low * 0.5 ? "warning" : "info",
        category: "conv-rate-issue",
        campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
        description: `Conversieratio ${pct1(s.avgConvRate)} onder benchmark (${pct1(crBench.low)} voor ${s.purposeLabel}). ${s.totalClicks} clicks, ${s.totalConversions} conversies.`,
        action: crAdvice[purpose],
        impactScore: s.totalClicks * (crBench.low - s.avgConvRate) * 10,
      });
    }

    // ── Conversion Rate trend ──
    if (crBench.low > 0 && s.convRateTrend < -20 && s.totalClicks > 100) {
      findings.push({
        severity: "warning",
        category: "conv-rate-issue",
        campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
        description: `Conversieratio daalt ${pct(s.convRateTrend)} van Jan→Mrt (${pct1(months[0].conversionRate)} → ${pct1(months[months.length - 1].conversionRate)}).`,
        action: purpose === "brand"
          ? "Branded bezoekers converteren steeds slechter — is er iets veranderd op de site of in het aanbod?"
          : `Check landingspagina performance (snelheid, mobiel), zoektermkwaliteit, en of het aanbod nog competitief is.`,
        impactScore: Math.abs(s.convRateTrend) * s.spendShare,
      });
    }

    // ── CPC trend (rising = competitive pressure or worsening QS) ──
    if (s.cpcTrend > 15 && s.totalClicks > 100) {
      const cpcAdvice: Record<CampaignPurpose, string> = {
        brand: `CPC stijgt op eigen merknaam (${fmt(months[0].avgCpc)} → ${fmt(months[months.length - 1].avgCpc)}). Concurrent biedt waarschijnlijk op je merk. Check Auction Insights.`,
        generic: `CPC stijgt ${pct(s.cpcTrend)} terwijl conv.rate ${s.convRateTrend > 0 ? "stijgt" : "daalt"} — ${s.convRateTrend < 0 ? "dubbel probleem, efficiency verslechtert snel" : "acceptabel als conversieratio meestijgt"}. Check Quality Score.`,
        category: `CPC stijgt in deze categorie. Meer concurrentie? Check Auction Insights en Quality Score.`,
        shopping: `Shopping CPC stijgt. Meer concurrenten of agressievere biedingen. Check benchmark CPC.`,
        pmax: `PMax CPC stijgt — Google vergroot bereik naar duurdere plaatsingen. Monitor of conversies meegroeien.`,
        remarketing: `Remarketing CPC stijgt. Doelgroep wordt duurder — check of frequentie niet te hoog is.`,
        awareness: `CPM stijgt. Meer concurrentie voor bereik of doelgroep te smal.`,
        competitor: `CPC op concurrent-termen stijgt. Concurrent verdedigt actiever. Heroverweeg ROI.`,
      };
      findings.push({
        severity: s.cpcTrend > 30 ? "warning" : "info",
        category: "cpc-rising",
        campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
        description: `CPC stijgt ${pct(s.cpcTrend)} van Jan→Mrt (${fmt(months[0].avgCpc)} → ${fmt(months[months.length - 1].avgCpc)}).`,
        action: cpcAdvice[purpose],
        impactScore: s.cpcTrend * s.spendShare * 0.3,
      });
    }

    // ── Volume/Impression trend (dropping = market shrink or budget limit) ──
    if (s.impressionTrend < -20 && s.totalImpressions > 1000) {
      const volumeAdvice: Record<CampaignPurpose, string> = {
        brand: "Minder branded zoekopdrachten = dalende merkbekendheid. Investeer in awareness/PR.",
        generic: "Impressies dalen. Budget te laag, zoekwoorden te restrictief, of markt krimpt.",
        category: "Volume in deze categorie daalt. Seizoenseffect of structureel?",
        shopping: "Minder productvertoningen. Feed issues, budget cap, of dalende vraag?",
        pmax: "PMax bereik daalt. Budget te laag of doelgroep uitgeput.",
        remarketing: "Remarketing bereik krimpt = minder verkeer naar site. Prospecting versterken.",
        awareness: "Bereik daalt. Budget te laag, frequentie cap bereikt, of doelgroep uitgeput.",
        competitor: "Minder vertoningen op concurrent-termen. Check Impression Share.",
      };
      findings.push({
        severity: s.impressionTrend < -35 ? "warning" : "info",
        category: "volume-drop",
        campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
        description: `Impressies dalen ${pct(s.impressionTrend)} van Jan→Mrt (${months[0].impressions.toLocaleString("nl-NL")} → ${months[months.length - 1].impressions.toLocaleString("nl-NL")}).`,
        action: volumeAdvice[purpose],
        impactScore: Math.abs(s.impressionTrend) * s.spendShare * 0.4,
      });
    }

    // ── Awareness-specific: CPM efficiency ──
    if (purpose === "awareness") {
      const cpm = s.cpm;
      if (cpm > 15) {
        findings.push({
          severity: cpm > 25 ? "warning" : "info",
          category: "awareness-inefficiency",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `CPM van ${fmt(cpm)} is hoog voor awareness. Je betaalt veel per 1000 vertoningen.`,
          action: "Verbreed doelgroep, test andere plaatsingen, of verlaag biedingen. Vergelijk met branche-benchmark (€5-€12 is normaal voor Display/Video).",
          impactScore: cpm * s.totalSpend / 1000,
        });
      }
      // Awareness with rising CPC but low CTR = bad creative
      if (s.avgCtr < 0.003 && s.totalImpressions > 5000) {
        findings.push({
          severity: "warning",
          category: "awareness-inefficiency",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Awareness CTR van ${pct1(s.avgCtr)} met ${s.totalImpressions.toLocaleString("nl-NL")} impressies. Creative resoneert niet met doelgroep.`,
          action: "Test nieuwe creatives: andere hook in eerste 3 seconden (video), andere visuele stijl (display). A/B test minimaal 3 varianten.",
          impactScore: s.totalSpend * 0.8,
        });
      }
    }

    // ── Remarketing-specific: ad fatigue detection ──
    if (purpose === "remarketing") {
      // CTR declining + conversion rate declining = classic fatigue
      if (s.ctrTrend < -10 && s.convRateTrend < -10) {
        findings.push({
          severity: "warning",
          category: "remarketing-fatigue",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Ad fatigue: zowel CTR (${pct(s.ctrTrend)}) als conversieratio (${pct(s.convRateTrend)}) dalen. Doelgroep reageert steeds minder.`,
          action: "Vernieuw alle creatives, segmenteer de doelgroep scherper (recent vs lang geleden bezocht), en overweeg frequentie cap (max 5x/maand).",
          impactScore: Math.abs(s.ctrTrend + s.convRateTrend) * s.spendShare,
        });
      }
      // Remarketing with low conversion rate = lists too broad
      if (s.avgConvRate < 0.01 && s.totalClicks > 50) {
        findings.push({
          severity: "info",
          category: "remarketing-fatigue",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Remarketing conversieratio ${pct1(s.avgConvRate)} is onder verwachting. Lijsten zijn mogelijk te breed.`,
          action: "Segmenteer: maak aparte lijsten voor cart abandoners (hoog), product viewers (midden), en bounce visitors (laag). Pas biedingen hierop aan.",
          impactScore: s.totalSpend * 0.3,
        });
      }
    }

    // ── PMax-specific ──
    if (purpose === "pmax") {
      // PMax with high ROAS = suspicious (might steal brand)
      if (s.roas > accountTotals.avgRoas * 1.3 && !bleeders.some((b) => b.name === s.name)) {
        findings.push({
          severity: "info",
          category: "pmax-concern",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `ROAS ${s.roas.toFixed(2)} is verdacht hoog voor PMax. Mogelijk steelt PMax branded zoekverkeer.`,
          action: "Check Search Term Insights: hoeveel % is branded? Voeg brand als negatief zoekwoord toe. Vergelijk of brand campagne gelijktijdig daalt.",
          impactScore: s.totalSpend * 0.5,
        });
      }
      // PMax with declining conversion rate = broadening too much
      if (s.convRateTrend < -15) {
        findings.push({
          severity: "warning",
          category: "pmax-concern",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `PMax conversieratio daalt ${pct(s.convRateTrend)}. Google vergroot bereik naar lagere intentie doelgroepen.`,
          action: "Versterk audience signals, voeg negatieve zoekwoorden toe, en overweeg ROAS target te verhogen om Google te dwingen gerichter te targeten.",
          impactScore: Math.abs(s.convRateTrend) * s.spendShare,
        });
      }
    }

    // ── Brand protection ──
    if (purpose === "brand") {
      if (s.momChange < -10) {
        findings.push({
          severity: "warning",
          category: "brand-protection",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Brand conversies dalen ${pct(s.momChange)}. Verlies van branded IS, concurrent biedgedrag, of PMax overlap.`,
          action: "Check Impression Share (moet >90%), Auction Insights (bieden concurrenten?), en of PMax branded traffic overneemt.",
          impactScore: Math.abs(s.momChange) * s.totalSpend * 0.5,
        });
      }
      // Brand with rising CPC = competitors bidding
      if (s.cpcTrend > 20) {
        findings.push({
          severity: "warning",
          category: "brand-protection",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Brand CPC stijgt ${pct(s.cpcTrend)} — concurrenten bieden mogelijk op je merknaam.`,
          action: "Check Auction Insights voor nieuwe concurrenten. Overweeg merknaam bescherming en contact met Google over trademark policy.",
          impactScore: s.cpcTrend * s.totalSpend * 0.3,
        });
      }
      // Brand CTR declining = competitor ads or PMax stealing
      if (s.ctrTrend < -10) {
        findings.push({
          severity: "info",
          category: "brand-protection",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Brand CTR daalt ${pct(s.ctrTrend)}. Concurrenten staan mogelijk boven je ads, of PMax neemt branded clicks over.`,
          action: "Check Absolute Top Impression Rate (moet >80%) en verifieer dat PMax niet branded zoektermen oppikt.",
          impactScore: Math.abs(s.ctrTrend) * s.spendShare * 0.3,
        });
      }
    }

    // ── Category comparison (compare similar-purpose campaigns) ──
    if (purpose === "category") {
      const otherCategories = summaries.filter((o) => o.purpose === "category" && o.name !== s.name);
      if (otherCategories.length > 0) {
        const avgCatRoas = otherCategories.reduce((sum, o) => sum + o.roas, 0) / otherCategories.length;
        if (s.roas < avgCatRoas * 0.6 && s.totalSpend > totalSpend * 0.05) {
          findings.push({
            severity: "warning",
            category: "category-underperform",
            campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
            description: `ROAS ${s.roas.toFixed(2)} vs categorie-gemiddelde ${avgCatRoas.toFixed(2)} — dit segment presteert ${Math.round((1 - s.roas / avgCatRoas) * 100)}% slechter dan andere categorieën.`,
            action: "Heroverweeg dit segment: is de landingspagina goed? Is het volume groot genoeg? Overweeg budget te verschuiven naar beter presterende categorieën.",
            impactScore: (avgCatRoas - s.roas) * s.totalSpend,
          });
        }
      }
    }

    // ── Shopping-specific: efficiency checks ──
    if (purpose === "shopping") {
      // Shopping with declining CTR = feed quality issue
      if (s.ctrTrend < -15) {
        findings.push({
          severity: "info",
          category: "shopping-efficiency",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Shopping CTR daalt ${pct(s.ctrTrend)}. Producten worden minder aantrekkelijk in vergelijking met concurrenten.`,
          action: "Optimaliseer feed: productafbeeldingen (witte achtergrond, hoge resolutie), titels (zoekwoord in titel), prijsconcurrentie, en merchant promotions.",
          impactScore: Math.abs(s.ctrTrend) * s.spendShare * 0.4,
        });
      }
      // Shopping with rising CPC but stable/declining conv rate
      if (s.cpcTrend > 15 && s.convRateTrend <= 0) {
        findings.push({
          severity: "warning",
          category: "shopping-efficiency",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Shopping CPC stijgt ${pct(s.cpcTrend)} terwijl conversieratio ${s.convRateTrend < -5 ? `daalt (${pct(s.convRateTrend)})` : "vlak is"}. Efficiency verslechtert.`,
          action: "Check benchmark CPC in Merchant Center. Evalueer biedstrategie (ROAS target aanpassen?). Check of concurrenten agressiever bieden.",
          impactScore: s.cpcTrend * s.spendShare * 0.5,
        });
      }
    }

    // ── Declining campaign (all purposes) ──
    if (s.momChange < -15) {
      // Don't duplicate if already caught by purpose-specific checks above
      const alreadyFound = findings.some((f) =>
        f.campaignName === s.name && (f.category === "brand-protection" || f.category === "bleeder")
      );
      if (!alreadyFound) {
        findings.push({
          severity: s.momChange < -30 && s.spendShare > 10 ? "critical" : "warning",
          category: "declining",
          campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
          description: `Conversies ${pct(s.momChange)} Jan→Mrt. ${s.spendShare > 10 ? `Significant: ${Math.round(s.spendShare)}% van budget.` : `${Math.round(s.spendShare)}% budget.`}`,
          action: `Analyseer: ${getPurposeFocus(purpose)}. Check change history.`,
          impactScore: Math.abs(s.momChange) * s.spendShare,
        });
      }
    }

    // ── CPA issues (non-brand, non-awareness) ──
    if (!hasNaturallyHighRoas(purpose) && purpose !== "awareness" &&
      s.cpa > accountTotals.avgCpaNonBrand * 1.5 && s.totalSpend > totalSpend * 0.08 &&
      !bleeders.some((b) => b.name === s.name)) {
      findings.push({
        severity: s.cpa > accountTotals.avgCpaNonBrand * 2 ? "critical" : "warning",
        category: "cpa-issue",
        campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
        description: `CPA ${fmt(s.cpa)} vs non-brand gem. ${fmt(accountTotals.avgCpaNonBrand)} (${Math.round((s.cpa / accountTotals.avgCpaNonBrand - 1) * 100)}% hoger).`,
        action: `Werk terug: conversieratio → klikken → CPC. Focus: ${getPurposeFocus(purpose)}.`,
        impactScore: (s.cpa - accountTotals.avgCpaNonBrand) * s.totalConversions,
      });
    }

    // ── Scale opportunities (only scalable) ──
    if (isScalable(purpose) && s.roas > accountTotals.avgRoasNonBrand * 1.2 &&
      s.totalConversions > 0 && s.spendShare < 35) {
      findings.push({
        severity: "positive",
        category: "budget-opportunity",
        campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
        description: `ROAS ${s.roas.toFixed(2)} (${Math.round((s.roas / accountTotals.avgRoasNonBrand - 1) * 100)}% boven non-brand gem.) met ${Math.round(s.spendShare)}% budget.${s.momChange > 0 ? ` Trend: ${pct(s.momChange)}.` : ""}`,
        action: `Verhoog budget 20-30%. Check IS Lost (Budget).${bleeders.length > 0 ? ` Financier uit "${bleeders[0].name}".` : ""}`,
        impactScore: s.roas * s.spendShare,
      });
    }

    // ── Trend break detection ──
    if (months.length >= 3) {
      const [m1, m2, m3] = months;
      const janFeb = m1.conversions > 0 ? (m2.conversions - m1.conversions) / m1.conversions : 0;
      const febMar = m2.conversions > 0 ? (m3.conversions - m2.conversions) / m2.conversions : 0;
      if (janFeb > -0.05 && febMar < -0.20) {
        if (!declining.some((d) => d.name === s.name)) {
          findings.push({
            severity: "warning",
            category: "trend-break",
            campaignName: s.name, campaignType: s.type, purpose, purposeLabel: s.purposeLabel,
            description: `Breuklijn: stabiel Jan→Feb (${pct(janFeb * 100)}) maar daling Feb→Mrt (${pct(febMar * 100)}).`,
            action: purpose === "brand"
              ? "Check of concurrent recent op je merk is gaan bieden of PMax branded traffic overneemt."
              : "Check change history: biedstrategie-, budget-, of targetingwijzigingen rond begin maart?",
            impactScore: Math.abs(febMar) * s.spendShare * 100,
          });
        }
      }
    }
  }

  // Deduplicate: keep highest impact per campaign per category
  const seen = new Map<string, CampaignFinding>();
  for (const f of findings) {
    const key = `${f.campaignName}|${f.category}`;
    const existing = seen.get(key);
    if (!existing || f.impactScore > existing.impactScore) {
      seen.set(key, f);
    }
  }
  const deduped = Array.from(seen.values());
  deduped.sort((a, b) => b.impactScore - a.impactScore);

  // Deduplicate manual checks
  const seenChecks = new Set<string>();
  const uniqueChecks = manualChecks.filter((c) => {
    const key = `${c.campaignName}|${c.metric}`;
    if (seenChecks.has(key)) return false;
    seenChecks.add(key);
    return true;
  });

  return {
    findings: deduped,
    topSpenders,
    bleeders,
    declining,
    scaleOpportunities,
    manualChecks: uniqueChecks,
    accountTotals,
  };
}
