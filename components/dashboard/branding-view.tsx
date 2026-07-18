"use client";

import { useState, useEffect } from "react";
import { Loader2, Palette, Save, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { resolveEventTheme, type BrandVisualIdentity } from "@/lib/branding/theme";

// Branding-tab: de merk-identiteit per klant/account. Bewerkt client_settings.brand_guide
// (jsonb, migratie 019). Dit is gezicht 1 (de visuele identiteit) van de brand guide; de
// creatieve regels (tone, verboden woorden) komen in een vervolgronde. De live-preview
// gebruikt dezelfde resolveEventTheme-logica die het dashboard per event toepast.

type GuideShape = { brandName?: string; visual?: BrandVisualIdentity } & Record<string, unknown>;

const COLOR_FIELDS: { key: keyof BrandVisualIdentity; label: string }[] = [
  { key: "primaryColor", label: "Primaire kleur" },
  { key: "accentColor", label: "Accentkleur" },
  { key: "secondaryColor", label: "Secundaire kleur" },
];

export function BrandingView({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [guide, setGuide] = useState<GuideShape | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setGuide(null); setError(null); setSaved(false);
    sb.from("client_settings").select("brand_guide").eq("client_id", clientId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setError(error.message); return; }
        const g = (data?.brand_guide ?? {}) as GuideShape;
        setGuide({ brandName: g.brandName ?? clientName, ...g, visual: g.visual ?? {} });
      });
    return () => { cancelled = true; };
  }, [clientId, clientName]);

  function setVisual(key: keyof BrandVisualIdentity, value: string) {
    setGuide((g) => g ? { ...g, visual: { ...g.visual, [key]: value } } : g);
    setSaved(false);
  }

  async function save() {
    const sb = supabase;
    if (!sb || !guide) return;
    setSaving(true); setError(null);
    const { error } = await sb.from("client_settings").upsert(
      { client_id: clientId, brand_guide: guide },
      { onConflict: "client_id" }
    );
    setSaving(false);
    if (error) setError(error.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 4000); }
  }

  if (error && !guide) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  }
  if (!guide) {
    return <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Laden...</div>;
  }

  const theme = resolveEventTheme(guide.visual ?? {});

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Editor */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Palette className="w-5 h-5 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">Merk-identiteit</h3>
        </div>
        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="text-[11px] font-medium text-rm-gray">Merknaam</span>
            <input
              type="text"
              value={guide.brandName ?? ""}
              onChange={(e) => { setGuide((g) => g ? { ...g, brandName: e.target.value } : g); setSaved(false); }}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-[13px] focus:border-rm-blue/50 focus:outline-none"
            />
          </label>

          {COLOR_FIELDS.map(({ key, label }) => {
            const val = (guide.visual?.[key] as string) ?? "";
            return (
              <label key={key} className="block">
                <span className="text-[11px] font-medium text-rm-gray">{label}</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#([0-9a-fA-F]{6})$/.test(val) ? val : "#000000"}
                    onChange={(e) => setVisual(key, e.target.value)}
                    className="h-9 w-12 rounded border border-border cursor-pointer"
                  />
                  <input
                    type="text"
                    value={val}
                    placeholder="#08288C"
                    onChange={(e) => setVisual(key, e.target.value)}
                    className="flex-1 rounded-md border border-border px-3 py-2 text-[13px] font-mono focus:border-rm-blue/50 focus:outline-none"
                  />
                </div>
              </label>
            );
          })}

          <label className="block">
            <span className="text-[11px] font-medium text-rm-gray">Logo-URL</span>
            <input
              type="text"
              value={(guide.visual?.logoUrl as string) ?? ""}
              placeholder="https://..."
              onChange={(e) => setVisual("logoUrl", e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-[13px] focus:border-rm-blue/50 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-rm-gray">Heading-font</span>
            <input
              type="text"
              value={(guide.visual?.headingFont as string) ?? ""}
              placeholder="Gilroy, Ubuntu, sans-serif"
              onChange={(e) => setVisual("headingFont", e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-[13px] focus:border-rm-blue/50 focus:outline-none"
            />
          </label>

          {error && <p className="text-[11px] text-red-500">{error}</p>}
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-rm-blue text-white text-[12px] font-medium hover:bg-rm-blue/90 disabled:opacity-50 transition-all"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? "Opslaan..." : saved ? "Opgeslagen" : "Opslaan"}
          </button>
          <p className="text-[10px] text-muted-foreground">
            Alleen geldige hex-kleuren (#RRGGBB) worden toegepast; anders valt het thema terug op de standaardkleuren.
            Dit is de visuele identiteit; de creatieve regels (tone-of-voice, verboden woorden) volgen in een vervolgronde.
          </p>
        </div>
      </div>

      {/* Live preview */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-rm-gray">Live preview</h3>
        </div>
        <div className="p-5">
          <div className="rounded-xl overflow-hidden border border-border" style={{ background: theme.background, color: theme.foreground }}>
            <div className="px-5 py-4 flex items-center gap-3" style={{ background: theme.primary, color: theme.primaryForeground, fontFamily: theme.headingFont }}>
              {theme.logoUrl
                ? <img src={theme.logoUrl} alt="logo" className="h-7 w-auto object-contain" />
                : <div className="h-7 w-7 rounded" style={{ background: theme.primaryForeground, opacity: 0.25 }} />}
              <span className="text-base font-bold">{guide.brandName || clientName}</span>
            </div>
            <div className="p-5 space-y-3" style={{ background: theme.card }}>
              <div className="text-[13px] font-semibold" style={{ color: theme.foreground }}>Voorbeeld-kaart</div>
              <p className="text-[12px]" style={{ color: theme.foreground, opacity: 0.7 }}>Zo rendert het dashboard met deze merk-identiteit.</p>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded-md text-[12px] font-medium" style={{ background: theme.primary, color: theme.primaryForeground }}>Primaire actie</button>
                <button className="px-3 py-1.5 rounded-md text-[12px] font-medium" style={{ background: theme.accent, color: theme.accentForeground }}>Accent</button>
                <button className="px-3 py-1.5 rounded-md text-[12px] font-medium" style={{ background: theme.secondary, color: theme.foreground }}>Secundair</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
