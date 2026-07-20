"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, TrendingUp, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { forecastChannelMetric, type MonthValue } from "@/lib/analysis/channel-forecast";
import { MonthlyTrendChart } from "./monthly-trend-chart";

// Run-rate-prognose voor Meta/LinkedIn: lopende maand op tempo + volgende maand via een lichte
// trend. Eerlijk over de beperking (geen meerjarige historie, dus geen seizoenscorrectie).

type ChannelKind = "meta" | "linkedin";

interface Cfg { table: string; select: string; convField: string; convLabel: string }
const CFG: Record<ChannelKind, Cfg> = {
  meta: { table: "meta_account_daily", select: "date, spend, conversions", convField: "conversions", convLabel: "Conversies" },
  linkedin: { table: "linkedin_account_daily", select: "date, spend, one_click_leads", convField: "one_click_leads", convLabel: "Leads" },
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const eur = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const fmt = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v));

export function ChannelForecast({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const cfg = CFG[channel];
  const [rows, setRows] = useState<{ date: string; spend: number; conv: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setRows(null); setError(null);
    const since = new Date(Date.now() - 220 * 86_400_000).toISOString().slice(0, 10);
    sb.from(cfg.table).select(cfg.select).eq("client_id", clientId).gte("date", since)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setError(error.message); setRows([]); return; }
        setRows(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ date: String(r.date), spend: num(r.spend), conv: num(r[cfg.convField]) })));
      });
    return () => { cancelled = true; };
  }, [clientId, channel, cfg]);

  const model = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const curMonth = today.slice(0, 7);
    const dayOfMonth = Number(today.slice(8, 10));
    const daysInMonth = new Date(Number(curMonth.slice(0, 4)), Number(curMonth.slice(5, 7)), 0).getDate();

    const byMonth = new Map<string, { spend: number; conv: number }>();
    for (const r of rows) {
      const m = r.date.slice(0, 7);
      const a = byMonth.get(m) ?? { spend: 0, conv: 0 };
      a.spend += r.spend; a.conv += r.conv;
      byMonth.set(m, a);
    }
    const fullSpend: MonthValue[] = [...byMonth.entries()].filter(([m]) => m < curMonth).sort().map(([month, a]) => ({ month, value: a.spend }));
    const fullConv: MonthValue[] = [...byMonth.entries()].filter(([m]) => m < curMonth).sort().map(([month, a]) => ({ month, value: a.conv }));
    const cur = byMonth.get(curMonth) ?? { spend: 0, conv: 0 };

    const spendF = forecastChannelMetric({ fullMonths: fullSpend, mtd: cur.spend, dayOfMonth, daysInMonth });
    const convF = forecastChannelMetric({ fullMonths: fullConv, mtd: cur.conv, dayOfMonth, daysInMonth });
    return { spendF, convF, dayOfMonth, daysInMonth, curMtd: cur, monthsCount: fullSpend.length };
  }, [rows]);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  if (rows === null) return <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>;
  if (!model) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">Nog geen {channel === "meta" ? "Meta" : "LinkedIn"}-dagdata voor een prognose. Zodra de sync draait, verschijnt hier de run-rate-prognose.</div>;
  }

  const { spendF, convF, dayOfMonth, daysInMonth, curMtd, monthsCount } = model;
  const chartData = spendF.fullMonths.map((m, i) => ({ maand: m.month, spend: m.value, lijn: convF.fullMonths[i]?.value ?? 0 }));

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[11px] text-blue-800 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Run-rate-prognose: de lopende maand geprojecteerd op het tempo tot nu (dag {dayOfMonth} van {daysInMonth}),
          de volgende maand via een lichte trend over {monthsCount} volle maand{monthsCount === 1 ? "" : "en"}.
          Geen meerjarige historie, dus <strong>geen seizoenscorrectie</strong> — dit is een tempo-indicatie, geen doelprognose.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Lopende maand */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <div className="text-[11px] font-semibold text-rm-blue uppercase tracking-wide mb-2">Lopende maand (projectie)</div>
          <div className="space-y-1.5 text-[13px]">
            <Row label="Spend tot nu" value={eur(curMtd.spend)} />
            <Row label="Spend geprojecteerd" value={eur(spendF.currentMonthProjected)} strong warn={!spendF.currentMonthReliable} />
            <Row label={`${cfg.convLabel} tot nu`} value={fmt(curMtd.conv)} />
            <Row label={`${cfg.convLabel} geprojecteerd`} value={fmt(convF.currentMonthProjected)} strong warn={!convF.currentMonthReliable} />
          </div>
          {!spendF.currentMonthReliable && <p className="text-[10px] text-amber-600 mt-2">Nog weinig dagen deze maand — de projectie is grof.</p>}
        </div>

        {/* Volgende maand */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <div className="text-[11px] font-semibold text-rm-blue uppercase tracking-wide mb-2">Volgende volle maand (trend)</div>
          <div className="space-y-1.5 text-[13px]">
            <Row label="Spend verwacht" value={eur(spendF.nextMonthProjected)} strong />
            <Row label={`${cfg.convLabel} verwacht`} value={fmt(convF.nextMonthProjected)} strong />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            {spendF.nextMonthMethod === "trend" ? "Lineaire trend over de recente maanden, geklemd tegen wilde uitschieters." : spendF.nextMonthMethod === "laatste" ? "Te weinig maanden voor een trend — gelijk aan de laatste volle maand." : "Onvoldoende data."}
          </p>
        </div>
      </div>

      {chartData.length >= 2 && (
        <MonthlyTrendChart title={`Volle maanden — spend & ${cfg.convLabel.toLowerCase()}`} data={chartData} lineLabel={cfg.convLabel} />
      )}
    </div>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${strong ? "font-semibold" : ""} ${warn ? "text-amber-600" : "text-rm-gray"}`}>{value}</span>
    </div>
  );
}
