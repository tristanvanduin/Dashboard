"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Radar, Calendar, AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

// Gedeelde kaart voor de deterministische signaal-analyses (Meta, LinkedIn, cross-channel).
// Zelfde contract als de losse analyses: GET ?client_id= voor de laatste opgeslagen sectie,
// POST { client_id } om te draaien. Geen LLM in de route, dus draaien is goedkoop; de kaart
// toont de laatste output uitklapbaar zodat de bevindingen zichtbaar blijven zonder klik.

export function SignalAnalysisCard({ clientId, endpoint, title, description }: {
  clientId: string;
  endpoint: string;
  title: string;
  description: string;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`${endpoint}?client_id=${encodeURIComponent(clientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.analysis) {
        setLastDate(data.analysis.analysis_date ?? null);
        setOutput(data.analysis.output ?? null);
      }
    } catch { /* geen laatste run is geen fout */ }
  }, [clientId, endpoint]);

  useEffect(() => {
    setLastDate(null); setOutput(null); setError(null); setSuccess(null); setExpanded(false);
    fetchLatest();
  }, [fetchLatest]);

  async function run() {
    setRunning(true); setError(null); setSuccess(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyse mislukt");
      setSuccess(`${data.signals ?? 0} signa${(data.signals ?? 0) === 1 ? "al" : "len"} getriggerd (${data.checked ?? 0} gecontroleerd)`);
      await fetchLatest();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Radar className="w-4.5 h-4.5 text-rm-blue" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-rm-gray">{title}</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="px-3 py-1.5 rounded-md bg-rm-blue text-white text-[11px] font-medium hover:bg-rm-blue/90 disabled:opacity-50 flex items-center gap-1.5 transition-all"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {running ? "Detecteren..." : "Detecteer signalen"}
        </button>
      </div>
      <div className="px-5 py-3 space-y-2">
        <div className="flex items-center gap-3 text-[11px]">
          {lastDate && (
            <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="w-3 h-3" /> Laatst: {lastDate}</span>
          )}
          {success && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {success}</span>}
          {error && <span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3.5 h-3.5" /> {error}</span>}
          {!lastDate && !success && !error && <span className="text-muted-foreground">Nog niet gedraaid.</span>}
        </div>
        {output && (
          <>
            <button
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1 text-[11px] text-rm-blue hover:underline"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Verberg bevindingen" : "Bekijk bevindingen"}
            </button>
            {expanded && (
              <div className="rounded-md border border-border bg-gray-50 px-3 py-2 text-[11px] text-rm-gray whitespace-pre-wrap max-h-72 overflow-y-auto">
                {output}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
