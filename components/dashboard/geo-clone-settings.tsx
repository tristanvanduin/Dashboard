"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Save, CheckCircle2, Palette, Target, CalendarClock, Plus, Trash2, CornerDownRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getClientSettings } from "@/lib/client-settings";
import { RAI_GEO_CLONES } from "@/lib/rai/geo-clone-catalog";
import {
  resolveGeoCloneSettings,
  type AccountSettings,
  type GeoCloneSettings,
  type GeoCloneBranding,
  type GeoCloneGoals,
  type Edition,
  type Cadence,
} from "@/lib/rai/geo-clone-settings";

// Fase 2: per geo-clone een eigen instellingen-laag (branding, doelen, event-datums) met
// account-fallback. Laat je een veld leeg, dan erft het van het account (client_settings). De
// resolver (lib/rai/geo-clone-settings) bepaalt de effectieve waarde en de inherited-vlaggen;
// dit paneel toont per veld de account-terugval als placeholder/hint en slaat alleen de echte
// afwijkingen op in geo_clone_settings (migratie 025).

const CADENCE_LABEL: Record<Cadence, string> = { annual: "Jaarlijks", biennial: "2-jaarlijks", custom: "Anders" };

interface RaiEvent { id?: string; name?: string; abbrev?: string; cadence?: Cadence; editions?: Edition[] }

