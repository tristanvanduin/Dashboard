"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, TrendingUp, TrendingDown, Info, DollarSign, Filter, X, ChevronDown, ChevronUp } from "lucide-react";
import { useClientHistoricalData, useClientDataState } from "@/lib/client-data-provider";
import { computeForecast, type ClientForecast } from "@/lib/forecast";
import { getClientSettings } from "@/lib/client-settings";
import { supabase } from "@/lib/supabase";
import type { ImpressionShareData, AccountStructureData, WastefulSearchTermData, AdGroupBleederData, ChangeHistoryData } from "@/lib/use-client-data";
import { channelOfSopType, type InsightChannel } from "@/lib/insights/channel-of";

type InsightType = "critical" | "warning" | "positive" | "info";

interface Insight {
  type: InsightType;
  level: string;
  text: string;
}

const icons: Record<InsightType, React.ReactNode> = {
  critical: <AlertTriangle className="w-4 h-4 text-red-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-rm-orange" />,
  positive: <TrendingUp className="w-4 h-4 text-green-500" />,
  info: <Info className="w-4 h-4 text-rm-blue" />,
};

const bgColors: Record<InsightType, string> = {
  critical: "bg-red-50 border-red-200",
  warning: "bg-orange-50 border-rm-orange/20",
  positive: "bg-green-50 border-green-200",
  info: "bg-blue-50 border-rm-blue/20",
};

