// Vormt de dag-rijen van Meta en LinkedIn om naar de invoer van de signaal-detectors
// (lib/signals/meta-creative en linkedin-signals): per entiteit gesommeerd over een recent
// venster en een prior venster van gelijke lengte, met ratio's UIT DE VENSTERTOTALEN (dezelfde
// regel als overal). Puur en los getest; de routes leveren alleen de rijen en de namen.

import type { MetaAdSignalInput, MetaLevelSignalInput } from "@/lib/signals/meta-creative";
import type { LinkedInEntitySignalInput } from "@/lib/signals/linkedin-signals";

export const WINDOW_DAYS = 28;

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export interface MetaDailyRow {
  entity_id: string;
  date: string;
  impressions?: number | null;
  link_clicks?: number | null;
  spend?: number | null;
  conversions?: number | null;
  conversion_value?: number | null;
  frequency?: number | null;
  hook_rate?: number | null;
  hold_rate?: number | null;
  quality_ranking?: string | null;
  engagement_rate_ranking?: string | null;
  conversion_rate_ranking?: string | null;
}

export interface LinkedInDailyRow {
  entity_urn: string;
  date: string;
  impressions?: number | null;
  clicks?: number | null;
  spend?: number | null;
  one_click_leads?: number | null;
  one_click_lead_form_opens?: number | null;
  video_completions?: number | null;
  video_starts?: number | null;
}

interface Window<R> { recent: R[]; prior: R[] }

// Splitst dag-rijen in een recent en een prior venster van WINDOW_DAYS, gerekend vanaf de
// laatste datum in de data (niet vandaag: sync-lag mag het venster niet leeg maken).
export function splitWindows<R extends { date: string }>(rows: R[], windowDays = WINDOW_DAYS): Window<R> & { anchor: string | null } {
  if (rows.length === 0) return { recent: [], prior: [], anchor: null };
  const anchor = rows.map((r) => r.date).sort().at(-1)!;
  const anchorMs = new Date(anchor).getTime();
  const dayMs = 86_400_000;
  const recentStart = anchorMs - (windowDays - 1) * dayMs;
  const priorStart = recentStart - windowDays * dayMs;
  const recent: R[] = [];
  const prior: R[] = [];
  for (const r of rows) {
    const t = new Date(r.date).getTime();
    if (t >= recentStart) recent.push(r);
    else if (t >= priorStart) prior.push(r);
  }
  return { recent, prior, anchor };
}

interface MetaAgg {
  impressions: number; linkClicks: number; spend: number; conversions: number; conversionValue: number;
  freqWeighted: number; freqWeight: number;
  hookWeighted: number; holdWeighted: number; rateWeight: number;
  lastRankings: { quality: string | null; engagement: string | null; conversion: string | null; date: string };
}

function aggMeta(rows: MetaDailyRow[]): Map<string, MetaAgg> {
  const out = new Map<string, MetaAgg>();
  for (const r of rows) {
    const a = out.get(r.entity_id) ?? {
      impressions: 0, linkClicks: 0, spend: 0, conversions: 0, conversionValue: 0,
      freqWeighted: 0, freqWeight: 0, hookWeighted: 0, holdWeighted: 0, rateWeight: 0,
      lastRankings: { quality: null, engagement: null, conversion: null, date: "" },
    };
    const imp = n(r.impressions);
    a.impressions += imp; a.linkClicks += n(r.link_clicks); a.spend += n(r.spend);
    a.conversions += n(r.conversions); a.conversionValue += n(r.conversion_value);
    if (r.frequency != null && imp > 0) { a.freqWeighted += r.frequency * imp; a.freqWeight += imp; }
    if (imp > 0) {
      if (r.hook_rate != null) a.hookWeighted += r.hook_rate * imp;
      if (r.hold_rate != null) a.holdWeighted += r.hold_rate * imp;
      a.rateWeight += imp;
    }
    // Rankings: de meest recente niet-lege waarneming wint (kwalitatief, niet optelbaar).
    if (r.date >= a.lastRankings.date && (r.quality_ranking || r.engagement_rate_ranking || r.conversion_rate_ranking)) {
      a.lastRankings = {
        quality: r.quality_ranking ?? a.lastRankings.quality,
        engagement: r.engagement_rate_ranking ?? a.lastRankings.engagement,
        conversion: r.conversion_rate_ranking ?? a.lastRankings.conversion,
        date: r.date,
      };
    }
    out.set(r.entity_id, a);
  }
  return out;
}

