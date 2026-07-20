"use client";

import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { useClientDataState } from "@/lib/client-data-provider";
import { visibleGeoClones } from "@/lib/rai/geo-clone-catalog";

// Fase 1 van de geo-clone-projecten: detecteert de geo-clones van dit account uit de
// campagnenamen (via de catalogus, hide-if-absent) en biedt een kiezer om de weergave te
// scopen. Accounts zonder geo-clones (bv. agency-klanten) renderen niets, zodat dit alleen
// verschijnt waar het zin heeft. De scope zelf wordt door de bovenliggende views toegepast.

export function GeoCloneScope({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const dataState = useClientDataState();
  const variants = useMemo(() => {
    const names = (dataState?.accountStructure?.campaigns ?? []).map((c: { name: string }) => c.name);
    return visibleGeoClones(names);
  }, [dataState?.accountStructure]);

  if (variants.length === 0) return null;

  const pill = (active: boolean) =>
    `px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
      active ? "bg-rm-blue text-white" : "bg-blue-50 text-muted-foreground hover:text-rm-gray"
    }`;

  // Al binnen een beurs? Dan geen redundant beurs-filter meer (je hebt al gekozen, en de
  // sidebar + het beursoverzicht tonen de context). Alleen een compacte indicatie + uitgang.
  if (value !== null) {
    const active = variants.find((v) => v.abbreviation === value);
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" /> Beurs:
        </span>
        <span className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-rm-blue text-white">
          {active ? `${active.brand} ${active.location} (${active.abbreviation})` : value}
        </span>
        <button onClick={() => onChange(null)} className="text-[11px] text-muted-foreground hover:text-rm-blue underline underline-offset-2">
          ← Hele account
        </button>
      </div>
    );
  }

  // Op accountniveau: de volledige beurs-kiezer om in een beurs te stappen.
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
        <MapPin className="w-3.5 h-3.5" /> Beurs:
      </span>
      <button onClick={() => onChange(null)} className={pill(value === null)}>Hele account</button>
      {variants.map((v) => (
        <button key={v.abbreviation} onClick={() => onChange(v.abbreviation)} className={pill(value === v.abbreviation)}>
          {v.brand} {v.location} <span className="opacity-60">({v.abbreviation})</span>
        </button>
      ))}
    </div>
  );
}