const levelColors: Record<string, string> = {
  "Account": "bg-rm-blue/10 text-rm-blue",
  "Budget": "bg-amber-100 text-amber-700",
  "Campagne": "bg-purple-100 text-purple-700",
  "Trend": "bg-slate-100 text-slate-700",
  "KPI": "bg-amber-100 text-amber-700",
  "Efficiency": "bg-cyan-100 text-cyan-700",
  "Seizoen": "bg-cyan-100 text-cyan-700",
  "Actie": "bg-green-100 text-green-700",
};

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function pct(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)}%`;
}

interface ExtraData {
  impressionShare?: ImpressionShareData[];
  accountStructure?: AccountStructureData;
  wastefulSearchTerms?: WastefulSearchTermData[];
  adGroupBleeders?: AdGroupBleederData[];
  changeHistory?: ChangeHistoryData[];
}

function generateInsights(forecast: ClientForecast, clientId: string, extra: ExtraData): Insight[] {
  const { impressionShare, accountStructure, wastefulSearchTerms, adGroupBleeders, changeHistory } = extra;
  const insights: Insight[] = [];
  const settings = getClientSettings(clientId);
  const kpi = settings.kpiTargets;

  const convKpi = forecast.conversions.kpi;
  const revKpi = forecast.revenue.kpi;
  const spendKpi = forecast.adSpend.kpi;
  const roasKpi = forecast.roas.kpi;
  const cpaKpi = forecast.cpa.kpi;
  const budget = forecast.budgetRecommendation;

  const convDiff = convKpi.diffPct;
  const revDiff = revKpi.diffPct;
  const roasDiff = roasKpi.diffPct;
  const cpaDiff = cpaKpi.diffPct;
  const spendDiff = spendKpi.diffPct;

  // Realized ratios for trend
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null);
  const realizedRatios = realizedMonths.map((p) => p.monthRatio);

  // ── 0. Tracking Anomaly Detection ──
  // Check if conversion efficiency (conv/spend) has crashed vs historical pattern
  if (realizedMonths.length >= 2) {
    const convPoints = forecast.conversions.points;
    const spendPoints = forecast.adSpend.points;

    // Calculate efficiency per realized month
    const efficiencies: { month: string; eff: number; conv: number; spend: number }[] = [];
    for (let i = 0; i < convPoints.length; i++) {
      const c = convPoints[i];
      const s = spendPoints[i];
      if (c.realized !== null && s.realized !== null && s.realized > 0) {
        efficiencies.push({
          month: c.monthLabel,
          eff: c.realized / s.realized,
          conv: c.realized,
          spend: s.realized,
        });
      }
    }

    if (efficiencies.length >= 3) {
      // First half = "baseline", second half = "recent"
      const mid = Math.floor(efficiencies.length / 2);
      const baselineEff = efficiencies.slice(0, mid);
      const recentEff = efficiencies.slice(mid);

      const avgBaseline = baselineEff.reduce((s, e) => s + e.eff, 0) / baselineEff.length;
      const avgRecent = recentEff.reduce((s, e) => s + e.eff, 0) / recentEff.length;

      // If recent efficiency is <30% of baseline, flag tracking anomaly
      if (avgBaseline > 0 && avgRecent / avgBaseline < 0.3) {
        const dropPct = Math.round((1 - avgRecent / avgBaseline) * 100);
        const affectedMonths = recentEff.map((e) => e.month).join(", ");
        insights.push({
          type: "critical",
          level: "Account",
          text: `Mogelijke tracking anomalie: conversie-efficiëntie is ${dropPct}% gedaald in ${affectedMonths} t.o.v. eerdere maanden. Spend is relatief stabiel maar conversies zijn disproportioneel lager. Controleer de conversietracking voordat je performance-acties neemt. Stel eventueel conversie-overrides in bij Instellingen.`,
        });
      }
    }
  }

  // ── 1. Account Performance Overview ──

  const offTrack: string[] = [];
  const onTrack: string[] = [];

  if (convDiff < -5) offTrack.push(`Conversies (${pct(convDiff)} vs doel)`);
  else if (convDiff > 5) onTrack.push(`Conversies (${pct(convDiff)} vs doel)`);

  if (revDiff < -5) offTrack.push(`Omzet (${pct(revDiff)} vs doel)`);
  else if (revDiff > 5) onTrack.push(`Omzet (${pct(revDiff)} vs doel)`);

  if (roasDiff < -5) offTrack.push(`ROAS (${pct(roasDiff)} vs doel)`);
  else if (roasDiff > 5) onTrack.push(`ROAS (${pct(roasDiff)} vs doel)`);

  // CPA inverted: positive diffPct means CPA is ABOVE target = bad
  if (cpaDiff > 10) offTrack.push(`CPA (${pct(cpaDiff)} boven doel)`);
  else if (cpaDiff < -10) onTrack.push(`CPA (${pct(Math.abs(cpaDiff))} onder doel)`);

  if (offTrack.length > 0) {
    const severity: InsightType = offTrack.length >= 3 ? "critical" : "warning";
    insights.push({
      type: severity,
      level: "Account",
      text: `Performance ligt niet op schema. Prognose eindigt onder target voor: ${offTrack.join(", ")}. ${severity === "critical" ? "Directe actie vereist." : ""}`,
    });
  }

  if (onTrack.length > 0) {
    insights.push({
      type: "positive",
      level: "Account",
      text: `Performance boven doelstelling voor: ${onTrack.join(", ")}. Huidige strategie levert resultaat.`,
    });
  }

  if (offTrack.length === 0 && onTrack.length === 0) {
    insights.push({
      type: "info",
      level: "Account",
      text: "Alle KPI's liggen binnen 5% van de doelstellingen. Performance is stabiel.",
    });
  }

  // ── 2. Spend Analysis — is budget het probleem? ──

  if (spendDiff < -10) {
    const spendRatio = spendKpi.performanceRatio;
    const convRatio = convKpi.performanceRatio;

    // Efficiency = conversions per euro spent
    const efficiencyRatio = spendRatio > 0 ? convRatio / spendRatio : 1;

    insights.push({
      type: "warning",
      level: "Budget",
      text: `Ad spend ligt ${pct(spendDiff)} onder target. YTD ${fmt(spendKpi.ytdRealized)} uitgegeven vs ${fmt(spendKpi.ytdExpected)} verwacht.${
        efficiencyRatio > 0.9
          ? ` De efficiency per euro is goed (${Math.round(efficiencyRatio * 100)}%) — het budget is het probleem, niet de campagne-performance.`
          : ` Daarnaast is de efficiency per euro ook lager dan verwacht (${Math.round(efficiencyRatio * 100)}%) — zowel budget als campagne-performance moet aangepakt worden.`
      }`,
    });

    if (convDiff < -10 && efficiencyRatio > 0.85) {
      insights.push({
        type: "info",
        level: "Budget",
        text: `De achterstand op conversies (${pct(convDiff)}) wordt grotendeels verklaard door underspend (${pct(spendDiff)}). Als budget wordt opgeschaald naar plan, herstelt de prognose naar verwachting.`,
      });
    }
  } else if (spendDiff > 10) {
    insights.push({
      type: "warning",
      level: "Budget",
      text: `Ad spend ligt ${pct(spendDiff)} boven target. YTD ${fmt(spendKpi.ytdRealized)} uitgegeven vs ${fmt(spendKpi.ytdExpected)} verwacht. Check of de extra spend proportioneel meer conversies oplevert.`,
    });
  }

  // ── 3. Budget Recommendation ──

  if (budget.behindTarget && budget.extraSpendNeeded > 0) {
    const remainingMonths = 12 - realizedMonths.length;
    insights.push({
      type: "critical",
      level: "Budget",
      text: `Om het jaardoel te halen zijn nog ${budget.conversionGap.toLocaleString("nl-NL")} conversies nodig in ${remainingMonths} maanden. Bij huidige CPA van ${fmt(budget.currentCpa)} vereist dit ${fmt(budget.extraSpendNeeded)} extra budget — maandelijks ${fmt(budget.requiredMonthlySpend)} i.p.v. ${fmt(budget.currentMonthlySpend)} (${budget.spendIncreasePct > 0 ? `+${Math.round(budget.spendIncreasePct)}%` : "gelijk"}).`,
    });
  }

  // ── 4. KPI Chain Analysis ──

  if (convDiff < -10) {
    const worstMonthIdx = realizedRatios.indexOf(Math.min(...realizedRatios));
    const worstLabel = realizedMonths[worstMonthIdx]?.monthLabel ?? "?";
    const worstRatio = realizedRatios[worstMonthIdx] ?? 0;

    insights.push({
      type: "warning",
      level: "KPI",
      text: `Performance ratio van ${(convKpi.performanceRatio * 100).toFixed(1)}% verklaart het verschil van ${pct(convDiff)} met het conversiedoel. ${worstLabel} was de zwakste maand (ratio ${(worstRatio * 100).toFixed(1)}%). Werk terug in de KPI-keten: Conversieratio → Klikken → CPC → Impressies.`,
    });
  }

  // ── 5. CPA / Efficiency Analysis ──

  if (realizedMonths.length >= 2) {
    const cpaPoints = forecast.cpa.points.filter((p) => p.realized !== null);
    if (cpaPoints.length >= 2) {
      const firstCpa = cpaPoints[0].realized!;
      const lastCpa = cpaPoints[cpaPoints.length - 1].realized!;
      const cpaTrend = firstCpa > 0 ? ((lastCpa - firstCpa) / firstCpa) * 100 : 0;

      if (cpaTrend > 15) {
        insights.push({
          type: "warning",
          level: "Efficiency",
          text: `CPA stijgt: van ${fmt(firstCpa)} (${cpaPoints[0].monthLabel}) naar ${fmt(lastCpa)} (${cpaPoints[cpaPoints.length - 1].monthLabel}), een stijging van ${Math.round(cpaTrend)}%. Elke conversie wordt duurder. Analyseer: hogere CPC (meer concurrentie?) of lagere conversieratio (landingspagina/aanbod)?`,
        });
      } else if (cpaTrend < -15) {
        insights.push({
          type: "positive",
          level: "Efficiency",
          text: `CPA daalt: van ${fmt(firstCpa)} naar ${fmt(lastCpa)} (${Math.round(Math.abs(cpaTrend))}% daling). Efficiency verbetert — optimalisaties werken. ${convDiff < 0 ? "Overweeg budget te verhogen om het volume-tekort in te halen bij deze gunstige CPA." : ""}`,
        });
      }
    }
  }

  // ── 6. ROAS Analysis ──

  if (roasDiff < -20) {
    insights.push({
      type: "critical",
      level: "KPI",
      text: `ROAS prognose (${roasKpi.adjustedAnnual.toFixed(2)}x) ligt ${Math.round(Math.abs(roasDiff))}% onder target (${roasKpi.annualTarget.toFixed(2)}x). Check of dit door lagere conversiewaarde (AOV daling?) of hogere spend per conversie komt. Evalueer welke campagnes de meeste spend verbruiken met laagste ROAS.`,
    });
  }

  // ── 7. Trend Analysis (uses projectionFactor, not raw monthRatio) ──

  {
    const pf = convKpi.projectionFactor;
    const dm = forecast.dataMaturity;

    if (dm.isScaling && !dm.isMature) {
      // Scaling client: report on efficiency trend, not raw conversion trend
      const et = dm.efficiencyTrend;
      if (et < 0.85) {
        insights.push({
          type: "warning",
          level: "Trend",
          text: `Efficiency daalt ${Math.round((1 - et) * 100)}% terwijl het account opschaalt. Conversies per euro spend nemen af — de CPA stijgt bij hogere budgetten. Analyseer of dit komt door: (1) Verzadiging van de beste doelgroepen, (2) Lagere kwaliteit zoektermen bij breder bereik, (3) Hogere CPCs door meer concurrentie.`,
        });
      } else if (et > 1.05) {
        insights.push({
          type: "positive",
          level: "Trend",
          text: `Efficiency verbetert ${Math.round((et - 1) * 100)}% terwijl het account opschaalt. Conversies per euro spend nemen toe — een sterk signaal dat de schaling gezond is. Overweeg versneld opschalen.`,
        });
      } else {
        insights.push({
          type: "info",
          level: "Trend",
          text: `Account schaalt op met stabiele efficiency (${Math.round(et * 100)}% van vorige periode). De CPA blijft onder controle. Goed teken voor verdere groei.`,
        });
      }
    } else if (pf > 1.05) {
      insights.push({
        type: "positive",
        level: "Trend",
        text: `Opwaartse trend: gewogen prestatiefactor ${(pf * 100).toFixed(0)}%. Recente maanden presteren beter dan verwacht. ${convDiff < 0 ? "Trend is positief maar nog onvoldoende om het doel te halen. Versnelling nodig." : "Als trend aanhoudt, verbetert de jaarprognose."}`,
      });
    } else if (pf < 0.90) {
      insights.push({
        type: "warning",
        level: "Trend",
        text: `Neerwaartse trend: gewogen prestatiefactor ${(pf * 100).toFixed(0)}%. Recente maanden presteren onder verwachting. Zonder ingrijpen verslechtert de prognose verder. Check campagnewijzigingen, concurrentie, en marktomstandigheden.`,
      });
    }
  }

  // ── 8. MoM Performance Breakdown ──

  if (realizedMonths.length >= 2) {
    const monthBreakdown = realizedMonths.map((m) => {
      const status = m.monthRatio >= 1 ? "✓" : "✗";
      return `${m.monthLabel}: ${(m.monthRatio * 100).toFixed(0)}% ${status}`;
    }).join(" · ");

    insights.push({
      type: "info",
      level: "KPI",
      text: `Maand-voor-maand performance ratio: ${monthBreakdown}. Factor voor prognose: ${(convKpi.projectionFactor * 100).toFixed(1)}% (gewogen, recentste maanden zwaarder).`,
    });
  }

  // ── 9. Spend vs Performance Mismatch ──

  if (Math.abs(spendDiff) < 10 && convDiff < -20) {
    // Spend is on target but conversions way behind = efficiency problem
    insights.push({
      type: "critical",
      level: "Efficiency",
      text: `Budget is nagenoeg op schema (${pct(spendDiff)}) maar conversies liggen ${pct(convDiff)} achter. Dit wijst op een efficiency-probleem: de euro's worden uitgegeven maar leveren minder op. Urgente analyse nodig van: zoektermkwaliteit, conversieratio op landingspagina's, en doelgroep-targeting.`,
    });
  }

  if (spendDiff > 5 && convDiff < -10) {
    // Spending MORE but getting LESS
    insights.push({
      type: "critical",
      level: "Efficiency",
      text: `Meer uitgegeven dan verwacht (${pct(spendDiff)}) maar minder conversies (${pct(convDiff)}). Efficiency verslechtert snel. Directe actie: pauzeer underperforming campagnes, evalueer biedstrategieën, en controleer zoektermrapporten op irrelevant verkeer.`,
    });
  }

  // ── 10. Concrete Recovery Actions (when significantly behind) ──

  if (convDiff < -25) {
    insights.push({
      type: "info",
      level: "Actie",
      text: `Herstelplan nodig. Prioriteiten: (1) Evalueer per campagne welke het meest bijdraagt aan de achterstand, (2) Check Impression Share Lost — is er ruimte om meer vertoningen te pakken?, (3) Controleer conversieratio trend — is de landingspagina nog competitief?, (4) Analyseer zoektermrapporten op verspilling, (5) Overleg budget verhoging met de klant op basis van de CPA berekening hierboven.`,
    });
  }

  // ── 11. Seasonal Context ──

  const prevYearData = forecast.conversions.points;
  const q1Weight = prevYearData.slice(0, 3).reduce((s, p) => s + p.expected, 0);
  const q2Weight = prevYearData.slice(3, 6).reduce((s, p) => s + p.expected, 0);
  const q2VsQ1 = q1Weight > 0 ? ((q2Weight - q1Weight) / q1Weight) * 100 : 0;

  if (Math.abs(q2VsQ1) > 10) {
    insights.push({
      type: "info",
      level: "Seizoen",
      text: q2VsQ1 > 0
        ? `Seizoenseffect: Q2 is historisch ${Math.round(q2VsQ1)}% sterker dan Q1. ${convDiff < 0 ? "Dit kan helpen om de achterstand in te lopen als het budget meeschaalt." : "Houd hier rekening mee bij budgetallocatie."}`
        : `Seizoenseffect: Q2 is historisch ${Math.round(Math.abs(q2VsQ1))}% zwakker dan Q1. ${convDiff < 0 ? "Dit maakt herstel moeilijker — extra actie nodig." : "Pas verwachtingen aan."}`,
    });
  }

  // ── 12. Impression Share & Budget Expansion Analysis ──

  if (impressionShare && impressionShare.length > 0) {
    // Campaigns with high IS Lost (Budget) — direct growth opportunity
    const budgetLimited = impressionShare
      .filter((is) => is.searchBudgetLostIS > 0.15 && is.cost > 0)
      .sort((a, b) => b.searchBudgetLostIS - a.searchBudgetLostIS);

    if (budgetLimited.length > 0) {
      const topBudgetLimited = budgetLimited.slice(0, 3);
      const names = topBudgetLimited
        .map((is) => `"${is.campaignName}" (${Math.round(is.searchBudgetLostIS * 100)}% verloren)`)
        .join(", ");
      insights.push({
        type: budget.behindTarget ? "critical" : "warning",
        level: "Budget",
        text: `Impression Share Lost (Budget): ${budgetLimited.length} campagne${budgetLimited.length > 1 ? "s" : ""} verliezen vertoningen door budgetlimieten. Top: ${names}. Dit is direct groeipotentieel — verhoog het dagbudget op deze campagnes om meer verkeer te vangen.`,
      });
    }

    // Campaigns with high IS Lost (Rank) — Quality Score / bid issue
    const rankLimited = impressionShare
      .filter((is) => is.searchRankLostIS > 0.20 && is.cost > 0)
      .sort((a, b) => b.searchRankLostIS - a.searchRankLostIS);

    if (rankLimited.length > 0) {
      const topRankLimited = rankLimited.slice(0, 3);
      const names = topRankLimited
        .map((is) => `"${is.campaignName}" (${Math.round(is.searchRankLostIS * 100)}% verloren)`)
        .join(", ");
      insights.push({
        type: "warning",
        level: "KPI",
        text: `Impression Share Lost (Rank): ${rankLimited.length} campagne${rankLimited.length > 1 ? "s" : ""} verliezen vertoningen door lage Ad Rank. Top: ${names}. Oorzaken: lage Quality Score, te lage biedingen, of slechte advertentierelevantie. Dit is geen budgetprobleem maar een kwaliteitsprobleem.`,
      });
    }

    // Low budget utilization — budget is there but not being spent
    const underutilized = impressionShare
      .filter((is) => is.budgetUtilization < 0.60 && is.dailyBudget > 0)
      .sort((a, b) => a.budgetUtilization - b.budgetUtilization);

    if (underutilized.length > 0) {
      const topUnder = underutilized.slice(0, 3);
      const names = topUnder
        .map((is) => `"${is.campaignName}" (${Math.round(is.budgetUtilization * 100)}% benut)`)
        .join(", ");
      insights.push({
        type: "warning",
        level: "Budget",
        text: `Budget onderbenutting: ${underutilized.length} campagne${underutilized.length > 1 ? "s" : ""} besteden minder dan 60% van hun dagbudget. Top: ${names}. Mogelijke oorzaken: te restrictieve targeting, te lage biedingen, beperkt zoekvolume, of zoekwoorden dekking te smal.`,
      });
    }

    // Overall Impression Share health
    const totalIS = impressionShare.reduce((s, is) => s + is.searchImpressionShare * is.cost, 0);
    const totalCost = impressionShare.reduce((s, is) => s + is.cost, 0);
    const weightedIS = totalCost > 0 ? totalIS / totalCost : 0;

    if (weightedIS > 0 && weightedIS < 0.5) {
      insights.push({
        type: "info",
        level: "Budget",
        text: `Gewogen Search Impression Share is ${Math.round(weightedIS * 100)}% — je mist meer dan de helft van het beschikbare zoekverkeer. ${budget.behindTarget ? "Dit is een belangrijke factor in de achterstand op de doelstellingen." : "Er is significant groeipotentieel als budget en biedingen worden verhoogd."}`,
      });
    }
  }

  // ── 13. Account Structure Intelligence ──

  if (accountStructure) {
    const { campaigns: structCampaigns, detectedStrategy } = accountStructure;

    // Show detected strategy
    if (detectedStrategy.length > 0) {
      insights.push({
        type: "info",
        level: "Account",
        text: `Account structuur: ${detectedStrategy.join(" · ")}. ${structCampaigns.length} actieve campagnes.`,
      });
    }

    // Feed-only PMax insight
    const feedOnlyPmax = structCampaigns.filter((c) => c.type === "PERFORMANCE_MAX" && c.hasFeed && c.assetGroupCount <= 1);
    if (feedOnlyPmax.length > 0) {
      const names = feedOnlyPmax.map((c) => `"${c.name}"`).join(", ");
      insights.push({
        type: "info",
        level: "Campagne",
        text: `Feed-only PMax gedetecteerd: ${names}. Deze campagne${feedOnlyPmax.length > 1 ? "s draaien" : " draait"} puur op de productfeed zonder extra assets. Performance hangt direct af van feed-kwaliteit (titels, afbeeldingen, beschikbaarheid, prijs).`,
      });
    }

    // PMax with many asset groups but low conversions
    const underperformingPmax = structCampaigns.filter(
      (c) => c.type === "PERFORMANCE_MAX" && c.assetGroupCount > 2 && c.conversions30d < 5 && c.cost30d > 100
    );
    if (underperformingPmax.length > 0) {
      insights.push({
        type: "warning",
        level: "Campagne",
        text: `"${underperformingPmax[0].name}" heeft ${underperformingPmax[0].assetGroupCount} asset groups maar slechts ${Math.round(underperformingPmax[0].conversions30d)} conversies (30d) voor ${fmt(underperformingPmax[0].cost30d)} spend. Te veel asset groups versnipperen het budget. Consolideer naar 2-3 goed presterende asset groups.`,
      });
    }

    // Campaigns with 0 conversions but significant spend
    const zeroCampaigns = structCampaigns.filter((c) => c.conversions30d === 0 && c.cost30d > 50);
    if (zeroCampaigns.length > 0) {
      const totalWaste = zeroCampaigns.reduce((s, c) => s + c.cost30d, 0);
      insights.push({
        type: "warning",
        level: "Campagne",
        text: `${zeroCampaigns.length} campagne${zeroCampaigns.length > 1 ? "s" : ""} met 0 conversies in de laatste 30 dagen maar wel ${fmt(totalWaste)} spend: ${zeroCampaigns.slice(0, 3).map((c) => `"${c.name}" (${fmt(c.cost30d)})`).join(", ")}${zeroCampaigns.length > 3 ? ` en ${zeroCampaigns.length - 3} meer` : ""}. Evalueer of deze campagnes gepauzeerd moeten worden.`,
      });
    }

    // Bidding strategy analysis
    const biddingStrategies = new Map<string, number>();
    for (const c of structCampaigns) {
      const bs = c.biddingStrategy;
      biddingStrategies.set(bs, (biddingStrategies.get(bs) ?? 0) + 1);
    }
    const manualBidding = structCampaigns.filter((c) =>
      c.biddingStrategy === "MANUAL_CPC" || c.biddingStrategy === "ENHANCED_CPC"
    );
    if (manualBidding.length > 3) {
      insights.push({
        type: "info",
        level: "Campagne",
        text: `${manualBidding.length} campagnes draaien op manual/enhanced CPC. Overweeg Smart Bidding (tCPA of tROAS) voor betere automatische optimalisatie — vooral bij voldoende conversiedata (>15 conversies/maand per campagne).`,
      });
    }

    // Missing brand campaign
    if (!structCampaigns.some((c) => c.purpose === "brand") && structCampaigns.length > 2) {
      insights.push({
        type: "warning",
        level: "Account",
        text: `Geen brand campagne gedetecteerd. Dit betekent dat branded zoekverkeer mogelijk door concurrenten of PMax wordt opgevangen. Overweeg een dedicated brand campagne voor merkbescherming.`,
      });
    }
  }

  // ── 14. Wasteful Search Terms ──

  if (wastefulSearchTerms && wastefulSearchTerms.length > 0) {
    const totalWaste = wastefulSearchTerms.reduce((s, t) => s + t.cost, 0);
    const topTerms = wastefulSearchTerms.slice(0, 5);
    const termList = topTerms.map((t) => `"${t.searchTerm}" (${fmt(t.cost)})`).join(", ");

    insights.push({
      type: totalWaste > 100 ? "critical" : "warning",
      level: "Campagne",
      text: `Zoekterm verspilling: ${fmt(totalWaste)} uitgegeven aan ${wastefulSearchTerms.length} zoektermen met 0 conversies (30 dagen). Top verspillers: ${termList}. Voeg deze toe als negatief zoekwoord.`,
    });
  }

  // ── 15. Ad Group Bleeders ──

  if (adGroupBleeders && adGroupBleeders.length > 0) {
    const totalBleederCost = adGroupBleeders.reduce((s, ag) => s + ag.cost, 0);
    const topBleeders = adGroupBleeders.slice(0, 3);
    const bleederList = topBleeders.map((ag) =>
      `"${ag.adGroupName}" in "${ag.campaignName}" (${fmt(ag.cost)}, ${ag.clicks} clicks, 0 conv.)`
    ).join("; ");

    insights.push({
      type: totalBleederCost > 200 ? "critical" : "warning",
      level: "Campagne",
      text: `${adGroupBleeders.length} ad group${adGroupBleeders.length > 1 ? "s" : ""} met 0 conversies maar ${fmt(totalBleederCost)} spend (30d). Bleeders: ${bleederList}. Evalueer of deze gepauzeerd of geherstructureerd moeten worden.`,
    });
  }

  // ── 16. Change History ──

  if (changeHistory && changeHistory.length > 0) {
    const campaignChanges = changeHistory.filter((ch) => ch.resourceType === "CAMPAIGN" || ch.resourceType === "CAMPAIGN_BUDGET");
    const recentChanges = campaignChanges.slice(0, 5);

    if (recentChanges.length > 0) {
      const changeList = recentChanges.map((ch) => {
        const date = new Date(ch.changeDateTime).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
        return `${date}: ${ch.changeType} op "${ch.campaignName}"${ch.userEmail ? ` (${ch.userEmail})` : ""}`;
      }).join("; ");

      insights.push({
        type: "info",
        level: "Account",
        text: `Recente wijzigingen (14d): ${changeList}. ${campaignChanges.length > 5 ? `En ${campaignChanges.length - 5} meer.` : ""} Controleer of performance-veranderingen samenvallen met deze wijzigingen.`,
      });
    }
  }

  // ── 17. SOP: KPI Chain Decomposition ──
  // SOPs always trace the chain: Impressions → Clicks → CPC → CVR → Conversions → AOV → Revenue
  // When conversions are off-track, identify WHERE in the chain it breaks

  if (convDiff < -5 && realizedMonths.length >= 2) {
    const convPoints = forecast.conversions.points.filter((p) => p.realized !== null);
    const spendPoints = forecast.adSpend.points.filter((p) => p.realized !== null);
    const revPoints = forecast.revenue.points.filter((p) => p.realized !== null);

    if (convPoints.length >= 2 && spendPoints.length >= 2) {
      // CPC trend: spend/clicks proxy via spend growth vs conv growth
      const spendGrowth = spendPoints.length >= 2
        ? ((spendPoints[spendPoints.length - 1].realized! - spendPoints[0].realized!) / Math.max(spendPoints[0].realized!, 1)) * 100
        : 0;
      const convGrowth = convPoints.length >= 2
        ? ((convPoints[convPoints.length - 1].realized! - convPoints[0].realized!) / Math.max(convPoints[0].realized!, 1)) * 100
        : 0;

      // If spend grows but conversions don't → CPC rising or CVR dropping
      if (spendGrowth > 5 && convGrowth < -5) {
        insights.push({
          type: "warning",
          level: "KPI",
          text: `KPI-keten analyse: spend stijgt (${Math.round(spendGrowth)}%) maar conversies dalen (${Math.round(convGrowth)}%). Dit wijst op stijgende CPC, dalende CVR, of beide. Werk terug: (1) Check CPC trend per campagne, (2) Check CVR trend — daalt deze in lijn met verkeersstijging? Bij een vergelijkbare daling is het een verdunningseffect door breder verkeer.`,
        });
      }

      // AOV analysis: if revenue trend differs from conversion trend
      if (revPoints.length >= 2) {
        const revGrowth = ((revPoints[revPoints.length - 1].realized! - revPoints[0].realized!) / Math.max(revPoints[0].realized!, 1)) * 100;
        if (revGrowth > 10 && convGrowth < -5) {
          insights.push({
            type: "info",
            level: "KPI",
            text: `AOV-effect: omzet stijgt (${Math.round(revGrowth)}%) terwijl conversies dalen (${Math.round(convGrowth)}%). Dit wijst op hogere gemiddelde orderwaarde. De omzetdoelstelling kan gehaald worden ondanks minder conversies, maar het volume-effect verdient aandacht.`,
          });
        } else if (revGrowth < -10 && convGrowth > -5) {
          insights.push({
            type: "warning",
            level: "KPI",
            text: `AOV-daling: omzet daalt (${Math.round(revGrowth)}%) sneller dan conversies (${Math.round(convGrowth)}%). De gemiddelde orderwaarde neemt af. Check of dit een mix-verschuiving is (meer goedkope producten/diensten) of een markteffect.`,
          });
        }
      }
    }
  }

  // ── 18. SOP: Campaign-Level Root Cause Attribution ──
  // SOPs always identify WHICH campaign drives account-level trends

  if (accountStructure && accountStructure.campaigns.length > 1 && (convDiff < -10 || convDiff > 10)) {
    const camps = accountStructure.campaigns
      .filter((c) => c.cost30d > 0)
      .sort((a, b) => b.cost30d - a.cost30d);

    if (camps.length > 0) {
      const totalSpend = camps.reduce((s, c) => s + c.cost30d, 0);
      const totalConv = camps.reduce((s, c) => s + c.conversions30d, 0);
      const avgCpa = totalConv > 0 ? totalSpend / totalConv : 0;

      // Find high-spend low-conversion campaigns (bleeders at campaign level)
      const inefficient = camps.filter((c) => {
        const campCpa = c.conversions30d > 0 ? c.cost30d / c.conversions30d : Infinity;
        return campCpa > avgCpa * 2 && c.cost30d > totalSpend * 0.1;
      });

      if (inefficient.length > 0) {
        const names = inefficient.slice(0, 2).map((c) => {
          const campCpa = c.conversions30d > 0 ? c.cost30d / c.conversions30d : c.cost30d;
          return `"${c.name}" (CPA ${fmt(campCpa)}, ${Math.round(c.cost30d / totalSpend * 100)}% van spend)`;
        }).join(", ");
        insights.push({
          type: "warning",
          level: "Campagne",
          text: `Campagne-doorvertaling: ${names} heeft een CPA die meer dan 2× het accountgemiddelde (${fmt(avgCpa)}) is. Deze campagne${inefficient.length > 1 ? "s drukken" : " drukt"} het accountrendement. Evalueer of budget verschoven moet worden naar beter presterende campagnes.`,
        });
      }

      // Find top contributors (positive)
      const topPerformers = camps.filter((c) => {
        const campCpa = c.conversions30d > 0 ? c.cost30d / c.conversions30d : Infinity;
        return campCpa < avgCpa * 0.7 && c.conversions30d >= 3;
      });

      if (topPerformers.length > 0 && convDiff < -5) {
        const names = topPerformers.slice(0, 2).map((c) => {
          const campCpa = c.cost30d / c.conversions30d;
          return `"${c.name}" (CPA ${fmt(campCpa)})`;
        }).join(", ");
        insights.push({
          type: "positive",
          level: "Campagne",
          text: `Top campagne${topPerformers.length > 1 ? "s" : ""}: ${names} presteert significant boven gemiddelde. Overweeg budget te verschuiven vanuit underperformers naar deze campagne${topPerformers.length > 1 ? "s" : ""} voor direct resultaat.`,
        });
      }
    }
  }

  // ── 19. SOP: IS Budget vs Rank Shift Analysis ──
  // SOPs track the SHIFT between IS Lost Budget and IS Lost Rank — not just snapshot

  if (impressionShare && impressionShare.length > 0) {
    const totalBudgetLost = impressionShare.reduce((s, is) => s + is.searchBudgetLostIS * is.cost, 0);
    const totalRankLost = impressionShare.reduce((s, is) => s + is.searchRankLostIS * is.cost, 0);
    const totalCostIS = impressionShare.reduce((s, is) => s + is.cost, 0);

    if (totalCostIS > 0) {
      const wBudgetLost = totalBudgetLost / totalCostIS;
      const wRankLost = totalRankLost / totalCostIS;

      // When budget lost dominates over rank lost → scaling opportunity
      if (wBudgetLost > 0.20 && wBudgetLost > wRankLost * 1.5) {
        insights.push({
          type: budget.behindTarget ? "critical" : "info",
          level: "Budget",
          text: `IS Lost (Budget) domineert over IS Lost (Rank): ${Math.round(wBudgetLost * 100)}% vs ${Math.round(wRankLost * 100)}%. Dit is een positief signaal — de kwaliteit is goed maar het budget limiteert de groei. Budgetverhoging is de directe hefboom.`,
        });
      }
      // When rank lost dominates → quality issue, not budget
      if (wRankLost > 0.20 && wRankLost > wBudgetLost * 1.5) {
        insights.push({
          type: "warning",
          level: "KPI",
          text: `IS Lost (Rank) domineert over IS Lost (Budget): ${Math.round(wRankLost * 100)}% vs ${Math.round(wBudgetLost * 100)}%. Meer budget besteden lost dit niet op. Focus op: Quality Score verbeteren, advertentierelevantie, en landingspagina-ervaring.`,
        });
      }
    }
  }

  // ── 20. SOP: Product Bleeder Identification ──
  // SOPs specifically analyze product-level performance (custom labels, product groups)

  if (adGroupBleeders && adGroupBleeders.length > 0) {
    // Group bleeders by campaign to find structural issues
    const bleedersByCampaign = new Map<string, { cost: number; count: number }>();
    for (const b of adGroupBleeders) {
      const existing = bleedersByCampaign.get(b.campaignName) ?? { cost: 0, count: 0 };
      existing.cost += b.cost;
      existing.count += 1;
      bleedersByCampaign.set(b.campaignName, existing);
    }

    const totalBleederCost = adGroupBleeders.reduce((s, b) => s + b.cost, 0);
    const totalSpend = forecast.adSpend.kpi.ytdRealized;
    const bleederRatio = totalSpend > 0 ? totalBleederCost / (totalSpend / (realizedMonths.length || 1)) : 0;

    // If bleeders are concentrated in one campaign → structural issue
    for (const [campName, { cost, count }] of bleedersByCampaign) {
      if (count >= 3 && cost > 100) {
        insights.push({
          type: "warning",
          level: "Campagne",
          text: `"${campName}" heeft ${count} ad groups met 0 conversies (${fmt(cost)} spend). Dit wijst op een structureel probleem binnen deze campagne — evalueer of de product feed, targeting, of asset groups geherstructureerd moeten worden.`,
        });
        break; // Only show top one
      }
    }

    // Bleeder percentage of monthly spend
    if (bleederRatio > 0.05) {
      insights.push({
        type: "warning",
        level: "Efficiency",
        text: `${Math.round(bleederRatio * 100)}% van de maandelijkse spend gaat naar ad groups zonder conversies. Dit is verspild budget dat beter ingezet kan worden. SOP-actie: evalueer de top bleeders en pauzeer of herstructureer.`,
      });
    }
  }

  // Sort by priority: critical → warning → positive → info
  const typeOrder: Record<InsightType, number> = { critical: 0, warning: 1, positive: 2, info: 3 };
  insights.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

  return insights;
}

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
  sop_type: string | null;
}

const severityToType: Record<string, InsightType> = {
  critical: "critical",
  high: "warning",
  medium: "info",
  low: "info",
  positive: "positive",
};

export function InsightsBlock({
  clientId,
  selectedInsightId,
  onSelectInsight,
  refreshKey,
  channel,
}: {
  clientId: string;
  selectedInsightId?: string | null;
  onSelectInsight?: (id: string | null) => void;
  refreshKey?: number;
  channel?: InsightChannel | null;
}) {
  const data = useClientHistoricalData(clientId);
  const dataState = useClientDataState();
  const forecast = computeForecast(data);
  const insights = generateInsights(forecast, clientId, {
    impressionShare: dataState?.impressionShare,
    accountStructure: dataState?.accountStructure,
    wastefulSearchTerms: dataState?.wastefulSearchTerms,
    adGroupBleeders: dataState?.adGroupBleeders,
    changeHistory: dataState?.changeHistory,
  });

  const [dbInsights, setDbInsights] = useState<DbInsight[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("sop_insights")
      .select("id, title, description, severity, insight_type, affected_entity, affected_entity_type, metric, action_required, sop_type")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data: rows }) => setDbInsights((rows ?? []) as DbInsight[]));
  }, [clientId, refreshKey]);

  // Kanaal-filter: het kanaal volgt uit de sop_type van de analyse die het inzicht schreef.
  const channelFiltered = channel
    ? dbInsights.filter((i) => channelOfSopType(i.sop_type) === channel)
    : dbInsights;

  const hasDbInsights = channelFiltered.length > 0;
  const [isExpanded, setIsExpanded] = useState(false);

  // Sort dbInsights by severity priority
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, positive: 4 };
  const sortedDbInsights = [...channelFiltered].sort(
    (a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
  );

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">
          Inzichten
        </h3>
        {selectedInsightId && onSelectInsight && (
          <button
            onClick={() => onSelectInsight(null)}
            className="flex items-center gap-1 text-[11px] text-rm-blue hover:underline"
          >
            <X className="w-3 h-3" />
            Filter wissen
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mb-4">
        {hasDbInsights ? "AI analyse inzichten — klik om aanbevelingen en taken te filteren" : "Automatisch geanalyseerd op basis van API data en SOP-methodiek"}
      </p>

      {/* AI-generated insights from sop_insights */}
      {hasDbInsights && (
        <div className="space-y-2 mb-4">
          {(isExpanded ? sortedDbInsights : sortedDbInsights.slice(0, 3)).map((ins) => {
            const insType = severityToType[ins.severity] ?? "info";
            const isSelected = selectedInsightId === ins.id;
            return (
              <button
                key={ins.id}
                onClick={() => onSelectInsight?.(isSelected ? null : ins.id)}
                className={`flex gap-3 p-3 rounded-lg border w-full text-left transition-all ${
                  isSelected
                    ? "ring-2 ring-rm-blue border-rm-blue/30 bg-blue-50/50"
                    : bgColors[insType]
                } hover:shadow-sm`}
              >
                <div className="mt-0.5 shrink-0">
                  {isSelected ? <Filter className="w-4 h-4 text-rm-blue" /> : icons[insType]}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      ins.severity === "critical" ? "bg-red-100 text-red-700" :
                      ins.severity === "high" ? "bg-orange-100 text-orange-700" :
                      ins.severity === "positive" ? "bg-green-100 text-green-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {ins.severity}
                    </span>
                    <span className="text-[9px] text-muted-foreground">{ins.affected_entity}</span>
                    {ins.action_required && (
                      <span className="text-[9px] font-semibold text-red-600">Actie vereist</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-rm-gray">{ins.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{ins.description}</p>
                </div>
              </button>
            );
          })}
          {sortedDbInsights.length > 3 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center justify-center gap-1.5 w-full py-2 text-[11px] font-medium text-rm-blue hover:text-rm-blue/80 transition-colors"
            >
              {isExpanded ? (
                <>Toon minder <ChevronUp className="w-3.5 h-3.5" /></>
              ) : (
                <>Toon alle {sortedDbInsights.length} inzichten <ChevronDown className="w-3.5 h-3.5" /></>
              )}
            </button>
          )}
        </div>
      )}

      {/* Legacy generated insights */}
      {!hasDbInsights && (
        <>
        <div className="space-y-3">
          {(isExpanded ? insights : insights.slice(0, 3)).map((insight, i) => (
            <div
              key={i}
              className={`flex gap-3 p-3 rounded-lg border ${bgColors[insight.type]}`}
            >
              <div className="mt-0.5 shrink-0">{icons[insight.type]}</div>
              <div className="min-w-0">
                <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded mb-1.5 ${levelColors[insight.level] ?? "bg-gray-100 text-gray-600"}`}>
                  {insight.level}
                </span>
                <p className="text-sm text-rm-gray leading-relaxed">{insight.text}</p>
              </div>
            </div>
          ))}
        </div>
        {insights.length > 3 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-center gap-1.5 w-full py-2 mt-2 text-[11px] font-medium text-rm-blue hover:text-rm-blue/80 transition-colors"
          >
            {isExpanded ? (
              <>Toon minder <ChevronUp className="w-3.5 h-3.5" /></>
            ) : (
              <>Toon alle {insights.length} inzichten <ChevronDown className="w-3.5 h-3.5" /></>
            )}
          </button>
        )}
        </>
      )}
    </div>
  );
}
