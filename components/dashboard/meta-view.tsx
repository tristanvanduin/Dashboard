"use client";

import { useState, useEffect } from "react";
import { Megaphone } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";
import { CreativePerformance } from "./creative-performance";
import { ChannelViewHeader } from "./channel-view-header";
import { GeoBreakdown } from "./geo-breakdown";
import { isDemoMode } from "@/lib/demo/demo-mode";

// Meta Ads-tab: DATA-weergave (connectiestatus + wat het kanaal levert). Zelfde opbouw als de
// Google-weergave via de gedeelde ChannelViewHeader. De analyses (maand-SOP, creative vision,
// briefing, signalen) draaien vanaf het Analyses-tabblad — één plek voor alle analyses.

const SECTIONS = ["Campagnes", "Ad sets", "Advertenties & creatives", "Breakdowns (leeftijd, plaatsing, device)"];

export function MetaView({ clientId, geoClone }: { clientId: string; geoClone?: string | null }) {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (isDemoMode()) { setConnected(true); return; } // demo: geen live status-call
    let cancelled = false;
    fetch("/api/meta-ads?action=status")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setConnected(Boolean(d?.connected)); })
      .catch(() => { if (!cancelled) setConnected(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    <div className="space-y-6">
      <ChannelViewHeader
        icon={<Megaphone className="w-5 h-5 text-rm-blue" />}
        title="Meta Ads"
        geoClone={geoClone}
        status={connected === null ? { kind: "loading" } : connected ? { kind: "connected" } : { kind: "warning", label: "Niet gekoppeld" }}
        blurb={
          geoClone
            ? <>Cijfers hieronder zijn <strong>her-geaggregeerd per beurs</strong> ({geoClone}) uit de campagnes waarvan de naam bij deze beurs hoort. Ratio&apos;s (CPA, CTR) komen uit de venstertotalen, niet uit dag-gemiddelden.</>
            : <>Account-brede Meta-cijfers: kerncijfers over de laatste 28 dagen, pacing tegen vorige maand, maandverloop en de campagnes.</>
        }
        delivers={SECTIONS}
        analysesHint={<>De Meta-analyses (maand-SOP, creative vision, briefing, signalen) draai je via het tabblad <strong>Analyses</strong> → Meta.</>}
        warning={connected === false ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
            Meta is nog niet gekoppeld. Configureer de Meta-credentials (env) en draai de sync; daarna vult dit tabblad met campagnes, ad sets, creatives en breakdowns.
          </div>
        ) : undefined}
      />

      {/* Volwaardige prestatie-view: KPI's, pacing, grafiek, maand- en campagnetabel. */}
      <ChannelPerformance clientId={clientId} channel="meta" geoClone={geoClone} />
      {/* Geo-mapping: waar komt verkeer/conversies vandaan (per gekozen metric). */}
      <GeoBreakdown clientId={clientId} channel="meta" />
      {/* Quick scan: creatives + prestaties + samenvatting. */}
      <CreativePerformance clientId={clientId} channel="meta" />
    </div>
  );
}
