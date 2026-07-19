"use client";

import { useState } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

// De losse Meta creative-analyses (M3 vision, M4 briefing). Verhuisd uit de Meta-kanaaltab:
// alle analyses draaien vanaf het Analyses-tabblad, per kanaal; de kanaaltabs blijven
// data-weergaven. Zelfde eenvoudige POST-contract als voorheen.

const META_ANALYSES = [
  { key: "meta-briefing", label: "Creatieve briefing", description: "Merk-briefing voor nieuwe creatives (M4)", endpoint: "/api/analysis/meta-briefing" },
  { key: "meta-creatives", label: "Creative vision", description: "Visuele feature-analyse van de advertenties (M3)", endpoint: "/api/analysis/meta-creatives" },
];

export function MetaCreativeAnalyses({ clientId }: { clientId: string }) {
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

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
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-rm-gray">Creative-analyses (Meta)</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">Losse creative-analyses; vereisen gesyncte Meta-data.</p>
      </div>
      <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {META_ANALYSES.map((a) => {
          const r = result[a.key];
          return (
            <button
              key={a.key}
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
          );
        })}
      </div>
    </div>
  );
}
