"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, TrendingDown, Layers } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { analyzeCreativeFatigue, type CreativePeriodRow, type FatigueStatus } from "@/lib/analysis/creative-fatigue";
import { analyzeAssetBreakdown, type AssetRow, type AssetVerdict } from "@/lib/analysis/asset-breakdown";

// De grondige creative-uitwerking op het Analyses-tabblad (de quick-scan staat op Overzicht):
// het CTR-traject per creative over de maanden (vermoeidheid) en — voor Google RSA — welke
// headlines/descriptions het gewicht trekken. Beide deterministisch en los getest; deze
// component doet alleen de fetch, aggregatie naar maandbuckets en de weergave.

type ChannelKind = "google" | "meta" | "linkedin";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0));
const pct = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
const fmt = (v: number): string => new Intl.NumberFormat("nl-NL").format(v);

const FATIGUE_STYLE: Record<FatigueStatus, string> = {
  vermoeid: "text-red-700 bg-red-50 border-red-200",
  afnemend: "text-amber-700 bg-amber-50 border-amber-200",
  stabiel: "text-emerald-700 bg-emerald-50 border-emerald-200",
  te_weinig_data: "text-gray-500 bg-gray-50 border-gray-200",
};
const FATIGUE_LABEL: Record<FatigueStatus, string> = {
  vermoeid: "Vermoeid", afnemend: "Afnemend", stabiel: "Stabiel", te_weinig_data: "Te weinig data",
};
const VERDICT_STYLE: Record<AssetVerdict, string> = {
  sterk: "text-emerald-700 bg-emerald-50 border-emerald-200",
  zwak: "text-red-700 bg-red-50 border-red-200",
  neutraal: "text-gray-600 bg-gray-50 border-gray-200",
  te_weinig_data: "text-gray-400 bg-gray-50 border-gray-200",
};

