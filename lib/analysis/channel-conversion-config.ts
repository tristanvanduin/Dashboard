// Conversie-selectie per kanaal — het Meta/LinkedIn-equivalent van Google's keuze welke
// conversie-acties meetellen. Meta's sync mapt de ruwe action_types al naar vaste
// uitkomst-velden (conversions = aankopen, leads), en LinkedIn levert leads, website-conversies
// en post-click-conversies als aparte kolommen. "Welke conversies tellen mee" is hier dus:
// welke van die velden je optelt tot de conversie die de KPI's, forecasts en views gebruiken.
//
// Eén centrale bron zodat elke leesplek (ChannelPerformance, ChannelForecast, cross-channel,
// de beurs-forecast) exact dezelfde selectie toepast. Puur, geen IO, los getest.

export type ChannelConversionChannel = "meta_ads" | "linkedin_ads";

export interface ChannelConversionSource {
  field: string; // kolomnaam in de *_daily-tabellen van het kanaal
  label: string; // UI-label
  hint?: string; // korte toelichting
}

// De velden die de sync per kanaal daadwerkelijk bewaart (en die dus selecteerbaar zijn).
export const META_CONVERSION_SOURCES: ChannelConversionSource[] = [
  { field: "conversions", label: "Aankopen / conversies", hint: "purchase / omni_purchase / pixel-conversie" },
  { field: "leads", label: "Leads", hint: "lead / omni_lead / pixel-lead" },
];
export const LINKEDIN_CONVERSION_SOURCES: ChannelConversionSource[] = [
  { field: "one_click_leads", label: "Lead-formulieren", hint: "one-click lead-gen-forms" },
  { field: "external_website_conversions", label: "Website-conversies", hint: "conversies op de eigen site" },
  { field: "post_click_conversions", label: "Post-click-conversies", hint: "na een klik toegeschreven" },
];

export function conversionSourcesFor(channel: ChannelConversionChannel): ChannelConversionSource[] {
  return channel === "meta_ads" ? META_CONVERSION_SOURCES : LINKEDIN_CONVERSION_SOURCES;
}

// Welke velden per kanaal meetellen. Leeg/ongeldig valt terug op de default van dat kanaal,
// zodat de conversie nooit per ongeluk 0 wordt (dat zou elke CPA/ROAS breken).
export interface ChannelConversionConfig {
  meta_ads: string[];
  linkedin_ads: string[];
}

export const DEFAULT_CHANNEL_CONVERSION_CONFIG: ChannelConversionConfig = {
  meta_ads: ["conversions", "leads"],
  linkedin_ads: ["one_click_leads", "external_website_conversions"],
};

function validFields(selected: unknown, channel: ChannelConversionChannel): string[] {
  const allowed = new Set(conversionSourcesFor(channel).map((s) => s.field));
  const list = Array.isArray(selected) ? selected.filter((f): f is string => typeof f === "string" && allowed.has(f)) : [];
  const deduped = [...new Set(list)];
  return deduped.length > 0 ? deduped : DEFAULT_CHANNEL_CONVERSION_CONFIG[channel];
}

// Normaliseer een (deels) opgeslagen config naar een volledige, geldige config.
export function resolveChannelConversionConfig(stored: Partial<Record<ChannelConversionChannel, unknown>> | null | undefined): ChannelConversionConfig {
  return {
    meta_ads: validFields(stored?.meta_ads, "meta_ads"),
    linkedin_ads: validFields(stored?.linkedin_ads, "linkedin_ads"),
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0));

// Tel de geselecteerde conversievelden uit één dag/rij op — de conversie die telt.
export function sumSelectedConversions(row: Record<string, unknown>, channel: ChannelConversionChannel, config: ChannelConversionConfig): number {
  const fields = config[channel];
  let sum = 0;
  for (const f of fields) sum += num(row[f]);
  return sum;
}

// De labels van de geselecteerde velden, voor een eerlijke bijschrift in de UI ("telt: Leads").
export function selectedConversionLabels(channel: ChannelConversionChannel, config: ChannelConversionConfig): string[] {
  const byField = new Map(conversionSourcesFor(channel).map((s) => [s.field, s.label]));
  return config[channel].map((f) => byField.get(f) ?? f);
}
