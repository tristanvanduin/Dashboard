"use client";

import { useMemo, useState } from "react";
import { feature } from "topojson-client";
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from "d3-geo";
// world-atlas levert de landgeometrie als topojson (~110m resolutie).
import worldTopo from "world-atlas/countries-110m.json";
import { NUMERIC_TO_ALPHA2 } from "@/lib/geo/iso-numeric";
import { countryLabel } from "@/lib/countries";

// Interactieve choropleth-wereldkaart: kleurt elk land naar de gekozen metric en licht op met een
// tooltip bij hover. Puur SVG (d3-geo voor de projectie + paden), geen zware kaart-library — dus
// geen React-versieconflict. De landgeometrie wordt één keer geprojecteerd op module-niveau.

const WIDTH = 760;
const HEIGHT = 380;

// Eénmalig: topojson → geojson → NaturalEarth-projectie → SVG-pad per land.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const topo = worldTopo as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const collection = feature(topo, topo.objects.countries) as any;
const features = (collection.features ?? []) as Array<{ id?: string | number; properties?: { name?: string } }>;
const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], collection as GeoPermissibleObjects);
const pathGen = geoPath(projection);
interface Shape { key: string; alpha2: string | null; d: string }
const SHAPES: Shape[] = features.map((f, i) => {
  const numeric = f.id != null ? String(Number(f.id)) : "";
  return { key: `${numeric}-${i}`, alpha2: NUMERIC_TO_ALPHA2[numeric] ?? null, d: pathGen(f as GeoPermissibleObjects) ?? "" };
});

// Sequentiële blauw-ramp (licht → donker) op waarde-intensiteit; merk-onafhankelijk en leesbaar.
const LIGHT = [230, 238, 248];
const DARK = [8, 40, 140];
function ramp(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const c = LIGHT.map((x, i) => Math.round(x + (DARK[i] - x) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export interface WorldMapProps {
  /** alpha-2 landcode → waarde van de gekozen metric. */
  values: Map<string, number>;
  /** formatter voor de tooltip-waarde. */
  format: (v: number) => string;
  /** label van de gekozen metric (voor de tooltip). */
  metricLabel: string;
  /** optioneel: klik op een land (bv. VS) om in te zoomen op de drilldown. */
  onCountryClick?: (alpha2: string) => void;
}

export default function WorldMap({ values, format, metricLabel, onCountryClick }: WorldMapProps) {
  const [hover, setHover] = useState<{ alpha2: string; x: number; y: number } | null>(null);

  const max = useMemo(() => Math.max(1, ...[...values.values()].map((v) => Math.abs(v))), [values]);
  const hoveredValue = hover ? values.get(hover.alpha2) : undefined;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label={`Wereldkaart: ${metricLabel} per land`}>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="transparent" onMouseMove={() => setHover(null)} />
        {SHAPES.map((s) => {
          const v = s.alpha2 ? values.get(s.alpha2) : undefined;
          const has = v != null && Number.isFinite(v);
          const isHover = !!hover && hover.alpha2 === s.alpha2;
          const clickable = has && !!s.alpha2 && !!onCountryClick;
          return (
            <path
              key={s.key}
              d={s.d}
              fill={has ? ramp(Math.abs(v as number) / max) : "#eef1f6"}
              stroke={isHover ? "#08288C" : "#ffffff"}
              strokeWidth={isHover ? 1.4 : 0.4}
              style={{ cursor: clickable ? "pointer" : "default", opacity: hover && !isHover ? 0.9 : 1, transition: "opacity 120ms" }}
              onClick={() => { if (clickable && s.alpha2) onCountryClick!(s.alpha2); }}
              onMouseMove={(e) => {
                if (!has || !s.alpha2) { setHover(null); return; }
                const box = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement)?.getBoundingClientRect();
                if (!box) return;
                setHover({ alpha2: s.alpha2, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>

      {hover && hoveredValue != null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-white px-2.5 py-1.5 shadow-md text-[11px]"
          style={{ left: Math.min(hover.x + 12, WIDTH - 120), top: hover.y + 12 }}
        >
          <div className="font-semibold text-rm-gray">{countryLabel(hover.alpha2)}</div>
          <div className="text-muted-foreground">{metricLabel}: <span className="font-medium text-rm-blue">{format(hoveredValue)}</span></div>
        </div>
      )}
    </div>
  );
}
