"use client";

import { useState, useEffect } from "react";
import { Loader2, Save, CheckCircle2, Target } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  conversionSourcesFor,
  resolveChannelConversionConfig,
  type ChannelConversionChannel,
  type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";

// Conversie-selectie per kanaal: kies, net als bij Google, welke conversies meetellen voor
// Meta en LinkedIn. De selectie werkt door in de KPI's, forecasts en views (via
// lib/analysis/channel-conversion-config). Opgeslagen in client_settings.channel_conversion_config.

const CHANNELS: { channel: ChannelConversionChannel; label: string }[] = [
  { channel: "meta_ads", label: "Meta" },
  { channel: "linkedin_ads", label: "LinkedIn" },
];

export function ChannelConversionSettings({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<ChannelConversionConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setConfig(null); setError(null); setSaved(false);
    sb.from("client_settings").select("channel_conversion_config").eq("client_id", clientId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setConfig(resolveChannelConversionConfig((data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null));
      });
    return () => { cancelled = true; };
  }, [clientId]);

  function toggle(channel: ChannelConversionChannel, field: string) {
    setConfig((c) => {
      if (!c) return c;
      const cur = c[channel];
      const next = cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field];
      setSaved(false);
      return { ...c, [channel]: next };
    });
  }

  async function save() {
    const sb = supabase;
    if (!sb || !config) return;
    setSaving(true); setError(null);
    // Normaliseer (lege selectie → default) vóór opslaan, zodat de conversie nooit 0 wordt.
    const clean = resolveChannelConversionConfig(config);
    const { error } = await sb.from("client_settings").upsert(
      { client_id: clientId, channel_conversion_config: clean },
      { onConflict: "client_id" }
    );
    setSaving(false);
    if (error) setError(error.message);
    else { setConfig(clean); setSaved(true); setTimeout(() => setSaved(false), 4000); }
  }

  if (error && !config) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  }
  if (!config) {
    return <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Laden...</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Target className="w-5 h-5 text-rm-blue" />
        <h2 className="text-base font-semibold text-rm-blue">Conversie-selectie per kanaal</h2>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Kies welke conversies meetellen voor Meta en LinkedIn (zoals de conversie-acties bij Google).
        De selectie werkt door in de KPI&apos;s, pacing en forecasts. Laat je alles uit, dan valt het
        kanaal terug op de standaard (de conversie wordt nooit 0).
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {CHANNELS.map(({ channel, label }) => {
          const selected = new Set(config[channel]);
          return (
            <div key={channel}>
              <h3 className="text-[12px] font-semibold text-rm-gray mb-2">{label}</h3>
              <div className="space-y-1.5">
                {conversionSourcesFor(channel).map((src) => (
                  <label key={src.field} className="flex items-start gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selected.has(src.field)}
                      onChange={() => toggle(channel, src.field)}
                      className="mt-0.5 accent-rm-blue"
                    />
                    <span className="min-w-0">
                      <span className="text-[12px] text-rm-gray">{src.label}</span>
                      {src.hint && <span className="block text-[10px] text-muted-foreground">{src.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Telt mee: <strong>{config[channel].length > 0 ? conversionSourcesFor(channel).filter((s) => selected.has(s.field)).map((s) => s.label).join(", ") : "standaard"}</strong>
              </p>
            </div>
          );
        })}
      </div>

      {error && <p className="text-[11px] text-red-500 mt-3">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="mt-5 flex items-center gap-2 px-4 py-2 rounded-md bg-rm-blue text-white text-[12px] font-medium hover:bg-rm-blue/90 disabled:opacity-50 transition-all"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saving ? "Opslaan..." : saved ? "Opgeslagen" : "Conversie-selectie opslaan"}
      </button>
    </div>
  );
}
