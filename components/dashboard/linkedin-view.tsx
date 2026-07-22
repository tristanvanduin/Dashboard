"use client";

import { Briefcase } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";
import { CreativePerformance } from "./creative-performance";
import { ChannelViewHeader } from "./channel-view-header";
import { GeoBreakdown } from "./geo-breakdown";
import { isDemoMode } from "@/lib/demo/demo-mode";

// LinkedIn Ads-tab. Zelfde opbouw als de Google- en Meta-weergave via de gedeelde
// ChannelViewHeader. Buiten demo is er nog geen gesyncte data; dan toont de header een eerlijke
// lege staat en de prestatie-view eronder blijft leeg tot de sync draait.

const SECTIONS = [
  "Campagnegroepen & campagnes",
  "Creatives",
  "Dagelijkse performance (account / campagne / creative)",
  "Demografie (functie, senioriteit, industrie, bedrijfsgrootte)",
  "Lead-forms",
];

export function LinkedInView({ clientId, geoClone }: { clientId: string; geoClone?: string | null }) {
  const demo = isDemoMode();
  return (
    <div className="space-y-6">
      <ChannelViewHeader
        icon={<Briefcase className="w-5 h-5 text-rm-blue" />}
        title="LinkedIn Ads"
        geoClone={geoClone}
        status={demo ? { kind: "connected", label: "Gekoppeld (demo)" } : { kind: "warning", label: "Nog geen data" }}
        blurb={
          geoClone
            ? <>Cijfers hieronder zijn <strong>her-geaggregeerd per beurs</strong> ({geoClone}) uit de campagnes waarvan de naam bij deze beurs hoort. Ratio&apos;s (CPL, CTR) komen uit de venstertotalen, niet uit dag-gemiddelden.</>
            : <>Account-brede LinkedIn-cijfers: kerncijfers over de laatste 28 dagen, pacing tegen vorige maand, maandverloop en de campagnes.</>
        }
        delivers={SECTIONS}
        analysesHint={<>De LinkedIn-analyses (maand-SOP, signalen) draai je via het tabblad <strong>Analyses</strong> → LinkedIn.</>}
        warning={!demo ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
            Het LinkedIn-datamodel en de sync-laag staan klaar. Zodra de LinkedIn-koppeling live is en de
            sync draait, vult dit tabblad met onderstaande secties.
          </div>
        ) : undefined}
      />

      {/* Volwaardige prestatie-view: KPI's, pacing, grafiek, maand- en campagnetabel. */}
      <ChannelPerformance clientId={clientId} channel="linkedin" geoClone={geoClone} />
      {/* Geo-mapping: waar komt verkeer/conversies vandaan (per gekozen metric). */}
      <GeoBreakdown clientId={clientId} channel="linkedin" />
      {/* Quick scan: creatives + prestaties + samenvatting. */}
      <CreativePerformance clientId={clientId} channel="linkedin" />
    </div>
  );
}
