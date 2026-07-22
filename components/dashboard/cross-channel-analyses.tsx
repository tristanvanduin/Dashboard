"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Radar, Calendar, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Info } from "lucide-react";

// Cross-channel-analyse als losse sub-analyse-kaarten — net als de kanalen, maar uit ÉÉN
// deterministische run. De route (/api/analysis/cross-channel) levert de groepen (funnel,
// zaai/arbitrage/mix, KPI-verhoudingen, doelgroep-samenhang, GA4-CRO); deze kaart draait de run
// en toont per groep een eigen blok. Geen aparte endpoints, geen dubbele berekening.

interface CrossGroup { key: string; title: string; description: string; section: string; triggered: number; checked: string[] }

function GroupCard({ group }: { group: CrossGroup }) {
  const [expanded, setExpanded] = useState(false);
  const has = group.triggered > 0;
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <div className="flex-1">
          <h4 className="text-[13px] font-semibold text-rm-gray">{group.title}</h4>
          <p className="text-[10px] text-muted-foreground mt-0.5">{group.description}</p>
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${has ? "bg-rm-orange/10 text-rm-orange" : "bg-gray-100 text-muted-foreground"}`}>
          {has ? `${group.triggered} signa${group.triggered === 1 ? "al" : "len"}` : "geen"}
        </span>
      </div>
      <div className="px-5 py-2.5">
        {has ? (
          <>
            <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-1 text-[11px] text-rm-blue hover:underline">
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Verberg bevindingen" : "Bekijk bevindingen"}
            </button>
            {expanded && (
              <div className="mt-2 rounded-md border border-border bg-gray-50 px-3 py-2 text-[11px] text-rm-gray whitespace-pre-wrap max-h-72 overflow-y-auto">
                {group.section}
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Geen signalen getriggerd. Gecontroleerd: {group.checked.length > 0 ? group.checked.join(", ") : "—"}.
          </p>
        )}
      </div>
    </div>
  );
}

export function CrossChannelAnalyses({ clientId }: { clientId: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [groups, setGroups] = useState<CrossGroup[] | null>(null);
  const [degradations, setDegradations] = useState<string[]>([]);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/analysis/cross-channel?client_id=${encodeURIComponent(clientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.groups)) setGroups(data.groups);
      if (data?.groupsDate) setLastDate(data.groupsDate);
    } catch { /* geen laatste run is geen fout */ }
  }, [clientId]);

  useEffect(() => {
    setGroups(null); setLastDate(null); setError(null); setSuccess(null); setDegradations([]);
    fetchLatest();
  }, [fetchLatest]);

  async function run() {
    setRunning(true); setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/analysis/cross-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyse mislukt");
      if (Array.isArray(data.groups)) setGroups(data.groups);
      setDegradations(Array.isArray(data.degradations) ? data.degradations : []);
      setSuccess(`${data.signals ?? 0} signa${data.signals === 1 ? "al" : "len"} over ${data.groups?.length ?? 0} sub-analyses (${data.checked ?? 0} gecontroleerd)`);
      await fetchLatest();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Kop met de gedeelde run-knop: één run voedt alle sub-analyses. */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Radar className="w-4.5 h-4.5 text-rm-blue" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-rm-gray">Cross-channel-analyse</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Eén deterministische run; de sub-analyses hieronder komen uit dezelfde detectie. Getriggerde signalen landen in de goedkeuringswachtrij.
            </p>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="px-3 py-1.5 rounded-md bg-rm-blue text-white text-[11px] font-medium hover:bg-rm-blue/90 disabled:opacity-50 flex items-center gap-1.5 transition-all"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {running ? "Bezig..." : "Draai cross-channel-analyse"}
          </button>
        </div>
        <div className="px-5 py-3 flex items-center gap-3 text-[11px]">
          {lastDate && <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="w-3 h-3" /> Laatst: {lastDate}</span>}
          {success && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {success}</span>}
          {error && <span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3.5 h-3.5" /> {error}</span>}
          {!lastDate && !success && !error && <span className="text-muted-foreground">Nog niet gedraaid.</span>}
        </div>
      </div>

      {/* De sub-analyses als losse kaarten. */}
      {groups === null ? (
        <div className="bg-white rounded-xl border border-border p-6 shadow-sm flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-rm-blue" /></div>
      ) : groups.length === 0 ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-[11px] text-blue-800 flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Nog geen sub-analyses. Draai de cross-channel-analyse om de blokken (funnel, arbitrage/mix, KPI-verhoudingen, doelgroep-samenhang, GA4-CRO) te vullen.</span>
        </div>
      ) : (
        groups.map((g) => <GroupCard key={g.key} group={g} />)
      )}

      {degradations.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800">
          <p className="font-medium mb-1">Expliciet gedegradeerd (geen stil gokken)</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {degradations.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
