// Meta funnel-drop-off: de kanaal-configuratie op de gedeelde funnel-kern (funnel-core).
// Fasen: vertoning -> klik -> landing -> winkelwagen -> checkout -> conversie. De kern levert
// de venster-splitsing, de rates uit venstertotalen, de ruis-drempels en de expliciete
// degradatie van fasen zonder data.

import { analyzeFunnel, renderFunnelMarkdown, type FunnelFacts, type FunnelStageDef, type FunnelStageFact } from "./funnel-core";

export type { FunnelStageFact };
export type MetaFunnelFacts = FunnelFacts;

export interface MetaFunnelDailyRow {
  date: string;
  impressions?: number | null;
  link_clicks?: number | null;
  landing_page_views?: number | null;
  add_to_cart?: number | null;
  initiate_checkout?: number | null;
  conversions?: number | null;
}

const STAGES: FunnelStageDef<MetaFunnelDailyRow>[] = [
  { key: "impressions", label: "vertoningen", value: (r) => r.impressions },
  { key: "link_clicks", label: "link-klikken", value: (r) => r.link_clicks },
  { key: "landing_page_views", label: "landingspagina-views", value: (r) => r.landing_page_views },
  { key: "add_to_cart", label: "winkelwagen", value: (r) => r.add_to_cart },
  { key: "initiate_checkout", label: "checkout gestart", value: (r) => r.initiate_checkout },
  { key: "conversions", label: "conversies", value: (r) => r.conversions },
];

export function analyzeMetaFunnel(rows: MetaFunnelDailyRow[]): MetaFunnelFacts {
  return analyzeFunnel(rows, STAGES, { emptyReason: "geen Meta-dagdata" });
}

export function renderMetaFunnelMarkdown(facts: MetaFunnelFacts): string {
  return renderFunnelMarkdown(facts, {
    title: "Meta funnel-drop-off",
    windowNote: "Fase-overgangen: recent 28-dagen-venster vs het venster ervoor (rates uit venstertotalen).",
  });
}
