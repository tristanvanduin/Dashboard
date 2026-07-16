"use client";

import { TrendingUp, TrendingDown, Target, DollarSign, BarChart3, Wallet } from "lucide-react";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast } from "@/lib/forecast";
import { getClientSettings } from "@/lib/client-settings";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("nl-NL").format(value);
}

interface KpiCardProps {
  label: string;
  icon: React.ReactNode;
  annualTarget: number;
  adjusted: number;
  realized: number;
  diffPct: number;
  format: (v: number) => string;
  /** Subtitle shown below the label */
  subtitle?: string;
}

function KpiCard({ label, icon, annualTarget, adjusted, realized, diffPct, format, subtitle }: KpiCardProps) {
  const yearProgress = 25; // end of Q1
  const realizedPct = annualTarget > 0 ? (realized / annualTarget) * 100 : 0;

  const isPositive = diffPct >= 0;
  const StatusIcon = isPositive ? TrendingUp : TrendingDown;
  const statusColor = isPositive ? "text-green-600" : "text-red-500";
  const statusBg = isPositive ? "bg-green-50" : "bg-red-50";

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rm-blue/10 flex items-center justify-center">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-rm-blue">{label}</h3>
            {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className={`w-7 h-7 rounded-full ${statusBg} flex items-center justify-center`}>
          <StatusIcon className={`w-3.5 h-3.5 ${statusColor}`} />
        </div>
      </div>

      {/* Big number: YTD realized */}
      <div className="mb-4">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
          Gerealiseerd YTD
        </p>
        <p className="text-2xl font-bold text-rm-blue leading-none">
          {format(realized)}
        </p>
      </div>

      {/* Target + Forecast */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Jaardoel</span>
          <span className="text-xs font-semibold text-rm-gray">{format(annualTarget)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Jaarprognose</span>
          <span className="text-xs font-semibold text-rm-blue">{format(adjusted)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-[10px] mb-1.5">
          <span className="text-muted-foreground">{Math.round(realizedPct)}% gerealiseerd</span>
          <span className={`font-bold ${statusColor}`}>
            {diffPct > 0 ? "+" : ""}{diffPct.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden relative">
          {/* Expected position marker */}
          <div
            className="absolute top-0 bottom-0 w-px bg-rm-blue/30 z-10"
            style={{ left: `${yearProgress}%` }}
          />
          <div
            className={`h-full rounded-full transition-all ${
              isPositive ? "bg-gradient-to-r from-green-400 to-green-500" : "bg-gradient-to-r from-red-400 to-red-500"
            }`}
            style={{ width: `${Math.min(realizedPct, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
          <span>0%</span>
          <span>Q1 verwacht ({yearProgress}%)</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

export function MetricCards({ clientId, countryFilter }: { clientId: string; countryFilter?: string | null }) {
  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const forecast = computeForecast(data);
  const settings = getClientSettings(clientId);
  const kpi = settings.kpiTargets;

  // CPA calculation
  const forecastedCpa = forecast.conversions.kpi.adjustedAnnual > 0
    ? data.targetCurrentYear.adSpend / forecast.conversions.kpi.adjustedAnnual
    : 0;
  const ytdConversions = forecast.conversions.kpi.ytdRealized;
  const ytdSpend = data.currentYearData
    .slice(0, 3)
    .reduce((s, r) => s + (r?.adSpend ?? 0), 0);
  const ytdCpa = ytdConversions > 0 ? ytdSpend / ytdConversions : 0;
  const cpaDiffPct = kpi.cpaTarget > 0
    ? ((kpi.cpaTarget - forecastedCpa) / kpi.cpaTarget) * 100  // inverted: lower CPA = better
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiCard
        label="Conversies"
        icon={<Target className="w-4 h-4 text-rm-blue" />}
        annualTarget={forecast.conversions.kpi.annualTarget}
        adjusted={forecast.conversions.kpi.adjustedAnnual}
        realized={forecast.conversions.kpi.ytdRealized}
        diffPct={forecast.conversions.kpi.diffPct}
        format={formatNumber}
        subtitle="Totaal aantal"
      />
      <KpiCard
        label="Omzet"
        icon={<DollarSign className="w-4 h-4 text-rm-blue" />}
        annualTarget={forecast.revenue.kpi.annualTarget}
        adjusted={forecast.revenue.kpi.adjustedAnnual}
        realized={forecast.revenue.kpi.ytdRealized}
        diffPct={forecast.revenue.kpi.diffPct}
        format={formatCurrency}
        subtitle="Conversiewaarde"
      />
      <KpiCard
        label="ROAS"
        icon={<BarChart3 className="w-4 h-4 text-rm-blue" />}
        annualTarget={forecast.roas.kpi.annualTarget}
        adjusted={forecast.roas.kpi.adjustedAnnual}
        realized={forecast.roas.kpi.ytdRealized}
        diffPct={forecast.roas.kpi.diffPct}
        format={(v: number) => `${v.toFixed(2)}x`}
        subtitle="Return on ad spend"
      />
      <KpiCard
        label="CPA"
        icon={<Wallet className="w-4 h-4 text-rm-blue" />}
        annualTarget={kpi.cpaTarget}
        adjusted={forecastedCpa}
        realized={ytdCpa}
        diffPct={cpaDiffPct}
        format={(v: number) => `€${v.toFixed(2)}`}
        subtitle="Cost per acquisition"
      />
    </div>
  );
}
