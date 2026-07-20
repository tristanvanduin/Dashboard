"use client";

import { useState, useMemo } from "react";
import { Loader2, AlertTriangle, Scale, Eye, CheckCircle2, Info } from "lucide-react";
import { useTodayFeed } from "@/lib/feed/use-today-feed";
import type { FeedItem, FeedSeverity, FeedChannel } from "@/lib/feed/feed-item";
import { FeedCard } from "./feed-card";

// De "Vandaag"-cockpit: cross-client triage. Beantwoordt in één blik — is er iets kapot,
// welke beslissingen wachten, wat moet vandaag, wat is nieuw, en wie is veilig buiten beeld.
// Leest bestaande bronnen via useTodayFeed; verandert geen analyse/forecast/drempel.

type OwnerFilter = "team" | "mine" | "unassigned";
type ChannelFilter = "all" | FeedChannel;

const BANDS: { key: FeedSeverity; label: string; lede: string; icon: React.ReactNode; dot: string; count: string }[] = [
  { key: "critical", label: "Kapot / tijdkritisch", lede: "verloopt vandaag · gesorteerd op € risico", icon: <AlertTriangle className="w-4 h-4 text-red-500" />, dot: "bg-red-500", count: "bg-red-500 text-white" },
  { key: "decision", label: "Beslissing gevraagd", lede: "door de data voorbereid · gesorteerd op impact & ICE", icon: <Scale className="w-4 h-4 text-amber-500" />, dot: "bg-amber-400", count: "bg-amber-400 text-white" },
  { key: "watch", label: "Volgt / deze week", lede: "geen brand · kan wachten", icon: <Eye className="w-4 h-4 text-gray-400" />, dot: "bg-gray-300", count: "bg-gray-300 text-rm-gray" },
];

function Pulse({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className="bg-white rounded-xl border border-border px-3.5 py-2 shadow-sm min-w-[104px]">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${tone === "warn" ? "text-red-600" : tone === "ok" ? "text-emerald-600" : "text-rm-gray"}`}>{value}</p>
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="inline-flex bg-gray-100 border border-border rounded-lg p-0.5 gap-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={`text-[12.5px] font-medium px-3 py-1.5 rounded-md transition-colors ${value === o.v ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground hover:text-rm-gray"}`}>{o.l}</button>
      ))}
    </div>
  );
}

const eur = (v: number): string => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

