"use client";

import { useState, useEffect } from "react";
import { Lightbulb, ChevronDown, ChevronUp } from "lucide-react";
import { useClientHistoricalData, useClientDataState } from "@/lib/client-data-provider";
import { computeForecast, type ClientForecast } from "@/lib/forecast";
import { getClientSettings } from "@/lib/client-settings";
import { supabase } from "@/lib/supabase";
import type { ImpressionShareData } from "@/lib/use-client-data";
import { channelOfSopType, type InsightChannel } from "@/lib/insights/channel-of";

type Priority = "high" | "medium" | "low";

interface Recommendation {
  text: string;
  priority: Priority;
  source: string;
}

const priorityConfig: Record<Priority, { label: string; color: string; bg: string }> = {
  high: { label: "Hoog", color: "text-red-600", bg: "bg-red-100" },
  medium: { label: "Midden", color: "text-rm-orange", bg: "bg-orange-100" },
  low: { label: "Laag", color: "text-rm-blue", bg: "bg-blue-100" },
};

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function generateRecommendations(forecast: ClientForecast, clientId: string, impressionShare?: ImpressionShareData[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const settings = getClientSettings(clientId);

  const convDiff = forecast.conversions.kpi.diffPct;
  const revDiff = forecast.revenue.kpi.diffPct;
  const spendDiff = forecast.adSpend.kpi.diffPct;
  const budget = forecast.budgetRecommendation;
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null);
  const remainingMonths = 12 - realizedMonths.length;

  // Spend factor vs conversion factor
  const spendFactor = forecast.adSpend.kpi.projectionFactor;
  const convFactor = forecast.conversions.kpi.projectionFactor;
  const efficiencyFactor = spendFactor > 0 ? convFactor / spendFactor : 1;

  // CPA trend
  const cpaPoints = forecast.cpa.points.filter((p) => p.realized !== null);
  const firstCpa = cpaPoints[0]?.realized ?? 0;
  const lastCpa = cpaPoints[cpaPoints.length - 1]?.realized ?? 0;
  const cpaTrend = firstCpa > 0 ? ((lastCpa - firstCpa) / firstCpa) * 100 : 0;

  // ── Budget actions ──

  if (budget.behindTarget && spendDiff < -5) {
    recs.push({
      priority: "high",
      source: "Budget Opschaling",
      text: `Verhoog het maandbudget van ${fmt(budget.currentMonthlySpend)} naar ${fmt(budget.requiredMonthlySpend)} (+${Math.round(budget.spendIncreasePct)}%). Bij de huidige CPA van ${fmt(budget.currentCpa)} levert dit naar verwachting ${Math.round(budget.conversionGap / remainingMonths)} extra conversies per maand op. Bespreek dit met de klant als budget-voorstel.`,
    });
  }

  if (budget.behindTarget && spendDiff >= -5) {
    recs.push({
      priority: "high",
      source: "Efficiency Verbetering",
      text: `Budget is nagenoeg op schema maar resultaten lopen achter. Focus op efficiency: (1) Zoektermrapporten opschonen — verwijder irrelevante zoekopdrachten, (2) Biedstrategieën evalueren — overweeg switch naar tROAS of tCPA, (3) Landingspagina's testen — is de conversieratio competitief?`,
    });
  }

  // ── Campaign structure ──

  if (convDiff < -20) {
    recs.push({
      priority: "high",
      source: "Campagne Evaluatie",
      text: `Met ${Math.round(Math.abs(convDiff))}% achterstand op conversies: identificeer de top 3 campagnes op spend en beoordeel per campagne of de ROAS/CPA acceptabel is. Pauzeer of verlaag budget op campagnes met CPA > 2× gemiddelde. Verschuif budget naar best-presterende non-brand campagnes.`,
    });
  }

  // ── Impression Share opportunity ──

  if (convDiff < -10) {
    recs.push({
      priority: "high",
      source: "Impression Share",
      text: `Check Impression Share Lost (Budget) en Lost (Rank) in Google Ads. Als IS Lost (Budget) > 20%: er is directe groeipotentie door budget te verhogen. Als IS Lost (Rank) > 20%: Quality Score verbeteren via betere advertentieteksten en landingspagina's.`,
    });
  }

  // ── CPA optimization ──

  if (cpaTrend > 15 && lastCpa > 0) {
    recs.push({
      priority: "high",
      source: "CPA Optimalisatie",
      text: `CPA stijgt ${Math.round(cpaTrend)}% (van ${fmt(firstCpa)} naar ${fmt(lastCpa)}). Acties: (1) Check zoektermen — filter irrelevant verkeer met negatieve zoekwoorden, (2) Evalueer biedstrategie — overweeg max CPA bid cap, (3) Test landingspagina varianten — elke 1% conversieratio verbetering verlaagt CPA significant.`,
    });
  } else if (cpaTrend < -15 && convDiff < 0) {
    recs.push({
      priority: "medium",
      source: "CPA Kans",
      text: `CPA daalt (${Math.round(Math.abs(cpaTrend))}% daling) — efficiency verbetert. Dit is het ideale moment om budget te verhogen: je krijgt meer conversies per euro. Overweeg ${Math.round(Math.abs(cpaTrend))}% budget verhoging om het volume-tekort in te halen.`,
    });
  }

  // ── Search term quality ──

  recs.push({
    priority: convDiff < -10 ? "high" : "medium",
    source: "Zoektermanalyse",
    text: `Analyseer de zoektermrapporten van de afgelopen 30 dagen. ${convDiff < -10
      ? "Bij deze achterstand is zoektermkwaliteit cruciaal — elke euro naar irrelevante zoektermen is dubbel verlies."
      : "Wekelijkse onderhoud houdt de campagnes scherp."} Focus op: (1) Zoektermen met hoge kosten en 0 conversies, (2) Zoektermen die niet matchen met het aanbod, (3) Kansen om als exact match keyword toe te voegen.`,
  });

  // ── Bidding strategy ──

  if (convDiff < -15) {
    recs.push({
      priority: "medium",
      source: "Biedstrategie",
      text: `Evalueer de biedstrategieën per campagne. Overweeg: (1) Maximize Conversions met een target CPA van ${fmt(budget.currentCpa * 0.9)} (10% onder huidig), (2) Bij Shopping/PMax: target ROAS aanpassen op basis van actuele performance, (3) Bij manual bidding: verhoog biedingen op top-converting keywords.`,
    });
  }

  // ── Ad copy & creative ──

  if (realizedMonths.length >= 2) {
    const ctrPoints = forecast.conversions.weeklyPoints.filter((w) => w.realized !== null);
    if (ctrPoints.length > 0) {
      recs.push({
        priority: convDiff < -10 ? "medium" : "low",
        source: "Creative Analyse",
        text: `Check advertentieteksten en assets: (1) Vergelijk CTR over de afgelopen 3 maanden — dalende CTR = creative fatigue, (2) Test nieuwe headlines met actuele USPs en aanbiedingen, (3) Bij Shopping: optimaliseer productfeed titels en afbeeldingen.`,
      });
    }
  }

  // ── Audience & targeting ──

  if (convDiff < -10) {
    recs.push({
      priority: "medium",
      source: "Doelgroep Analyse",
      text: `Analyseer doelgroep-performance: (1) Device breakdown — presteert mobile significant anders dan desktop?, (2) Leeftijd/geslacht — zijn er segmenten die bovengemiddeld converteren?, (3) Dagdeel-analyse — zijn er uren/dagen met lage ROAS die je kan uitsluiten?`,
    });
  }

  // ── Competitor analysis ──

  recs.push({
    priority: convDiff < -20 ? "high" : "low",
    source: "Concurrentie",
    text: `Check Auction Insights voor de top campagnes: (1) Is er een nieuwe concurrent bijgekomen?, (2) Stijgt de overlap rate van bestaande concurrenten?, (3) Dalen je Impression Share of Average Position? Dit kan CPC-stijgingen en dalende CTR verklaren.`,
  });

  // ── Client communication ──

  if (convDiff < -25 || revDiff < -25) {
    recs.push({
      priority: "high",
      source: "Klantbespreking",
      text: `Plan een bespreking met de klant. Agenda: (1) Huidige resultaten vs doelstellingen transparant delen, (2) Oorzaakanalyse presenteren (budget/efficiency/markt), (3) Herstelplan voorleggen met budget-scenario's, (4) Verwachtingen bijstellen indien nodig. Gebruik de budget-aanbeveling als basis voor het gesprek.`,
    });
  }

  // ── Budget Expansion Plan (when budget is available but not spent) ──

  if (impressionShare && impressionShare.length > 0) {
    const budgetLimited = impressionShare.filter((is) => is.searchBudgetLostIS > 0.15 && is.cost > 0);
    const rankLimited = impressionShare.filter((is) => is.searchRankLostIS > 0.20 && is.cost > 0);
    const underutilized = impressionShare.filter((is) => is.budgetUtilization < 0.60 && is.dailyBudget > 0);

    // IS Lost Budget → direct budget increase
    if (budgetLimited.length > 0 && budget.behindTarget) {
      const topCampaign = budgetLimited[0];
      const potentialGrowth = Math.round(topCampaign.searchBudgetLostIS * 100);
      recs.push({
        priority: "high",
        source: "Budget Verhoging",
        text: `"${topCampaign.campaignName}" verliest ${potentialGrowth}% IS door budget. Verhoog het dagbudget van ${fmt(topCampaign.dailyBudget)} naar ${fmt(Math.round(topCampaign.dailyBudget * (1 + topCampaign.searchBudgetLostIS)))} (+${potentialGrowth}%). Dit is de snelste manier om meer volume te genereren.`,
      });
    }

    // IS Lost Rank → Quality Score verbetering
    if (rankLimited.length > 0) {
      const topRank = rankLimited[0];
      recs.push({
        priority: "high",
        source: "Ad Rank Verbetering",
        text: `"${topRank.campaignName}" verliest ${Math.round(topRank.searchRankLostIS * 100)}% IS door Ad Rank. Plan: (1) Check Quality Score per keyword — focus op keywords met QS < 6, (2) Verbeter advertentierelevantie — zorg dat de headline het zoekwoord bevat, (3) Optimaliseer landingspagina snelheid en relevantie, (4) Verhoog biedingen op keywords met hoge conversieratio.`,
      });
    }

    // Budget underutilization → expand reach
    if (underutilized.length > 0) {
      const topUnder = underutilized[0];
      recs.push({
        priority: "medium",
        source: "Bereik Uitbreiden",
        text: `"${topUnder.campaignName}" benut slechts ${Math.round(topUnder.budgetUtilization * 100)}% van het dagbudget. Budget is er maar wordt niet besteed. Acties: (1) Voeg Broad Match zoekwoorden toe om meer zoekverkeer te vangen, (2) Verbreed doelgroep-targeting (geo, devices), (3) Voeg nieuwe ad groups toe voor gerelateerde zoektermen, (4) Check of biedingen hoog genoeg zijn om de veiling te winnen.`,
      });
    }

    // Missing campaign types → suggest expansion
    const campaignTypes = new Set(impressionShare.map((is) => is.campaignType));
    const hasSearch = campaignTypes.has("SEARCH");
    const hasShopping = campaignTypes.has("SHOPPING");
    const hasPmax = campaignTypes.has("PERFORMANCE_MAX");

    if (hasSearch && !hasShopping && !hasPmax && budget.behindTarget) {
      recs.push({
        priority: "medium",
        source: "Account Uitbreiding",
        text: `Momenteel alleen Search campagnes actief. Overweeg: (1) Shopping campagne opzetten — als er producten verkocht worden is dit vaak de beste ROAS, (2) Performance Max testen — voor incrementeel bereik buiten Search. Dit vergroot het totale bereik significant.`,
      });
    }
  }

  // ── SOP: Budget verschuiving tussen campagnes ──
  // SOPs recommend shifting budget from underperformers to top performers

  if (impressionShare && impressionShare.length >= 2) {
    const withConversions = impressionShare.filter((is) => is.conversions > 0 && is.cost > 0);
    const withoutConversions = impressionShare.filter((is) => is.conversions === 0 && is.cost > 50);

    if (withConversions.length > 0 && withoutConversions.length > 0) {
      const wastedBudget = withoutConversions.reduce((s, is) => s + is.cost, 0);
      const bestCampaign = withConversions.sort((a, b) => (b.conversions / b.cost) - (a.conversions / a.cost))[0];
      if (wastedBudget > 100) {
        recs.push({
          priority: "high",
          source: "Budget Verschuiving",
          text: `${fmt(wastedBudget)} gaat naar campagnes zonder conversies. Verschuif dit budget naar "${bestCampaign.campaignName}" die de beste conversieratio per euro heeft. Dit is de snelste weg naar meer resultaat zonder extra budget.`,
        });
      }
    }
  }

  // ── SOP: CVR-specifieke optimalisatie ──
  // SOPs analyze CVR separate from traffic: if traffic is up but CVR is down, it's a different problem

  const spendFactor2 = forecast.adSpend.kpi.projectionFactor;
  const convFactor2 = forecast.conversions.kpi.projectionFactor;
  if (spendFactor2 > 0.95 && convFactor2 < 0.85) {
    recs.push({
      priority: "high",
      source: "Conversieratio",
      text: `Verkeer is op peil maar conversies niet — de conversieratio is het probleem. Acties: (1) Analyseer landingspagina's op mobiel en desktop — laadsnelheid, relevantie, CTA, (2) Check of het zoekverkeer relevant is via zoektermrapporten, (3) Vergelijk CVR per device en dag — identificeer waar het verlies zit. Elke 0,1% CVR verbetering levert direct meer conversies bij dezelfde kosten.`,
    });
  }

  // ── SOP: Feed-optimalisatie voor Shopping/PMax ──

  if (impressionShare) {
    const pmaxCampaigns = impressionShare.filter((is) => is.campaignType === "PERFORMANCE_MAX" || is.campaignType === "SHOPPING");
    const lowPerformingPmax = pmaxCampaigns.filter((is) => is.conversions === 0 && is.cost > 50);
    if (lowPerformingPmax.length > 0) {
      recs.push({
        priority: "medium",
        source: "Feed Optimalisatie",
        text: `${lowPerformingPmax.length} Shopping/PMax campagne(s) zonder conversies. Bij feed-gebaseerde campagnes is de productfeed cruciaal: (1) Check producttitels — bevatten ze relevante zoekwoorden?, (2) Check afbeeldingen — zijn ze kwalitatief en onderscheidend?, (3) Check prijsconcurrentie — ligt de prijs in lijn met de markt?, (4) Check beschikbaarheid — worden out-of-stock producten gefilterd?`,
      });
    }
  }

  // Sort by priority
  const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recs;
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
  sop_type: string | null;
}

