"use client";

import { useState } from "react";
import { FileText, Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { computeForecast, MONTH_LABELS } from "@/lib/forecast";
import { getClientSettings } from "@/lib/client-settings";
import { getAllClients } from "@/lib/clients";
import { fixMojibake } from "@/lib/analysis/sanitize";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

function pct(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)}%`;
}

export function ReportExport({ clientId }: { clientId: string }) {
  const [copied, setCopied] = useState(false);
  const data = useClientHistoricalData(clientId);
  const forecast = computeForecast(data);
  const settings = getClientSettings(clientId);
  const clientName = getAllClients().find((c) => c.id === clientId)?.name ?? clientId;

  const conv = forecast.conversions.kpi;
  const rev = forecast.revenue.kpi;
  const roas = forecast.roas.kpi;
  const cpa = forecast.cpa.kpi;
  const budget = forecast.budgetRecommendation;
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null);
  const lastMonth = realizedMonths[realizedMonths.length - 1];

  const now = new Date();
  const dateStr = now.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

  function generateReport(): string {
    const lines: string[] = [];

    lines.push(`# ${clientName} — Performance Rapport`);
    lines.push(`Datum: ${dateStr}`);
    lines.push(`Periode: Januari - ${lastMonth?.monthLabel ?? "?"} ${now.getFullYear()}`);
    lines.push("");

    // KPI overview
    lines.push("## KPI Overzicht");
    lines.push("");
    lines.push("| KPI | YTD Gerealiseerd | Jaardoel | Jaarprognose | Verschil |");
    lines.push("|-----|-----------------|----------|-------------|----------|");
    lines.push(`| Conversies | ${num(conv.ytdRealized)} | ${num(conv.annualTarget)} | ${num(conv.adjustedAnnual)} | ${pct(conv.diffPct)} |`);
    lines.push(`| Omzet | ${fmt(rev.ytdRealized)} | ${fmt(rev.annualTarget)} | ${fmt(rev.adjustedAnnual)} | ${pct(rev.diffPct)} |`);
    lines.push(`| ROAS | ${roas.ytdRealized.toFixed(2)}x | ${roas.annualTarget.toFixed(2)}x | ${roas.adjustedAnnual.toFixed(2)}x | ${pct(roas.diffPct)} |`);
    lines.push(`| CPA | ${fmt(cpa.ytdRealized)} | ${fmt(cpa.annualTarget)} | ${fmt(cpa.adjustedAnnual)} | ${pct(cpa.diffPct)} |`);
    lines.push("");

    // Monthly breakdown
    lines.push("## Maandoverzicht (Conversies)");
    lines.push("");
    lines.push("| Maand | Verwacht | Gerealiseerd | Prognose | Ratio |");
    lines.push("|-------|---------|-------------|---------|-------|");
    for (const pt of forecast.conversions.points) {
      const value = pt.realized !== null ? num(pt.realized) : pt.forecast !== null ? `*${num(pt.forecast)}*` : "-";
      const label = pt.realized !== null ? "Gerealiseerd" : "Prognose";
      lines.push(`| ${pt.monthLabel} | ${num(pt.expected)} | ${value} | ${label} | ${(pt.monthRatio * 100).toFixed(0)}% |`);
    }
    lines.push("");

    // Performance factor
    lines.push("## Analyse");
    lines.push("");
    lines.push(`- **Performance factor**: ${(conv.projectionFactor * 100).toFixed(1)}% (gewogen gemiddelde van gerealiseerde maanden)`);
    lines.push(`- **Spend YTD**: ${fmt(forecast.adSpend.kpi.ytdRealized)} van ${fmt(forecast.adSpend.kpi.annualTarget)} (${pct(forecast.adSpend.kpi.diffPct)})`);
    lines.push(`- **CPA trend**: ${fmt(cpa.ytdRealized)} gemiddeld YTD`);
    lines.push("");

    // Budget recommendation
    if (budget.behindTarget) {
      lines.push("## Budget Aanbeveling");
      lines.push("");
      lines.push(`Het jaardoel wordt op basis van de huidige trend niet gehaald. Om het doel te bereiken:`);
      lines.push("");
      lines.push(`- **Conversie gap**: ${num(budget.conversionGap)} conversies tekort`);
      lines.push(`- **Huidige CPA**: ${fmt(budget.currentCpa)}`);
      lines.push(`- **Extra budget nodig**: ${fmt(budget.extraSpendNeeded)}`);
      lines.push(`- **Benodigd maandbudget**: ${fmt(budget.requiredMonthlySpend)}/maand (huidig: ${fmt(budget.currentMonthlySpend)}/maand)`);
      if (budget.spendIncreasePct > 0) {
        lines.push(`- **Budget verhoging**: +${Math.round(budget.spendIncreasePct)}%`);
      }
      lines.push("");
    }

    // Top insights
    lines.push("## Status");
    lines.push("");
    if (conv.diffPct < -10) {
      lines.push(`⚠️ Performance ligt ${pct(conv.diffPct)} onder target voor conversies.`);
    } else if (conv.diffPct > 10) {
      lines.push(`✅ Performance ligt ${pct(conv.diffPct)} boven target.`);
    } else {
      lines.push(`✅ Performance ligt binnen bereik van het doel.`);
    }
    lines.push("");

    lines.push("---");
    lines.push(`*Gegenereerd door Ranking Masters SEA Dashboard op ${dateStr}*`);

    return lines.join("\n");
  }

  function handleCopy() {
    const report = fixMojibake(generateReport());
    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const report = fixMojibake(generateReport());
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${clientName.replace(/\s+/g, "-").toLowerCase()}-rapport-${now.toISOString().split("T")[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-rm-blue" />
          <h3 className="text-base font-semibold text-rm-blue">Klantrapport</h3>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Gekopieerd!" : "Kopieer"}
          </Button>
          <Button size="sm" onClick={handleDownload} className="gap-1.5 text-xs bg-rm-blue hover:bg-rm-blue-light text-white">
            <Download className="w-3.5 h-3.5" />
            Download .md
          </Button>
        </div>
      </div>

      {/* Preview */}
      <div className="bg-gray-50 rounded-lg p-4 max-h-[400px] overflow-y-auto">
        <pre className="text-xs text-rm-gray whitespace-pre-wrap font-mono leading-relaxed">
          {generateReport()}
        </pre>
      </div>
    </div>
  );
}
