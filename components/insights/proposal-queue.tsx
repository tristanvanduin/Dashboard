"use client";

import { useState, useEffect, useCallback } from "react";
import { Inbox, Check, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { channelOfSource, type InsightChannel } from "@/lib/insights/channel-of";
import { ChannelBadge } from "./channel-filter";

// De goedkeuringswachtrij: ALLE pending voorstellen uit sprint_hypotheses, ongeacht bron
// (zoektermen, losse analyses, second opinion, Meta/LinkedIn/cross-signalen). De maand-
// hypotheses hebben hun eigen workflow-block (via de structured output); dit block maakt de
// rest zichtbaar — tot nu toe stonden die voorstellen wel in de wachtrij maar nergens in de
// UI. Accepteren zet status accepted (verschijnt in de sprintplanning); afwijzen vraagt een
// reden en bewaart die in decision_reason.

interface Proposal {
  id: string;
  hypothesis: string;
  expected_result: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  rationale: string | null;
  ice_total: number | null;
  source: string | null;
  created_at: string;
}

// De maand-bron heeft zijn eigen workflow-block; hier bewust uitgesloten (geen dubbele UI).
const EXCLUDED_SOURCES = new Set(["analysis"]);

export function ProposalQueue({ clientId, refreshKey, channel, onWorkflowChange }: {
  clientId: string;
  refreshKey?: number;
  channel?: InsightChannel | null;
  onWorkflowChange?: () => void;
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) { setProposals([]); return; }
    const { data } = await supabase
      .from("sprint_hypotheses")
      .select("id, hypothesis, expected_result, measurement_metric, timeframe, rationale, ice_total, source, created_at")
      .eq("client_id", clientId)
      .eq("status", "pending")
      .order("ice_total", { ascending: false });
    setProposals(((data ?? []) as Proposal[]).filter((p) => !EXCLUDED_SOURCES.has((p.source ?? "").toLowerCase())));
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  async function decide(p: Proposal, action: "accept" | "reject") {
    if (!supabase) return;
    let reason = "";
    if (action === "reject") {
      reason = window.prompt("Waarom wijs je dit voorstel af?")?.trim() || "";
      if (!reason) return;
    }
    setBusyId(p.id);
    const now = new Date().toISOString();
    const patch = action === "accept"
      ? { status: "accepted", accepted_at: now, decided_at: now }
      : { status: "rejected", decision_reason: reason, decided_at: now };
    const { error } = await supabase.from("sprint_hypotheses").update(patch).eq("id", p.id).eq("status", "pending");
    setBusyId(null);
    if (!error) {
      setProposals((prev) => prev?.filter((x) => x.id !== p.id) ?? prev);
      onWorkflowChange?.();
    }
  }

  const filtered = (proposals ?? []).filter((p) => !channel || channelOfSource(p.source) === channel);

  if (proposals === null) {
    return (
      <div className="bg-white rounded-xl border border-border p-5 shadow-sm flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-rm-blue" />
      </div>
    );
  }
  if (filtered.length === 0) return null; // lege wachtrij: geen loze kaart

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Inbox className="w-4 h-4 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">Goedkeuringswachtrij</h3>
        <span className="text-[10px] text-muted-foreground">{filtered.length} voorstel{filtered.length === 1 ? "" : "len"}</span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">
        Voorstellen uit de losse analyses en signaal-detecties. Accepteren zet ze in de sprintplanning; afwijzen bewaart de reden.
      </p>
      <div className="space-y-2">
        {filtered.map((p) => (
          <div key={p.id} className="rounded-lg border border-border px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <ChannelBadge channel={channelOfSource(p.source)} />
                  <span className="text-[10px] text-muted-foreground">{p.source ?? "onbekend"}</span>
                  {p.ice_total != null && <span className="text-[10px] font-semibold text-rm-blue">ICE {p.ice_total.toFixed(1)}</span>}
                </div>
                <p className="text-[12px] text-rm-gray font-medium mt-1">{p.hypothesis}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => decide(p, "accept")}
                  disabled={busyId === p.id}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busyId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Accepteer
                </button>
                <button
                  onClick={() => decide(p, "reject")}
                  disabled={busyId === p.id}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <X className="w-3 h-3" /> Wijs af
                </button>
              </div>
            </div>
            <button
              onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              className="flex items-center gap-1 text-[10px] text-rm-blue hover:underline mt-1.5"
            >
              {expanded === p.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded === p.id ? "Verberg detail" : "Detail"}
            </button>
            {expanded === p.id && (
              <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                {p.rationale && <p><span className="font-medium text-rm-gray">Onderbouwing:</span> {p.rationale}</p>}
                {p.expected_result && <p><span className="font-medium text-rm-gray">Verwacht:</span> {p.expected_result}</p>}
                {p.measurement_metric && <p><span className="font-medium text-rm-gray">Meting:</span> {p.measurement_metric}</p>}
                {p.timeframe && <p><span className="font-medium text-rm-gray">Termijn:</span> {p.timeframe}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
