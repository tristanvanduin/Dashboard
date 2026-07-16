/**
 * Account Health Score (0–100) + Anomaly Detection
 *
 * Score is gebaseerd op 5 factoren (elk 0–20 punten):
 *
 * 1. TARGET TRACKING (20pt)
 *    Hoe dicht zit de prognose bij het jaardoel?
 *    100% = 20pt, 80% = 16pt, <50% = 0pt
 *
 * 2. SPEND EFFICIENCY (20pt)
 *    Wordt het budget efficiënt besteed? (CPA trend, ROAS vs target)
 *    Stabiel of dalend CPA = goed, stijgend = slecht
 *
 * 3. TREND (20pt)
 *    Verbetert of verslechtert de performance?
 *    Stijgende ratio = goed, dalend = slecht
 *
 * 4. BUDGET UTILIZATION (20pt)
 *    Wordt het beschikbare budget benut?
 *    >90% benut = 20pt, <50% = 0pt
 *
 * 5. ACCOUNT HYGIENE (20pt)
 *    Zoekterm verspilling, ad group bleeders, 0-conv campagnes
 *    Geen waste = 20pt, veel waste = 0pt
 *
 * Anomalies zijn events die buiten normaal patroon vallen:
 * - MoM verandering > 30% in een metric
 * - CPC stijging > 25%
 * - Conversieratio daling > 25%
 * - Campagne stopt met spend
 * - Nieuw account zonder targets
 */

import type { ClientForecast } from "./forecast";
import type { ImpressionShareData, WastefulSearchTermData, AdGroupBleederData } from "./use-client-data";

export interface HealthScore {
  total: number;               // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  color: string;               // tailwind color class
  factors: HealthFactor[];
  anomalies: Anomaly[];
}

export interface HealthFactor {
  name: string;
  score: number;               // 0–20
  maxScore: number;            // always 20
  description: string;
}

export interface Anomaly {
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

export function computeHealthScore(
  forecast: ClientForecast,
  impressionShare?: ImpressionShareData[],
  wastefulTerms?: WastefulSearchTermData[],
  adGroupBleeders?: AdGroupBleederData[],
): HealthScore {
  const factors: HealthFactor[] = [];
  const anomalies: Anomaly[] = [];

  const conv = forecast.conversions.kpi;
  const spend = forecast.adSpend.kpi;
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null);

  // ── 1. TARGET TRACKING (20pt) ──
  // How close is the adjusted annual to the target?
  const targetRatio = conv.annualTarget > 0
    ? conv.adjustedAnnual / conv.annualTarget
    : 1;
  const targetScore = clamp(Math.round(targetRatio * 20), 0, 20);
  factors.push({
    name: "Doelstelling",
    score: targetScore,
    maxScore: 20,
    description: conv.annualTarget > 0
      ? `Prognose ${Math.round(targetRatio * 100)}% van jaardoel`
      : "Geen jaardoel ingesteld",
  });

  if (targetRatio < 0.5 && conv.annualTarget > 0) {
    anomalies.push({
      severity: "critical",
      title: "Jaardoel in gevaar",
      description: `Prognose is slechts ${Math.round(targetRatio * 100)}% van het jaardoel. Zonder ingrijpen wordt het doel niet gehaald.`,
    });
  }

  // ── 2. SPEND EFFICIENCY (20pt) ──
  const cpaPoints = forecast.cpa.points.filter((p) => p.realized !== null);
  let efficiencyScore = 14; // default: decent

  if (cpaPoints.length >= 2) {
    const firstCpa = cpaPoints[0].realized!;
    const lastCpa = cpaPoints[cpaPoints.length - 1].realized!;
    const cpaTrend = firstCpa > 0 ? ((lastCpa - firstCpa) / firstCpa) * 100 : 0;

    if (cpaTrend < -10) efficiencyScore = 20;       // CPA dalend = excellent
    else if (cpaTrend < 5) efficiencyScore = 16;     // Stabiel
    else if (cpaTrend < 20) efficiencyScore = 10;    // Licht stijgend
    else efficiencyScore = 4;                         // Sterk stijgend

    if (cpaTrend > 25) {
      anomalies.push({
        severity: "warning",
        title: "CPA stijgt snel",
        description: `CPA steeg ${Math.round(cpaTrend)}% van ${fmt(firstCpa)} naar ${fmt(lastCpa)}.`,
      });
    }
    if (cpaTrend < -25) {
      anomalies.push({
        severity: "info",
        title: "CPA daalt sterk",
        description: `CPA daalde ${Math.round(Math.abs(cpaTrend))}%. Efficiency verbetert.`,
      });
    }
  }