// Mini-sparkline van CTR-punten; null-punten (geen volume) breken de lijn niet visueel af.
function Spark({ points }: { points: (number | null)[] }) {
  const vals = points.filter((p): p is number => p != null);
  if (vals.length < 2) return <span className="text-[10px] text-gray-300">—</span>;
  const max = Math.max(...vals), min = Math.min(...vals);
  const range = max - min || 1;
  const w = 72, h = 20;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => (p == null ? null : `${i * step},${h - ((p - min) / range) * (h - 3) - 1.5}`)).filter(Boolean).join(" ");
  return (
    <svg width={w} height={h} className="inline-block align-middle">
      <polyline points={coords} fill="none" stroke="#08288C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CreativeDeepDive({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const [periodRows, setPeriodRows] = useState<CreativePeriodRow[] | null>(null);
  const [assetRows, setAssetRows] = useState<AssetRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setPeriodRows(null); setAssetRows([]); setError(null);
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

    // Bouw maand-per-creative-rijen uit dagdata: sommeer per (id, YYYY-MM).
    const bucketize = (rows: Record<string, unknown>[], idField: string, clkField: string, nameFor: (id: string) => string): CreativePeriodRow[] => {
      const agg = new Map<string, { impressions: number; clicks: number }>();
      for (const r of rows) {
        const id = String(r[idField]);
        const period = String(r.date ?? "").slice(0, 7);
        if (!period) continue;
        const key = `${id}__${period}`;
        const a = agg.get(key) ?? { impressions: 0, clicks: 0 };
        a.impressions += num(r.impressions); a.clicks += num(r[clkField]);
        agg.set(key, a);
      }
      return [...agg.entries()].map(([key, v]) => {
        const [id, period] = key.split("__");
        return { id, name: nameFor(id), period, impressions: v.impressions, clicks: v.clicks };
      });
    };

    async function load() {
      if (channel === "google") {
        const [{ data: perf, error: e1 }, { data: assets, error: e2 }] = await Promise.all([
          sb!.from("ads_creative_performance").select("ad_id, ad_group_name, campaign_name, month, impressions, clicks").eq("client_id", clientId).gte("month", since),
          sb!.from("google_ads_rsa_assets").select("asset_text, field_type, performance_label, impressions, clicks").eq("client_id", clientId).gte("month", since),
        ]);
        if (e1 || e2) { if (!cancelled) { setError((e1 ?? e2)!.message); setPeriodRows([]); } return; }
        const rows: CreativePeriodRow[] = ((perf ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
          id: String(r.ad_id), name: String(r.ad_group_name ?? r.campaign_name ?? r.ad_id),
          period: String(r.month ?? "").slice(0, 7), impressions: num(r.impressions), clicks: num(r.clicks),
        })).filter((r) => r.period);
        const arows: AssetRow[] = ((assets ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
          assetText: String(r.asset_text ?? ""), fieldType: String(r.field_type ?? ""),
          performanceLabel: String(r.performance_label ?? "UNKNOWN"), impressions: num(r.impressions), clicks: num(r.clicks),
        })).filter((r) => r.assetText);
        if (!cancelled) { setPeriodRows(rows); setAssetRows(arows); }
      } else if (channel === "meta") {
        const [{ data: ads }, { data: daily, error: e }] = await Promise.all([
          sb!.from("meta_ads").select("ad_id, name").eq("client_id", clientId),
          sb!.from("meta_ad_daily").select("entity_id, date, impressions, link_clicks").eq("client_id", clientId).gte("date", since),
        ]);
        if (e) { if (!cancelled) { setError(e.message); setPeriodRows([]); } return; }
        const nameMap = new Map((ads ?? []).map((a) => [String(a.ad_id), String(a.name ?? a.ad_id)]));
        const rows = bucketize((daily ?? []) as unknown as Record<string, unknown>[], "entity_id", "link_clicks", (id) => nameMap.get(id) ?? id);
        if (!cancelled) setPeriodRows(rows);
      } else {
        const [{ data: creatives }, { data: daily, error: e }] = await Promise.all([
          sb!.from("linkedin_creatives").select("creative_urn, headline, post_text").eq("client_id", clientId),
          sb!.from("linkedin_creative_daily").select("entity_urn, date, impressions, clicks").eq("client_id", clientId).gte("date", since),
        ]);
        if (e) { if (!cancelled) { setError(e.message); setPeriodRows([]); } return; }
        const nameMap = new Map((creatives ?? []).map((c) => [String(c.creative_urn), String(c.headline ?? c.post_text ?? c.creative_urn).slice(0, 60)]));
        const rows = bucketize((daily ?? []) as unknown as Record<string, unknown>[], "entity_urn", "clicks", (id) => nameMap.get(id) ?? id);
        if (!cancelled) setPeriodRows(rows);
      }
    }
    load().catch((err) => { if (!cancelled) { setError(String(err)); setPeriodRows([]); } });
    return () => { cancelled = true; };
  }, [clientId, channel]);

  const fatigue = useMemo(() => (periodRows ? analyzeCreativeFatigue(periodRows) : []), [periodRows]);
  const breakdown = useMemo(() => (channel === "google" ? analyzeAssetBreakdown(assetRows) : null), [assetRows, channel]);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  if (periodRows === null) return <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>;

  const flagged = fatigue.filter((f) => f.status === "vermoeid" || f.status === "afnemend");

  return (
    <div className="space-y-4">
      {/* Creative-vermoeidheid */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">Creative-vermoeidheid</h3>
          <span className="text-[10px] text-muted-foreground">CTR-traject per creative over de maanden</span>
        </div>
        {fatigue.length === 0 ? (
          <div className="px-5 py-4 text-[12px] text-muted-foreground">Nog geen maanddata per creative voor een vermoeidheidsoordeel.</div>
        ) : (
          <>
            <div className="px-5 py-2.5 text-[11px] text-muted-foreground border-b border-border">
              {flagged.length > 0
                ? `${flagged.length} van ${fatigue.length} creatives zakken onder hun CTR-piek — kandidaat om te verversen.`
                : `Geen materiële vermoeidheid over ${fatigue.length} creatives; het CTR-traject blijft stabiel.`}
            </div>
            <div className="divide-y divide-border">
              {fatigue.slice(0, 15).map((f) => (
                <div key={f.id} className="px-5 py-2.5 flex items-center gap-3">
                  <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${FATIGUE_STYLE[f.status]}`}>{FATIGUE_LABEL[f.status]}</span>
                  <span className="text-[12px] text-rm-gray truncate flex-1 min-w-0" title={f.name}>{f.name}</span>
                  <Spark points={f.points.map((p) => p.ctr)} />
                  <span className="text-[11px] text-muted-foreground w-28 text-right shrink-0">
                    {f.peakCtr != null ? `piek ${pct(f.peakCtr)} → ${pct(f.latestCtr)}` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Asset-uitsplitsing (alleen Google RSA) */}
      {breakdown && (breakdown.headlines.length > 0 || breakdown.descriptions.length > 0) && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <Layers className="w-4 h-4 text-rm-blue" />
            <h3 className="text-sm font-semibold text-rm-gray">Asset-uitsplitsing (RSA)</h3>
            <span className="text-[10px] text-muted-foreground">welke headlines/descriptions het gewicht trekken</span>
          </div>
          <div className="px-5 py-3 space-y-3">
            <p className="text-[12px] text-rm-gray leading-relaxed">{breakdown.summaryText}</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AssetColumn title="Headlines" stats={breakdown.headlines} />
              <AssetColumn title="Descriptions" stats={breakdown.descriptions} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Oordeel uit Google&apos;s eigen performance-label (BEST/LOW) gecombineerd met de CTR t.o.v. de mediaan binnen het veldtype.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetColumn({ title, stats }: { title: string; stats: { assetText: string; ctr: number | null; impressions: number; label: string; verdict: AssetVerdict }[] }) {
  if (stats.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <ul className="space-y-1.5">
        {stats.slice(0, 10).map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px]">
            <span className={`text-[9px] font-semibold border rounded px-1.5 py-0.5 shrink-0 capitalize ${VERDICT_STYLE[s.verdict]}`}>{s.verdict === "te_weinig_data" ? "weinig data" : s.verdict}</span>
            <span className="text-rm-gray truncate flex-1 min-w-0" title={s.assetText}>{s.assetText}</span>
            <span className="text-muted-foreground shrink-0 w-24 text-right">{pct(s.ctr)} · {fmt(s.impressions)} imp</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
