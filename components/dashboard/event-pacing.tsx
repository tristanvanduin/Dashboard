"use client";

import { useState, useEffect } from "react";
import { Loader2, CalendarClock, TrendingUp, TrendingDown, Minus, Info } from "lucide-react";

// Event-relatieve pacing: voor een beurs is "dag X van 365" zinloos. Wat telt is de opbouw tot NU
// afgezet tegen HETZELFDE punt vóór de vorige editie (op gelijke afstand tot de beursdag,
// cadans-bewust). Loop je vóór of achter t.o.v. de vorige keer? Deze widget toont dat altijd-live
// (draait de deterministische geo-clone-analyse via ?live=1), zonder dat je een knop hoeft te
// klikken. De rekenkern zit in lib/rai; dit is puur de uitlezing.

interface Pacing {
  geoClone: string;
  fairLabel: string;
  daysToFair: number | null;
  currentEditionId: string | null;
  previousEditionId: string | null;
  comparable: boolean;
  currentCumulative: number | null;
  previousCumulative: number | null;
  deltaPct: number | null;
  costDeltaPct: number | null;
  actionNeeded: boolean;
  degradations: string[];
}

const fmt = (n: number | null): string => (n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n));
const pct = (r: number | null): string => (r == null || !Number.isFinite(r) ? "—" : `${r >= 0 ? "+" : ""}${Math.round(r * 100)}%`);

export function EventPacing({ clientId, geoClone }: { clientId: string; geoClone: string }) {
  const [data, setData] = useState<Pacing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    fetch(`/api/analysis/geo-clone?client_id=${encodeURIComponent(clientId)}&geo_clone=${encodeURIComponent(geoClone)}&live=1`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d?.pacing) setData(d.pacing as Pacing); else setError(d?.error ?? "Geen pacing beschikbaar"); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [clientId, geoClone]);

  // Aanvullend widget: kan de pacing niet berekend worden (geen data/config), dan tonen we niets
  // en laat het beursoverzicht eronder het werk doen — geen storende foutmelding bovenaan.
  if (error) return null;
  if (!data) {
    return <div className="bg-white rounded-xl border border-border p-6 shadow-sm flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-rm-blue" /></div>;
  }

  const behind = data.comparable && data.deltaPct != null && data.deltaPct < -0.02;
  const ahead = data.comparable && data.deltaPct != null && data.deltaPct > 0.02;
  const toneClass = behind ? "text-red-600" : ahead ? "text-emerald-600" : "text-rm-gray";
  const TrendIcon = behind ? TrendingDown : ahead ? TrendingUp : Minus;
  // Spend gelijk of hoger terwijl de opbouw achterloopt = effectiviteitsvraag, geen budgetkwestie.
  const effectivenessNote = behind && data.costDeltaPct != null && data.deltaPct != null && data.costDeltaPct >= data.deltaPct;

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <CalendarClock className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">Pacing richting de beurs</h3>
        <span className="text-[11px] text-muted-foreground">event-relatief · vs vorige editie</span>
        {data.daysToFair != null && (
          <span className="ml-auto text-[11px] font-medium text-rm-blue">
            nog {data.daysToFair} {data.daysToFair === 1 ? "dag" : "dagen"} tot {data.fairLabel}
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        {!data.comparable ? (
          <div className="text-[12px] text-muted-foreground flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Nog niet vergelijkbaar met de vorige editie{data.previousEditionId ? ` (${data.previousEditionId})` : ""}:
              {data.degradations[0] ? ` ${data.degradations[0]}` : " te weinig vergelijkbare data op gelijke afstand tot de beursdag."}
              {" "}Opbouw tot nu: <strong>{fmt(data.currentCumulative)}</strong> conversies.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-[11px] text-muted-foreground">Opbouw tot nu (deze editie)</div>
              <div className="text-lg font-semibold text-rm-gray mt-0.5">{fmt(data.currentCumulative)}</div>
              <div className="text-[10px] text-muted-foreground">conversies</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Vorige editie op ditzelfde punt</div>
              <div className="text-lg font-semibold text-rm-gray mt-0.5">{fmt(data.previousCumulative)}</div>
              <div className="text-[10px] text-muted-foreground">{data.previousEditionId ?? "vorige editie"}, gelijke afstand</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Pacing vs vorige editie</div>
              <div className={`text-lg font-semibold mt-0.5 flex items-center gap-1.5 ${toneClass}`}>
                <TrendIcon className="w-4 h-4" /> {pct(data.deltaPct)}
              </div>
              <div className="text-[10px] text-muted-foreground">{behind ? "loopt achter" : ahead ? "loopt voor" : "op koers"}</div>
            </div>
          </div>
        )}

        {effectivenessNote && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            De aanloop ligt achter terwijl de spend gelijk of hoger is ({pct(data.costDeltaPct)}): dit is een
            effectiviteitsvraag, geen budgetkwestie — kijk naar conversieratio en targeting vóór je meer budget inzet.
          </div>
        )}
      </div>
    </div>
  );
}