  factors.push({
    name: "Efficiency",
    score: efficiencyScore,
    maxScore: 20,
    description: efficiencyScore >= 16 ? "CPA stabiel of dalend" : efficiencyScore >= 10 ? "CPA licht stijgend" : "CPA stijgt significant",
  });

  // ── 3. TREND (20pt) ──
  //
  // Two modes:
  //   A) Mature client: projectionFactor + lastRatio (standard)
  //   B) Scaling/limited data client: efficiency trend (conv/spend) is the real signal
  //      because raw conversion growth just reflects spend scaling, not account health.
  //
  // The forecast engine's dataMaturity tells us which mode to use.
  let trendScore = 10;
  {
    const dm = forecast.dataMaturity;
    const pf = conv.projectionFactor;
    const lastRatio = realizedMonths.length > 0
      ? realizedMonths[realizedMonths.length - 1].monthRatio
      : 1.0;

    if (dm.isScaling && !dm.isMature) {
      // ── Scaling client: judge on EFFICIENCY trend, not raw conversions ──
      // If spend doubles and conversions double → neutral (efficiency stable)
      // If spend doubles and conversions triple → great (efficiency improving)
      // If spend doubles and conversions stay flat → bad (efficiency declining)
      const et = dm.efficiencyTrend;  // >1 = improving, <1 = declining

      let base: number;
      if (et > 1.10) base = 20;       // efficiency improving 10%+
      else if (et > 1.02) base = 16;  // slightly improving
      else if (et > 0.95) base = 12;  // stable efficiency while scaling
      else if (et > 0.85) base = 8;   // declining efficiency
      else base = 4;                   // significant efficiency loss

      // Small modifier for absolute last-month performance
      const modifier = lastRatio >= 1.0 ? 2 : lastRatio >= 0.85 ? 0 : -2;
      trendScore = clamp(base + modifier, 0, 20);

      // Anomaly: efficiency dropping while scaling
      if (et < 0.80) {
        anomalies.push({
          severity: "warning",
          title: "Efficiency daalt bij opschaling",
          description: `Conversieratio per € spend daalde ${Math.round((1 - et) * 100)}% terwijl budget groeit. CPA stijgt.`,
        });
      }
    } else {
      // ── Mature client: use projectionFactor as primary signal ──
      let base: number;
      if (pf > 1.15) base = 18;
      else if (pf > 1.05) base = 16;
      else if (pf > 0.95) base = 12;
      else if (pf > 0.85) base = 8;
      else if (pf > 0.75) base = 4;
      else base = 2;

      const modifier = lastRatio >= 1.0 ? 2 : lastRatio >= 0.85 ? 0 : -2;
      trendScore = clamp(base + modifier, 0, 20);

      // Anomalies: only flag genuinely concerning situations
      if (pf < 0.80 && lastRatio < 0.80) {
        anomalies.push({
          severity: "critical",
          title: "Sterke neerwaartse trend",
          description: `Gewogen prestatiefactor ${(pf * 100).toFixed(0)}%, laatste maand ${(lastRatio * 100).toFixed(0)}% van verwachting.`,
        });
      } else if (pf < 0.90 && lastRatio < 0.90) {
        anomalies.push({
          severity: "warning",
          title: "Dalende trend",
          description: `Gewogen prestatiefactor ${(pf * 100).toFixed(0)}%, laatste maand ${(lastRatio * 100).toFixed(0)}% van verwachting.`,
        });
      }
    }

    // MoM anomalies — only flag if it's both a big drop AND below expectations
    if (realizedMonths.length >= 2) {
      for (let i = 1; i < realizedMonths.length; i++) {
        const prev = realizedMonths[i - 1];
        const curr = realizedMonths[i];
        if (prev.realized && curr.realized && prev.realized > 0) {
          const momChange = ((curr.realized - prev.realized) / prev.realized) * 100;
          if (momChange < -30 && curr.monthRatio < 0.80) {
            anomalies.push({
              severity: "warning",
              title: `Scherpe daling ${prev.monthLabel}→${curr.monthLabel}`,
              description: `Conversies daalden ${Math.round(Math.abs(momChange))}% in één maand.`,
            });
          }
        }
      }
    }
  }

