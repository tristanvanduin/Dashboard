// LinkedIn funnel-drop-off: kanaal-configuratie op de gedeelde funnel-kern. Fasen:
// vertoning -> klik -> landingspagina-klik -> form-open -> lead. Website-conversies zijn
// een parallel pad (geen strikte sub-fase van forms) en blijven daarom bewust buiten de
// keten; de forms-keten is de meetbaar geordende funnel.

import { analyzeFunnel, renderFunnelMarkdown, type FunnelFacts, type FunnelStageDef } from "./funnel-core";

export type LinkedInFunnelFacts = FunnelFacts;

export interface LinkedInFunnelDailyRow {
  date: string;
  impressions?: number | null;
  clicks?: number | null;
  landing_page_clicks?: number | null;
  one_click_lead_form_opens?: number | null;
  one_click_leads?: number | null;
}

const STAGES: FunnelStageDef<LinkedInFunnelDailyRow>[] = [
  { key: "impressions", label: "vertoningen", value: (r) => r.impressions },
  { key: "clicks", label: "klikken", value: (r) => r.clicks },
  { key: "landing_page_clicks", label: "landingspagina-klikken", value: (r) => r.landing_page_clicks },
  { key: "one_click_lead_form_opens", label: "form-opens", value: (r) => r.one_click_lead_form_opens },
  { key: "one_click_leads", label: "leads", value: (r) => r.one_click_leads },
];

export function analyzeLinkedInFunnel(rows: LinkedInFunnelDailyRow[]): LinkedInFunnelFacts {
  return analyzeFunnel(rows, STAGES, { emptyReason: "geen LinkedIn-dagdata" });
}

export function renderLinkedInFunnelMarkdown(facts: LinkedInFunnelFacts): string {
  return renderFunnelMarkdown(facts, {
    title: "LinkedIn funnel-drop-off",
    windowNote: "Fase-overgangen: recent 28-dagen-venster vs het venster ervoor (rates uit venstertotalen). Website-conversies zijn een parallel pad en tellen niet als fase.",
  });
}
