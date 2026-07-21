"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, BarChart3, Megaphone, Briefcase, Layers } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { matchGeoCloneByCampaignName } from "@/lib/rai/geo-clone-catalog";

// Campagne-overzicht over alle kanalen: op welke kanalen zijn we actief en welke campagnes
// draaien er per kanaal (beurs-gescoped op de afkorting in de campagnenaam). Leest de campagne-
// dagdata/maanddata direct uit Supabase en aggregeert per campagne over het recente venster.
// Vult het gat dat de blended-maandgrafiek liet: die toont spend-per-maand, niet de campagnes.

type ChannelKey = "google_ads" | "meta_ads" | "linkedin_ads";
interface CampaignAgg { name: string; spend: number; conversions: number }
interface ChannelBlock { channel: ChannelKey; label: string; convLabel: string; campaigns: CampaignAgg[] }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0));
const eur = (v: number): string => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const fmt = (v: number, d = 0): string => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);

const CHANNEL_META: Record<ChannelKey, { label: string; convLabel: string; icon: React.ReactNode }> = {
  google_ads: { label: "Google Ads", convLabel: "Conversies", icon: <BarChart3 className="w-4 h-4 text-rm-blue" /> },
  meta_ads: { label: "Meta", convLabel: "Conversies", icon: <Megaphone className="w-4 h-4 text-rm-blue" /> },
  linkedin_ads: { label: "LinkedIn", convLabel: "Leads", icon: <Briefcase className="w-4 h-4 text-rm-blue" /> },
};

export function CampaignsPerChannel({ clientId, geoClone }: { clientId: string; geoClone?: string | null }) {
  const [blocks, setBlocks] = useState<ChannelBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setBlocks(null); setError(null);
    const sinceMonth = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    const sinceDay = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

    async function load() {
      const [gRes, mNamesRes, mDailyRes, lNamesRes, lDailyRes] = await Promise.all([
        sb!.from("ads_campaign_monthly").select("campaign_name, month, cost, conversions").eq("client_id", clientId).gte("month", sinceMonth),
        sb!.from("meta_campaigns").select("campaign_id, name").eq("client_id", clientId),
        sb!.from("meta_campaign_daily").select("entity_id, spend, conversions").eq("client_id", clientId).gte("date", sinceDay),
        sb!.from("linkedin_campaigns").select("campaign_urn, name").eq("client_id", clientId),
        sb!.from("linkedin_campaign_daily").select("entity_urn, spend, one_click_leads").eq("client_id", clientId).gte("date", sinceDay),
      ]);
      if (cancelled) return;

      // Google: uit ads_campaign_monthly (draagt campaign_name), aggregeer per campagne.
      const gMap = new Map<string, CampaignAgg>();
      for (const r of gRes.data ?? []) {
        const name = String(r.campaign_name ?? "");
        if (!name) continue;
        const a = gMap.get(name) ?? { name, spend: 0, conversions: 0 };
        a.spend += num(r.cost); a.conversions += num(r.conversions);
        gMap.set(name, a);
      }

      // Meta / LinkedIn: namen + dagdata per entiteit.
      const aggByEntity = (names: { id: string; name: string }[], daily: { entity: string; spend: number; conv: number }[]) => {
        const nameOf = new Map(names.map((n) => [n.id, n.name]));
        const map = new Map<string, CampaignAgg>();
        for (const d of daily) {
          const name = nameOf.get(d.entity) ?? d.entity;
          const a = map.get(name) ?? { name, spend: 0, conversions: 0 };
          a.spend += d.spend; a.conversions += d.conv;
          map.set(name, a);
        }
        return map;
      };
      const mMap = aggByEntity(
        (mNamesRes.data ?? []).map((c) => ({ id: String(c.campaign_id), name: String(c.name ?? c.campaign_id) })),
        (mDailyRes.data ?? []).map((r) => ({ entity: String(r.entity_id), spend: num(r.spend), conv: num(r.conversions) })),
      );
      const lMap = aggByEntity(
        (lNamesRes.data ?? []).map((c) => ({ id: String(c.campaign_urn), name: String(c.name ?? c.campaign_urn) })),
        (lDailyRes.data ?? []).map((r) => ({ entity: String(r.entity_urn), spend: num(r.spend), conv: num(r.one_click_leads) })),
      );

      const scope = (rows: CampaignAgg[]) => rows
        .filter((c) => c.spend > 0 || c.conversions > 0)
        .filter((c) => !geoClone || matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone)
        .sort((a, b) => b.spend - a.spend);

      const built: ChannelBlock[] = ([
        { channel: "google_ads" as const, map: gMap },
        { channel: "meta_ads" as const, map: mMap },
        { channel: "linkedin_ads" as const, map: lMap },
      ]).map(({ channel, map }) => ({
        channel, label: CHANNEL_META[channel].label, convLabel: CHANNEL_META[channel].convLabel,
        campaigns: scope([...map.values()]),
      }));
      setBlocks(built);
    }
    load().catch((e) => { if (!cancelled) { setError(String(e)); setBlocks([]); } });
    return () => { cancelled = true; };
  }, [clientId, geoClone]);

  const activeChannels = useMemo(() => (blocks ?? []).filter((b) => b.campaigns.length > 0), [blocks]);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>;
  if (blocks === null) return <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border shadow-sm px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Layers className="w-4.5 h-4.5 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-gray">Actieve kanalen & campagnes{geoClone ? ` — beurs ${geoClone}` : ""}</h3>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {activeChannels.length === 0
            ? "Geen actieve campagnes gevonden voor deze scope."
            : `Actief op ${activeChannels.length} kanaal${activeChannels.length === 1 ? "" : "en"}: ${activeChannels.map((b) => `${b.label} (${b.campaigns.length})`).join(" · ")}.`}
        </p>
      </div>

      {activeChannels.map((block) => (
        <div key={block.channel} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            {CHANNEL_META[block.channel].icon}
            <h3 className="text-sm font-semibold text-rm-gray">{block.label}</h3>
            <span className="text-[10px] text-muted-foreground">{block.campaigns.length} campagne{block.campaigns.length === 1 ? "" : "s"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-5 py-2 font-medium">Campagne</th>
                  <th className="px-3 py-2 font-medium text-right">Spend</th>
                  <th className="px-3 py-2 font-medium text-right">{block.convLabel}</th>
                  <th className="px-5 py-2 font-medium text-right">CPA</th>
                </tr>
              </thead>
              <tbody>
                {block.campaigns.map((c) => (
                  <tr key={c.name} className="border-b border-border/50">
                    <td className="px-5 py-1.5 text-rm-gray font-medium">{c.name}</td>
                    <td className="px-3 py-1.5 text-right">{eur(c.spend)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(c.conversions, 1)}</td>
                    <td className="px-5 py-1.5 text-right">{c.conversions > 0 ? eur(c.spend / c.conversions) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
