// M4 fatigue-kern: de deterministische vervangingsurgentie. Een winnaar is een ad die in de
// periode echt converteert; vermoeid is een winnaar wiens CTR wezenlijk zakt TERWIJL de
// frequency hoog staat (het publiek is verzadigd). Pure functies op per-ad-samenvattingen;
// de route aggregeert de dag-rijen met aggregateAdWindow zodat ook die stap getest is.
// De uitkomst voedt het bestaande flagFatiguedWinners (patterns.ts), geen kopie.

import type { FatigueInput } from "../vision/patterns";

export const FATIGUE_CTR_DROP = -0.25; // minstens 25 procent CTR-daling recent tegen prior
export const FATIGUE_MIN_FREQUENCY = 3;
export const FATIGUE_MIN_IMPRESSIONS = 5000; // onder dit recente volume geen oordeel
export const WINNER_TOP_N = 5;

export interface AdDailyRow {
  adId: string;
  impressions: number;
  linkClicks: number;
  conversions: number;
  frequency: number | null;
}

export interface AdWindowSummary {
  adId: string;
  impressions: number;
  ctr: number | null; // linkClicks / impressions
  frequency: number | null; // impressie-gewogen gemiddelde
  conversions: number;
}

// Aggregeert dag-rijen van EEN venster naar per-ad-samenvattingen.
export function aggregateAdWindow(rows: AdDailyRow[]): Map<string, AdWindowSummary> {
  const byAd = new Map<string, { impressions: number; linkClicks: number; conversions: number; freqWeighted: number; freqWeight: number }>();
  for (const row of rows) {
    const current = byAd.get(row.adId) ?? { impressions: 0, linkClicks: 0, conversions: 0, freqWeighted: 0, freqWeight: 0 };
    current.impressions += Math.max(row.impressions, 0);
    current.linkClicks += Math.max(row.linkClicks, 0);
    current.conversions += Math.max(row.conversions, 0);
    if (row.frequency != null && row.impressions > 0) {
      current.freqWeighted += row.frequency * row.impressions;
      current.freqWeight += row.impressions;
    }
    byAd.set(row.adId, current);
  }
  const result = new Map<string, AdWindowSummary>();
  for (const [adId, s] of byAd) {
    result.set(adId, {
      adId,
      impressions: s.impressions,
      ctr: s.impressions > 0 ? s.linkClicks / s.impressions : null,
      frequency: s.freqWeight > 0 ? Math.round((s.freqWeighted / s.freqWeight) * 10) / 10 : null,
      conversions: s.conversions,
    });
  }
  return result;
}

// De classificatie: winnaars op conversies in het recente venster (top N, minimaal 1),
// vermoeid bij een wezenlijke CTR-daling met hoge frequency en voldoende recent volume,
// onbekend als het prior-venster geen basis biedt.
export function buildFatigueInputs(recent: Map<string, AdWindowSummary>, prior: Map<string, AdWindowSummary>): FatigueInput[] {
  const winners = new Set(
    [...recent.values()]
      .filter((a) => a.conversions > 0)
      .sort((a, b) => b.conversions - a.conversions)
      .slice(0, WINNER_TOP_N)
      .map((a) => a.adId)
  );

  return [...recent.values()].map((r) => {
    const p = prior.get(r.adId);
    if (!p || p.ctr == null || p.ctr <= 0 || r.ctr == null || r.impressions < FATIGUE_MIN_IMPRESSIONS) {
      return { adId: r.adId, isWinner: winners.has(r.adId), fatigueStatus: "onbekend" as const };
    }
    const ctrDeltaPct = Math.round(((r.ctr - p.ctr) / p.ctr) * 100) / 100;
    const tired = ctrDeltaPct <= FATIGUE_CTR_DROP && (r.frequency ?? 0) >= FATIGUE_MIN_FREQUENCY;
    return {
      adId: r.adId,
      isWinner: winners.has(r.adId),
      fatigueStatus: tired ? ("vermoeid" as const) : ("gezond" as const),
      ctrDeltaPct,
      frequency: r.frequency,
    };
  });
}
