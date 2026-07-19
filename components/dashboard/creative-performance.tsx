"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Sparkles, ImageOff, ArrowUpRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { summarizeCreatives, type CreativeRow } from "@/lib/analysis/creative-summary";

// Creative Performance per kanaal: hoe de creatives eruit zien (preview), hoe ze presteerden
// (metrics per creative) en een deterministische samenvatting + aanbevelingen eronder — zodat
// de Analyses-tab echt de diepte in kan. Google rendert de RSA-tekstpreview uit de gesyncte
// assets; Meta/LinkedIn de visual (thumbnail/afbeelding). Ontbreekt de creative-tekst/visual
// in de sync, dan degradeert de kaart eerlijk naar metrics-met-label i.p.v. iets voor te wenden.

type ChannelKind = "google" | "meta" | "linkedin";

interface CreativeCard extends CreativeRow {
  // Presentatie
  headline: string | null;
  description: string | null;
  displayUrl: string | null;
  imageUrl: string | null;
  cta: string | null;
  format: string | null;      // ad_type / creative-format
  subLabel: string | null;    // ad-groep of campagne
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0));
const asArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; } catch { return []; } }
  return [];
};
const eur = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const fmt = (v: number, d = 0): string => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
const pctS = (imp: number, clk: number): string => (imp > 0 ? new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(clk / imp) : "—");

const CHANNEL_LABEL: Record<ChannelKind, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn" };
const REC_STYLE: Record<string, string> = {
  pauzeer: "text-red-700 bg-red-50 border-red-200",
  vervang: "text-amber-700 bg-amber-50 border-amber-200",
  schaal: "text-emerald-700 bg-emerald-50 border-emerald-200",
};

