"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Calendar, TrendingUp, Gauge, BarChart3 } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { supabase } from "@/lib/supabase";

// Volwaardige prestatie-view voor Meta en LinkedIn: dezelfde bouwstenen als Google
// (KPI-kaarten, pacing, maandtabel, grafiek, campagnetabel), gevoed uit de dag-tabellen van
// het kanaal. Ratio's UIT TOTALEN (venster/maand), nooit uit dag-gemiddelden. Pacing is
// maand-tot-nu tegen dezelfde dag-telling van de vorige maand: geen doel nodig, wel eerlijk
// tempo-inzicht. De analyses draaien elders (Analyses-tab); dit is de data-weergave.

type ChannelKind = "meta" | "linkedin";

interface DailyRow {
  date: string;
  entity: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  leads: number;
}

interface ChannelConfig {
  accountTable: string;
  campaignTable: string;
  nameTable: string;
  nameId: string;
  entityField: string;
  select: string;
  map: (r: Record<string, unknown>) => Omit<DailyRow, "entity"> & { entity: string };
  convLabel: string; // "Conversies" of "Leads"
  useLeads: boolean;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const CONFIG: Record<ChannelKind, ChannelConfig> = {
  meta: {
    accountTable: "meta_account_daily",
    campaignTable: "meta_campaign_daily",
    nameTable: "meta_campaigns",
    nameId: "campaign_id",
    entityField: "entity_id",
    select: "date, entity_id, impressions, link_clicks, spend, conversions, leads",
    map: (r) => ({ date: String(r.date), entity: String(r.entity_id), impressions: num(r.impressions), clicks: num(r.link_clicks), spend: num(r.spend), conversions: num(r.conversions), leads: num(r.leads) }),
    convLabel: "Conversies",
    useLeads: false,
  },
  linkedin: {
    accountTable: "linkedin_account_daily",
    campaignTable: "linkedin_campaign_daily",
    nameTable: "linkedin_campaigns",
    nameId: "campaign_urn",
    entityField: "entity_urn",
    select: "date, entity_urn, impressions, clicks, spend, external_website_conversions, one_click_leads",
    map: (r) => ({ date: String(r.date), entity: String(r.entity_urn), impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend), conversions: num(r.external_website_conversions), leads: num(r.one_click_leads) }),
    convLabel: "Leads",
    useLeads: true,
  },
};

const eur = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const fmt = (v: number | null, d = 0): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v));
const pctS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
const deltaS = (cur: number | null, prev: number | null): string | null =>
  cur != null && prev != null && prev > 0 ? `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%` : null;

interface Agg { impressions: number; clicks: number; spend: number; conv: number }
const emptyAgg = (): Agg => ({ impressions: 0, clicks: 0, spend: 0, conv: 0 });