  factors.push({
    name: "Trend",
    score: trendScore,
    maxScore: 20,
    description: trendScore >= 16 ? "Opwaartse trend" : trendScore >= 10 ? "Stabiel" : "Neerwaartse trend",
  });

  // ── 4. BUDGET UTILIZATION (20pt) ──
  let budgetScore = 14;
  const spendRatio = spend.annualTarget > 0 ? spend.ytdRealized / spend.ytdExpected : 1;

  if (spendRatio > 0.90) budgetScore = 20;
  else if (spendRatio > 0.75) budgetScore = 16;
  else if (spendRatio > 0.50) budgetScore = 10;
  else if (spendRatio > 0.25) budgetScore = 4;
  else budgetScore = 0;

  if (impressionShare && impressionShare.length > 0) {
    const highBudgetLost = impressionShare.filter((is) => is.searchBudgetLostIS > 0.30);
    if (highBudgetLost.length > 0) {
      budgetScore = Math.max(budgetScore - 4, 0);
      anomalies.push({
        severity: "warning",
        title: `${highBudgetLost.length} campagne(s) budget-gelimiteerd`,
        description: `Campagnes verliezen >30% IS door budget. Direct groeipotentieel.`,
      });
    }
  }

  factors.push({
    name: "Budget",
    score: budgetScore,
    maxScore: 20,
    description: spendRatio > 0.85 ? "Budget wordt goed benut" : `${Math.round(spendRatio * 100)}% van budget besteed`,
  });

  // ── 5. ACCOUNT HYGIENE (20pt) ──
  let hygieneScore = 20;

  const wasteAmount = wastefulTerms?.reduce((s, t) => s + t.cost, 0) ?? 0;
  const bleederAmount = adGroupBleeders?.reduce((s, b) => s + b.cost, 0) ?? 0;
  const totalWaste = wasteAmount + bleederAmount;
  const totalSpend = spend.ytdRealized;
  const wasteRatio = totalSpend > 0 ? totalWaste / totalSpend : 0;

  if (wasteRatio > 0.15) hygieneScore = 4;
  else if (wasteRatio > 0.08) hygieneScore = 10;
  else if (wasteRatio > 0.03) hygieneScore = 14;
  else if (wasteRatio > 0.01) hygieneScore = 17;

  if (wasteAmount > 200) {
    anomalies.push({
      severity: "warning",
      title: "Zoekterm verspilling",
      description: `${fmt(wasteAmount)} uitgegeven aan zoektermen met 0 conversies (30d).`,
    });
  }
  if (bleederAmount > 200) {
    anomalies.push({
      severity: "warning",
      title: "Ad group bleeders",
      description: `${fmt(bleederAmount)} in ad groups met 0 conversies (30d).`,
    });
  }

  factors.push({
    name: "Hygiëne",
    score: hygieneScore,
    maxScore: 20,
    description: hygieneScore >= 17 ? "Weinig verspilling" : `${Math.round(wasteRatio * 100)}% spend naar 0-conversie items`,
  });

  // ── Total ──
  const total = factors.reduce((s, f) => s + f.score, 0);

  const grade: HealthScore["grade"] =
    total >= 85 ? "A" :
    total >= 70 ? "B" :
    total >= 55 ? "C" :
    total >= 40 ? "D" : "F";

  const color =
    total >= 85 ? "text-green-600" :
    total >= 70 ? "text-green-500" :
    total >= 55 ? "text-amber-500" :
    total >= 40 ? "text-orange-500" : "text-red-500";

  // Sort anomalies by severity
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { total, grade, color, factors, anomalies };
}