export function CreativePerformance({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const [cards, setCards] = useState<CreativeCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setCards(null); setError(null);
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);

    async function load() {
      if (channel === "google") {
        const { data, error } = await sb!
          .from("ads_creative_performance")
          .select("ad_id, ad_group_name, campaign_name, ad_type, headlines, descriptions, final_urls, impressions, clicks, cost, conversions")
          .eq("client_id", clientId)
          .gte("month", since)
          .order("cost", { ascending: false })
          .limit(12);
        if (error) { if (!cancelled) { setError(error.message); setCards([]); } return; }
        // Metrics per ad_id sommeren over de periode + de tekst uit de eerste rij met assets.
        const byAd = new Map<string, CreativeCard>();
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          const id = String(r.ad_id);
          const heads = asArray(r.headlines); const descs = asArray(r.descriptions); const urls = asArray(r.final_urls);
          const cur = byAd.get(id) ?? {
            id, name: String(r.ad_group_name ?? r.campaign_name ?? id),
            impressions: 0, clicks: 0, cost: 0, conversions: 0,
            headline: heads[0] ?? null, description: descs[0] ?? null,
            displayUrl: urls[0] ? String(urls[0]).replace(/^https?:\/\//, "").split("/")[0] : null,
            imageUrl: null, cta: null, format: String(r.ad_type ?? "").replace(/_/g, " ").toLowerCase(),
            subLabel: String(r.ad_group_name ?? ""),
          };
          cur.impressions += num(r.impressions); cur.clicks += num(r.clicks); cur.cost += num(r.cost); cur.conversions += num(r.conversions);
          if (!cur.headline && heads[0]) cur.headline = heads[0];
          if (!cur.description && descs[0]) cur.description = descs[0];
          byAd.set(id, cur);
        }
        // Verrijk tekst uit google_ads_rsa_assets waar de arrays leeg waren.
        const ids = [...byAd.keys()];
        if (ids.length > 0) {
          const [{ data: assets }, { data: meta }] = await Promise.all([
            sb!.from("google_ads_rsa_assets").select("ad_id, field_type, asset_text, impressions").eq("client_id", clientId).in("ad_id", ids),
            sb!.from("google_ads_ad_meta").select("ad_id, final_url").eq("client_id", clientId).in("ad_id", ids),
          ]);
          const pick = (adId: string, field: string) => (assets ?? [])
            .filter((a) => String(a.ad_id) === adId && a.field_type === field)
            .sort((a, b) => num(b.impressions) - num(a.impressions))[0]?.asset_text as string | undefined;
          for (const [id, card] of byAd) {
            if (!card.headline) card.headline = pick(id, "HEADLINE") ?? null;
            if (!card.description) card.description = pick(id, "DESCRIPTION") ?? null;
            const url = (meta ?? []).find((m) => String(m.ad_id) === id)?.final_url as string | undefined;
            if (!card.displayUrl && url) card.displayUrl = url.replace(/^https?:\/\//, "").split("/")[0];
          }
        }
        if (!cancelled) setCards([...byAd.values()].sort((a, b) => b.cost - a.cost));
      } else if (channel === "meta") {
        const [{ data: ads }, { data: creatives }, { data: daily }] = await Promise.all([
          sb!.from("meta_ads").select("ad_id, name, creative_id").eq("client_id", clientId),
          sb!.from("meta_creatives").select("creative_id, title, body, thumbnail_url, format, call_to_action_type, link_url").eq("client_id", clientId),
          sb!.from("meta_ad_daily").select("entity_id, impressions, link_clicks, spend, conversions").eq("client_id", clientId).gte("date", since),
        ]);
        const cr = new Map((creatives ?? []).map((c) => [String(c.creative_id), c as Record<string, unknown>]));
        const metrics = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number }>();
        for (const d of (daily ?? []) as Record<string, unknown>[]) {
          const id = String(d.entity_id);
          const m = metrics.get(id) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
          m.impressions += num(d.impressions); m.clicks += num(d.link_clicks); m.cost += num(d.spend); m.conversions += num(d.conversions);
          metrics.set(id, m);
        }
        const list: CreativeCard[] = (ads ?? []).map((a) => {
          const c = a.creative_id ? cr.get(String(a.creative_id)) : undefined;
          const m = metrics.get(String(a.ad_id)) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
          return {
            id: String(a.ad_id), name: String(a.name ?? a.ad_id), ...m,
            headline: (c?.title as string) ?? null, description: (c?.body as string) ?? null,
            displayUrl: c?.link_url ? String(c.link_url).replace(/^https?:\/\//, "").split("/")[0] : null,
            imageUrl: (c?.thumbnail_url as string) ?? null, cta: (c?.call_to_action_type as string) ?? null,
            format: (c?.format as string) ?? null, subLabel: null,
          };
        }).filter((c) => c.impressions > 0 || c.headline || c.imageUrl);
        if (!cancelled) setCards(list.sort((a, b) => b.cost - a.cost).slice(0, 12));
      } else {
        const [{ data: creatives }, { data: daily }] = await Promise.all([
          sb!.from("linkedin_creatives").select("creative_urn, headline, post_text, image_storage_path, cta_label, landing_url, format").eq("client_id", clientId),
          sb!.from("linkedin_creative_daily").select("entity_urn, impressions, clicks, spend, external_website_conversions, one_click_leads").eq("client_id", clientId).gte("date", since),
        ]);
        const metrics = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number }>();
        for (const d of (daily ?? []) as Record<string, unknown>[]) {
          const id = String(d.entity_urn);
          const m = metrics.get(id) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
          m.impressions += num(d.impressions); m.clicks += num(d.clicks); m.cost += num(d.spend);
          m.conversions += num(d.one_click_leads) || num(d.external_website_conversions);
          metrics.set(id, m);
        }
        const list: CreativeCard[] = (creatives ?? []).map((c) => {
          const m = metrics.get(String(c.creative_urn)) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
          return {
            id: String(c.creative_urn), name: String(c.headline ?? c.post_text ?? c.creative_urn).slice(0, 60), ...m,
            headline: (c.headline as string) ?? null, description: (c.post_text as string) ?? null,
            displayUrl: c.landing_url ? String(c.landing_url).replace(/^https?:\/\//, "").split("/")[0] : null,
            imageUrl: (c.image_storage_path as string) ?? null, cta: (c.cta_label as string) ?? null,
            format: (c.format as string) ?? null, subLabel: null,
          };
        }).filter((c) => c.impressions > 0 || c.headline || c.imageUrl);
        if (!cancelled) setCards(list.sort((a, b) => b.cost - a.cost).slice(0, 12));
      }
    }
    load().catch((e) => { if (!cancelled) { setError(String(e)); setCards([]); } });
    return () => { cancelled = true; };
  }, [clientId, channel]);

  const summary = useMemo(() => (cards ? summarizeCreatives(cards) : null), [cards]);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  if (cards === null) return <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>;
  if (cards.length === 0) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
        Nog geen creative-data voor {CHANNEL_LABEL[channel]}. {channel === "google" ? "Zodra de creative-sync draait, verschijnen hier de advertenties met hun prestaties." : "Zodra de creatives gesynct zijn (afbeeldingen/teksten), verschijnen ze hier met hun prestaties."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Sparkles className="w-4.5 h-4.5 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">Creative Performance — {CHANNEL_LABEL[channel]}</h3>
          <span className="text-[10px] text-muted-foreground">top {cards.length} op kosten, laatste 6 maanden</span>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => (
            <div key={c.id} className="rounded-lg border border-border overflow-hidden flex flex-col">
              {/* Preview — beeld voor Meta/LinkedIn, een echte zoekadvertentie-look voor Google-tekst. */}
              <div className="bg-gray-100/70 p-3 border-b border-border min-h-[92px] flex items-center">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt={c.name} className="w-full h-36 object-cover rounded-md" />
                ) : c.headline ? (
                  // Google-zoekadvertentie: blauwe kop, Ad-badge + weergave-URL, grijze beschrijving.
                  <div className="w-full rounded-md bg-white border border-gray-200 px-4 py-3 shadow-sm">
                    <div className="text-[15px] leading-tight text-[#1a0dab] hover:underline cursor-default">{c.headline}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] font-semibold text-gray-700 border border-gray-400 rounded-[3px] px-1 leading-tight">Ad</span>
                      {c.displayUrl && <span className="text-[12px] text-gray-700">{c.displayUrl}</span>}
                    </div>
                    {c.description && <div className="text-[12px] text-gray-600 mt-1.5 leading-snug">{c.description}</div>}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <ImageOff className="w-4 h-4" /> Creative-tekst/visual niet gesynct — alleen prestaties beschikbaar.
                  </div>
                )}
              </div>
              {/* Meta-regel */}
              <div className="px-3 pt-2 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-medium text-rm-gray truncate max-w-[60%]">{c.name}</span>
                {c.format && <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{c.format}</span>}
                {c.cta && <span className="text-[9px] text-blue-700 flex items-center gap-0.5">{c.cta} <ArrowUpRight className="w-2.5 h-2.5" /></span>}
              </div>
              {/* Metrics */}
              <div className="px-3 py-2 grid grid-cols-4 gap-2 text-[11px]">
                <div><div className="text-muted-foreground">Klikken</div><div className="font-semibold text-rm-gray">{fmt(c.clicks)}</div></div>
                <div><div className="text-muted-foreground">CTR</div><div className="font-semibold text-rm-gray">{pctS(c.impressions, c.clicks)}</div></div>
                <div><div className="text-muted-foreground">Kosten</div><div className="font-semibold text-rm-gray">{eur(c.cost)}</div></div>
                <div><div className="text-muted-foreground">Conversies</div><div className="font-semibold text-rm-gray">{fmt(c.conversions, 1)}</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Samenvatting + aanbevelingen */}
      {summary && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-rm-gray">Samenvatting</h3>
          </div>
          <div className="px-5 py-4 space-y-3">
            <p className="text-[12px] text-rm-gray leading-relaxed">{summary.summaryText}</p>
            {summary.recommendations.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Aanbevelingen</p>
                <ul className="space-y-1.5">
                  {summary.recommendations.map((r, i) => (
                    <li key={i} className={`text-[12px] border rounded-md px-3 py-2 ${REC_STYLE[r.kind]}`}>
                      <strong className="capitalize">{r.kind}:</strong> &ldquo;{r.creativeName}&rdquo; — {r.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              Deterministisch afgeleid uit de creative-prestaties. Voor een geschreven diepteanalyse en briefing:
              draai de creative-analyses hierboven (Google RSA-copy, Meta creative vision/briefing).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
