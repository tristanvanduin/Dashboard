"use client";

import { useState, useEffect } from "react";
import { Loader2, Megaphone, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";

// Meta Ads-tab: DATA-weergave (connectiestatus + wat het kanaal levert). De analyses
// (maand-SOP, creative vision, briefing, signalen) draaien vanaf het Analyses-tabblad,
// per kanaal — één plek voor alle analyses, de kanaaltabs blijven weergaven.

const SECTIONS = ["Campagnes", "Ad sets", "Advertenties & creatives", "Breakdowns (leeftijd, plaatsing, device)"];

export function MetaView({ clientId }: { clientId: string }) {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/meta-ads?action=status")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setConnected(Boolean(d?.connected)); })
      .catch(() => { if (!cancelled) setConnected(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">Meta Ads</h3>
          {connected === null ? (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin ml-auto" />
          ) : connected ? (
            <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> Gekoppeld</span>
          ) : (
            <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-600"><AlertCircle className="w-3.5 h-3.5" /> Niet gekoppeld</span>
          )}
        </div>
        <div className="px-5 py-4">
          {connected === false && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
              Meta is nog niet gekoppeld. Configureer de Meta-credentials (env) en draai de sync; daarna vult dit tabblad met campagnes, ad sets, creatives en breakdowns.
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3 mb-1">Dit kanaal levert:</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {SECTIONS.map((s) => (
              <li key={s} className="text-[12px] text-rm-gray flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rm-blue/40" /> {s}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground mt-4 flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5" />
            De Meta-analyses (maand-SOP, creative vision, briefing, signalen) draai je via het tabblad <strong>Analyses</strong> → Meta.
          </p>
        </div>
      </div>

      {/* Volwaardige prestatie-view: KPI's, pacing, grafiek, maand- en campagnetabel. */}
      <ChannelPerformance clientId={clientId} channel="meta" />
    </div>
  );
}
