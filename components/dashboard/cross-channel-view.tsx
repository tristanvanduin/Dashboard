"use client";

import { useState, useEffect } from "react";
import { Loader2, Layers, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Cross-channel (blended) tab. Leest de blended_account_monthly-view over Google, Meta en
// LinkedIn heen. De view levert de bouwstenen; de attributie-voetnoot is verplicht, want elk
// kanaal meet zijn eigen attributie en bedragen zijn alleen optelbaar bij gelijke valuta.

interface BlendedRow {
  month: string;
  channel: string;
  currency: string | null;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  conversions: number | null;
  conversion_value: number | null;
  leads: number | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  google_ads: "Google",
  meta_ads: "Meta",
  linkedin_ads: "LinkedIn",
};

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n);
}

export function CrossChannelView({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<BlendedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setRows(null); setError(null);
    sb.from("blended_account_monthly")
      .select("month, channel, currency, impressions, clicks, spend, conversions, conversion_value, leads")
      .eq("client_id", clientId)
      .order("month", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setRows((data ?? []) as BlendedRow[]);
      });
    return () => { cancelled = true; };
  }, [clientId]);

  const months = rows ? [...new Set(rows.map((r) => r.month))] : [];

  return (
    <div className="space-y-6">
      {/* Data-weergave; de cross-channel-signaalanalyse draait via Analyses → Cross-channel. */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Layers className="w-5 h-5 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">Cross-channel (blended)</h3>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[11px] text-blue-800 flex gap-2 mb-4">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Blended cijfers zijn <strong>indicatief</strong>: elk kanaal meet zijn eigen attributie, dus de som is geen
              exacte verdeling. Bedragen alleen optellen over kanalen met gelijke valuta.
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
          {rows && rows.length === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
              Nog geen cross-channel data. Zodra minstens één kanaal (Google/Meta/LinkedIn) gesynct is, verschijnt hier de blended maandview.
            </div>
          )}
          {rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4 font-medium">Maand</th>
                    <th className="py-2 pr-4 font-medium">Kanaal</th>
                    <th className="py-2 pr-4 font-medium text-right">Spend</th>
                    <th className="py-2 pr-4 font-medium text-right">Klikken</th>
                    <th className="py-2 pr-4 font-medium text-right">Conversies</th>
                    <th className="py-2 pr-4 font-medium text-right">Conv.waarde</th>
                    <th className="py-2 font-medium">Valuta</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) =>
                    rows.filter((r) => r.month === m).map((r, i) => (
                      <tr key={`${m}-${r.channel}`} className="border-b border-border/50">
                        <td className="py-1.5 pr-4 text-muted-foreground">{i === 0 ? m : ""}</td>
                        <td className="py-1.5 pr-4 text-rm-gray font-medium">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                        <td className="py-1.5 pr-4 text-right">{fmt(r.spend)}</td>
                        <td className="py-1.5 pr-4 text-right">{fmt(r.clicks)}</td>
                        <td className="py-1.5 pr-4 text-right">{fmt(r.conversions)}</td>
                        <td className="py-1.5 pr-4 text-right">{fmt(r.conversion_value)}</td>
                        <td className="py-1.5 text-muted-foreground">{r.currency ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
