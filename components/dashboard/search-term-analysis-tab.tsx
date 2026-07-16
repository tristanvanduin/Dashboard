"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, ArrowUpDown, Loader2, Sparkles, ShieldAlert, ShieldCheck, ShieldQuestion, Eye } from "lucide-react";
import { useAnalysis } from "@/lib/analysis-context";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

export interface SearchTermResult {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  relevanceScore: number;
  verdict: string;
  recommendedAction: string;
  reason: string;
}

type SortKey = "cost" | "clicks" | "score" | "term";
type VerdictFilter = "all" | "relevant" | "irrelevant" | "uncertain" | "partially_relevant";

const verdictLabels: Record<string, string> = {
  relevant: "Relevant",
  irrelevant: "Irrelevant",
  uncertain: "Onzeker",
  partially_relevant: "Deels relevant",
};

const verdictColors: Record<string, string> = {
  relevant: "bg-emerald-50 text-emerald-700 border-emerald-200",
  irrelevant: "bg-red-50 text-red-700 border-red-200",
  uncertain: "bg-amber-50 text-amber-700 border-amber-200",
  partially_relevant: "bg-blue-50 text-blue-700 border-blue-200",
};

const verdictIcons: Record<string, typeof ShieldCheck> = {
  relevant: ShieldCheck,
  irrelevant: ShieldAlert,
  uncertain: ShieldQuestion,
  partially_relevant: Eye,
};

const actionLabels: Record<string, string> = {
  keep: "Houden",
  negative_exact: "Uitsluiten (exact)",
  negative_phrase: "Uitsluiten (phrase)",
  monitor: "Monitoren",
  investigate: "Onderzoeken",
};

const actionColors: Record<string, string> = {
  keep: "text-emerald-600",
  negative_exact: "text-red-600 font-semibold",
  negative_phrase: "text-red-500",
  monitor: "text-amber-600",
  investigate: "text-blue-600",
};

interface Props {
  clientId: string;
}

