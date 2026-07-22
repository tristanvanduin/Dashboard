"use client";

import { useMemo, useState } from "react";
import { feature } from "topojson-client";
import { geoAlbersUsa, geoPath, type GeoPermissibleObjects } from "d3-geo";
// us-atlas levert de staten-geometrie als topojson; geoAlbersUsa projecteert incl. Alaska/Hawaï-insets.
import statesTopo from "us-atlas/states-10m.json";
import { FIPS_TO_USPS, stateLabel } from "@/lib/geo/us-fips";

// Interactieve choropleth van de Amerikaanse staten — de VS-drilldown onder de wereldkaart. Zelfde
// patroon als world-map (puur SVG via d3-geo, hover-tooltip, sequentiële blauw-ramp), maar dan met
// staten-geometrie en een FIPS → USPS-join. De geometrie wordt één keer geprojecteerd op module-niveau.

const WIDTH = 760;
const HEIGHT = 460;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const topo = statesTopo as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const collection = feature(topo, topo.objects.states) as any;
const features = (collection.features ?? []) as Array<{ id?: string | number; properties?: { name?: string } }>;
const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], collection as GeoPermissibleObjects);
const pathGen = geoPath(projection);
interface Shape { key: string; usps: string | null; d: string }
const SHAPES: Shape[] = features.map((f, i) => {
  const fips = f.id != null ? String(f.id).padStart(2, "0") : "";
  return { key: `${fips}-${i}`, usps: FIPS_TO_USPS[fips] ?? null, d: pathGen(f as GeoPermissibleObjects) ?? "" };
});

// Sequentiële blauw-ramp (licht → donker) op waarde-intensiteit; identiek aan de wereldkaart.
const LIGHT = [230, 238, 248];
const DARK = [8, 40, 140];
function ramp(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const c = LIGHT.map((x, i) => Math.round(x + (DARK[i] - x) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export interface UsStatesMapProps {
  /** USPS-staatcode (CA, TX, …) → waarde van de gekozen metric. */
  values: Map<string, number>;
  /** formatter voor de tooltip-waarde. */
  format: (v: number) => string;
  /** label van de gekozen metric (voor de tooltip). */
  metricLabel: string;
}

export default function UsStatesMap({ values, format, metricLabel }: UsStatesMapProps) {
  const [hover, setHover] = useState<{ usps: string; x: number; y: number } | null>(null);

  const max = useMemo(() => Math.max(1, ...[...values.values()].map((v) => Math.abs(v))), [values]);
  const hoveredValue = hover ? values.get(hover.usps) : undefined;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label={`Kaart van de VS: ${metricLabel} per staat`}>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="transparent" onMouseMove={() => setHover(null)} />
        {SHAPES.map((s) => {
          const v = s.usps ? values.get(s.usps) : undefined;
          const has = v != null && Number.isFinite(v);
          const isHover = !!hover && hover.usps === s.usps;
          return (
            <path
              key={s.key}
              d={s.d}
              fill={has ? ramp(Math.abs(v as number) / max) : "#eef1f6"}
              stroke={isHover ? "#08288C" : "#ffffff"}
              strokeWidth={isHover ? 1.4 : 0.5}
              style={{ cursor: has ? "pointer" : "default", opacity: hover && !isHover ? 0.9 : 1, transition: "opacity 120ms" }}
              onMouseMove={(e) => {
                if (!has || !s.usps) { setHover(null); return; }
                const box = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement)?.getBoundingClientRect();
                if (!box) return;
                setHover({ usps: s.usps, x: e.clientX - box.left, y: e.clientY - box.top });
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
          <div className="font-semibold text-rm-gray">{stateLabel(hover.usps)}</div>
          <div className="text-muted-foreground">{metricLabel}: <span className="font-medium text-rm-blue">{format(hoveredValue)}</span></div>
        </div>
      )}
    </div>
  );
}
