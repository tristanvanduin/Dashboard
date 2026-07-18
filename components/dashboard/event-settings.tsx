"use client";

import { useState, useEffect } from "react";
import { Loader2, CalendarClock, Save, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

// RAI event-instellingen per klant: beurzen/geo-clones met cadans (jaarlijks/2-jaarlijks/anders)
// en de datums van de afgelopen edities. Slaat op in client_settings.rai_events (migratie 024).
// Deze input voedt de event-relatieve vergelijking en forecast (lib/rai): waarmee moet de
// huidige editie vergeleken worden. Voorloper op de per-geo-clone entiteit-laag.

type Cadence = "annual" | "biennial" | "custom";
const CADENCE_LABEL: Record<Cadence, string> = {
  annual: "Jaarlijks",
  biennial: "2-jaarlijks",
  custom: "Anders",
};

interface Edition { date: string; label: string }
interface RaiEvent { id: string; name: string; abbrev: string; cadence: Cadence; editions: Edition[] }

function emptyEvent(): RaiEvent {
  return { id: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())), name: "", abbrev: "", cadence: "annual", editions: [{ date: "", label: "" }] };
}

export function EventSettings({ clientId }: { clientId: string }) {
  const [events, setEvents] = useState<RaiEvent[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setEvents(null); setError(null); setSaved(false);
    sb.from("client_settings").select("rai_events").eq("client_id", clientId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setError(error.message); setEvents([]); return; }
        const raw = (data?.rai_events as { events?: RaiEvent[] } | null) ?? null;
        setEvents(Array.isArray(raw?.events) ? raw!.events : []);
      });
    return () => { cancelled = true; };
  }, [clientId]);

  function patchEvent(id: string, next: Partial<RaiEvent>) {
    setEvents((evs) => evs?.map((e) => (e.id === id ? { ...e, ...next } : e)) ?? evs);
    setSaved(false);
  }
  function patchEdition(eventId: string, idx: number, next: Partial<Edition>) {
    setEvents((evs) => evs?.map((e) => e.id === eventId ? { ...e, editions: e.editions.map((ed, i) => i === idx ? { ...ed, ...next } : ed) } : e) ?? evs);
    setSaved(false);
  }

  async function save() {
    const sb = supabase;
    if (!sb || !events) return;
    setSaving(true); setError(null);
    // lege edities eruit filteren
    const clean = events
      .filter((e) => e.name.trim())
      .map((e) => ({ ...e, editions: e.editions.filter((ed) => ed.date) }));
    const { error } = await sb.from("client_settings").upsert(
      { client_id: clientId, rai_events: { events: clean } },
      { onConflict: "client_id" }
    );
    setSaving(false);
    if (error) setError(error.message.includes("rai_events") ? "Kolom ontbreekt — draai eerst migratie 024_rai_events.sql." : error.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 4000); }
  }

  if (error && !events) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  }
  if (!events) {
    return <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Laden...</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <CalendarClock className="w-5 h-5 text-rm-blue" />
        <h2 className="text-base font-semibold text-rm-blue">Beurzen & edities</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Leg per beurs (of geo-clone) vast of hij jaarlijks of 2-jaarlijks is en wanneer de afgelopen edities plaatsvonden.
        Dit bepaalt met welke vorige editie de huidige data vergeleken wordt, en voedt de event-prognose.
      </p>

      <div className="space-y-4">
        {events.length === 0 && (
          <p className="text-[12px] text-muted-foreground">Nog geen beurzen ingesteld. Voeg er een toe.</p>
        )}
        {events.map((ev) => (
          <div key={ev.id} className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-[11px] font-medium text-rm-gray">Naam</span>
                  <input type="text" value={ev.name} placeholder="bijv. GreenTech Amsterdam"
                    onChange={(e) => patchEvent(ev.id, { name: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-[13px] focus:border-rm-blue/50 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-rm-gray">Afkorting (campagne)</span>
                  <input type="text" value={ev.abbrev} placeholder="bijv. GTA"
                    onChange={(e) => patchEvent(ev.id, { abbrev: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-[13px] font-mono focus:border-rm-blue/50 focus:outline-none" />
                </label>
              </div>
              <button onClick={() => { setEvents((evs) => evs?.filter((e) => e.id !== ev.id) ?? evs); setSaved(false); }}
                className="mt-6 text-muted-foreground hover:text-red-500 transition-colors" title="Beurs verwijderen">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-rm-gray">Cadans:</span>
              {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                <button key={c} onClick={() => patchEvent(ev.id, { cadence: c })}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${ev.cadence === c ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"}`}>
                  {CADENCE_LABEL[c]}
                </button>
              ))}
            </div>

            <div>
              <span className="text-[11px] font-medium text-rm-gray">Afgelopen edities</span>
              <div className="space-y-2 mt-1">
                {ev.editions.map((ed, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input type="date" value={ed.date}
                      onChange={(e) => patchEdition(ev.id, idx, { date: e.target.value })}
                      className="rounded-md border border-border px-3 py-1.5 text-[12px] focus:border-rm-blue/50 focus:outline-none" />
                    <input type="text" value={ed.label} placeholder="label (bijv. 2026)"
                      onChange={(e) => patchEdition(ev.id, idx, { label: e.target.value })}
                      className="flex-1 rounded-md border border-border px-3 py-1.5 text-[12px] focus:border-rm-blue/50 focus:outline-none" />
                    <button onClick={() => patchEvent(ev.id, { editions: ev.editions.filter((_, i) => i !== idx) })}
                      className="text-muted-foreground hover:text-red-500" title="Editie verwijderen">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={() => patchEvent(ev.id, { editions: [...ev.editions, { date: "", label: "" }] })}
                  className="flex items-center gap-1 text-[11px] text-rm-blue hover:underline">
                  <Plus className="w-3 h-3" /> Editie toevoegen
                </button>
              </div>
            </div>
          </div>
        ))}

        <button onClick={() => { setEvents((evs) => [...(evs ?? []), emptyEvent()]); setSaved(false); }}
          className="flex items-center gap-1.5 text-[12px] text-rm-blue hover:underline">
          <Plus className="w-4 h-4" /> Beurs toevoegen
        </button>
      </div>

      {error && <p className="text-[11px] text-red-500 mt-3">{error}</p>}
      <button onClick={save} disabled={saving}
        className="mt-4 flex items-center gap-2 px-4 py-2 rounded-md bg-rm-blue text-white text-[12px] font-medium hover:bg-rm-blue/90 disabled:opacity-50 transition-all">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saving ? "Opslaan..." : saved ? "Opgeslagen" : "Opslaan"}
      </button>
    </div>
  );
}
