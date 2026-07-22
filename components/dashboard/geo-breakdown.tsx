"use client";

import { useState, useMemo } from "react";
import { Globe2 } from "lucide-react";
import { useClientDataState } from "@/lib/client-data-provider";
import { countryLabel } from "@/lib/countries";

// Geo-mapping: waar komt het verkeer / de conversies vandaan, per gekozen metric. Interactief —
// je kiest de metric (impressies, klikken, CTR, conversies, conversieratio, CPA) en de landen
// herordenen + herkleuren ernaar. Dit is het analytische hart (per-land uitsplitsing uit
// ads_country_monthly); de gekleurde wereldkaart (choropleth) komt hier als visuele skin bovenop.
// Ratio's uit de landtotalen, nooit uit een gemiddelde van maand-deelwaarden.

interface CountryAgg { code: string; impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number }

type MetricKey = "impressions" | "clicks" | "ctr" | "conversions" | "conversionRate" | "cpa";
interface MetricDef { key: MetricKey; label: string; higherIsBetter: boolean; value: (a: CountryAgg) => number | null; fmt: (v: number | null) => string }

const nf = (d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d });
const eur = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
const int = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : nf(0).format(v));

const METRICS: MetricDef[] = [
  { key: "impressions", label: "Vertoningen", higherIsBetter: true, value: (a) => a.impressions, fmt: int },
  { key: "clicks", label: "Klikken", higherIsBetter: true, value: (a) => a.clicks, fmt: int },
  { key: "ctr", label: "CTR", higherIsBetter: true, value: (a) => (a.impressions > 0 ? a.clicks / a.impressions : null), fmt: pct },
  { key: "conversions", label: "Conversies", higherIsBetter: true, value: (a) => a.conversions, fmt: (v) => (v == null ? "—" : nf(1).format(v)) },
  { key: "conversionRate", label: "Conversieratio", higherIsBetter: true, value: (a) => (a.clicks > 0 ? a.conversions / a.clicks : null), fmt: pct },
  { key: "cpa", label: "CPA", higherIsBetter: false, value: (a) => (a.conversions > 0 ? a.cost / a.conversions : null), fmt: eur },
];

export function GeoBreakdown({ clientId }: { clientId: string }) {
  const state = useClientDataState();
  const [metricKey, setMetricKey] = useState<MetricKey>("conversions");
  const metric = METRICS.find((m) => m.key === metricKey)!;

  const rows = state?.countryMonthlyData ?? [];
  const countries = useMemo<CountryAgg[]>(() => {
    const map = new Map<string, CountryAgg>();
    for (const r of rows) {
      const code = String(r.countryCode || "").toUpperCase();
      if (!code) continue;
      const a = map.get(code) ?? { code, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
      a.impressions += r.impressions; a.clicks += r.clicks; a.cost += r.cost; a.conversions += r.conversions; a.conversionsValue += r.conversionsValue;
      map.set(code, a);
    }
    return [...map.values()];
  }, [rows]);

  const ranked = useMemo(() => {
    const withVal = countries.map((c) => ({ c, v: metric.value(c) }));
    // Sorteer op de metric: bij "hoger is beter" aflopend, bij CPA oplopend (goedkoopst eerst).
    return withVal
      .filter((x) => x.v != null && Number.isFinite(x.v))
      .sort((a, b) => (metric.higherIsBetter ? (b.v! - a.v!) : (a.v! - b.v!)));
  }, [countries, metric]);

  // Schaal voor de balklengte: altijd op de absolute grootte van de metric (max = vol).
  const maxV = useMemo(() => Math.max(1, ...ranked.map((x) => Math.abs(x.v ?? 0))), [ranked]);

  if (countries.length <= 1) return null; // één (of geen) land: geen geo-verhaal

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Globe2 className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">Waar komt het vandaan — per land</h3>
        <span className="text-[11px] text-muted-foreground">kies een metric</span>
        <div className="ml-auto flex gap-1 flex-wrap">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetricKey(m.key)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${m.key === metricKey ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4 space-y-1.5">
        {ranked.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-4 text-center">Geen land-data voor deze metric.</p>
        ) : (
          ranked.map(({ c, v }) => {
            const frac = Math.min(1, Math.abs(v ?? 0) / maxV);
            return (
              <div key={c.code} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-[12px] text-rm-gray font-medium truncate">{countryLabel(c.code)}</div>
                <div className="flex-1 h-5 rounded bg-gray-100 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${Math.max(2, frac * 100)}%`, background: "var(--brand-primary, #08288C)", opacity: 0.35 + frac * 0.6 }} />
                </div>
                <div className="w-24 shrink-0 text-right text-[12px] font-semibold text-rm-gray tabular-nums">{metric.fmt(v)}</div>
              </div>
            );
          })
        )}
      </div>

      {/* Volledige tabel: alle metrics per land, zodat je naast de gekozen metric ook de rest ziet. */}
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-5 py-2 font-medium">Land</th>
              <th className="px-3 py-2 font-medium text-right">Vertoningen</th>
              <th className="px-3 py-2 font-medium text-right">Klikken</th>
              <th className="px-3 py-2 font-medium text-right">CTR</th>
              <th className="px-3 py-2 font-medium text-right">Conversies</th>
              <th className="px-3 py-2 font-medium text-right">Conv.ratio</th>
              <th className="px-5 py-2 font-medium text-right">CPA</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ c }) => (
              <tr key={c.code} className="border-b border-border/50">
                <td className="px-5 py-1.5 text-rm-gray font-medium">{countryLabel(c.code)}</td>
                <td className="px-3 py-1.5 text-right">{int(c.impressions)}</td>
                <td className="px-3 py-1.5 text-right">{int(c.clicks)}</td>
                <td className="px-3 py-1.5 text-right">{pct(c.impressions > 0 ? c.clicks / c.impressions : null)}</td>
                <td className="px-3 py-1.5 text-right">{c.conversions == null ? "—" : nf(1).format(c.conversions)}</td>
                <td className="px-3 py-1.5 text-right">{pct(c.clicks > 0 ? c.conversions / c.clicks : null)}</td>
                <td className="px-5 py-1.5 text-right">{eur(c.conversions > 0 ? c.cost / c.conversions : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
