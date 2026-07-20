"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, UserPlus, ChevronRight } from "lucide-react";
import { CHANNEL_BADGE_CLASS, CHANNEL_LABEL } from "@/lib/insights/channel-of";
import type { FeedItem, FeedStatus } from "@/lib/feed/feed-item";
import { MOCK_TEAM } from "@/lib/feed/owners-mock";

// Presentatie van één feed-item. TYPE (chip) en STATUS (pill) zijn bewust twee losse visuele
// kanalen; de status is neutraal gekleurd zodat hij niet met de urgentieband concurreert.
// Impact toont measured vs estimated duidelijk verschillend. Snooze vraagt verplicht een reden.

const TYPE_LABEL: Record<FeedItem["type"], string> = { signal: "Signaal", decision: "Beslissing", task: "Taak", issue: "Issue" };
const STATUS_LABEL: Record<FeedStatus, string> = { new: "Nieuw", in_progress: "In behandeling", awaiting_approval: "Wacht op akkoord", snoozed: "Gesnoozed", resolved: "Opgelost" };
const STATUS_CLASS: Record<FeedStatus, string> = {
  new: "text-blue-700 bg-blue-50 border-blue-200",
  in_progress: "text-amber-700 bg-amber-50 border-amber-200",
  awaiting_approval: "text-rm-blue bg-rm-blue/10 border-rm-blue/20",
  snoozed: "text-gray-500 bg-gray-100 border-gray-200",
  resolved: "text-emerald-700 bg-emerald-50 border-emerald-200",
};
const BORDER: Record<FeedItem["severity"], string> = { critical: "border-l-red-400", decision: "border-l-amber-400", watch: "border-l-gray-300" };

const AV_COLORS = ["bg-[#b8562f]", "bg-[#2f7d5b]", "bg-[#08288C]", "bg-[#7b3fe4]"];
function avatarColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

function plusDays(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}

export function FeedCard({ item, onSnooze, onAssign, onStatus }: {
  item: FeedItem;
  onSnooze: (item: FeedItem, reason: string, until: string) => void;
  onAssign: (item: FeedItem, owner: string) => void;
  onStatus: (item: FeedItem, status: string) => void;
}) {
  const [mode, setMode] = useState<null | "snooze" | "assign">(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(1);

  const impactMeasured = item.impactType === "measured";
  const impactColor = item.impactDirection === "risk" ? "text-red-600" : item.impactDirection === "gain" ? "text-emerald-600" : "text-rm-gray";

  return (
    <div className={`bg-white rounded-xl border border-border border-l-[3px] ${BORDER[item.severity]} shadow-sm p-3.5`}>
      {/* Kop: klant · kanaal · type · status · mock · leeftijd */}
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <Link href={item.clientUrl} className="text-sm font-bold text-rm-gray hover:text-rm-blue truncate max-w-[40%]">{item.clientName}</Link>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${CHANNEL_BADGE_CLASS[item.channel]}`}>{CHANNEL_LABEL[item.channel]}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-border bg-gray-50 text-muted-foreground">{TYPE_LABEL[item.type]}</span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
        {item.isMock && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">Demo</span>}
      </div>

      <p className="text-[13.5px] text-rm-gray leading-snug">{item.title}</p>
      {item.explanation && <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">{item.explanation}</p>}

      {/* Voetregel: impact · eigenaar · acties */}
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mt-2.5">
        {item.impactLabel && (
          <span className="inline-flex items-center gap-1.5 text-[12px]">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Impact</span>
            <span className={`font-semibold ${impactColor}`}>{item.impactLabel}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded ${impactMeasured ? "text-emerald-700 bg-emerald-50" : "text-gray-500 bg-gray-100 border border-dashed border-gray-300"}`}>
              {impactMeasured ? "gemeten" : "geschat"}
            </span>
          </span>
        )}

        {/* Eigenaar */}
        {item.ownerName ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className={`w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${avatarColor(item.ownerName)}`}>{item.ownerName.charAt(0)}</span>
            {item.ownerName}{item.ownerIsMock && <span className="text-[9px] text-gray-400">· demo</span>}
            {item.dueAt && <span className={`ml-1 ${new Date(item.dueAt) <= new Date() ? "text-red-600 font-semibold" : ""}`}><Clock className="w-3 h-3 inline -mt-0.5" /> {item.dueAt.slice(0, 10)}</span>}
          </span>
        ) : (
          <button onClick={() => setMode(mode === "assign" ? null : "assign")} className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 hover:underline">
            <span className="w-5 h-5 rounded-full border border-dashed border-red-400 text-red-500 text-[10px] flex items-center justify-center">?</span>
            Niet toegewezen
          </button>
        )}

        <span className="flex items-center gap-1.5 ml-auto">
          <Link href={item.actionUrl} className="text-[12px] font-semibold text-white bg-rm-blue rounded-lg px-3 py-1.5 hover:brightness-110 inline-flex items-center gap-1">
            {item.primaryAction.label}<ChevronRight className="w-3.5 h-3.5" />
          </Link>
          {item.secondaryActions.some((a) => a.kind === "assign") && item.ownerName && (
            <button onClick={() => setMode(mode === "assign" ? null : "assign")} title="Opnieuw toewijzen" className="text-[12px] text-muted-foreground border border-border rounded-lg px-2 py-1.5 hover:text-rm-gray"><UserPlus className="w-3.5 h-3.5" /></button>
          )}
          {item.secondaryActions.some((a) => a.kind === "snooze") && (
            <button onClick={() => setMode(mode === "snooze" ? null : "snooze")} className="text-[12px] text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:text-rm-gray">Snooze</button>
          )}
        </span>
      </div>

      {/* Snooze — reden verplicht */}
      {mode === "snooze" && (
        <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {[{ d: 1, l: "morgen" }, { d: 3, l: "3 dagen" }, { d: 7, l: "volgende week" }].map((o) => (
              <button key={o.d} onClick={() => setDays(o.d)} className={`text-[11px] px-2.5 py-1 rounded-md border ${days === o.d ? "bg-rm-blue text-white border-transparent" : "border-border text-muted-foreground"}`}>{o.l}</button>
            ))}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reden (verplicht)…" className="flex-1 min-w-[160px] text-[12px] border border-border rounded-md px-2.5 py-1.5 focus:outline-none focus:border-rm-blue" />
          <button disabled={!reason.trim()} onClick={() => { onSnooze(item, reason.trim(), plusDays(days)); setMode(null); setReason(""); }} className="text-[12px] font-semibold text-white bg-rm-blue rounded-md px-3 py-1.5 disabled:opacity-40">Snooze</button>
        </div>
      )}

      {/* Toewijzen */}
      {mode === "assign" && (
        <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Wijs toe aan:</span>
          {MOCK_TEAM.map((name) => (
            <button key={name} onClick={() => { onAssign(item, name); setMode(null); }} className="text-[12px] px-2.5 py-1 rounded-md border border-border hover:border-rm-blue hover:text-rm-blue">{name}</button>
          ))}
          <span className="text-[10px] text-gray-400">· echte toewijzing (geen demo)</span>
        </div>
      )}
    </div>
  );
}