/** Meta-ad-dagrijen -> MetaAdSignalInput[] (recent venster, met prior-CTR/CPA voor de trend). */
export function shapeMetaAdInputs(rows: MetaDailyRow[], names: Map<string, { adName: string; campaignName?: string | null }>): MetaAdSignalInput[] {
  const { recent, prior } = splitWindows(rows);
  const rec = aggMeta(recent);
  const pri = aggMeta(prior);
  return [...rec.entries()].map(([entityId, a]) => {
    const p = pri.get(entityId);
    const nm = names.get(entityId);
    return {
      entityId,
      adName: nm?.adName ?? entityId,
      campaignName: nm?.campaignName ?? null,
      impressions: a.impressions,
      frequency: a.freqWeight > 0 ? a.freqWeighted / a.freqWeight : null,
      hookRate: a.rateWeight > 0 ? a.hookWeighted / a.rateWeight : null,
      holdRate: a.rateWeight > 0 ? a.holdWeighted / a.rateWeight : null,
      linkCtr: ratio(a.linkClicks, a.impressions),
      cpa: a.conversions > 0 ? a.spend / a.conversions : null,
      roas: a.spend > 0 ? a.conversionValue / a.spend : null,
      qualityRanking: a.lastRankings.quality,
      engagementRanking: a.lastRankings.engagement,
      conversionRanking: a.lastRankings.conversion,
      prevLinkCtr: p ? ratio(p.linkClicks, p.impressions) : null,
      prevCpa: p && p.conversions > 0 ? p.spend / p.conversions : null,
    };
  });
}

/** Campagne-dagrijen -> frequency-niveaus (recent venster) voor de saturatie-detector. */
export function shapeMetaLevelInputs(campaignRows: MetaDailyRow[], names: Map<string, { adName: string }>): MetaLevelSignalInput[] {
  const { recent } = splitWindows(campaignRows);
  const agg = aggMeta(recent);
  return [...agg.entries()].map(([entityId, a]) => ({
    scope: names.get(entityId)?.adName ?? entityId,
    frequency: a.freqWeight > 0 ? a.freqWeighted / a.freqWeight : null,
    impressions: a.impressions,
  }));
}

interface LiAgg { impressions: number; clicks: number; spend: number; leads: number; formOpens: number; videoStarts: number; videoCompletions: number }

function aggLi(rows: LinkedInDailyRow[]): Map<string, LiAgg> {
  const out = new Map<string, LiAgg>();
  for (const r of rows) {
    const a = out.get(r.entity_urn) ?? { impressions: 0, clicks: 0, spend: 0, leads: 0, formOpens: 0, videoStarts: 0, videoCompletions: 0 };
    a.impressions += n(r.impressions); a.clicks += n(r.clicks); a.spend += n(r.spend);
    a.leads += n(r.one_click_leads); a.formOpens += n(r.one_click_lead_form_opens);
    a.videoStarts += n(r.video_starts); a.videoCompletions += n(r.video_completions);
    out.set(r.entity_urn, a);
  }
  return out;
}

/** LinkedIn-campagne-dagrijen -> LinkedInEntitySignalInput[] (ratio's uit venstertotalen). */
export function shapeLinkedInInputs(rows: LinkedInDailyRow[], names: Map<string, string>): LinkedInEntitySignalInput[] {
  const { recent, prior } = splitWindows(rows);
  const rec = aggLi(recent);
  const pri = aggLi(prior);
  return [...rec.entries()].map(([urn, a]) => {
    const p = pri.get(urn);
    return {
      entityUrn: urn,
      name: names.get(urn) ?? urn,
      impressions: a.impressions,
      clicks: a.clicks,
      ctr: ratio(a.clicks, a.impressions),
      cpl: a.leads > 0 ? a.spend / a.leads : null,
      formOpens: a.formOpens,
      formCompletionRate: a.formOpens > 0 ? a.leads / a.formOpens : null,
      videoCompletionRate: a.videoStarts > 0 ? a.videoCompletions / a.videoStarts : null,
      prevCtr: p ? ratio(p.clicks, p.impressions) : null,
      prevCpl: p && p.leads > 0 ? p.spend / p.leads : null,
    };
  });
}