export function RecommendationsBlock({
  clientId,
  selectedInsightId,
  refreshKey,
  channel,
}: {
  clientId: string;
  selectedInsightId?: string | null;
  refreshKey?: number;
  channel?: InsightChannel | null;
}) {
  const data = useClientHistoricalData(clientId);
  const dataState = useClientDataState();
  const forecast = computeForecast(data);
  const legacyRecs = generateRecommendations(forecast, clientId, dataState?.impressionShare);

  const [dbRecs, setDbRecs] = useState<DbRecommendation[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("sop_recommendations")
      .select("id, insight_id, hypothesis, expected_result, measurement_metric, timeframe, ice_impact, ice_confidence, ice_ease, ice_total, sop_type")
      .eq("client_id", clientId)
      .not("insight_id", "is", null)
      .order("ice_total", { ascending: false })
      .limit(20)
      .then(({ data: rows }) => setDbRecs((rows ?? []) as DbRecommendation[]));
  }, [clientId, refreshKey]);

  // Kanaal-filter via de sop_type van de analyse die de aanbeveling schreef.
  const channelRecs = channel ? dbRecs.filter((r) => channelOfSopType(r.sop_type) === channel) : dbRecs;
  const hasDbRecs = channelRecs.length > 0;
  const filteredRecs = selectedInsightId
    ? channelRecs.filter((r) => r.insight_id === selectedInsightId)
    : channelRecs;
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide mb-1">
        Aanbevelingen
      </h3>
      <p className="text-[10px] text-muted-foreground mb-4">
        {hasDbRecs
          ? `Aanbevelingen gekoppeld aan inzichten${selectedInsightId ? " (gefilterd)" : ""} — gesorteerd op ICE score`
          : "Concrete acties op basis van campagne-analyse en SOP-methodiek"}
      </p>

      {/* AI-generated recommendations from sop_recommendations */}
      {hasDbRecs && (() => {
        // Only finding-based recommendations (hypotheses are in HypothesesBlock)
        const findingRecs = filteredRecs;
        const visibleFindingRecs = isExpanded ? findingRecs : findingRecs.slice(0, 3);

        return (
        <div className="space-y-3">
          {findingRecs.length === 0 && selectedInsightId && (
            <p className="text-sm text-muted-foreground py-3 text-center">
              Geen aanbevelingen gekoppeld aan dit inzicht.
            </p>
          )}
          {visibleFindingRecs.map((rec) => (
            <div
              key={rec.id}
              className="p-3 rounded-lg bg-rm-blue/5 border border-rm-blue/10"
            >
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-rm-orange shrink-0" />
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rm-blue/10 text-rm-blue">
                  ICE {rec.ice_total}
                </span>
                <span className="text-[9px] text-muted-foreground">
                  I:{rec.ice_impact} C:{rec.ice_confidence} E:{rec.ice_ease}
                </span>
              </div>
              <p className="text-sm text-rm-gray leading-relaxed mb-1.5">{rec.hypothesis}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                <span>Verwacht: {rec.expected_result}</span>
                <span>Metric: {rec.measurement_metric}</span>
                <span>Binnen: {rec.timeframe}</span>
              </div>
            </div>
          ))}
          {findingRecs.length > 3 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center justify-center gap-1.5 w-full py-2 text-[11px] font-medium text-rm-blue hover:text-rm-blue/80 transition-colors"
            >
              {isExpanded ? (
                <>Toon minder <ChevronUp className="w-3.5 h-3.5" /></>
              ) : (
                <>Toon alle {findingRecs.length} aanbevelingen <ChevronDown className="w-3.5 h-3.5" /></>
              )}
            </button>
          )}
        </div>
        );
      })()}

      {/* Legacy generated recommendations */}
      {!hasDbRecs && (
        <>
        <div className="space-y-3">
          {(isExpanded ? legacyRecs : legacyRecs.slice(0, 3)).map((rec, i) => {
            const config = priorityConfig[rec.priority];
            return (
              <div
                key={i}
                className="flex gap-3 p-3 rounded-lg bg-rm-blue/5 border border-rm-blue/10"
              >
                <Lightbulb className="w-4 h-4 text-rm-orange mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                      {config.label}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {rec.source}
                    </span>
                  </div>
                  <p className="text-sm text-rm-gray leading-relaxed">{rec.text}</p>
                </div>
              </div>
            );
          })}
        </div>
        {legacyRecs.length > 3 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-center gap-1.5 w-full py-2 mt-2 text-[11px] font-medium text-rm-blue hover:text-rm-blue/80 transition-colors"
          >
            {isExpanded ? (
              <>Toon minder <ChevronUp className="w-3.5 h-3.5" /></>
            ) : (
              <>Toon alle {legacyRecs.length} aanbevelingen <ChevronDown className="w-3.5 h-3.5" /></>
            )}
          </button>
        )}
        </>
      )}
    </div>
  );
}
