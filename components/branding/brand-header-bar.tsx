"use client";

import { useBrandTheme } from "./brand-theme-provider";
import { RAI_GEO_CLONES } from "@/lib/rai/geo-clone-catalog";

// De merk-header: het logo (of een net logomark met de merk-initiaal in de merkkleur) plus de
// merk-/beursnaam. Dit is de plek waar het klant-/beurslogo landt. Zonder ingestelde logo-URL
// tonen we de initiaal-chip, zodat de branding altijd zichtbaar is.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function BrandHeaderBar({ geoClone, fallbackName }: { geoClone?: string | null; fallbackName?: string }) {
  const { theme, brandName } = useBrandTheme();
  const name = brandName || fallbackName || "Dashboard";
  const variant = geoClone ? RAI_GEO_CLONES.find((v) => v.abbreviation === geoClone) ?? null : null;
  const beursLabel = variant ? `${variant.brand} ${variant.location}` : geoClone;

  return (
    <div className="flex items-center gap-3 pb-1">
      {/* Logomark: echt logo indien ingesteld, anders de merk-initiaal in de merkkleur. */}
      {theme.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={theme.logoUrl} alt={name} className="h-9 w-9 rounded-lg object-contain bg-white border border-border" />
      ) : (
        <div
          className="h-9 w-9 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0"
          style={{ background: "var(--brand-primary)", color: "var(--brand-primary-contrast)" }}
        >
          {initials(name)}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[15px] font-bold leading-tight text-rm-gray truncate" style={{ fontFamily: "var(--font-heading)" }}>
          {name}
        </div>
        {beursLabel && (
          <div className="text-[11px] text-muted-foreground truncate">
            Beurs: <span className="font-medium text-rm-blue">{beursLabel}</span>
          </div>
        )}
      </div>
      {/* Merkstreep als subtiel accent — geeft de header een afgewerkte, ontworpen rand. */}
      <div className="ml-auto h-1.5 w-16 rounded-full" style={{ background: "linear-gradient(90deg, var(--brand-primary), var(--brand-accent))" }} />
    </div>
  );
}
