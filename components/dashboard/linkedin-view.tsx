"use client";

import { Briefcase, AlertCircle, ArrowRight } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";

// LinkedIn Ads-tab. Het datamodel (linkedin_* tabellen) en de sync-laag staan klaar, maar er
// is nog geen lees-API en nog geen gesyncte data. Dit tabblad toont de structuur en een
// eerlijke lege staat, zodat het kanaal zichtbaar is zonder iets voor te wenden.

const SECTIONS = [
  "Campagnegroepen & campagnes",
  "Creatives",
  "Dagelijkse performance (account / campagne / creative)",
  "Demografie (functie, senioriteit, industrie, bedrijfsgrootte)",
  "Lead-forms",
];

export function LinkedInView({ clientId }: { clientId: string }) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">LinkedIn Ads</h3>
          <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-600">
            <AlertCircle className="w-3.5 h-3.5" /> Nog geen data
          </span>
        </div>
        <div className="px-5 py-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
            Het LinkedIn-datamodel en de sync-laag staan klaar. Zodra de LinkedIn-koppeling live is en de
            sync draait, vult dit tabblad met onderstaande secties. (Client: {clientId})
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 mb-1">Dit kanaal levert:</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {SECTIONS.map((s) => (
              <li key={s} className="text-[12px] text-rm-gray flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rm-blue/40" /> {s}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground mt-4 flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5" />
            De LinkedIn-analyses (maand-SOP, signalen) draai je via het tabblad <strong>Analyses</strong> → LinkedIn.
          </p>
        </div>
      </div>

      {/* Volwaardige prestatie-view: KPI's, pacing, grafiek, maand- en campagnetabel. */}
      <ChannelPerformance clientId={clientId} channel="linkedin" />
    </div>
  );
}
