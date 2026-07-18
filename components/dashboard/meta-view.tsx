"use client";

import { useState, useEffect } from "react";
import { Loader2, Megaphone, AlertCircle, CheckCircle2 } from "lucide-react";
import { SignalAnalysisCard } from "./signal-analysis-card";

// Meta Ads-tab. Toont de connectiestatus en de structuur van wat dit kanaal levert. Zonder
// gekoppelde Meta-credentials of gesyncte data blijft dit een eerlijke lege staat; de kopjes
// en de losse Meta-analyses staan er wel, conform de wens dat de structuur zichtbaar is.

const META_ANALYSES = [
  { key: "meta-briefing", label: "Creatieve briefing", description: "Merk-briefing voor nieuwe creatives (M4)", endpoint: "/api/analysis/meta-briefing" },
  { key: "meta-creatives", label: "Creative vision", description: "Visuele feature-analyse van de advertenties (M3)", endpoint: "/api/analysis/meta-creatives" },
];

const SECTIONS = ["Campagnes", "Ad sets", "Advertenties & creatives", "Breakdowns (leeftijd, plaatsing, device)"];

export function MetaView({ clientId }: { clientId: string }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/meta-ads?action=status")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setConnected(Boolean(d?.connected)); })
      .catch(() => { if (!cancelled) setConnected(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  async function run(a: (typeof META_ANALYSES)[number]) {
    setRunning((p) => ({ ...p, [a.key]: true }));
    setResult((p) => ({ ...p, [a.key]: undefined as never }));
    try {
      const res = await fetch(a.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyse mislukt");
      setResult((p) => ({ ...p, [a.key]: { ok: true, msg: "Uitgevoerd en opgeslagen" } }));
    } catch (err) {
      setResult((p) => ({ ...p, [a.key]: { ok: false, msg: err instanceof Error ? err.message : "Fout" } }));
    } finally {
      setRunning((p) => ({ ...p, [a.key]: false }));
    }
  }

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
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-rm-gray">Meta-analyses</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Losse creative-analyses; vereisen gesyncte Meta-data.</p>
        </div>
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {META_ANALYSES.map((a) => {
            const r = result[a.key];
            return (
              <div key={a.key} className="flex flex-col gap-1.5">
                <button
                  onClick={() => run(a)}
                  disabled={running[a.key]}
                  className={`w-full px-4 py-3 rounded-lg border text-left transition-all ${
                    r?.ok ? "border-emerald-300 bg-emerald-50" : r && !r.ok ? "border-red-300 bg-red-50" : "border-border hover:border-rm-blue/40 hover:bg-gray-50 cursor-pointer"
                  } ${running[a.key] ? "cursor-wait opacity-70" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-rm-gray">{a.label}</span>
                    {running[a.key] && <Loader2 className="w-4 h-4 text-rm-blue animate-spin" />}
                    {r?.ok && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {r && !r.ok && <AlertCircle className="w-4 h-4 text-red-500" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{a.description}</p>
                  {r && <p className={`text-[10px] mt-1 truncate ${r.ok ? "text-emerald-600" : "text-red-500"}`}>{r.msg}</p>}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Deterministische signaal-detectie: fatigue, frequency-saturatie, rankings, hook/hold. */}
      <SignalAnalysisCard
        clientId={clientId}
        endpoint="/api/analysis/meta-signals"
        title="Meta-signalen"
        description="Deterministische detectie: creative fatigue, frequency-saturatie, ranking-zwakte, hook/hold. Voedt de goedkeuringswachtrij."
      />
    </div>
  );
}
