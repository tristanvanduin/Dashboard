// X4 pure kern: lens 1 (de marginale euro over kanalen) en lens 6 (concentratie en risico).
// Review-verbeterpunten verwerkt: lens 1 consumeert de hefboom-2-uitkomst per kanaal (de
// budgetallocatie-facts) in plaats van opgeslagen SOP-teksten te parsen, zodat het advies twee
// lagen heeft: eerst binnen het kanaal her-alloceren, dan pas over kanalen. En de
// attributie-voetnoot is een verplicht veld aan elke vergelijkende uitkomst, geen optie.
// IO-vrij en los getest; de datalaag en de synthese-wiring komen later (build-kant).

import type { BudgetFact, BudgetAllocationSummary } from "@/lib/analysis/budget-allocation-facts";

export const ATTRIBUTION_FOOTNOTE =
  "Elk kanaal meet zijn eigen attributie; optellen of vergelijken over kanalen is indicatief, niet de waarheid.";

export type ChannelKey = "google_ads" | "meta_ads" | "linkedin_ads";

// De samenvatting van een kanaal voor de cross-channel-lens: de hefboom-2-uitkomst plus de
// efficientie op de EIGEN as van het kanaal (CPA of CPL of ROAS, nooit blind opgeteld).
export interface ChannelBudgetSnapshot {
  channel: ChannelKey;
  spend: number;
  // De eigen efficientie-as: welke metric en hoe hij zich tot de eigen target verhoudt.
  efficiencyMetric: "cpa" | "cpl" | "roas" | "none";
  efficiencyVsTargetPct: number | null; // boven 1 is beter dan target (richting-genormaliseerd)
  // De hefboom-2-uitkomst binnen het kanaal.
  allocation: BudgetAllocationSummary;
  scaleUpCandidates: BudgetFact[]; // de beste interne bestemmingen (al gerangschikt)
  // Kanaal-brede signalen.
  budgetConstrained: boolean; // er is aantoonbare onbenutte vraag (bijv. budget-lost IS)
  saturated: boolean; // verzadigingssignaal (rang-beperkt breed, fatigue, frequency)
}

export type CrossChannelDirection = "verschuif_over_kanalen" | "eerst_binnen_kanaal" | "geen_verschuiving" | "onvoldoende_basis";

export interface MarginalEuroResult {
  direction: CrossChannelDirection;
  fromChannel: ChannelKey | null;
  toChannel: ChannelKey | null;
  reason: string;
  attributionFootnote: string; // verplicht, altijd gevuld
  perChannelFirst: Array<{ channel: ChannelKey; internalMove: string }>;
}

