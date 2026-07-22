"use client";

import { useState, useMemo } from "react";
import { Globe2, Loader2, ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useClientDataState } from "@/lib/client-data-provider";
import { countryLabel } from "@/lib/countries";
import { stateLabel } from "@/lib/geo/us-fips";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { demoGeoCountries, demoGeoStates, type GeoAgg } from "@/lib/demo/geo-demo";

// De kaarten (SVG + geometrie + d3-geo) client-only en code-split laden: pas geladen als deze
// weergave rendert, en nooit tijdens SSR.
const WorldMap = dynamic(() => import("./world-map"), {
  ssr: false,
  loading: () => <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>,
});
const UsStatesMap = dynamic(() => import("./us-states-map"), {
  ssr: false,
  loading: () => <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>,
});

// Geo-mapping: waar komt het verkeer / de conversies vandaan, per gekozen metric. Interactief —
// je kiest de metric (impressies, klikken, CTR, conversies, conversieratio, CPA) en de landen
// herordenen + herkleuren ernaar. Klik op de VS om in te zoomen op de staten (drilldown).
// Werkt per kanaal: Google toont echte landdata; Meta/LinkedIn/blended tonen demo-geo tot de sync
// er is (Laag 2). Ratio's altijd uit de landtotalen, nooit uit een gemiddelde van maand-deelwaarden.

type Channel = "google" | "meta" | "linkedin" | "blended";

type MetricKey = "impressions" | "clicks" | "ctr" | "conversions" | "conversionRate" | "cpa";
interface MetricDef { key: MetricKey; label: string; higherIsBetter: boolean; value: (a: GeoAgg) => number | null; fmt: (v: number | null) => string }

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

const CHANNEL_LABEL: Record<Channel, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn", blended: "Alle kanalen" };

export function GeoBreakdown({ clientId, channel = "google" }: { clientId: string; channel?: Channel }) {
  const state = useClientDataState();
  const [metricKey, setMetricKey] = useState<MetricKey>("conversions");
  const [focus, setFocus] = useState<"US" | null>(null); // null = wereld, "US" = staten-drilldown
  const metric = METRICS.find((m) => m.key === metricKey)!;
  const demo = isDemoMode();

  // Land-databron per kanaal. Google = echte per-land data (ads_country_monthly, in demo de
  // curated set). Meta/LinkedIn/blended hebben nog geen gesyncte geo → demo-mock, of niets buiten demo.
  const countries = useMemo<GeoAgg[]>(() => {
    if (channel === "google") {
      const map = new Map<string, GeoAgg>();
      for (const r of state?.countryMonthlyData ?? []) {
        const code = String(r.countryCode || "").toUpperCase();
        if (!code) continue;
        const a = map.get(code) ?? { code, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
        a.impressions += r.impressions; a.clicks += r.clicks; a.cost += r.cost; a.conversions += r.conversions; a.conversionsValue += r.conversionsValue;
        map.set(code, a);
      }
      return [...map.values()];
    }
    return demo ? demoGeoCountries(channel) : [];
  }, [channel, state, demo]);

  // VS-staten (drilldown). Laag 1: alleen demo-data — echte staten-sync komt in Laag 2.
  const states = useMemo<GeoAgg[]>(() => (demo ? demoGeoStates(channel) : []), [channel, demo]);
  const canDrillUs = states.length > 0 && countries.some((c) => c.code === "US");

  const active = focus === "US" ? states : countries;
  const labelOf = focus === "US" ? stateLabel : countryLabel;
  const geoWord = focus === "US" ? "staat" : "land";

  const ranked = useMemo(() => {
    return active
      .map((c) => ({ c, v: metric.value(c) }))
      .filter((x) => x.v != null && Number.isFinite(x.v))
      // Sorteer op de metric: bij "hoger is beter" aflopend, bij CPA oplopend (goedkoopst eerst).
      .sort((a, b) => (metric.higherIsBetter ? (b.v! - a.v!) : (a.v! - b.v!)));
  }, [active, metric]);

  // Waarde per code (alpha-2-land óf USPS-staat) voor de kaart-inkleuring van de gekozen metric.
  const values = useMemo(() => {
    const m = new Map<string, number>();
    for (const { c, v } of ranked) if (v != null && Number.isFinite(v)) m.set(c.code, v);
    return m;
  }, [ranked]);

  if (countries.length <= 1) return null; // één (of geen) land: geen geo-verhaal

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Globe2 className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">
          Waar komt het vandaan{focus === "US" ? " — Verenigde Staten" : ""}
        </h3>
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{CHANNEL_LABEL[channel]}</span>
        {focus === "US" && (
          <button
            onClick={() => setFocus(null)}
            className="flex items-center gap-0.5 text-[11px] font-medium text-rm-blue hover:underline"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Wereld
          </button>
        )}
        {/* Slimme dropdown naast de kaart: kies de metric die de kaart inkleurt. */}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Toon
          <select
            value={metricKey}
            onChange={(e) => setMetricKey(e.target.value as MetricKey)}
            className="rounded-md border border-border bg-white px-2 py-1 text-[12px] font-medium text-rm-gray focus:outline-none focus:ring-1 focus:ring-rm-blue"
          >
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          per {geoWord}
        </label>
      </div>

      <div className="px-3 py-3">
        {ranked.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-4 text-center">Geen {geoWord}-data voor deze metric.</p>
        ) : focus === "US" ? (
          <UsStatesMap values={values} format={metric.fmt} metricLabel={metric.label} />
        ) : (
          <WorldMap values={values} format={metric.fmt} metricLabel={metric.label} onCountryClick={canDrillUs ? (a) => a === "US" && setFocus("US") : undefined} />
        )}
        {focus == null && canDrillUs && (
          <p className="text-center text-[11px] text-muted-foreground pt-1">Klik op de <strong>Verenigde Staten</strong> om de staten te zien.</p>
        )}
      </div>

      {/* Volledige tabel: alle metrics per land/staat, zodat je naast de gekozen metric ook de rest ziet. */}
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-5 py-2 font-medium">{focus === "US" ? "Staat" : "Land"}</th>
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
                <td className="px-5 py-1.5 text-rm-gray font-medium">{labelOf(c.code)}</td>
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