export function TodayFeed() {
  const feed = useTodayFeed();
  const [owner, setOwner] = useState<OwnerFilter>("team");
  const [channel, setChannel] = useState<ChannelFilter>("all");

  const match = useMemo(() => (i: FeedItem): boolean => {
    if (channel !== "all" && i.channel !== channel) return false;
    if (owner === "unassigned" && i.ownerName) return false;
    if (owner === "mine" && i.ownerName !== feed.currentUser) return false;
    return true;
  }, [channel, owner, feed.currentUser]);

  const bands = useMemo(() => ({
    critical: feed.bands.critical.filter(match),
    decision: feed.bands.decision.filter(match),
    watch: feed.bands.watch.filter(match),
  }), [feed.bands, match]);

  const myActions = useMemo(() => feed.myActions.filter(match), [feed.myActions, match]);
  const totalVisible = bands.critical.length + bands.decision.length + bands.watch.length;

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Goedemorgen" : now.getHours() < 18 ? "Goedemiddag" : "Goedenavond";
  const dateStr = now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  if (feed.loading) {
    return <div className="flex items-center justify-center py-20 gap-3"><Loader2 className="w-6 h-6 animate-spin text-rm-blue" /><p className="text-sm text-muted-foreground">Vandaag samenstellen…</p></div>;
  }

  return (
    <div className="space-y-5">
      {/* Kop + pols */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-rm-gray">{greeting}{feed.currentUser ? `, ${feed.currentUser.split("@")[0]}` : ""}</h1>
          <p className="text-[13px] text-muted-foreground capitalize">{dateStr}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Pulse label="Aandacht nodig" value={String(feed.pulse.attention)} tone={feed.pulse.attention > 0 ? "warn" : "ok"} />
          <Pulse label="Op koers" value={String(feed.pulse.onTrack)} tone="ok" />
          <Pulse label="Risico open (gemeten)" value={feed.pulse.measuredRisk > 0 ? eur(feed.pulse.measuredRisk) : "€0"} tone={feed.pulse.measuredRisk > 0 ? "warn" : undefined} />
          <Pulse label="Niet toegewezen" value={String(feed.pulse.unassigned)} tone={feed.pulse.unassigned > 0 ? "warn" : undefined} />
        </div>
      </div>

      {feed.error && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800">{feed.error}</div>}
      {feed.demoMode && (
        <div className="rounded-md border border-purple-200 bg-purple-50 px-4 py-2 text-[11.5px] text-purple-800 flex items-center gap-2">
          <Info className="w-3.5 h-3.5 shrink-0" /> <strong>Demo-modus actief</strong> — mock-eigenaren en <strong>Demo</strong>-operationele kaarten worden getoond voor presentatie. Ze tellen niet mee in de pols. Verwijder <code className="bg-white/60 px-1 rounded">?demo=1</code> uit de URL voor de echte feed.
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Seg value={owner} onChange={setOwner} options={[{ v: "team", l: "Team" }, { v: "mine", l: "Mijn" }, { v: "unassigned", l: "Niet toegewezen" }]} />
        <Seg value={channel} onChange={setChannel} options={[{ v: "all", l: "Alle kanalen" }, { v: "google", l: "Google" }, { v: "meta", l: "Meta" }, { v: "linkedin", l: "LinkedIn" }]} />
        <span className="ml-auto text-[11px] font-mono text-muted-foreground bg-white border border-border rounded-full px-3 py-1">Nieuw sinds gisteren · {feed.pulse.newSince}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Feed */}
        <div className="space-y-6">
          {BANDS.map((b) => (
            <section key={b.key}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${b.dot}`} />
                <h2 className="text-sm font-bold text-rm-gray">{b.label}</h2>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 tabular-nums ${b.count}`}>{bands[b.key].length}</span>
                <span className="text-[11px] text-muted-foreground ml-auto text-right">{b.lede}</span>
              </div>
              {bands[b.key].length === 0 ? (
                <p className="text-[12px] text-muted-foreground bg-white border border-border rounded-lg px-4 py-3">Niets in deze band{owner !== "team" || channel !== "all" ? " binnen dit filter" : ""}.</p>
              ) : (
                <div className="space-y-2">
                  {bands[b.key].map((item) => (
                    <FeedCard key={item.id} item={item} onSnooze={feed.snooze} onAssign={feed.assign} onStatus={feed.setStatus} />
                  ))}
                </div>
              )}
            </section>
          ))}

          {totalVisible === 0 && (
            <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-5 py-4 text-[13px] text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4.5 h-4.5" />
              Onder deze lijn: {feed.pulse.onTrack} klanten op koers, niets dat vandaag je aandacht vraagt.
            </div>
          )}
        </div>

        {/* Rechterkolom */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Mijn acties vandaag</h3>
              <span className="text-[12px] font-bold text-rm-blue tabular-nums">{myActions.length}</span>
            </div>
            <p className="text-[10.5px] text-gray-400 mb-2.5">= dezelfde feed, gefilterd op deadline vandaag/verlopen{feed.currentUser ? " of jouw naam" : ""}</p>
            {myActions.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Geen acties met deadline vandaag.</p>
            ) : (
              <ul className="space-y-2">
                {myActions.slice(0, 8).map((i) => (
                  <li key={i.id} className="text-[12.5px] border-t border-border pt-2 first:border-0 first:pt-0">
                    <span className="text-rm-gray">{i.title}</span>
                    <span className="block text-[11px] text-muted-foreground font-mono mt-0.5">{i.clientName}{i.dueAt ? ` · ${new Date(i.dueAt) <= now ? "verlopen" : i.dueAt.slice(0, 10)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Nieuw sinds gisteren</h3>
            {(["critical", "decision", "watch"] as FeedSeverity[]).map((k, idx) => (
              <div key={k} className={`flex justify-between text-[12.5px] py-1.5 ${idx > 0 ? "border-t border-border" : ""}`}>
                <span className="text-muted-foreground">{k === "critical" ? "Kapot / tijdkritisch" : k === "decision" ? "Beslissing gevraagd" : "Volgt deze week"}</span>
                <span className="font-mono font-bold tabular-nums text-rm-gray">+{feed.newByBand[k]}</span>
              </div>
            ))}
            <div className="flex justify-between text-[12.5px] py-1.5 border-t border-border">
              <span className="text-muted-foreground">Automatisch opgelost</span>
              <span className="font-mono font-bold tabular-nums text-emerald-600">{feed.pulse.autoResolved}</span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Wanneer kleurt het?</h3>
            <ul className="space-y-2.5">
              <li className="flex gap-2.5 text-[12px] text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 mt-1 shrink-0" /><span><strong className="text-rm-gray">Rood</strong> — tracking/sync kapot, budget acuut fout, grote spend-anomalie, conversies vallen weg, deadline vandaag/verlopen. Schaars &amp; vandaag actioneerbaar.</span></li>
              <li className="flex gap-2.5 text-[12px] text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 mt-1 shrink-0" /><span><strong className="text-rm-gray">Oranje</strong> — beslissing nodig, substantiële afwijking, hoge ICE, budgetherallocatie.</span></li>
              <li className="flex gap-2.5 text-[12px] text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300 mt-1 shrink-0" /><span><strong className="text-rm-gray">Geel</strong> — optimalisatiekans, trendverslechtering, monitoring.</span></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