export function SearchTermAnalysisTab({ clientId }: Props) {
  const [results, setResults] = useState<SearchTermResult[]>([]);
  const [analysisDate, setAnalysisDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{ totalInput: number; totalAnalyzed: number; totalFailed: number; coveragePct: number } | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const { startJob, isRunning } = useAnalysis();

  const googleAdsCustomerId = clientId.replace("gads-", "");
  const jobId = `search-terms-${clientId}`;
  const bgRunning = isRunning(jobId);

  // Load cached results on mount (and poll while bg job is running)
  useEffect(() => {
    setLoading(true);
    fetch(`/api/analysis/search-terms?client_id=${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        setResults(data.results ?? []);
        setAnalysisDate(data.analysisDate);
      })
      .catch(() => setError("Fout bij laden van gecachte resultaten"))
      .finally(() => setLoading(false));
  }, [clientId]);

  // Reload results when bg job finishes
  useEffect(() => {
    if (bgRunning) {
      setAnalyzing(true);
    } else if (analyzing) {
      // Job just finished — reload cached results
      setAnalyzing(false);
      fetch(`/api/analysis/search-terms?client_id=${clientId}`)
        .then((r) => r.json())
        .then((data) => {
          setResults(data.results ?? []);
          setAnalysisDate(data.analysisDate);
        })
        .catch(() => {});
    }
  }, [bgRunning, clientId, analyzing]);

  // Trigger new analysis (runs in background)
  function runAnalysis() {
    setAnalyzing(true);
    setError(null);

    startJob(jobId, "AI zoektermanalyse", async () => {
      const res = await fetch("/api/analysis/search-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, customerId: googleAdsCustomerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyse mislukt");
      if (data.coverage) setCoverage(data.coverage);
    });
  }

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("desc"); }
  }

  const filtered = useMemo(() => {
    let items = results;
    if (verdictFilter !== "all") {
      items = items.filter((r) => r.verdict === verdictFilter);
    }
    return [...items].sort((a, b) => {
      if (sortBy === "term") return sortDir === "asc" ? a.searchTerm.localeCompare(b.searchTerm) : b.searchTerm.localeCompare(a.searchTerm);
      if (sortBy === "clicks") return sortDir === "asc" ? a.clicks - b.clicks : b.clicks - a.clicks;
      if (sortBy === "score") return sortDir === "asc" ? a.relevanceScore - b.relevanceScore : b.relevanceScore - a.relevanceScore;
      return sortDir === "asc" ? a.cost - b.cost : b.cost - a.cost;
    });
  }, [results, verdictFilter, sortBy, sortDir]);

  // Summary stats
  const irrelevantTerms = results.filter((r) => r.verdict === "irrelevant");
  const irrelevantCost = irrelevantTerms.reduce((s, r) => s + r.cost, 0);
  const uncertainTerms = results.filter((r) => r.verdict === "uncertain");

  const SortTh = ({ col, label, align }: { col: SortKey; label: string; align?: string }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-rm-blue ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === col ? <span>{sortDir === "asc" ? "\u2191" : "\u2193"}</span> : <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );

  // Loading state
  if (loading) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
        Gecachte resultaten laden...
      </div>
    );
  }

  // No results yet — show start button
  if (results.length === 0 && !analyzing) {
    return (
      <div className="px-5 py-10 text-center">
        <Sparkles className="w-8 h-8 text-rm-blue mx-auto mb-3 opacity-60" />
        <p className="text-sm text-muted-foreground mb-4">
          {error
            ? error
            : "Nog geen AI-analyse uitgevoerd. Analyseer alle zoektermen op relevantie."}
        </p>
        <button
          onClick={runAnalysis}
          className="px-4 py-2 bg-rm-blue text-white text-sm font-medium rounded-lg hover:bg-rm-blue/90 transition-colors"
        >
          Start Analyse
        </button>
        <p className="text-[10px] text-muted-foreground mt-2">
          Duurt ca. 30-60 seconden
        </p>
      </div>
    );
  }

  // Analyzing state
  if (analyzing) {
    return (
      <div className="px-5 py-10 text-center">
        <Loader2 className="w-8 h-8 text-rm-blue mx-auto mb-3 animate-spin" />
        <p className="text-sm font-medium text-rm-gray mb-1">Zoektermen analyseren...</p>
        <p className="text-xs text-muted-foreground">
          AI beoordeelt alle zoektermen met clicks op relevantie. Dit duurt ca. 30-120 seconden afhankelijk van het aantal termen.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="px-5 py-3 border-b border-border bg-gray-50/50 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">
            {results.length} zoektermen geanalyseerd
            {coverage && coverage.totalInput > results.length && (
              <span className="ml-1">van {coverage.totalInput} gevonden ({coverage.coveragePct}% dekking)</span>
            )}
            {coverage && coverage.totalFailed > 0 && (
              <span className="ml-1 text-amber-600">| {coverage.totalFailed} gefaald</span>
            )}
            {analysisDate && <span className="ml-1">| {analysisDate}</span>}
            {" "}| Periode: laatste 30 dagen
          </span>
          {irrelevantTerms.length > 0 && (
            <span className="text-red-600 font-semibold">
              {irrelevantTerms.length} irrelevant ({fmt(irrelevantCost)} verspild)
            </span>
          )}
          {uncertainTerms.length > 0 && (
            <span className="text-amber-600">
              {uncertainTerms.length} onzeker
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value as VerdictFilter)}
            className="text-xs border border-border rounded-md px-2 py-1 bg-white"
          >
            <option value="all">Alle beoordelingen</option>
            <option value="irrelevant">Irrelevant</option>
            <option value="uncertain">Onzeker</option>
            <option value="partially_relevant">Deels relevant</option>
            <option value="relevant">Relevant</option>
          </select>
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="px-3 py-1 text-xs font-medium text-rm-blue border border-rm-blue/30 rounded-md hover:bg-rm-blue/5 transition-colors"
          >
            Opnieuw analyseren
          </button>
        </div>
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 text-red-600 text-xs border-b border-red-100">
          {error}
        </div>
      )}

      {/* Results table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50/50 border-b border-border">
            <tr>
              <SortTh col="term" label="Zoekterm" />
              <th className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Campagne</th>
              <SortTh col="clicks" label="Clicks" align="right" />
              <SortTh col="cost" label="Kosten" align="right" />
              <th className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Conv.</th>
              <SortTh col="score" label="Score" align="right" />
              <th className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Beoordeling</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Actie</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Reden</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r, i) => {
              const VerdictIcon = verdictIcons[r.verdict] ?? Search;
              return (
                <tr key={i} className={`hover:bg-gray-50/50 transition-colors ${r.verdict === "irrelevant" ? "bg-red-50/20" : ""}`}>
                  <td className="px-3 py-2.5">
                    <span className="text-sm text-rm-gray font-medium">{r.searchTerm}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground" title={`${r.campaignName} > ${r.adGroupName}`}>
                    <div className="text-xs text-rm-gray">{r.campaignName}</div>
                    <div className="text-[10px] text-muted-foreground">{r.adGroupName}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm text-rm-gray">{r.clicks}</td>
                  <td className="px-3 py-2.5 text-right text-sm text-rm-gray">{fmt(r.cost)}</td>
                  <td className="px-3 py-2.5 text-right text-sm text-rm-gray">{r.conversions}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`inline-block w-6 text-center text-xs font-bold rounded ${
                      r.relevanceScore >= 4 ? "text-emerald-600" :
                      r.relevanceScore >= 3 ? "text-amber-600" :
                      "text-red-600"
                    }`}>
                      {r.relevanceScore}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${verdictColors[r.verdict] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
                      <VerdictIcon className="w-3 h-3" />
                      {verdictLabels[r.verdict] || r.verdict}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs font-medium ${actionColors[r.recommendedAction] || "text-gray-600"}`}>
                      {actionLabels[r.recommendedAction] || r.recommendedAction}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[250px]">
                    {r.reason}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          Geen zoektermen gevonden voor dit filter.
        </div>
      )}
    </div>
  );
}