// Lens 1: waar werkt de marginale euro het hardst, over kanalen heen. De volgorde is bewust:
// eerst de interne herallocatie per kanaal (hefboom 2), dan pas over kanalen. Alleen een
// kanaal dat efficient EN budget-beperkt is, is een geldige bestemming; alleen een kanaal dat
// zijn target mist of verzadigd is, is een geldige bron. Zonder dat contrast: geen flag.
export function marginalEuroAcrossChannels(channels: ChannelBudgetSnapshot[]): MarginalEuroResult {
  const base = { attributionFootnote: ATTRIBUTION_FOOTNOTE };

  if (channels.length < 2) {
    return { ...base, direction: "onvoldoende_basis", fromChannel: null, toChannel: null, reason: "minder dan twee kanalen met data", perChannelFirst: [] };
  }

  // Laag 1: interne herallocatie per kanaal eerst (hefboom 2).
  const perChannelFirst = channels
    .filter((c) => c.allocation.scaleDown > 0 && c.allocation.scaleUp > 0)
    .map((c) => ({
      channel: c.channel,
      internalMove: `verschuif eerst binnen ${c.channel}: ${c.allocation.scaleDown} campagne(s) leveren in, ${c.allocation.scaleUp} kandidaat/kandidaten voor meer`,
    }));

  // Laag 2: over kanalen. Bestemming: efficient (op of boven de eigen target) en budget-beperkt
  // en niet verzadigd. Bron: mist de eigen target of is verzadigd.
  const destinations = channels
    .filter((c) => c.efficiencyVsTargetPct != null && c.efficiencyVsTargetPct >= 1 && c.budgetConstrained && !c.saturated)
    .sort((a, b) => (b.efficiencyVsTargetPct ?? 0) - (a.efficiencyVsTargetPct ?? 0));
  const sources = channels
    .filter((c) => (c.efficiencyVsTargetPct != null && c.efficiencyVsTargetPct < 1) || c.saturated)
    .sort((a, b) => b.spend - a.spend);

  if (destinations.length > 0 && sources.length > 0 && destinations[0].channel !== sources[0].channel) {
    return {
      ...base,
      direction: "verschuif_over_kanalen",
      fromChannel: sources[0].channel,
      toChannel: destinations[0].channel,
      reason: `${sources[0].channel} ${sources[0].saturated ? "is verzadigd" : "mist de eigen target"} terwijl ${destinations[0].channel} boven target presteert met aantoonbare onbenutte vraag`,
      perChannelFirst,
    };
  }

  if (perChannelFirst.length > 0) {
    return { ...base, direction: "eerst_binnen_kanaal", fromChannel: null, toChannel: null, reason: "geen kanaal-contrast, maar binnen kanalen is wel herallocatie mogelijk", perChannelFirst };
  }

  return { ...base, direction: "geen_verschuiving", fromChannel: null, toChannel: null, reason: "geen kanaal is tegelijk efficient en budget-beperkt naast een bron; de verdeling staat goed", perChannelFirst: [] };
}

// ── Lens 6: concentratie en risico ──

export const SINGLE_CHANNEL_DEPENDENCY = 0.8; // meer dan 80 procent spend in een kanaal
export const SINGLE_CAMPAIGN_DEPENDENCY = 0.5; // een campagne draagt meer dan 50 procent van de blend

export interface ConcentrationInput {
  channel: ChannelKey;
  spend: number;
  topCampaign?: { name: string; spend: number } | null;
}

export interface ConcentrationFlag {
  kind: "kanaal_afhankelijkheid" | "campagne_afhankelijkheid";
  detail: string;
  sharePct: number;
}

export interface ConcentrationResult {
  totalSpend: number;
  flags: ConcentrationFlag[];
  attributionFootnote: string;
}

// Lens 6: deterministische concentratie-ratio's met drempels. Portfoliorisico dat in geen
// enkel los kanaalrapport zichtbaar is.
export function concentrationAcrossChannels(inputs: ConcentrationInput[]): ConcentrationResult {
  const totalSpend = inputs.reduce((s, c) => s + Math.max(c.spend, 0), 0);
  const flags: ConcentrationFlag[] = [];

  if (totalSpend > 0) {
    for (const c of inputs) {
      const share = c.spend / totalSpend;
      if (share > SINGLE_CHANNEL_DEPENDENCY) {
        flags.push({
          kind: "kanaal_afhankelijkheid",
          detail: `${c.channel} draagt ${Math.round(share * 100)} procent van de totale spend; het portfolio leunt op een kanaal`,
          sharePct: Math.round(share * 1000) / 10,
        });
      }
      if (c.topCampaign && c.topCampaign.spend > 0) {
        const campaignShare = c.topCampaign.spend / totalSpend;
        if (campaignShare > SINGLE_CAMPAIGN_DEPENDENCY) {
          flags.push({
            kind: "campagne_afhankelijkheid",
            detail: `campagne "${c.topCampaign.name}" (${c.channel}) draagt ${Math.round(campaignShare * 100)} procent van de blended spend`,
            sharePct: Math.round(campaignShare * 1000) / 10,
          });
        }
      }
    }
  }

  return { totalSpend, flags, attributionFootnote: ATTRIBUTION_FOOTNOTE };
}
