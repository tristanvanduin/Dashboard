// Google funnel-drop-off: kanaal-configuratie op de gedeelde funnel-kern. Google levert op
// account-niveau maar drie eerlijk geordende fasen: vertoning -> klik -> conversie; de
// tussenstappen (landing, winkelwagen) meet Google Ads niet account-breed. De data is
// WEEKDATA (ads_account_weekly), dus het venster is 4 weken vs de 4 weken ervoor.

import { analyzeFunnel, renderFunnelMarkdown, type FunnelFacts, type FunnelStageDef } from "./funnel-core";

export type GoogleFunnelFacts = FunnelFacts;

export interface GoogleFunnelWeeklyRow {
  date: string; // week_start
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
}

const STAGES: FunnelStageDef<GoogleFunnelWeeklyRow>[] = [
  { key: "impressions", label: "vertoningen", value: (r) => r.impressions },
  { key: "clicks", label: "klikken", value: (r) => r.clicks },
  { key: "conversions", label: "conversies", value: (r) => r.conversions },
];

export function analyzeGoogleFunnel(rows: GoogleFunnelWeeklyRow[]): GoogleFunnelFacts {
  return analyzeFunnel(rows, STAGES, { emptyReason: "geen Google-weekdata" });
}

export function renderGoogleFunnelMarkdown(facts: GoogleFunnelFacts): string {
  return renderFunnelMarkdown(facts, {
    title: "Google funnel-drop-off",
    windowNote: "Fase-overgangen: recente 4 weken vs de 4 weken ervoor (rates uit venstertotalen). Google meet account-breed alleen vertoning → klik → conversie; diepere fasen bestaan hier niet.",
  });
}
