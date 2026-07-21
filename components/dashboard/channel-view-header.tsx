"use client";

import { Loader2, AlertCircle, CheckCircle2, ArrowRight, Info } from "lucide-react";

// Gedeelde kanaal-header voor de kanaaltabs (Meta, LinkedIn) zodat ze dezelfde opbouw als de
// Google-weergave hebben: een getitelde kaart met kanaalnaam + koppelstatus, een blauwe
// context-regel (zoals het Google-beursoverzicht) en de "dit kanaal levert"-lijst ingeklapt —
// zodat de weergave met data leidt, niet met een feature-lijst. De drie kanalen ogen zo gelijk.

type Status =
  | { kind: "loading" }
  | { kind: "connected"; label?: string }
  | { kind: "warning"; label: string };

function StatusBadge({ status }: { status: Status }) {
  if (status.kind === "loading") return <Loader2 className="w-4 h-4 text-muted-foreground animate-spin ml-auto" />;
  if (status.kind === "connected")
    return (
      <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-600">
        <CheckCircle2 className="w-3.5 h-3.5" /> {status.label ?? "Gekoppeld"}
      </span>
    );
  return (
    <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-600">
      <AlertCircle className="w-3.5 h-3.5" /> {status.label}
    </span>
  );
}

export function ChannelViewHeader({
  icon,
  title,
  geoClone,
  status,
  blurb,
  delivers,
  analysesHint,
  warning,
}: {
  icon: React.ReactNode;
  title: string;
  geoClone?: string | null;
  status: Status;
  blurb: React.ReactNode;
  delivers: string[];
  analysesHint: React.ReactNode;
  warning?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-rm-gray">{title}</h3>
        {geoClone && <span className="text-[11px] text-muted-foreground">— beurs {geoClone}</span>}
        <StatusBadge status={status} />
      </div>
      <div className="px-5 py-4 space-y-3">
        {warning}
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[11px] text-blue-800 flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{blurb}</span>
        </div>
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-rm-gray select-none">
            Wat dit kanaal levert
          </summary>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2">
            {delivers.map((s) => (
              <li key={s} className="text-[12px] text-rm-gray flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rm-blue/40" /> {s}
              </li>
            ))}
          </ul>
        </details>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <ArrowRight className="w-3.5 h-3.5" />
          {analysesHint}
        </p>
      </div>
    </div>
  );
}
