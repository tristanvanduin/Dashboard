"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, MapPin, Info, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { aggregateCampaignMonthlyByGeoClone, type CampaignMonthlyRow } from "@/lib/rai/geo-clone-aggregate";
import { RAI_GEO_CLONES } from "@/lib/rai/geo-clone-catalog";
import { SignalAnalysisCard } from "./signal-analysis-card";
import { MonthlyTrendChart } from "./monthly-trend-chart";

// Fase 1c: account-brede kaarten kunnen niet per geo-clone gesplitst worden (de account-tabel
// draagt geen campagnenaam). Daarom her-aggregeren we de KPI's PER geo-clone uit
// ads_campaign_monthly (die wél campaign_name draagt) en tonen we dat overzicht zodra een beurs
// gekozen is. Ratio's komen uit de maandtotalen — nooit uit gemiddelde deelwaarden.

function fmt(n: number | null, opts?: Intl.NumberFormatOptions): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0, ...opts }).format(n);
}
function fmtEur(n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
function fmtPct(ratio: number | null): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(ratio);
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-4 py-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-rm-gray mt-0.5">{value}</div>
    </div>
  );
}

export function GeoCloneOverview({ clientId, geoClone }: { clientId: string; geoClone: string }) {
  const [rows, setRows] = useState<CampaignMonthlyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const variant = useMemo(() => RAI_GEO_CLONES.find((v) => v.abbreviation === geoClone) ?? null, [geoClone]);
  const label = variant ? `${variant.brand} ${variant.location}` : geoClone;

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setRows(null); setError(null);
    sb.from("ads_campaign_monthly")
      .select("campaign_name, month, impressions, clicks, cost, conversions, conversions_value")
      .eq("client_id", clientId)
      .order("month", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setRows((data ?? []) as CampaignMonthlyRow[]);
      });
    return () => { cancelled = true; };
  }, [clientId]);

  const summary = useMemo(() => (rows ? aggregateCampaignMonthlyByGeoClone(rows, geoClone) : null), [rows, geoClone]);
  // Focus op het advertentievenster: de recente maanden richting de beurs, niet de hele historie.
  const RECENT_MONTHS = 6;
  const recentMonths = useMemo(() => (summary ? summary.months.slice(-RECENT_MONTHS) : []), [summary]);
  const monthsDesc = useMemo(() => [...recentMonths].reverse(), [recentMonths]);

  return (
    <div className="space-y-6">
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <MapPin className="w-5 h-5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">{label} — beursoverzicht</h3>
        <span className="text-[11px] text-muted-foreground">({geoClone})</span>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[11px] text-blue-800 flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Deze cijfers zijn <strong>her-geaggregeerd per beurs</strong> uit de campagnedata (op basis van de
            afkorting <strong>{geoClone}</strong> in de campagnenaam). Ratio&apos;s (CPA, ROAS, CTR) komen uit de
            maandtotalen, niet uit een gemiddelde van deelwaarden.
          </span>
        </div>

        {rows === null && !error && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Laden...
          </div>
        )}
        {error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>
        )}
        {summary && summary.months.length === 0 && !error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
            Nog geen campagnedata voor <strong>{label}</strong> ({geoClone}). Zodra er campagnes met deze afkorting
            gesynct zijn, verschijnt hier het beursoverzicht.
          </div>
        )}

        {summary && summary.months.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <Kpi label="Spend" value={fmtEur(summary.totals.cost)} />
              <Kpi label="Conversies" value={fmt(summary.totals.conversions, { maximumFractionDigits: 1 })} />
              <Kpi label="Conv.waarde" value={fmtEur(summary.totals.conversionsValue)} />
              <Kpi label="CPA" value={fmtEur(summary.totals.cpa)} />
              <Kpi label="ROAS" value={summary.totals.roas === null ? "—" : `${summary.totals.roas.toFixed(2)}×`} />
              <Kpi label="CTR" value={fmtPct(summary.totals.ctr)} />
            </div>

            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              {summary.campaignCount} campagne{summary.campaignCount === 1 ? "" : "s"} · laatste {recentMonths.length} maand
              {recentMonths.length === 1 ? "" : "en"} getoond (van {summary.months.length}).
            </div>

            <MonthlyTrendChart
              title="Maandverloop (laatste maanden richting de beurs)"
              lineLabel="Conversies"
              data={recentMonths.map((m) => ({ maand: m.month.slice(0, 7), spend: m.cost, lijn: m.conversions }))}
            />

            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4 font-medium">Maand</th>
                    <th className="py-2 pr-4 font-medium text-right">Spend</th>
                    <th className="py-2 pr-4 font-medium text-right">Klikken</th>
                    <th className="py-2 pr-4 font-medium text-right">Conversies</th>
                    <th className="py-2 pr-4 font-medium text-right">Conv.waarde</th>
                    <th className="py-2 pr-4 font-medium text-right">CPA</th>
                    <th className="py-2 pr-4 font-medium text-right">ROAS</th>
                    <th className="py-2 font-medium text-right">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {monthsDesc.map((m) => (
                    <tr key={m.month} className="border-b border-border/50">
                      <td className="py-1.5 pr-4 text-muted-foreground">{m.month.slice(0, 7)}</td>
                      <td className="py-1.5 pr-4 text-right">{fmtEur(m.cost)}</td>
                      <td className="py-1.5 pr-4 text-right">{fmt(m.clicks)}</td>
                      <td className="py-1.5 pr-4 text-right">{fmt(m.conversions, { maximumFractionDigits: 1 })}</td>
                      <td className="py-1.5 pr-4 text-right">{fmtEur(m.conversionsValue)}</td>
                      <td className="py-1.5 pr-4 text-right">{fmtEur(m.cpa)}</td>
                      <td className="py-1.5 pr-4 text-right">{m.roas === null ? "—" : `${m.roas.toFixed(2)}×`}</td>
                      <td className="py-1.5 text-right">{fmtPct(m.ctr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>

    {/* Fase 4: de event-relatieve beursanalyse (editie-over-editie + projectie richting beursdag). */}
    <SignalAnalysisCard
      clientId={clientId}
      endpoint="/api/analysis/geo-clone"
      extra={{ geo_clone: geoClone }}
      title={`Beursanalyse ${label}`}
      description="Event-relatief: aanloop naar deze editie vs dezelfde afstand tot de vorige editie (cadans-bewust), plus projectie richting de beursdag tegen het doel. Bijsturing landt in de goedkeuringswachtrij."
      runLabel="Draai beursanalyse"
    />
    </div>
  );
}
