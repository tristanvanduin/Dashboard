"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Layers, TrendingUp, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildMetaBreakdownSignals, type MetaBreakdownRow } from "@/lib/signals/meta-breakdown";
import { buildLinkedInDemographicSignals, type LinkedInDemographicRow } from "@/lib/signals/linkedin-demographic";
import type { SignalStory, SignalCertainty } from "@/lib/signals/types";

// Deterministische structuur-analyse per kanaal, client-side (leest de dag-tabellen direct en
// draait de pure detector) — zodat de segment-efficiëntie zichtbaar is zonder API-key of
// server-trigger. Meta: plaatsing/leeftijd/device. LinkedIn: functie/seniority/industrie/
// bedrijfsgrootte. Waste + schaalkansen, in het signaal-frame.

type ChannelKind = "meta" | "linkedin";

const PIVOT_TO_DIM: Record<string, string> = {
  MEMBER_JOB_FUNCTION: "functie",
  MEMBER_SENIORITY: "seniority",
  MEMBER_INDUSTRY: "industrie",
  MEMBER_COMPANY_SIZE: "bedrijfsgrootte",
  COMPANY_SIZE: "bedrijfsgrootte",
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const CERTAINTY_STYLE: Record<SignalCertainty, string> = {
  bewezen_binnen_platform: "bg-emerald-50 text-emerald-700 border-emerald-200",
  indicatie: "bg-amber-50 text-amber-700 border-amber-200",
  verklaringskandidaat: "bg-blue-50 text-blue-700 border-blue-200",
};
const CERTAINTY_LABEL: Record<SignalCertainty, string> = {
  bewezen_binnen_platform: "bewezen",
  indicatie: "indicatie",
  verklaringskandidaat: "kandidaat",
};

export function ChannelStructureAnalysis({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const [stories, setStories] = useState<SignalStory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setStories(null); setError(null);
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

    async function load() {
      if (channel === "meta") {
        const { data, error } = await sb!
          .from("meta_breakdown_daily")
          .select("breakdown_type, breakdown_value, impressions, link_clicks, spend, conversions")
          .eq("client_id", clientId)
          .gte("date", since);
        if (error) { if (!cancelled) { setError(error.message); setStories([]); } return; }
        const rows: MetaBreakdownRow[] = (data ?? []).map((r) => ({
          breakdownType: String(r.breakdown_type ?? ""),
          breakdownValue: String(r.breakdown_value ?? ""),
          impressions: num(r.impressions), clicks: num(r.link_clicks), spend: num(r.spend), conversions: num(r.conversions),
        }));
        if (!cancelled) setStories(buildMetaBreakdownSignals(rows).triggered);
      } else {
        const [{ data: demo, error: demoErr }, { data: labels }] = await Promise.all([
          sb!.from("linkedin_demographic_daily").select("pivot_type, pivot_value_urn, spend, leads").eq("client_id", clientId).gte("date", since),
          sb!.from("linkedin_urn_labels").select("urn, label"),
        ]);
        if (demoErr) { if (!cancelled) { setError(demoErr.message); setStories([]); } return; }
        const urnLabel = new Map((labels ?? []).map((l) => [String(l.urn), String(l.label)]));
        const rows: LinkedInDemographicRow[] = (demo ?? [])
          .map((r) => {
            const dimension = PIVOT_TO_DIM[String(r.pivot_type ?? "")];
            const urn = String(r.pivot_value_urn ?? "");
            if (!dimension || !urn || urn === "TOTAL") return null;
            return { dimension, value: urnLabel.get(urn) ?? urn, spend: num(r.spend), leads: num(r.leads) };
          })
          .filter((r): r is LinkedInDemographicRow => r !== null);
        if (!cancelled) setStories(buildLinkedInDemographicSignals(rows).triggered);
      }
    }
    load().catch((e) => { if (!cancelled) { setError(String(e)); setStories([]); } });
    return () => { cancelled = true; };
  }, [clientId, channel]);

  const { waste, scale } = useMemo(() => {
    const list = stories ?? [];
    return {
      waste: list.filter((s) => s.id.includes("_waste_")),
      scale: list.filter((s) => s.id.includes("_scale_")),
    };
  }, [stories]);

  const dimLabel = channel === "meta" ? "plaatsing, leeftijd en device" : "functie, seniority, industrie en bedrijfsgrootte";

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Layers className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">Structuur & segment-efficiëntie</h3>
        <span className="text-[10px] text-muted-foreground">waar landt het budget binnen {dimLabel}</span>
      </div>
      <div className="px-5 py-4">
        {stories === null ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>
        ) : stories.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Geen materiële segment-signalen — het budget is redelijk verdeeld, of er is te weinig data per dimensie voor een eerlijk oordeel.
          </p>
        ) : (
          <div className="space-y-4">
            {waste.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-red-600 uppercase tracking-wide mb-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Verspilling</p>
                <div className="space-y-2">{waste.map((s) => <StoryRow key={s.id} s={s} />)}</div>
              </div>
            )}
            {scale.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wide mb-2 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> Schaalkansen</p>
                <div className="space-y-2">{scale.map((s) => <StoryRow key={s.id} s={s} />)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StoryRow({ s }: { s: SignalStory }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-[11px] font-medium text-rm-gray">{s.scope}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${CERTAINTY_STYLE[s.certainty]}`}>{CERTAINTY_LABEL[s.certainty]}</span>
      </div>
      <p className="text-[12px] text-rm-gray leading-snug">{s.story}</p>
      <p className="text-[11px] text-muted-foreground mt-1">→ {s.actionDirection}</p>
      {s.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {s.evidence.map((e, i) => (
            <span key={i} className="text-[10px] bg-gray-100 rounded px-1.5 py-0.5 text-rm-gray">{e.metric}: <strong>{String(e.value)}</strong></span>
          ))}
        </div>
      )}
    </div>
  );
}
