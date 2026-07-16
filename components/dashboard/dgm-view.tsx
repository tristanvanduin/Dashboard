"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Shield, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Clock, Target, ChevronDown, ChevronUp, Lightbulb, ArrowRight,
  CircleDot, Activity, BarChart3, DollarSign, Users, Zap,
  AlertCircle, Info, ExternalLink,
} from "lucide-react";
import { useClientHistoricalData, useClientDataState } from "@/lib/client-data-provider";
import { computeForecast, type ClientForecast, type ForecastKPI } from "@/lib/forecast";
import { computeHealthScore, type HealthScore, type Anomaly } from "@/lib/health-score";
import { getClientSettings } from "@/lib/client-settings";
import { supabase } from "@/lib/supabase";
import type { ImpressionShareData, WastefulSearchTermData, AdGroupBleederData } from "@/lib/use-client-data";

// ─── Account type vocabulary ─────────────────────────────────────────

interface Vocab {
  conversion: string;    // "verkoop" | "lead" | "conversie"
  conversions: string;   // "verkopen" | "leads" | "conversies"
  cpa: string;           // "kosten per verkoop" | "kosten per lead"
  volume: string;        // "verkoopvolume" | "leadvolume" | "conversievolume"
}

function getVocab(settings: { kpiTargets: { roasTarget: number; cpaTarget: number } }): Vocab {
  const kpi = settings.kpiTargets;
  // If ROAS target is set → ecommerce (sales)
  if (kpi.roasTarget > 0) {
    return { conversion: "verkoop", conversions: "verkopen", cpa: "kosten per verkoop", volume: "Verkoopvolume" };
  }
  // If only CPA target → leadgen
  if (kpi.cpaTarget > 0 && kpi.roasTarget === 0) {
    return { conversion: "lead", conversions: "leads", cpa: "kosten per lead", volume: "Leadvolume" };
  }
  // Default: generic
  return { conversion: "conversie", conversions: "conversies", cpa: "kosten per conversie", volume: "Conversievolume" };
}

// ─── Types ───────────────────────────────────────────────────────────

interface DbInsight {
  id: string;
  title: string;
  description: string;
  severity: string;
  insight_type: string;
  affected_entity: string;
  affected_entity_type: string;
  metric: string;
  action_required: boolean;
}

interface DbRecommendation {
  id: string;
  insight_id: string | null;
  hypothesis: string;
  expected_result: string;
  measurement_metric: string;
  timeframe: string;
  ice_impact: number;
  ice_confidence: number;
  ice_ease: number;
  ice_total: number;
}

interface DbTask {
  id: string;
  title: string;
  description: string;
  action_type: string;
  affected_campaign: string | null;
  priority: string;
  frequency: string;
  status: string;
  due_date: string | null;
  recommendation_id: string | null;
}

// ─── Formatters ──────────────────────────────────────────────────────

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number, decimals = 0): string {
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}