export function ChannelPerformance({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const cfg = CONFIG[channel];
  const [account, setAccount] = useState<DailyRow[] | null>(null);
  const [campaign, setCampaign] = useState<DailyRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setAccount(null); setError(null);
    const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    const since35 = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
    Promise.all([
      sb.from(cfg.accountTable).select(cfg.select).eq("client_id", clientId).gte("date", since),
      sb.from(cfg.campaignTable).select(cfg.select).eq("client_id", clientId).gte("date", since35),
      sb.from(cfg.nameTable).select(`${cfg.nameId}, name`).eq("client_id", clientId),
    ]).then(([accRes, campRes, nameRes]) => {
      if (cancelled) return;
      if (accRes.error) { setError(accRes.error.message); setAccount([]); return; }
      setAccount(((accRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map));
      setCampaign(((campRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map));
      setNames(new Map(((nameRes.data ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r[cfg.nameId]), String(r.name ?? r[cfg.nameId])])));
    });
    return () => { cancelled = true; };
  }, [clientId, channel, cfg]);

  const convOf = (r: { conversions: number; leads: number }) => (cfg.useLeads ? r.leads : r.conversions);

  const derived = useMemo(() => {
    if (!account || account.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const curMonth = today.slice(0, 7);

    // Maand-aggregatie (volle maanden, laatste 6).
    const byMonth = new Map<string, Agg>();
    for (const r of account) {
      const m = r.date.slice(0, 7);
      const a = byMonth.get(m) ?? emptyAgg();
      a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convOf(r);
      byMonth.set(m, a);
    }
    const fullMonths = [...byMonth.entries()].filter(([m]) => m < curMonth).sort().slice(-6);

    // KPI-vensters: laatste 28 dagen vs de 28 ervoor.
    const win = (from: number, to: number): Agg => {
      const a = emptyAgg();
      for (const r of account) {
        const age = (new Date(today).getTime() - new Date(r.date).getTime()) / 86_400_000;
        if (age >= from && age < to) { a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convOf(r); }
      }
      return a;
    };
    const recent = win(0, 28);
    const prior = win(28, 56);

    // Pacing: maand-tot-nu vs dezelfde dag-telling vorige maand.
    const dayOfMonth = Number(today.slice(8, 10));
    const prevMonthDate = new Date(today); prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonth = prevMonthDate.toISOString().slice(0, 7);
    const mtd = emptyAgg(); const prevMtd = emptyAgg();
    for (const r of account) {
      const day = Number(r.date.slice(8, 10));
      if (r.date.slice(0, 7) === curMonth) { mtd.spend += r.spend; mtd.conv += convOf(r); }
      if (r.date.slice(0, 7) === prevMonth && day <= dayOfMonth) { prevMtd.spend += r.spend; prevMtd.conv += convOf(r); }
    }

    // Campagnetabel: laatste 28 dagen per campagne.
    const byCampaign = new Map<string, Agg>();
    for (const r of campaign) {
      const age = (new Date(today).getTime() - new Date(r.date).getTime()) / 86_400_000;
      if (age >= 28) continue;
      const a = byCampaign.get(r.entity) ?? emptyAgg();
      a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convOf(r);
      byCampaign.set(r.entity, a);
    }
    const campaigns = [...byCampaign.entries()].map(([entity, a]) => ({ entity, ...a })).sort((a, b) => b.spend - a.spend);

    return { fullMonths, recent, prior, mtd, prevMtd, campaigns, dayOfMonth };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, campaign, cfg.useLeads]);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  if (account === null) {
    return <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>;
  }
  if (!derived) return null; // geen data: de kanaaltab toont al de eerlijke lege staat

  const { fullMonths, recent, prior, mtd, prevMtd, campaigns, dayOfMonth } = derived;
  const cpa = (a: Agg): number | null => (a.conv > 0 ? a.spend / a.conv : null);
  const ctr = (a: Agg): number | null => (a.impressions > 0 ? a.clicks / a.impressions : null);
  const chartData = fullMonths.map(([m, a]) => ({ maand: m, Spend: Math.round(a.spend), [cfg.convLabel]: Math.round(a.conv) }));
  const pace = deltaS(mtd.spend, prevMtd.spend);
  const pacePct = mtd.spend > 0 && prevMtd.spend > 0 ? mtd.spend / prevMtd.spend : null;

  const kpis: { label: string; value: string; delta: string | null }[] = [
    { label: "Spend (28d)", value: eur(recent.spend), delta: deltaS(recent.spend, prior.spend) },
    { label: `${cfg.convLabel} (28d)`, value: fmt(recent.conv, 1), delta: deltaS(recent.conv, prior.conv) },
    { label: cfg.useLeads ? "CPL (28d)" : "CPA (28d)", value: eur(cpa(recent)), delta: deltaS(cpa(recent), cpa(prior)) },
    { label: "CTR (28d)", value: pctS(ctr(recent)), delta: deltaS(ctr(recent), ctr(prior)) },
  ];

  return (
    <div className="space-y-6">
      {/* KPI-kaarten */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-border px-4 py-3 shadow-sm">
            <div className="text-[11px] text-muted-foreground">{k.label}</div>
            <div className="text-lg font-semibold text-rm-gray mt-0.5">{k.value}</div>
            {k.delta && <div className={`text-[10px] mt-0.5 ${k.delta.startsWith("+") ? "text-emerald-600" : "text-red-500"}`}>{k.delta} vs vorige 28d</div>}
          </div>
        ))}
      </div>

      {/* Pacing */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Gauge className="w-4.5 h-4.5 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">Pacing — maand tot nu (dag {dayOfMonth})</h3>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-[13px]">
          <div>
            <div className="text-[11px] text-muted-foreground">Spend deze maand</div>
            <div className="font-semibold text-rm-gray">{eur(mtd.spend)} <span className="text-[11px] text-muted-foreground font-normal">(vorige maand op dag {dayOfMonth}: {eur(prevMtd.spend)})</span></div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">{cfg.convLabel} deze maand</div>
            <div className="font-semibold text-rm-gray">{fmt(mtd.conv, 1)} <span className="text-[11px] text-muted-foreground font-normal">(was {fmt(prevMtd.conv, 1)})</span></div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Tempo vs vorige maand</div>
            <div className={`font-semibold ${pacePct != null && pacePct > 1.15 ? "text-amber-600" : "text-rm-gray"}`}>{pace ?? "—"}{pacePct != null && pacePct > 1.15 ? " (loopt voor)" : ""}</div>
          </div>
        </div>
      </div>

      {/* Grafiek */}
      {chartData.length >= 2 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <TrendingUp className="w-4.5 h-4.5 text-rm-blue" />
            <h3 className="text-sm font-semibold text-rm-gray">Maandverloop</h3>
          </div>
          <div className="px-3 py-4" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
                <XAxis dataKey="maand" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="spend" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="conv" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="spend" dataKey="Spend" fill="#08288C" radius={[3, 3, 0, 0]} opacity={0.85} />
                <Line yAxisId="conv" dataKey={cfg.convLabel} stroke="#F16B37" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Maandtabel */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Calendar className="w-4.5 h-4.5 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">Maandprestaties</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-5 py-2 font-medium">Maand</th>
                <th className="px-3 py-2 font-medium text-right">Spend</th>
                <th className="px-3 py-2 font-medium text-right">Vertoningen</th>
                <th className="px-3 py-2 font-medium text-right">Klikken</th>
                <th className="px-3 py-2 font-medium text-right">CTR</th>
                <th className="px-3 py-2 font-medium text-right">{cfg.convLabel}</th>
                <th className="px-5 py-2 font-medium text-right">{cfg.useLeads ? "CPL" : "CPA"}</th>
              </tr>
            </thead>
            <tbody>
              {[...fullMonths].reverse().map(([m, a]) => (
                <tr key={m} className="border-b border-border/50">
                  <td className="px-5 py-1.5 text-muted-foreground">{m}</td>
                  <td className="px-3 py-1.5 text-right">{eur(a.spend)}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(a.impressions)}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(a.clicks)}</td>
                  <td className="px-3 py-1.5 text-right">{pctS(ctr(a))}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(a.conv, 1)}</td>
                  <td className="px-5 py-1.5 text-right">{eur(cpa(a))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campagnetabel */}
      {campaigns.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <BarChart3 className="w-4.5 h-4.5 text-rm-blue" />
            <h3 className="text-sm font-semibold text-rm-gray">Campagnes (laatste 28 dagen)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-5 py-2 font-medium">Campagne</th>
                  <th className="px-3 py-2 font-medium text-right">Spend</th>
                  <th className="px-3 py-2 font-medium text-right">Vertoningen</th>
                  <th className="px-3 py-2 font-medium text-right">Klikken</th>
                  <th className="px-3 py-2 font-medium text-right">CTR</th>
                  <th className="px-3 py-2 font-medium text-right">{cfg.convLabel}</th>
                  <th className="px-5 py-2 font-medium text-right">{cfg.useLeads ? "CPL" : "CPA"}</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.entity} className="border-b border-border/50">
                    <td className="px-5 py-1.5 text-rm-gray font-medium">{names.get(c.entity) ?? c.entity}</td>
                    <td className="px-3 py-1.5 text-right">{eur(c.spend)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(c.impressions)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(c.clicks)}</td>
                    <td className="px-3 py-1.5 text-right">{pctS(ctr(c))}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(c.conv, 1)}</td>
                    <td className="px-5 py-1.5 text-right">{eur(cpa(c))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
