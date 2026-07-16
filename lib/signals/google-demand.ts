// Categorie B: Google zichtbaarheid- en vraag-verhalen (SIGNAALVERHALEN_bibliotheek.md).
// Consumeert de bestaande vraag-versus-aandeel-decompositie (metric-cross-checks) en
// verhoogt de zekerheid alleen wanneer onafhankelijke bronnen hetzelfde zeggen. Puur en los
// getest; de datalaag voedt dit uit de decompositie, ads_search_terms_monthly (volumes) en
// ads_account_yoy of ads_campaign_yoy.

import { type DetectionResult, relDelta, pct } from "./types";
import type { DemandShareDecomposition } from "@/lib/analysis/metric-cross-checks";

export const TERMS_SHIFT_MATERIAL = 0.05; // vijf procent beweging in de zoektermen-volumes
export const YOY_SHIFT_MATERIAL = 0.05; // vijf procent jaar-op-jaar-beweging
export const SEASONAL_MOM_DROP = 0.05; // een MoM-beweging vanaf vijf procent vraagt het seizoensoordeel

export interface MarketShiftInput {
  scope: string; // account of campagne
  decomposition: DemandShareDecomposition;
  searchTermsVolume: number; // som van de zoekterm-impressies deze periode
  prevSearchTermsVolume: number;
  yoyImpressionsPct: number | null; // jaar-op-jaar impressie-verandering, relatief (0.05 is plus vijf procent)
}

// Verhaal B1: markt-shift bevestigd. De decompositie zegt markt; als de zoektermen-volumes
// en de YoY dezelfde richting wijzen, bevestigen drie onafhankelijke bronnen een verhaal en
// is het bewezen binnen het platform. Wijst maar een bron, dan blijft het een indicatie (de
// bestaande decompositie-uitkomst) en triggert dit verhaal niet dubbel.
export function detectMarktShiftBevestigd(input: MarketShiftInput): DetectionResult {
  const checked = ["markt_shift_bevestigd"];
  const { decomposition } = input;
  if (decomposition.verdict !== "markt_kromp" && decomposition.verdict !== "markt_groeide") {
    return { triggered: [], checked };
  }

  const termsDelta = relDelta(input.searchTermsVolume, input.prevSearchTermsVolume);
  const richtingKromp = decomposition.verdict === "markt_kromp";
  const termsBevestigt = termsDelta != null && (richtingKromp ? termsDelta <= -TERMS_SHIFT_MATERIAL : termsDelta >= TERMS_SHIFT_MATERIAL);
  const yoyBevestigt =
    input.yoyImpressionsPct != null && (richtingKromp ? input.yoyImpressionsPct <= -YOY_SHIFT_MATERIAL : input.yoyImpressionsPct >= YOY_SHIFT_MATERIAL);

  if (!termsBevestigt || !yoyBevestigt) return { triggered: [], checked };

  return {
    triggered: [
      {
        id: "markt_shift_bevestigd",
        category: "zichtbaarheid_vraag",
        scope: input.scope,
        story: richtingKromp
          ? `Drie bronnen bevestigen marktkrimp: de decompositie wijst naar de markt, de zoektermen-volumes daalden ${pct(Math.abs(termsDelta!))} en de jaar-op-jaar-impressies staan ${pct(Math.abs(input.yoyImpressionsPct!))} lager. De vraag zelf kromp; dit is geen prestatieprobleem.`
          : `Drie bronnen bevestigen marktgroei: de decompositie wijst naar de markt, de zoektermen-volumes stegen ${pct(termsDelta!)} en de jaar-op-jaar-impressies staan ${pct(input.yoyImpressionsPct!)} hoger. De impressie-groei is vooral markt, niet eigen verdienste.`,
        actionDirection: richtingKromp
          ? "stel de volumeverwachting en targets bij; optimaliseren op een krimpende markt verspilt aandacht"
          : "claim de groei niet als prestatie; beoordeel of het aandeel meebeweegt",
        certainty: "bewezen_binnen_platform",
        evidence: [
          { metric: "decompositie_verdict", value: decomposition.verdict },
          { metric: "search_terms_volume", value: input.searchTermsVolume, prev: input.prevSearchTermsVolume },
          { metric: "yoy_impressions_pct", value: input.yoyImpressionsPct ?? "geen" },
        ],
      },
    ],
    checked,
  };
}

export interface SeasonalInput {
  scope: string;
  momDeltaPct: number; // maand-op-maand, relatief
  yoySameMonthDeltaPct: number | null; // dezelfde maand een jaar terug, relatief
}

// Verhaal B2: seizoenspatroon. Een MoM-daling terwijl dezelfde maand jaar-op-jaar juist
// hoger ligt is seizoen, geen trendbreuk. En de spiegel: een MoM-stijging die een
// jaar-op-jaar-daling maskeert is juist WEL een probleem dat de maandvergelijking verbergt.
export function detectSeizoenspatroon(input: SeasonalInput): DetectionResult {
  const checked = ["seizoensdip_geen_trendbreuk", "stijging_maskeert_yoy_daling"];
  if (input.yoySameMonthDeltaPct == null) return { triggered: [], checked };

  const momDaalt = input.momDeltaPct <= -SEASONAL_MOM_DROP;
  const momStijgt = input.momDeltaPct >= SEASONAL_MOM_DROP;
  const yoyHoger = input.yoySameMonthDeltaPct >= YOY_SHIFT_MATERIAL;
  const yoyLager = input.yoySameMonthDeltaPct <= -YOY_SHIFT_MATERIAL;

  if (momDaalt && yoyHoger) {
    return {
      triggered: [
        {
          id: "seizoensdip_geen_trendbreuk",
          category: "zichtbaarheid_vraag",
          scope: input.scope,
          story: `De maand daalde ${pct(Math.abs(input.momDeltaPct))} maar dezelfde maand ligt jaar-op-jaar ${pct(input.yoySameMonthDeltaPct)} hoger: dit is het seizoenspatroon, geen trendbreuk.`,
          actionDirection: "geen ingreep op de daling; beoordeel de prestatie tegen dezelfde maand vorig jaar",
          certainty: "bewezen_binnen_platform",
          evidence: [
            { metric: "mom_delta_pct", value: input.momDeltaPct },
            { metric: "yoy_same_month_pct", value: input.yoySameMonthDeltaPct },
          ],
        },
      ],
      checked,
    };
  }

  if (momStijgt && yoyLager) {
    return {
      triggered: [
        {
          id: "stijging_maskeert_yoy_daling",
          category: "zichtbaarheid_vraag",
          scope: input.scope,
          story: `De maand steeg ${pct(input.momDeltaPct)} maar dezelfde maand ligt jaar-op-jaar ${pct(Math.abs(input.yoySameMonthDeltaPct))} lager: de maandstijging maskeert een structurele daling.`,
          actionDirection: "behandel dit als een dalende trend ondanks de groene maandcijfers",
          certainty: "bewezen_binnen_platform",
          evidence: [
            { metric: "mom_delta_pct", value: input.momDeltaPct },
            { metric: "yoy_same_month_pct", value: input.yoySameMonthDeltaPct },
          ],
        },
      ],
      checked,
    };
  }

  return { triggered: [], checked };
}