function pct(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)}%`;
}

function dateLabel(): string {
  return new Date().toLocaleDateString("nl-NL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// ─── Business Logic ──────────────────────────────────────────────────

type TrajectStatus = "groen" | "oranje" | "rood";

interface TrajectInfo {
  status: TrajectStatus;
  summary: string;
  confidence: string;
}

function computeTrajectStatus(
  forecast: ClientForecast,
  health: HealthScore,
): TrajectInfo {
  const conv = forecast.conversions.kpi;
  const rev = forecast.revenue.kpi;
  const diffPct = conv.diffPct;
  const criticalAnomalies = health.anomalies.filter((a) => a.severity === "critical").length;
  const warningAnomalies = health.anomalies.filter((a) => a.severity === "warning").length;

  // Determine status
  let status: TrajectStatus;
  if (diffPct >= -3 && criticalAnomalies === 0) {
    status = "groen";
  } else if (diffPct >= -15 && criticalAnomalies <= 1) {
    status = "oranje";
  } else {
    status = "rood";
  }

  // Build summary in business language
  let summary: string;
  const mainMetric = conv.annualTarget > 0 ? "conversions" : "omzet";

  if (status === "groen") {
    if (diffPct > 5) {
      summary = `Het traject presteert boven verwachting. De prognose ligt ${Math.round(diffPct)}% boven het jaardoel.`;
    } else {
      summary = `Het traject ligt op schema richting het jaardoel. Geen directe actie nodig.`;
    }
  } else if (status === "oranje") {
    const behindBy = Math.abs(Math.round(diffPct));
    if (forecast.budgetRecommendation.behindTarget) {
      summary = `Groei blijft ${behindBy}% achter op doel. Met gerichte interventies is het jaardoel nog haalbaar.`;
    } else {
      summary = `Het traject wijkt licht af van het doel (${behindBy}%). Aandacht nodig om op koers te blijven.`;
    }
  } else {
    const behindBy = Math.abs(Math.round(diffPct));
    summary = `Het traject loopt significant achter (${behindBy}% onder doel). Zonder ingrijpen wordt het jaardoel niet gehaald.`;
  }

  // Confidence
  let confidence: string;
  if (health.total >= 70) {
    confidence = "Hoog vertrouwen in prognose";
  } else if (health.total >= 50) {
    confidence = "Gemiddeld vertrouwen — enkele risicofactoren";
  } else {
    confidence = "Laag vertrouwen — meerdere risicofactoren";
  }

  return { status, summary, confidence };
}

interface BusinessCause {
  title: string;
  explanation: string;
  impact: "hoog" | "middel" | "laag";
}

function computeBusinessCauses(
  forecast: ClientForecast,
  health: HealthScore,
  impressionShare?: ImpressionShareData[],
  wastefulTerms?: WastefulSearchTermData[],
  adGroupBleeders?: AdGroupBleederData[],
  dbInsights?: DbInsight[],
): BusinessCause[] {
  const causes: BusinessCause[] = [];

  // Use DB insights first if available (they're more specific)
  if (dbInsights && dbInsights.length > 0) {
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, positive: 4 };
    const sorted = [...dbInsights]
      .filter((i) => i.severity !== "positive")
      .sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

    for (const ins of sorted.slice(0, 3)) {
      const impact = ins.severity === "critical" ? "hoog" : ins.severity === "high" ? "hoog" : "middel";
      causes.push({
        title: translateInsightTitle(ins),
        explanation: translateInsightDescription(ins),
        impact,
      });
    }
    return causes;
  }

  // Fallback: derive from forecast + health data
  const budget = forecast.budgetRecommendation;
  const conv = forecast.conversions.kpi;
  const spend = forecast.adSpend.kpi;

  // Budget constraints
  if (impressionShare) {
    const budgetLimited = impressionShare.filter((is) => is.searchBudgetLostIS > 0.15);
    if (budgetLimited.length > 0) {
      const avgLost = budgetLimited.reduce((s, is) => s + is.searchBudgetLostIS, 0) / budgetLimited.length;
      causes.push({
        title: "Budget beperkt bereik en zichtbaarheid",
        explanation: `${budgetLimited.length} campagne(s) bereiken niet het volledige publiek doordat het dagbudget te laag is. Gemiddeld ${Math.round(avgLost * 100)}% van potentiële vertoningen wordt gemist.`,
        impact: "hoog",
      });
    }

    const rankLimited = impressionShare.filter((is) => is.searchRankLostIS > 0.20);
    if (rankLimited.length > 0 && causes.length < 3) {
      causes.push({
        title: "Concurrentie wint vaker de advertentiepositie",
        explanation: `${rankLimited.length} campagne(s) verliezen zichtbaarheid aan concurrenten door lagere advertentiekwaliteit of biedingen.`,
        impact: "middel",
      });
    }
  }

  // CPA trend
  const cpaPoints = forecast.cpa.points.filter((p) => p.realized !== null);
  if (cpaPoints.length >= 2 && causes.length < 3) {
    const firstCpa = cpaPoints[0].realized!;
    const lastCpa = cpaPoints[cpaPoints.length - 1].realized!;
    const cpaTrend = firstCpa > 0 ? ((lastCpa - firstCpa) / firstCpa) * 100 : 0;
    if (cpaTrend > 15) {
      causes.push({
        title: "Kosten per conversie stijgen",
        explanation: `De kosten per conversie zijn ${Math.round(cpaTrend)}% gestegen (van ${fmt(firstCpa)} naar ${fmt(lastCpa)}). Elke conversie kost meer budget.`,
        impact: cpaTrend > 25 ? "hoog" : "middel",
      });
    }
  }

  // Wasted spend
  if (wastefulTerms && wastefulTerms.length > 0 && causes.length < 3) {
    const totalWaste = wastefulTerms.reduce((s, t) => s + t.cost, 0);
    if (totalWaste > 100) {
      causes.push({
        title: "Budget gaat deels naar zoekopdrachten zonder resultaat",
        explanation: `${fmt(totalWaste)} is in de afgelopen 30 dagen besteed aan zoektermen die geen conversies opleveren.`,
        impact: totalWaste > 500 ? "hoog" : "middel",
      });
    }
  }

  // Budget underdelivery
  if (budget.behindTarget && spend.diffPct < -10 && causes.length < 3) {
    causes.push({
      title: "Advertentiebudget wordt niet volledig ingezet",
      explanation: `Het werkelijke mediabudget ligt ${Math.abs(Math.round(spend.diffPct))}% onder het geplande budget. Hierdoor worden minder mensen bereikt.`,
      impact: "hoog",
    });
  }

  // Ad group bleeders
  if (adGroupBleeders && adGroupBleeders.length > 0 && causes.length < 3) {
    const totalBleeder = adGroupBleeders.reduce((s, b) => s + b.cost, 0);
    if (totalBleeder > 100) {
      causes.push({
        title: "Onderdelen van campagnes presteren ondermaats",
        explanation: `${fmt(totalBleeder)} gaat naar advertentiegroepen die geen conversies opleveren. Dit budget kan beter ingezet worden.`,
        impact: "middel",
      });
    }
  }

  // Conversion rate issues
  const convPf = conv.projectionFactor;
  const spendPf = spend.projectionFactor;
  if (spendPf > 0.9 && convPf < 0.85 && causes.length < 3) {
    causes.push({
      title: "Bezoekers converteren minder vaak dan verwacht",
      explanation: `Het budget wordt goed besteed, maar het percentage bezoekers dat daadwerkelijk converteert is lager dan verwacht.`,
      impact: "middel",
    });
  }

  return causes.slice(0, 3);
}

function translateInsightTitle(ins: DbInsight): string {
  // Translate technical titles to business language
  const metric = ins.metric?.toLowerCase() ?? "";
  const severity = ins.severity;

  if (metric.includes("budget") || ins.title.toLowerCase().includes("budget")) {
    if (ins.title.toLowerCase().includes("-")) return "Budgetverlaging remt groei";
    return "Budgetrestricties beperken bereik";
  }
  if (metric.includes("cost") || metric.includes("kosten") || metric.includes("spend")) {
    return severity === "positive" ? "Kostendaling verbetert efficiency" : "Kostenstijging drukt rendement";
  }
  if (metric.includes("conv") || metric.includes("lead")) {
    return severity === "positive" ? "Conversievolume groeit" : "Conversievolume onder druk";
  }
  if (metric.includes("roas") || metric.includes("revenue") || metric.includes("omzet")) {
    return severity === "positive" ? "Rendement op advertenties verbetert" : "Rendement op advertenties daalt";
  }
  if (metric.includes("ctr")) {
    return severity === "positive" ? "Advertenties trekken meer aandacht" : "Advertenties presteren ondermaats";
  }
  if (metric.includes("cvr") || metric.includes("conversion_rate")) {
    return "Conversieratio wijkt af van verwachting";
  }
  if (ins.title.toLowerCase().includes("wasteful") || ins.title.toLowerCase().includes("waste")) {
    return "Budget gaat naar irrelevante zoekopdrachten";
  }

  // Default: use original but clean up
  return ins.title;
}

function translateInsightDescription(ins: DbInsight): string {
  // Use the existing description but clean up jargon if needed
  let desc = ins.description;
  desc = desc.replace(/Search Lost IS \(Budget\)/gi, "verloren zichtbaarheid door budget");
  desc = desc.replace(/Search Lost IS \(Rank\)/gi, "verloren zichtbaarheid door concurrentie");
  desc = desc.replace(/\bCVR\b/g, "conversieratio");
  desc = desc.replace(/\bCTR\b/g, "klikratio");
  desc = desc.replace(/\bCPC\b/g, "kosten per klik");
  desc = desc.replace(/\bCPA\b/g, "kosten per conversie");
  desc = desc.replace(/\bROAS\b/g, "rendement op advertentiebudget");
  return desc;
}

interface BusinessImpactStatement {
  text: string;
  type: "neutral" | "positive" | "warning" | "critical";
}

function computeBusinessImpact(forecast: ClientForecast): BusinessImpactStatement[] {
  const statements: BusinessImpactStatement[] = [];
  const conv = forecast.conversions.kpi;
  const rev = forecast.revenue.kpi;
  const spend = forecast.adSpend.kpi;
  const budget = forecast.budgetRecommendation;

  // Goal attainment
  if (conv.annualTarget > 0) {
    const ratio = conv.adjustedAnnual / conv.annualTarget;
    if (ratio >= 1.05) {
      statements.push({
        text: `Het traject ligt voor op het jaardoel. Bij ongewijzigd beleid wordt het doel ruim gehaald.`,
        type: "positive",
      });
    } else if (ratio >= 0.95) {
      statements.push({
        text: `Het traject ligt op koers richting het jaardoel van ${num(conv.annualTarget)} conversies.`,
        type: "neutral",
      });
    } else if (ratio >= 0.85) {
      statements.push({
        text: `Bij de huidige aanpak wordt het jaardoel waarschijnlijk net niet gehaald (prognose: ${num(conv.adjustedAnnual)} van ${num(conv.annualTarget)}).`,
        type: "warning",
      });
    } else {
      statements.push({
        text: `Zonder ingrijpen wordt het jaardoel niet gehaald. Prognose: ${num(conv.adjustedAnnual)} conversies, doel: ${num(conv.annualTarget)}.`,
        type: "critical",
      });
    }
  }

  // Bottleneck identification
  const convBehind = conv.diffPct < -5;
  const spendBehind = spend.diffPct < -5;
  const cpaTrending = forecast.cpa.points.filter((p) => p.realized !== null);

  if (convBehind && !spendBehind) {
    statements.push({
      text: "De grootste bottleneck zit in efficiency, niet in budget. Het budget wordt besteed maar levert minder conversies op dan verwacht.",
      type: "warning",
    });
  } else if (convBehind && spendBehind) {
    statements.push({
      text: "De achterstand wordt veroorzaakt door zowel een lager budget als lagere resultaten per euro.",
      type: "warning",
    });
  } else if (!convBehind && spendBehind) {
    statements.push({
      text: "Het budget wordt niet volledig ingezet, maar per bestede euro zijn de resultaten goed. Er ligt groeipotentieel.",
      type: "neutral",
    });
  }

  // Revenue impact
  if (rev.annualTarget > 0 && rev.diffPct < -10) {
    statements.push({
      text: `De verwachte omzet (${fmt(rev.adjustedAnnual)}) ligt ${Math.abs(Math.round(rev.diffPct))}% onder het jaardoel van ${fmt(rev.annualTarget)}.`,
      type: "warning",
    });
  } else if (rev.annualTarget > 0 && rev.diffPct > 5) {
    statements.push({
      text: `De verwachte omzet (${fmt(rev.adjustedAnnual)}) ligt boven het jaardoel van ${fmt(rev.annualTarget)}.`,
      type: "positive",
    });
  }

  // Budget recommendation summary
  if (budget.behindTarget && budget.spendIncreasePct > 5) {
    statements.push({
      text: `Met een budgetverhoging van ${Math.round(budget.spendIncreasePct)}% (naar ${fmt(budget.requiredMonthlySpend)}/maand) kan het conversiedoel waarschijnlijk alsnog gehaald worden.`,
      type: "neutral",
    });
  }

  return statements.slice(0, 4);
}

interface DecisionItem {
  decision: string;
  reason: string;
  urgency: "hoog" | "middel" | "laag";
  expectedEffect: string;
}

function computeDecisions(
  forecast: ClientForecast,
  health: HealthScore,
  dbRecs?: DbRecommendation[],
  dbTasks?: DbTask[],
  impressionShare?: ImpressionShareData[],
): DecisionItem[] {
  const decisions: DecisionItem[] = [];
  const budget = forecast.budgetRecommendation;
  const conv = forecast.conversions.kpi;

  // Check budget utilization: are campaigns actually spending their budgets?
  const isData = impressionShare ?? [];
  const lowUtilCampaigns = isData.filter((c) => c.dailyBudget > 0 && (c.cost / 30) < c.dailyBudget * 0.5);
  const avgUtilization = isData.length > 0
    ? isData.reduce((s, c) => s + (c.dailyBudget > 0 ? Math.min((c.cost / 30) / c.dailyBudget, 1) : 1), 0) / isData.length
    : 1;
  const budgetUnderutilized = avgUtilization < 0.6;

  // Budget decision — context-aware
  if (budget.behindTarget && budget.spendIncreasePct > 5) {
    if (budgetUnderutilized) {
      // Budget is NOT the problem — campaigns aren't spending what they have
      decisions.push({
        decision: `Bestedingscapaciteit verhogen (budget wordt niet opgemaakt)`,
        reason: `Het huidige budget wordt gemiddeld voor ${Math.round(avgUtilization * 100)}% benut. ${lowUtilCampaigns.length} campagne(s) besteden minder dan de helft van hun dagbudget. Meer budget toewijzen lost het probleem niet op — het volume moet omhoog.`,
        urgency: "hoog",
        expectedEffect: `Plan nodig: zoekwoorden verbreden, targeting uitbreiden, nieuwe campagnetypes (Shopping/PMax/Display), of biedingen verhogen om meer vertoningen te pakken.`,
      });
    } else {
      decisions.push({
        decision: `Budget verhogen met ${Math.round(budget.spendIncreasePct)}%`,
        reason: `Huidige budget is ontoereikend om het jaardoel te halen. Er is extra mediabudget nodig van ${fmt(budget.extraSpendNeeded)} verdeeld over de resterende maanden. Het budget wordt goed benut (${Math.round(avgUtilization * 100)}%).`,
        urgency: budget.spendIncreasePct > 20 ? "hoog" : "middel",
        expectedEffect: `Naar verwachting ${num(budget.conversionGap)} extra conversies bij huidige CPA van ${fmt(budget.currentCpa)}.`,
      });
    }
  }

  // Tasks waiting for approval
  if (dbTasks) {
    const waitingTasks = dbTasks.filter((t) =>
      t.status === "waiting" || t.status === "wachten_op_akkoord"
    );
    for (const task of waitingTasks.slice(0, 2)) {
      decisions.push({
        decision: task.title,
        reason: task.description,
        urgency: task.priority === "critical" || task.priority === "high" ? "hoog" : "middel",
        expectedEffect: "Zie aanbeveling voor verwachte impact.",
      });
    }
  }

  // High-impact recommendations that need a decision
  if (dbRecs && dbRecs.length > 0) {
    const highImpact = dbRecs
      .filter((r) => r.ice_impact >= 8 && r.ice_total >= 8)
      .slice(0, 3);

    for (const rec of highImpact) {
      // Don't duplicate budget decisions
      if (rec.hypothesis.toLowerCase().includes("budget") && decisions.some((d) => d.decision.toLowerCase().includes("budget"))) continue;
      if (decisions.length >= 4) break;

      decisions.push({
        decision: shortenHypothesis(rec.hypothesis),
        reason: rec.expected_result,
        urgency: rec.ice_impact >= 9 ? "hoog" : "middel",
        expectedEffect: `Verwachte impact op ${rec.measurement_metric} binnen ${rec.timeframe}.`,
      });
    }
  }

  // Efficiency vs volume decision
  if (conv.diffPct < -10 && !decisions.some((d) => d.decision.toLowerCase().includes("budget"))) {
    const spendOk = forecast.adSpend.kpi.diffPct > -5;
    if (spendOk) {
      decisions.push({
        decision: "Kiezen tussen focus op volume of efficiency",
        reason: "Het budget wordt besteed maar de resultaten blijven achter. Er moet gekozen worden: meer budget voor volume of eerst de efficiency verbeteren.",
        urgency: "middel",
        expectedEffect: "Bepaalt de strategische richting voor de komende weken.",
      });
    }
  }

  return decisions.slice(0, 4);
}

function shortenHypothesis(h: string): string {
  // Shorten long hypotheses to a decision-style title
  if (h.length <= 60) return h;
  // Take first sentence or first 60 chars
  const firstSentence = h.split(/[.!]/)[0];
  if (firstSentence.length <= 80) return firstSentence;
  return firstSentence.slice(0, 57) + "...";
}

interface ActionItem {
  title: string;
  why: string;
  impact: "hoog" | "middel" | "laag";
  status: string;
  deadline?: string;
  metric?: string;
}

function computeActions(
  forecast: ClientForecast,
  dbRecs?: DbRecommendation[],
  dbTasks?: DbTask[],
): ActionItem[] {
  const actions: ActionItem[] = [];

  // Use DB tasks first
  if (dbTasks && dbTasks.length > 0) {
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...dbTasks]
      .filter((t) => t.status !== "completed" && t.status !== "afgerond")
      .sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99));

    for (const task of sorted.slice(0, 3)) {
      actions.push({
        title: task.title,
        why: task.description,
        impact: task.priority === "critical" || task.priority === "high" ? "hoog" : task.priority === "medium" ? "middel" : "laag",
        status: translateStatus(task.status),
        deadline: task.due_date ?? undefined,
      });
    }
  }

  // Fill with DB recommendations
  if (dbRecs && dbRecs.length > 0 && actions.length < 6) {
    const remaining = 6 - actions.length;
    for (const rec of dbRecs.slice(0, remaining)) {
      // Don't duplicate
      if (actions.some((a) => a.title === shortenHypothesis(rec.hypothesis))) continue;
      actions.push({
        title: shortenHypothesis(rec.hypothesis),
        why: rec.expected_result,
        impact: rec.ice_impact >= 8 ? "hoog" : rec.ice_impact >= 6 ? "middel" : "laag",
        status: "Aanbevolen",
        deadline: rec.timeframe,
        metric: rec.measurement_metric,
      });
    }
  }

  // Fallback: generate from forecast
  if (actions.length === 0) {
    const budget = forecast.budgetRecommendation;
    if (budget.behindTarget) {
      actions.push({
        title: "Budgetvoorstel voorbereiden",
        why: `Er is ${fmt(budget.extraSpendNeeded)} extra budget nodig om het jaardoel te halen.`,
        impact: "hoog",
        status: "Aanbevolen",
      });
    }
    if (forecast.conversions.kpi.diffPct < -10) {
      actions.push({
        title: "Campagne-performance evalueren",
        why: "Identificeer welke campagnes achterlopen en waar optimalisatie mogelijk is.",
        impact: "hoog",
        status: "Aanbevolen",
      });
    }
    if (forecast.cpa.points.filter((p) => p.realized !== null).length >= 2) {
      const cpaPoints = forecast.cpa.points.filter((p) => p.realized !== null);
      const lastCpa = cpaPoints[cpaPoints.length - 1].realized!;
      const firstCpa = cpaPoints[0].realized!;
      if (firstCpa > 0 && ((lastCpa - firstCpa) / firstCpa) * 100 > 10) {
        actions.push({
          title: "Kosten per conversie optimaliseren",
          why: "De kosten per conversie stijgen. Zoektermen opschonen en biedingen evalueren.",
          impact: "middel",
          status: "Aanbevolen",
        });
      }
    }
  }

  return actions.slice(0, 6);
}

function translateStatus(status: string): string {
  const map: Record<string, string> = {
    pending: "Gepland",
    in_progress: "Bezig",
    completed: "Afgerond",
    waiting: "Wachten op akkoord",
    wachten_op_akkoord: "Wachten op akkoord",
    direct: "Direct uitvoeren",
    todo: "Gepland",
  };
  return map[status] ?? status;
}

// ─── Sub-components ──────────────────────────────────────────────────

const statusConfig = {
  groen: {
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    badge: "bg-green-100 text-green-800",
    icon: <CheckCircle2 className="w-5 h-5 text-green-600" />,
    label: "Op koers",
  },
  oranje: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-800",
    icon: <AlertTriangle className="w-5 h-5 text-amber-600" />,
    label: "Aandacht nodig",
  },
  rood: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    badge: "bg-red-100 text-red-800",
    icon: <AlertCircle className="w-5 h-5 text-red-600" />,
    label: "Actie vereist",
  },
};

const impactColors = {
  hoog: "bg-red-100 text-red-700",
  middel: "bg-amber-100 text-amber-700",
  laag: "bg-blue-100 text-blue-700",
};

function KpiCard({
  label,
  realized,
  target,
  forecast: forecastVal,
  diffPct,
  format,
}: {
  label: string;
  realized: number;
  target: number;
  forecast: number;
  diffPct: number;
  format: "currency" | "number" | "currency2";
}) {
  const fmtVal = format === "number" ? num : fmt;
  const isGood = diffPct >= -3;
  const isWarning = diffPct < -3 && diffPct >= -15;
  const isBad = diffPct < -15;

  const statusColor = isGood ? "text-green-600" : isWarning ? "text-amber-600" : "text-red-600";
  const statusBg = isGood ? "bg-green-50" : isWarning ? "bg-amber-50" : "bg-red-50";
  const barPct = target > 0 ? Math.min((realized / target) * 100, 100) : 0;
  const barColor = isGood ? "bg-green-500" : isWarning ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
      <p className="text-xs text-muted-foreground font-medium mb-2">{label}</p>
      <p className="text-2xl font-bold text-rm-gray">{fmtVal(realized)}</p>
      <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${barPct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-muted-foreground">Doel: {fmtVal(target)}</span>
        <span className={`text-[10px] font-semibold ${statusColor}`}>
          Prognose: {fmtVal(forecastVal)} ({pct(diffPct)})
        </span>
      </div>
    </div>
  );
}

function ForecastBar({
  label,
  realized,
  target,
  forecast: forecastVal,
}: {
  label: string;
  realized: number;
  target: number;
  forecast: number;
}) {
  const realizedPct = target > 0 ? Math.min((realized / target) * 100, 100) : 0;
  const forecastPct = target > 0 ? Math.min((forecastVal / target) * 100, 120) : 0;
  const diff = forecastVal - target;
  const diffPctVal = target > 0 ? (diff / target) * 100 : 0;
  const isOnTarget = diffPctVal >= -3;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-rm-gray">{label}</span>
        <span className={`text-xs font-semibold ${isOnTarget ? "text-green-600" : "text-amber-600"}`}>
          {pct(diffPctVal)} vs doel
        </span>
      </div>
      <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden">
        {/* Forecast bar (lighter) */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${isOnTarget ? "bg-green-200" : "bg-amber-200"}`}
          style={{ width: `${Math.min(forecastPct, 100)}%` }}
        />
        {/* Realized bar (solid) */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${isOnTarget ? "bg-green-500" : "bg-amber-500"}`}
          style={{ width: `${realizedPct}%` }}
        />
        {/* Target marker */}
        {target > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-rm-gray/40"
            style={{ left: `${Math.min(100, (target / Math.max(target, forecastVal) * 100))}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Gerealiseerd: {num(realized)}</span>
        <span>Prognose: {num(forecastVal)}</span>
        <span>Doel: {num(target)}</span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export function DgmView({ clientId }: { clientId: string }) {
  const data = useClientHistoricalData(clientId);
  const dataState = useClientDataState();
  const forecast = useMemo(() => computeForecast(data), [data]);
  const settings = getClientSettings(clientId);
  const vocab = getVocab(settings);

  const health = useMemo(() => computeHealthScore(
    forecast,
    dataState?.impressionShare,
    dataState?.wastefulSearchTerms,
    dataState?.adGroupBleeders,
  ), [forecast, dataState]);

  // Fetch DB data
  const [dbInsights, setDbInsights] = useState<DbInsight[]>([]);
  const [dbRecs, setDbRecs] = useState<DbRecommendation[]>([]);
  const [dbTasks, setDbTasks] = useState<DbTask[]>([]);
  const [sprintItems, setSprintItems] = useState<{ id: string; task: string; status: string; owner: string; hypothesis_id: string | null; week_number: number | null }[]>([]);
  const [sprintHypotheses, setSprintHypotheses] = useState<{ id: string; hypothesis: string; status: string; ice_total: number; timeframe: string | null }[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("sop_insights")
      .select("id, title, description, severity, insight_type, affected_entity, affected_entity_type, metric, action_required")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data: rows }) => setDbInsights((rows ?? []) as DbInsight[]));

    supabase
      .from("sop_recommendations")
      .select("id, insight_id, hypothesis, expected_result, measurement_metric, timeframe, ice_impact, ice_confidence, ice_ease, ice_total")
      .eq("client_id", clientId)
      .order("ice_total", { ascending: false })
      .limit(20)
      .then(({ data: rows }) => setDbRecs((rows ?? []) as DbRecommendation[]));

    supabase
      .from("sop_tasks")
      .select("id, title, description, action_type, affected_campaign, priority, frequency, status, due_date, recommendation_id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data: rows }) => setDbTasks((rows ?? []) as DbTask[]));

    supabase
      .from("sprint_items")
      .select("id, task, status, owner, hypothesis_id, week_number")
      .eq("client_id", clientId)
      .then(({ data: rows }) => setSprintItems((rows ?? []) as typeof sprintItems));

    supabase
      .from("sprint_hypotheses")
      .select("id, hypothesis, status, ice_total, timeframe")
      .eq("client_id", clientId)
      .in("status", ["accepted", "pending", "completed"])
      .then(({ data: rows }) => setSprintHypotheses((rows ?? []) as typeof sprintHypotheses));
  }, [clientId]);

  const traject = computeTrajectStatus(forecast, health);
  const sc = statusConfig[traject.status];
  const conv = forecast.conversions.kpi;
  const rev = forecast.revenue.kpi;
  const spend = forecast.adSpend.kpi;
  const cpa = forecast.cpa.kpi;
  const roas = forecast.roas.kpi;

  const businessImpact = computeBusinessImpact(forecast);
  const causes = computeBusinessCauses(
    forecast, health,
    dataState?.impressionShare,
    dataState?.wastefulSearchTerms,
    dataState?.adGroupBleeders,
    dbInsights,
  );
  const actions = computeActions(forecast, dbRecs, dbTasks);
  const decisions = computeDecisions(forecast, health, dbRecs, dbTasks, dataState?.impressionShare);

  const [detailsExpanded, setDetailsExpanded] = useState(false);

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ─── 1. Executive Snapshot ─── */}
      <div className={`rounded-xl border-2 ${sc.border} ${sc.bg} p-5`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {sc.icon}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${sc.badge}`}>
                  {sc.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Health score: {health.total}/100 ({health.grade})
                </span>
              </div>
              <p className={`text-base font-medium ${sc.text}`}>{traject.summary}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Stand per {dateLabel()} · {traject.confidence}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 2. KPI Cards ─── */}
      <div>
        <h2 className="text-sm font-semibold text-rm-blue uppercase tracking-wide mb-3">
          Voortgang trajectdoelen
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {conv.annualTarget > 0 && (
            <KpiCard
              label={vocab.conversions.charAt(0).toUpperCase() + vocab.conversions.slice(1)}
              realized={conv.ytdRealized}
              target={conv.annualTarget}
              forecast={conv.adjustedAnnual}
              diffPct={conv.diffPct}
              format="number"
            />
          )}
          {rev.annualTarget > 0 && (
            <KpiCard
              label="Omzet"
              realized={rev.ytdRealized}
              target={rev.annualTarget}
              forecast={rev.adjustedAnnual}
              diffPct={rev.diffPct}
              format="currency"
            />
          )}
          {cpa.annualTarget > 0 && (
            <KpiCard
              label={vocab.cpa.charAt(0).toUpperCase() + vocab.cpa.slice(1)}
              realized={cpa.ytdRealized > 0 ? spend.ytdRealized / conv.ytdRealized : 0}
              target={settings.kpiTargets.cpaTarget}
              forecast={conv.adjustedAnnual > 0 ? spend.adjustedAnnual / conv.adjustedAnnual : 0}
              diffPct={cpa.diffPct}
              format="currency"
            />
          )}
          {spend.annualTarget > 0 && (
            <KpiCard
              label="Advertentiebudget gebruikt"
              realized={spend.ytdRealized}
              target={spend.annualTarget}
              forecast={spend.adjustedAnnual}
              diffPct={spend.diffPct}
              format="currency"
            />
          )}
          {roas.annualTarget > 0 && settings.kpiTargets.roasTarget > 0 && (
            <KpiCard
              label="Rendement op advertentiebudget"
              realized={spend.ytdRealized > 0 ? rev.ytdRealized / spend.ytdRealized : 0}
              target={settings.kpiTargets.roasTarget}
              forecast={spend.adjustedAnnual > 0 ? rev.adjustedAnnual / spend.adjustedAnnual : 0}
              diffPct={roas.diffPct}
              format="number"
            />
          )}
        </div>
      </div>

      {/* ─── 3. Wat betekent dit? ─── */}
      {businessImpact.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-rm-blue uppercase tracking-wide mb-3">
            Wat betekent dit voor het traject?
          </h2>
          <div className="space-y-2.5">
            {businessImpact.map((item, i) => {
              const iconMap = {
                positive: <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />,
                neutral: <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />,
                warning: <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />,
                critical: <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />,
              };
              return (
                <div key={i} className="flex gap-2.5">
                  {iconMap[item.type]}
                  <p className="text-sm text-rm-gray leading-relaxed">{item.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── 4. Waarom gebeurt dit? ─── */}
      {causes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-rm-blue uppercase tracking-wide mb-3">
            Belangrijkste oorzaken
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {causes.map((cause, i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${impactColors[cause.impact]}`}>
                    Impact: {cause.impact}
                  </span>
                </div>
                <p className="text-sm font-medium text-rm-gray mb-1">{cause.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{cause.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 5. Lopende acties ─── */}
      {actions.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-rm-blue uppercase tracking-wide mb-3">
            Lopende acties en aanbevelingen
          </h2>
          <div className="space-y-3">
            {actions.map((action, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="mt-0.5 shrink-0">
                  {action.status === "Bezig" ? (
                    <Activity className="w-4 h-4 text-blue-500" />
                  ) : action.status === "Wachten op akkoord" ? (
                    <Clock className="w-4 h-4 text-amber-500" />
                  ) : action.status === "Afgerond" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <CircleDot className="w-4 h-4 text-rm-blue" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium text-rm-gray">{action.title}</p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{action.why}</p>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${impactColors[action.impact]}`}>
                      Impact: {action.impact}
                    </span>
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                      {action.status}
                    </span>
                    {action.deadline && (
                      <span className="text-[9px] text-muted-foreground px-1.5 py-0.5 rounded bg-gray-100">
                        {action.deadline}
                      </span>
                    )}
                    {action.metric && (
                      <span className="text-[9px] text-muted-foreground px-1.5 py-0.5 rounded bg-gray-100">
                        Metric: {action.metric}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 5b. Sprint Status ─── */}
      {(() => {
        const total = sprintItems.length;
        if (total === 0) return null;

        const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

        const done = sprintItems.filter((i) => i.status === "done").length;
        const expired = sprintItems.filter((i) => i.status === "expired").length;
        const backlog = sprintItems.filter((i) => i.status === "backlog").length;
        const todo = sprintItems.filter((i) => i.status === "todo").length;
        const inPlanning = sprintItems.filter((i) => i.status === "in_planning").length;
        const ongoing = sprintItems.filter((i) => i.status === "ongoing").length;
        const active = todo + inPlanning + ongoing;

        const isRm = (owner: string) => owner === "Ranking Masters" || owner === "RM";
        const isClient = (owner: string) => !isRm(owner);

        const clientOpen = sprintItems.filter((i) => isClient(i.owner) && !["done", "expired"].includes(i.status)).length;
        const rmOpen = sprintItems.filter((i) => isRm(i.owner) && !["done", "expired"].includes(i.status)).length;

        // Overdue: has a week number, that week has passed, and not done/expired
        const overdue = sprintItems.filter((i) => i.week_number && i.week_number < currentWeek && !["done", "expired"].includes(i.status)).length;

        const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
        const pendingHyps = sprintHypotheses.filter((h) => h.status === "pending").length;
        const acceptedHyps = sprintHypotheses.filter((h) => h.status === "accepted").length;

        // Weeks range in the planning
        const weeks = sprintItems.filter((i) => i.week_number).map((i) => i.week_number!);
        const minWeek = weeks.length > 0 ? Math.min(...weeks) : null;
        const maxWeek = weeks.length > 0 ? Math.max(...weeks) : null;

        // Status determination
        let sprintStatus: "on_track" | "at_risk" | "behind" = "on_track";
        if (overdue > 3 || expired > total * 0.4) {
          sprintStatus = "behind";
        } else if (overdue > 0 || clientOpen > 3 || expired > total * 0.2) {
          sprintStatus = "at_risk";
        }

        const statusStyles = {
          on_track: { bg: "bg-emerald-50", border: "border-emerald-200", bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", label: "Op schema" },
          at_risk: { bg: "bg-amber-50", border: "border-amber-200", bar: "bg-amber-500", badge: "bg-amber-100 text-amber-700", label: "Aandacht nodig" },
          behind: { bg: "bg-red-50", border: "border-red-200", bar: "bg-red-500", badge: "bg-red-100 text-red-700", label: "Achterstand" },
        };
        const ss = statusStyles[sprintStatus];

        return (
          <div className={`rounded-xl border ${ss.border} ${ss.bg} p-5 shadow-sm`}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">
                Sprintplanning Status
              </h2>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${ss.badge}`}>
                {ss.label}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-4">
              Week {currentWeek} · Gehele planning{minWeek && maxWeek ? ` (week ${minWeek} t/m ${maxWeek})` : ""} · {acceptedHyps} actieve hypotheses
            </p>

            {/* Progress bar - segmented */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-rm-gray font-medium">{progressPct}% voltooid</span>
                <span className="text-[10px] text-muted-foreground">{done} klaar · {active} actief · {expired} verlopen · {backlog} backlog</span>
              </div>
              <div className="w-full h-3 bg-white rounded-full border border-gray-200 overflow-hidden flex">
                {done > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(done / total) * 100}%` }} />}
                {ongoing > 0 && <div className="h-full bg-blue-500" style={{ width: `${(ongoing / total) * 100}%` }} />}
                {inPlanning > 0 && <div className="h-full bg-yellow-400" style={{ width: `${(inPlanning / total) * 100}%` }} />}
                {todo > 0 && <div className="h-full bg-blue-200" style={{ width: `${(todo / total) * 100}%` }} />}
                {expired > 0 && <div className="h-full bg-red-300" style={{ width: `${(expired / total) * 100}%` }} />}
                {backlog > 0 && <div className="h-full bg-gray-300" style={{ width: `${(backlog / total) * 100}%` }} />}
              </div>
              <div className="flex gap-3 mt-1.5 text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Klaar ({done})</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Bezig ({ongoing})</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" />Planning ({inPlanning})</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-200" />To Do ({todo})</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-300" />Verlopen ({expired})</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" />Backlog ({backlog})</span>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <div className="bg-white rounded-lg border border-gray-100 p-3 text-center">
                <p className="text-lg font-bold text-rm-blue">{active}</p>
                <p className="text-[10px] text-muted-foreground">Actief</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-100 p-3 text-center">
                <p className={`text-lg font-bold ${clientOpen > 2 ? "text-amber-600" : "text-rm-gray"}`}>{clientOpen}</p>
                <p className="text-[10px] text-muted-foreground">Open klant</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-100 p-3 text-center">
                <p className="text-lg font-bold text-rm-gray">{rmOpen}</p>
                <p className="text-[10px] text-muted-foreground">Open RM</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-100 p-3 text-center">
                <p className={`text-lg font-bold ${overdue > 0 ? "text-red-600" : "text-emerald-600"}`}>{overdue}</p>
                <p className="text-[10px] text-muted-foreground">Over deadline</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-100 p-3 text-center">
                <p className={`text-lg font-bold ${expired > 0 ? "text-red-400" : "text-emerald-600"}`}>{expired}</p>
                <p className="text-[10px] text-muted-foreground">Verlopen</p>
              </div>
            </div>

            {/* Warnings */}
            {(overdue > 0 || clientOpen > 2 || pendingHyps > 0 || expired > 0) && (
              <div className="space-y-2">
                {expired > 0 && (
                  <div className="flex items-center gap-2 text-xs text-red-500">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span><strong>{expired} taken zijn verlopen</strong> (week voorbij zonder afronding). {expired > total * 0.3 ? "Dit is een significant deel van de planning — er is structurele vertraging." : "Evalueer of deze nog relevant zijn of opnieuw ingepland moeten worden."}</span>
                  </div>
                )}
                {overdue > 0 && (
                  <div className="flex items-center gap-2 text-xs text-red-600">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{overdue} taken zijn over hun geplande week maar nog niet verlopen — direct actie nodig.</span>
                  </div>
                )}
                {clientOpen > 2 && (
                  <div className="flex items-center gap-2 text-xs text-amber-600">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>{clientOpen} taken wachten op de klant. Zonder deze input kan RM niet verder met afhankelijke taken.</span>
                  </div>
                )}
                {pendingHyps > 0 && (
                  <div className="flex items-center gap-2 text-xs text-purple-600">
                    <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                    <span>{pendingHyps} hypothese{pendingHyps !== 1 ? "s" : ""} wacht{pendingHyps === 1 ? "" : "en"} op goedkeuring in het Inzichten-tab.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ─── 6. Forecast vs Doel ─── */}
      <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-rm-blue uppercase tracking-wide mb-4">
          Prognose vs jaardoel
        </h2>
        <div className="space-y-5">
          {conv.annualTarget > 0 && (
            <ForecastBar
              label={vocab.conversions.charAt(0).toUpperCase() + vocab.conversions.slice(1)}
              realized={conv.ytdRealized}
              target={conv.annualTarget}
              forecast={conv.adjustedAnnual}
            />
          )}
          {rev.annualTarget > 0 && (
            <ForecastBar
              label="Omzet"
              realized={rev.ytdRealized}
              target={rev.annualTarget}
              forecast={rev.adjustedAnnual}
            />
          )}
          {spend.annualTarget > 0 && (
            <ForecastBar
              label="Advertentiebudget"
              realized={spend.ytdRealized}
              target={spend.annualTarget}
              forecast={spend.adjustedAnnual}
            />
          )}
        </div>

        {/* Scenario text */}
        {forecast.budgetRecommendation.behindTarget && conv.annualTarget > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <p className="text-xs text-blue-800 leading-relaxed">
              <strong>Scenario:</strong> Bij een budgetverhoging van {Math.round(forecast.budgetRecommendation.spendIncreasePct)}%
              (naar {fmt(forecast.budgetRecommendation.requiredMonthlySpend)}/maand) is het jaardoel
              van {num(conv.annualTarget)} {vocab.conversions} naar verwachting haalbaar.
              Zonder aanpassing is de verwachting {num(conv.adjustedAnnual)} {vocab.conversions} ({pct(conv.diffPct)} vs doel).
            </p>
          </div>
        )}
      </div>

      {/* ─── 7. Beslissingen nodig ─── */}
      {decisions.length > 0 && (
        <div className="bg-white rounded-xl border-2 border-amber-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-800 uppercase tracking-wide">
              Beslissingen nodig
            </h2>
          </div>
          <div className="space-y-3">
            {decisions.map((item, i) => (
              <div key={i} className="p-3 rounded-lg bg-amber-50/50 border border-amber-100">
                <div className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-rm-gray">{item.decision}</p>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${impactColors[item.urgency]}`}>
                        {item.urgency}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-1">{item.reason}</p>
                    <p className="text-xs text-amber-700">{item.expectedEffect}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 8. Specialistische verdieping (collapsed) ─── */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <button
          onClick={() => setDetailsExpanded(!detailsExpanded)}
          className="flex items-center justify-between w-full p-5 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              Bekijk specialistische onderbouwing
            </span>
          </div>
          {detailsExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {detailsExpanded && (
          <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
            {/* Health factors */}
            <div>
              <p className="text-xs font-semibold text-rm-gray mb-2">Health Score Factoren</p>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {health.factors.map((f) => (
                  <div key={f.name} className="text-center">
                    <p className="text-lg font-bold text-rm-gray">{f.score}/{f.maxScore}</p>
                    <p className="text-[10px] font-medium text-muted-foreground">{f.name}</p>
                    <p className="text-[9px] text-muted-foreground">{f.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Anomalies */}
            {health.anomalies.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-rm-gray mb-2">Anomalieën ({health.anomalies.length})</p>
                <div className="space-y-1.5">
                  {health.anomalies.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`shrink-0 text-[9px] font-bold uppercase px-1 py-0.5 rounded ${
                        a.severity === "critical" ? "bg-red-100 text-red-700" :
                        a.severity === "warning" ? "bg-amber-100 text-amber-700" :
                        "bg-blue-100 text-blue-700"
                      }`}>
                        {a.severity}
                      </span>
                      <span className="text-muted-foreground">
                        <strong>{a.title}:</strong> {a.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Monthly forecast detail */}
            <div>
              <p className="text-xs font-semibold text-rm-gray mb-2">Maandoverzicht {vocab.conversions.charAt(0).toUpperCase() + vocab.conversions.slice(1)}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 text-muted-foreground font-medium">Maand</th>
                      <th className="text-right py-1.5 text-muted-foreground font-medium">Verwacht</th>
                      <th className="text-right py-1.5 text-muted-foreground font-medium">Gerealiseerd</th>
                      <th className="text-right py-1.5 text-muted-foreground font-medium">Prognose</th>
                      <th className="text-right py-1.5 text-muted-foreground font-medium">Ratio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.conversions.points.map((p) => (
                      <tr key={p.month} className="border-b border-border/50">
                        <td className="py-1.5 font-medium text-rm-gray">{p.monthLabel}</td>
                        <td className="text-right text-muted-foreground">{num(p.expected)}</td>
                        <td className="text-right text-rm-gray">
                          {p.realized !== null ? num(p.realized) : "—"}
                        </td>
                        <td className="text-right text-muted-foreground">
                          {p.forecast !== null ? num(p.forecast) : "—"}
                        </td>
                        <td className={`text-right font-medium ${
                          p.monthRatio >= 1 ? "text-green-600" :
                          p.monthRatio >= 0.85 ? "text-amber-600" :
                          p.realized !== null ? "text-red-600" : "text-muted-foreground"
                        }`}>
                          {p.realized !== null ? `${Math.round(p.monthRatio * 100)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Impression Share summary */}
            {dataState?.impressionShare && dataState.impressionShare.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-rm-gray mb-2">Impression Share per Campagne</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1.5 text-muted-foreground font-medium">Campagne</th>
                        <th className="text-right py-1.5 text-muted-foreground font-medium">IS</th>
                        <th className="text-right py-1.5 text-muted-foreground font-medium">Lost (Budget)</th>
                        <th className="text-right py-1.5 text-muted-foreground font-medium">Lost (Rank)</th>
                        <th className="text-right py-1.5 text-muted-foreground font-medium">Kosten</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataState.impressionShare
                        .filter((is) => is.cost > 0)
                        .sort((a, b) => b.cost - a.cost)
                        .slice(0, 10)
                        .map((is) => (
                          <tr key={is.campaignId} className="border-b border-border/50">
                            <td className="py-1.5 font-medium text-rm-gray truncate max-w-[200px]">{is.campaignName}</td>
                            <td className="text-right text-muted-foreground">{Math.round(is.searchImpressionShare * 100)}%</td>
                            <td className={`text-right ${is.searchBudgetLostIS > 0.15 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                              {Math.round(is.searchBudgetLostIS * 100)}%
                            </td>
                            <td className={`text-right ${is.searchRankLostIS > 0.20 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                              {Math.round(is.searchRankLostIS * 100)}%
                            </td>
                            <td className="text-right text-muted-foreground">{fmt(is.cost)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Wasteful terms summary */}
            {dataState?.wastefulSearchTerms && dataState.wastefulSearchTerms.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-rm-gray mb-2">
                  Top verspilde zoektermen ({fmt(dataState.wastefulSearchTerms.reduce((s, t) => s + t.cost, 0))} totaal)
                </p>
                <div className="space-y-1">
                  {dataState.wastefulSearchTerms
                    .sort((a, b) => b.cost - a.cost)
                    .slice(0, 8)
                    .map((t, i) => (
                      <div key={i} className="flex justify-between text-xs py-1 border-b border-border/30">
                        <span className="text-muted-foreground truncate max-w-[300px]">{t.searchTerm}</span>
                        <span className="text-red-600 font-medium shrink-0 ml-2">{fmt(t.cost)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
