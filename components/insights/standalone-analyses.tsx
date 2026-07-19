"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Calendar, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

// De losse (standalone) Google-analyses. Elk endpoint deelt hetzelfde contract:
// GET ?client_id= levert de laatst opgeslagen analyse, POST { client_id } draait hem opnieuw
// en slaat de output op als sectie in sop_analysis_output. Geen job-tracking (synchrone call),
// dus bewust een aparte, simpelere component dan de SOP-trigger-knoppen.

interface AnalysisConfig {
  key: string;
  label: string;
  description: string;
  endpoint: string;
}

const ANALYSES: AnalysisConfig[] = [
  { key: "impression-share", label: "Impression Share", description: "Zichtbaarheid & verlies: budget versus rang", endpoint: "/api/analysis/impression-share" },
  { key: "budget-allocation", label: "Budgetallocatie", description: "Herverdeling naar bewezen-efficiënte campagnes", endpoint: "/api/analysis/budget-allocation" },
  { key: "bid-strategy", label: "Biedstrategie", description: "Fit van de biedstrategie per campagne", endpoint: "/api/analysis/bid-strategy" },
  { key: "quality-score", label: "Quality Score", description: "Kwaliteitsscore-analyse per keyword/campagne", endpoint: "/api/analysis/quality-score" },
  { key: "rsa-insights", label: "RSA copy", description: "Advertentiekop- en beschrijving-analyse", endpoint: "/api/analysis/rsa-insights" },
  { key: "landing-audit", label: "Landing-audit", description: "Landingspagina-check per advertentie", endpoint: "/api/analysis/landing-audit" },
];

interface AnalysisState {
  running: boolean;
  lastDate: string | null;
  output: string | null;
  error: string | null;
  success: boolean;
  expanded: boolean;
}

const EMPTY: AnalysisState = { running: false, lastDate: null, output: null, error: null, success: false, expanded: false };

export function StandaloneAnalyses({ clientId }: { clientId: string }) {
  const [state, setState] = useState<Record<string, AnalysisState>>(
    () => Object.fromEntries(ANALYSES.map((a) => [a.key, { ...EMPTY }]))
  );

  const patch = useCallback((key: string, next: Partial<AnalysisState>) => {
    setState((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }));
  }, []);

  // Laatst opgeslagen resultaat per analyse ophalen (best-effort; endpoints zonder GET slaan we over).
  const fetchLatest = useCallback(async (a: AnalysisConfig) => {
    try {
      const res = await fetch(`${a.endpoint}?client_id=${encodeURIComponent(clientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const analysis = data?.analysis;
      if (analysis) {
        patch(a.key, { lastDate: analysis.analysis_date ?? null, output: analysis.output ?? null });
      }
    } catch {
      // stil: geen laatste run is geen fout
    }
  }, [clientId, patch]);

  useEffect(() => {
    setState(Object.fromEntries(ANALYSES.map((a) => [a.key, { ...EMPTY }])));
    ANALYSES.forEach(fetchLatest);
  }, [clientId, fetchLatest]);

  async function run(a: AnalysisConfig) {
    patch(a.key, { running: true, error: null, success: false });
    try {
      const res = await fetch(a.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyse mislukt");
      patch(a.key, {
        running: false,
        success: true,
        lastDate: data.analysisDate ?? new Date().toISOString().split("T")[0],
      });
      // Verse output ophalen zodat "Bekijk resultaat" meteen klopt.
      await fetchLatest(a);
      setTimeout(() => patch(a.key, { success: false }), 5000);
    } catch (err) {
      patch(a.key, { running: false, error: err instanceof Error ? err.message : "Onbekende fout" });
    }
  }

  const anyRunning = Object.values(state).some((s) => s.running);

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-rm-gray">Losse analyses (Google)</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Deterministisch voorgerekend, door het model verwoord. Draai los van de maandanalyse; de output wordt opgeslagen bij de analyse-uitvoer.
        </p>
      </div>
      <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ANALYSES.map((a) => {
          const s = state[a.key];
          return (
            <div key={a.key} className="flex flex-col gap-1.5">
              <button
                onClick={() => run(a)}
                disabled={anyRunning}
                className={`w-full px-4 py-3 rounded-lg border transition-all text-left ${
                  s.running
                    ? "border-rm-blue/30 bg-rm-blue/5 cursor-wait"
                    : s.success
                    ? "border-emerald-300 bg-emerald-50"
                    : s.error
                    ? "border-red-300 bg-red-50"
                    : "border-border hover:border-rm-blue/40 hover:bg-gray-50 cursor-pointer"
                } ${anyRunning && !s.running ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-rm-gray">{a.label}</span>
                  {s.running && <Loader2 className="w-4 h-4 text-rm-blue animate-spin" />}
                  {s.success && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  {s.error && <AlertCircle className="w-4 h-4 text-red-500" />}
                </div>
                <p className="text-[10px] text-muted-foreground">{a.description}</p>
                {s.lastDate && (
                  <div className="flex items-center gap-1 mt-2 text-[9px] text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    Laatst: {s.lastDate}
                  </div>
                )}
                {s.error && <p className="text-[10px] text-red-500 mt-1 truncate">{s.error}</p>}
                {s.running && <p className="text-[10px] text-rm-blue mt-1">Bezig...</p>}
              </button>
              {s.output && (
                <>
                  <button
                    onClick={() => patch(a.key, { expanded: !s.expanded })}
                    className="flex items-center justify-center gap-1 px-3 py-1 rounded-md border border-border text-[10px] text-muted-foreground hover:bg-gray-50 hover:text-rm-gray transition-all"
                  >
                    {s.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {s.expanded ? "Verberg resultaat" : "Bekijk resultaat"}
                  </button>
                  {s.expanded && (
                    <div className="rounded-md border border-border bg-gray-50 px-3 py-2 text-[11px] text-rm-gray whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {s.output}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
