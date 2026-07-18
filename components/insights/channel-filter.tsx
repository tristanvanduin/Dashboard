"use client";

import { Filter } from "lucide-react";
import { CHANNEL_LABEL, CHANNEL_BADGE_CLASS, type InsightChannel } from "@/lib/insights/channel-of";

// Gedeelde kanaal-filterbalk en kanaal-badge voor de inzichten-laag en de sprintplanning.
// null = alle kanalen. De afleiding (bron/sop_type -> kanaal) leeft in lib/insights/channel-of;
// dit is puur de weergave, zodat elke plek dezelfde chips en kleuren gebruikt.

const CHANNELS: InsightChannel[] = ["google", "meta", "linkedin", "cross"];

export function ChannelFilter({ value, onChange, counts }: {
  value: InsightChannel | null;
  onChange: (v: InsightChannel | null) => void;
  counts?: Partial<Record<InsightChannel, number>>;
}) {
  const pill = (active: boolean) =>
    `px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
      active ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"
    }`;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Filter className="w-3.5 h-3.5" /> Kanaal:
      </span>
      <button onClick={() => onChange(null)} className={pill(value === null)}>Alle</button>
      {CHANNELS.map((c) => (
        <button key={c} onClick={() => onChange(c)} className={pill(value === c)}>
          {CHANNEL_LABEL[c]}
          {counts?.[c] != null && <span className="opacity-60"> ({counts[c]})</span>}
        </button>
      ))}
    </div>
  );
}

export function ChannelBadge({ channel }: { channel: InsightChannel | null }) {
  if (!channel) return <span className="text-[10px] text-muted-foreground">—</span>;
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded border ${CHANNEL_BADGE_CLASS[channel]}`}>
      {CHANNEL_LABEL[channel]}
    </span>
  );
}