export function GeoCloneSettingsPanel({ clientId, geoClone }: { clientId: string; geoClone: string }) {
  const [account, setAccount] = useState<AccountSettings | null>(null);
  const [override, setOverride] = useState<GeoCloneSettings>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variant = useMemo(() => RAI_GEO_CLONES.find((v) => v.abbreviation === geoClone) ?? null, [geoClone]);
  const label = variant ? `${variant.brand} ${variant.location}` : geoClone;

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setAccount(null); setError(null); setSaved(false); setOverride({});

    Promise.all([
      sb.from("client_settings").select("brand_guide, rai_events").eq("client_id", clientId).maybeSingle(),
      sb.from("geo_clone_settings").select("branding, goals, event").eq("client_id", clientId).eq("geo_clone", geoClone).maybeSingle(),
    ]).then(([csRes, gcRes]) => {
      if (cancelled) return;
      if (csRes.error && !csRes.data) { /* client_settings kan nog leeg zijn — geen harde fout */ }

      // Account-fallback opbouwen: branding uit brand_guide, doelen uit KPI-instellingen,
      // event uit de rai_events die bij deze afkorting hoort.
      const guide = (csRes.data?.brand_guide ?? {}) as { brandName?: string; visual?: GeoCloneBranding };
      const kpi = getClientSettings(clientId).kpiTargets;
      const events = ((csRes.data?.rai_events as { events?: RaiEvent[] } | null)?.events ?? []);
      const matchEvent = events.find((e) => (e.abbrev ?? "").trim().toUpperCase() === geoClone.toUpperCase());

      const acc: AccountSettings = {
        branding: { brandName: guide.brandName ?? null, ...(guide.visual ?? {}) },
        goals: {
          conversionsAbsolute: kpi.conversionsAbsolute || null,
          revenueAbsolute: kpi.revenueAbsolute || null,
          roasTarget: kpi.roasTarget || null,
          cpaTarget: kpi.cpaTarget || null,
        },
        event: { cadence: matchEvent?.cadence ?? null, editions: matchEvent?.editions ?? [] },
      };
      setAccount(acc);

      if (gcRes.error && gcRes.error.message.toLowerCase().includes("geo_clone_settings")) {
        setError("Tabel ontbreekt — draai eerst migratie 025_geo_clone_settings.sql.");
        return;
      }
      if (gcRes.data) {
        setOverride({
          branding: (gcRes.data.branding as GeoCloneBranding) ?? undefined,
          goals: (gcRes.data.goals as GeoCloneGoals) ?? undefined,
          event: (gcRes.data.event as GeoCloneSettings["event"]) ?? undefined,
        });
      }
    });
    return () => { cancelled = true; };
  }, [clientId, geoClone]);

  const resolved = useMemo(() => (account ? resolveGeoCloneSettings(account, override) : null), [account, override]);

  function setBrand(key: keyof GeoCloneBranding, value: string) {
    setOverride((o) => ({ ...o, branding: { ...o.branding, [key]: value } }));
    setSaved(false);
  }
  function setGoal(key: keyof GeoCloneGoals, value: number) {
    setOverride((o) => ({ ...o, goals: { ...o.goals, [key]: value } }));
    setSaved(false);
  }
  function setCadence(c: Cadence) {
    setOverride((o) => ({ ...o, event: { ...o.event, cadence: c } }));
    setSaved(false);
  }
  function patchEdition(idx: number, next: Partial<Edition>) {
    setOverride((o) => {
      const eds = [...(o.event?.editions ?? [])];
      eds[idx] = { ...(eds[idx] ?? { date: "", label: "" }), ...next };
      return { ...o, event: { ...o.event, editions: eds } };
    });
    setSaved(false);
  }
  function addEdition() {
    setOverride((o) => ({ ...o, event: { ...o.event, editions: [...(o.event?.editions ?? []), { date: "", label: "" }] } }));
    setSaved(false);
  }
  function removeEdition(idx: number) {
    setOverride((o) => ({ ...o, event: { ...o.event, editions: (o.event?.editions ?? []).filter((_, i) => i !== idx) } }));
    setSaved(false);
  }

  async function save() {
    const sb = supabase;
    if (!sb) return;
    setSaving(true); setError(null);
    // Alleen echte afwijkingen bewaren: lege editie-rijen eruit filteren.
    const cleanEditions = (override.event?.editions ?? []).filter((e) => e.date);
    const payload = {
      client_id: clientId,
      geo_clone: geoClone,
      branding: override.branding ?? null,
      goals: override.goals ?? null,
      event: override.event ? { ...override.event, editions: cleanEditions } : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("geo_clone_settings").upsert(payload, { onConflict: "client_id,geo_clone" });
    setSaving(false);
    if (error) setError(error.message.toLowerCase().includes("geo_clone_settings") ? "Tabel ontbreekt — draai eerst migratie 025_geo_clone_settings.sql." : error.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 4000); }
  }

  if (error && !account) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  }
  if (!account || !resolved) {
    return <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Laden...</div>;
  }

  const inheritHint = (inherited: boolean, val: string | number | null) =>
    inherited && val != null && val !== "" ? (
      <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
        <CornerDownRight className="w-3 h-3" /> Erft van account: <strong className="font-medium">{String(val)}</strong>
      </span>
    ) : null;

  const brandFields: { key: keyof GeoCloneBranding; label: string; color?: boolean }[] = [
    { key: "brandName", label: "Merknaam" },
    { key: "primaryColor", label: "Primaire kleur", color: true },
    { key: "accentColor", label: "Accentkleur", color: true },
    { key: "secondaryColor", label: "Secundaire kleur", color: true },
    { key: "logoUrl", label: "Logo-URL" },
    { key: "headingFont", label: "Heading-font" },
  ];

  const goalFields: { key: keyof GeoCloneGoals; label: string; prefix?: string; suffix?: string }[] = [
    { key: "conversionsAbsolute", label: "Conversies (jaar)" },
    { key: "revenueAbsolute", label: "Omzet (jaar)", prefix: "€" },
    { key: "roasTarget", label: "ROAS-doel", suffix: "×" },
    { key: "cpaTarget", label: "CPA-doel", prefix: "€" },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[11px] text-blue-800">
        Instellingen voor <strong>{label}</strong> ({geoClone}). Laat je een veld leeg, dan <strong>erft</strong> deze
        beurs de waarde van het account. Alleen afwijkingen worden per beurs opgeslagen.
      </div>

      {/* Branding */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-rm-blue" />
          <h2 className="text-base font-semibold text-rm-blue">Branding — {label}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {brandFields.map(({ key, label: fl, color }) => {
            const ovVal = (override.branding?.[key] as string | undefined) ?? "";
            const accVal = (account.branding[key] as string | null) ?? null;
            const inh = resolved.branding.inherited[key];
            return (
              <label key={key} className="block">
                <span className="text-[11px] font-medium text-rm-gray">{fl}</span>
                <div className="mt-1 flex items-center gap-2">
                  {color && (
                    <input type="color" value={/^#([0-9a-fA-F]{6})$/.test(ovVal) ? ovVal : "#000000"}
                      onChange={(e) => setBrand(key, e.target.value)}
                      className="h-9 w-12 rounded border border-border cursor-pointer" />
                  )}
                  <input type="text" value={ovVal} placeholder={accVal ? `${accVal} (account)` : "leeg = account"}
                    onChange={(e) => setBrand(key, e.target.value)}
                    className={`flex-1 rounded-md border border-border px-3 py-2 text-[13px] focus:border-rm-blue/50 focus:outline-none ${color ? "font-mono" : ""}`} />
                </div>
                {inheritHint(inh, accVal)}
              </label>
            );
          })}
        </div>
      </div>

      {/* Doelstellingen */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-rm-blue" />
          <h2 className="text-base font-semibold text-rm-blue">Doelstellingen — {label}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goalFields.map(({ key, label: fl, prefix, suffix }) => {
            const ovVal = override.goals?.[key];
            const accVal = account.goals[key] ?? null;
            const inh = resolved.goals.inherited[key];
            return (
              <label key={key} className="block">
                <span className="text-[11px] font-medium text-rm-gray">{fl}</span>
                <div className="mt-1 flex items-center gap-2">
                  {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
                  <input type="number" min={0} step={key === "roasTarget" ? 0.1 : 1}
                    value={ovVal != null && ovVal > 0 ? ovVal : ""}
                    placeholder={accVal != null ? `${accVal} (account)` : "leeg = account"}
                    onChange={(e) => setGoal(key, parseFloat(e.target.value) || 0)}
                    className="flex-1 rounded-md border border-border px-3 py-2 text-[13px] focus:border-rm-blue/50 focus:outline-none" />
                  {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
                </div>
                {inheritHint(inh, accVal)}
              </label>
            );
          })}
        </div>
      </div>

      {/* Event / datums */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <CalendarClock className="w-5 h-5 text-rm-blue" />
          <h2 className="text-base font-semibold text-rm-blue">Event & edities — {label}</h2>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-medium text-rm-gray">Cadans:</span>
          {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
            <button key={c} onClick={() => setCadence(c)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${override.event?.cadence === c ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"}`}>
              {CADENCE_LABEL[c]}
            </button>
          ))}
          {resolved.event.inherited.cadence && account.event.cadence && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <CornerDownRight className="w-3 h-3" /> account: {CADENCE_LABEL[account.event.cadence]}
            </span>
          )}
        </div>

        <div className="mt-3">
          <span className="text-[11px] font-medium text-rm-gray">Afgelopen edities</span>
          {resolved.event.inherited.editions && (account.event.editions?.length ?? 0) > 0 && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
              <CornerDownRight className="w-3 h-3" /> Erft van account: {(account.event.editions ?? []).map((e) => e.label || e.date).join(", ")}
            </p>
          )}
          <div className="space-y-2 mt-1">
            {(override.event?.editions ?? []).map((ed, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input type="date" value={ed.date} onChange={(e) => patchEdition(idx, { date: e.target.value })}
                  className="rounded-md border border-border px-3 py-1.5 text-[12px] focus:border-rm-blue/50 focus:outline-none" />
                <input type="text" value={ed.label} placeholder="label (bijv. 2026)" onChange={(e) => patchEdition(idx, { label: e.target.value })}
                  className="flex-1 rounded-md border border-border px-3 py-1.5 text-[12px] focus:border-rm-blue/50 focus:outline-none" />
                <button onClick={() => removeEdition(idx)} className="text-muted-foreground hover:text-red-500" title="Editie verwijderen">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button onClick={addEdition} className="flex items-center gap-1 text-[11px] text-rm-blue hover:underline">
              <Plus className="w-3 h-3" /> Editie toevoegen
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <button onClick={save} disabled={saving}
        className="flex items-center gap-2 px-4 py-2 rounded-md bg-rm-blue text-white text-[12px] font-medium hover:bg-rm-blue/90 disabled:opacity-50 transition-all">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saving ? "Opslaan..." : saved ? "Opgeslagen" : `Instellingen ${geoClone} opslaan`}
      </button>
    </div>
  );
}
