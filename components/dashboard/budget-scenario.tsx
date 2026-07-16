"use client";

import { useState, useMemo } from "react";
import { Calculator, ArrowRight, DollarSign, Target, AlertTriangle, Info } from "lucide-react";
import { useClientHistoricalData, useClientDataState } from "@/lib/client-data-provider";
import { computeForecast } from "@/lib/forecast";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

export function BudgetScenario({ clientId }: { clientId: string }) {
  const data = useClientHistoricalData(clientId);
  const dataState = useClientDataState();
  const forecast = useMemo(() => computeForecast(data), [data]);
  const [budgetChange, setBudgetChange] = useState(0);

  const conv = forecast.conversions.kpi;
  const spend = forecast.adSpend.kpi;
  const budget = forecast.budgetRecommendation;
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null).length;
  const remainingMonths = Math.max(1, 12 - realizedMonths);

  // Current actuals — ALL on annual projected basis for consistency
  const currentAnnualConv = conv.adjustedAnnual;
  const currentAnnualRev = forecast.revenue.kpi.adjustedAnnual;
  const currentAnnualSpend = spend.adjustedAnnual;
  const currentMonthlySpend = spend.annualTarget > 0 ? spend.annualTarget / 12 : spend.ytdRealized / Math.max(realizedMonths, 1);
  // CPA on ANNUAL basis (not YTD) so before/after are comparable
  const currentCpa = currentAnnualConv > 0 ? currentAnnualSpend / currentAnnualConv : 0;
  const currentRoas = currentAnnualSpend > 0 ? currentAnnualRev / currentAnnualSpend : 0;
  const aov = currentAnnualConv > 0 ? currentAnnualRev / currentAnnualConv : 0;

  // IS Lost (Budget) headroom — how much can we scale before diminishing returns?
  const impressionShare = dataState?.impressionShare ?? [];
  const avgBudgetLostIS = impressionShare.length > 0
    ? impressionShare.reduce((s, is) => s + is.searchBudgetLostIS * is.cost, 0) /
      Math.max(impressionShare.reduce((s, is) => s + is.cost, 0), 1)
    : 0;
  // Headroom: if we lose 30% IS to budget, we can grow ~30% at same efficiency
  const headroomPct = Math.round(avgBudgetLostIS * 100);

  // Scenario: budget verandert, CPA blijft gelijk
  // Dit is de correcte aanname bij tCPA bidding of stabiele efficiency
  const factor = 1 + budgetChange / 100;
  const newMonthlySpend = currentMonthlySpend * factor;
  const additionalMonthlySpend = newMonthlySpend - currentMonthlySpend;
  const additionalTotalSpend = additionalMonthlySpend * remainingMonths;

  // Conversies: extra spend / CPA = extra conversies (CPA constant)
  const additionalConversions = currentCpa > 0 ? additionalTotalSpend / currentCpa : 0;
  const newAnnualConv = Math.round(currentAnnualConv + additionalConversions);
  const newAnnualRev = Math.round(newAnnualConv * aov);
  const newAnnualSpend = Math.round(currentAnnualSpend + additionalTotalSpend);

  // ROAS en CPA: bij constante CPA en constante AOV
  // ROAS = omzet / spend = (conv × AOV) / spend = AOV / CPA → blijft gelijk
  // CPA = spend / conv → blijft gelijk (dat is de hele aanname)
  const newRoas = newAnnualSpend > 0 ? newAnnualRev / newAnnualSpend : 0;
  const newCpa = newAnnualConv > 0 ? newAnnualSpend / newAnnualConv : 0;

  // Target check
  const convTarget = conv.annualTarget;
  const hitsTarget = newAnnualConv >= convTarget && convTarget > 0;
  const convGap = convTarget - newAnnualConv;

  // Is the budget increase within IS headroom?
  const withinHeadroom = budgetChange <= headroomPct;

  const presets = [-25, 0, 25, 50, 75, 100];

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Calculator className="w-5 h-5 text-rm-blue" />
        <h3 className="text-base font-semibold text-rm-blue">Budget Scenario Builder</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Wat levert een budgetwijziging op? Berekend met constante CPA ({fmt(currentCpa)}) — de prijs per conversie verandert niet.
      </p>

      {/* Slider */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">Budget wijziging</span>
          <span className={`text-sm font-bold ${budgetChange > 0 ? "text-green-600" : budgetChange < 0 ? "text-red-500" : "text-rm-gray"}`}>
            {budgetChange > 0 ? "+" : ""}{budgetChange}%
          </span>
        </div>
        <div className="relative">
          <input
            type="range"
            min={-50}
            max={100}
            step={5}
            value={budgetChange}
            onChange={(e) => setBudgetChange(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-rm-blue"
          />
          {/* Headroom indicator */}
          {headroomPct > 0 && (
            <div
              className="absolute top-0 h-2 bg-green-200 rounded-l-lg pointer-events-none"
              style={{ left: "33.3%", width: `${Math.min(headroomPct, 100) * 0.667}%` }}
              title={`IS headroom: +${headroomPct}%`}
            />
          )}
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
          <span>-50%</span>
          <span>0%</span>
          <span>+50%</span>
          <span>+100%</span>
        </div>

        {/* Presets */}
        <div className="flex gap-1.5 mt-3">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setBudgetChange(p)}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                budgetChange === p
                  ? "bg-rm-blue text-white"
                  : "bg-gray-100 text-muted-foreground hover:text-rm-gray"
              }`}
            >
              {p > 0 ? "+" : ""}{p}%
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {budgetChange !== 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <ResultCard
              label="Maandbudget"
              before={fmt(currentMonthlySpend)}
              after={fmt(newMonthlySpend)}
              diff={`${budgetChange > 0 ? "+" : ""}${fmt(additionalMonthlySpend)}/mnd`}
            />
            <ResultCard
              label="Jaarprognose conversies"
              before={num(currentAnnualConv)}
              after={num(newAnnualConv)}
              diff={`${additionalConversions > 0 ? "+" : ""}${num(additionalConversions)}`}
              highlight={hitsTarget && currentAnnualConv < convTarget}
            />
            <ResultCard
              label="CPA"
              before={fmt(currentCpa)}
              after={fmt(newCpa)}
              diff="Constant"
              neutral
            />
            <ResultCard
              label="ROAS"
              before={`${currentRoas.toFixed(2)}x`}
              after={`${newRoas.toFixed(2)}x`}
              diff={currentRoas > 0 ? `${((newRoas / currentRoas - 1) * 100).toFixed(1)}%` : "—"}
              neutral={Math.abs(newRoas - currentRoas) < 0.05}
            />
          </div>

          {/* IS Headroom info */}
          {budgetChange > 0 && headroomPct > 0 && (
            <div className={`px-4 py-3 rounded-lg border mb-3 ${
              withinHeadroom
                ? "bg-green-50 border-green-200"
                : "bg-amber-50 border-amber-200"
            }`}>
              {withinHeadroom ? (
                <p className="text-sm text-green-800">
                  <span className="font-medium">Binnen IS headroom.</span> Het account verliest gemiddeld {headroomPct}% Impression Share door budget — een verhoging van {budgetChange}% zit daar ruim binnen. Verwachte CPA blijft stabiel.
                </p>
              ) : (
                <p className="text-sm text-amber-800">
                  <span className="font-medium">Voorbij IS headroom.</span> De beschikbare IS headroom is ~{headroomPct}%, maar je verhoogt met {budgetChange}%. Boven de {headroomPct}% kan Google breder targeten met mogelijk hogere CPA. Overweeg ook zoekwoorden uitbreiden of nieuwe campagnetypes.
                </p>
              )}
            </div>
          )}

          {/* Target status */}
          {convTarget > 0 && (
            <div className={`px-4 py-3 rounded-lg border ${
              hitsTarget ? "bg-green-50 border-green-200" : "bg-gray-50 border-border"
            }`}>
              {hitsTarget ? (
                <p className="text-sm text-green-800 font-medium">
                  ✓ Jaardoel van {num(convTarget)} conversies wordt gehaald ({num(newAnnualConv)} prognose).
                </p>
              ) : convGap > 0 ? (
                <p className="text-sm text-rm-gray">
                  Nog {num(convGap)} conversies tekort. Verhoog het budget verder of verbeter de campagne-efficiency.
                </p>
              ) : null}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {budgetChange === 0 && (
        <div className="text-center py-4 text-sm text-muted-foreground">
          Verschuif de slider om een scenario te berekenen
        </div>
      )}

      {/* Methodology note */}
      <div className="mt-4 flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Aanname: CPA blijft constant bij budgetwijziging (tCPA biedstrategie).
          Extra conversies = extra spend ÷ huidige CPA ({fmt(currentCpa)}).
          ROAS = omzet ÷ spend, verschuift minimaal bij constante AOV ({aov > 0 ? fmt(aov) : "n.v.t."}).
          {headroomPct > 0 && ` IS headroom: ${headroomPct}% van impressies wordt nu gemist door budget.`}
        </span>
      </div>
    </div>
  );
}

function ResultCard({
  label, before, after, diff, highlight, neutral,
}: {
  label: string;
  before: string;
  after: string;
  diff: string;
  highlight?: boolean;
  neutral?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${
      highlight ? "border-green-300 bg-green-50" : "border-border"
    }`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm text-muted-foreground">{before}</span>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
        <span className={`text-sm font-bold ${highlight ? "text-green-700" : "text-rm-blue"}`}>{after}</span>
      </div>
      <p className={`text-[10px] font-medium ${
        neutral ? "text-muted-foreground" :
        diff.startsWith("+") ? "text-green-600" :
        diff.startsWith("-") ? "text-red-500" :
        "text-muted-foreground"
      }`}>
        {diff}
      </p>
    </div>
  );
}
