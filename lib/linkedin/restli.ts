// Restli 2.0 URL-encoding voor de LinkedIn adAnalytics-finder. De deterministische
// primitieven (List()-encoding, dateRange-objectsyntax, veldensets-splitsing) zijn los
// testbaar. De exacte parameter-namen van de finder horen per de spec-preflight in een
// Postman-call geverifieerd te worden voor de app-tier; daarom is de query-assemblage een
// dunne compositie van de geverifieerde primitieven.

// Encodeert een array naar de Restli 2.0 List()-syntax met URL-gecodeerde elementen. URNs
// bevatten dubbele punten die gecodeerd moeten worden (urn:li:... wordt urn%3Ali%3A...).
export function encodeRestliList(values: string[]): string {
  return `List(${values.map((v) => encodeURIComponent(v)).join(",")})`;
}

// Encodeert een dateRange naar de Restli-objectsyntax die adAnalytics verwacht.
export function encodeDateRange(
  start: { year: number; month: number; day: number },
  end: { year: number; month: number; day: number }
): string {
  const part = (d: { year: number; month: number; day: number }) =>
    `(year:${d.year},month:${d.month},day:${d.day})`;
  return `(start:${part(start)},end:${part(end)})`;
}

// Splitst een veldenlijst in sets van maximaal maxPerRequest, zodat elke adAnalytics-call
// binnen de circa 20-velden-limiet blijft. De sets worden in aparte calls opgehaald en per
// dag plus entiteit gemerged (zie mergeFieldSets in transform.ts).
export function splitFieldSets(fields: string[], maxPerRequest = 20): string[][] {
  if (maxPerRequest < 1) return [fields.slice()];
  const sets: string[][] = [];
  for (let i = 0; i < fields.length; i += maxPerRequest) {
    sets.push(fields.slice(i, i + maxPerRequest));
  }
  return sets;
}

export interface AnalyticsQueryParams {
  pivot: string;
  dateRange: {
    start: { year: number; month: number; day: number };
    end: { year: number; month: number; day: number };
  };
  fields: string[];
  accounts?: string[];
  campaigns?: string[];
  shares?: string[];
}

// Stelt de query-parameters voor een adAnalytics-call samen uit de geverifieerde primitieven.
// Een pivot per call (member-pivots zijn niet combineerbaar). De entiteit-arrays gaan via
// List(); fields gaat als projectie (komma-gescheiden).
export function buildAnalyticsQuery(params: AnalyticsQueryParams): string {
  const parts: string[] = [
    "q=analytics",
    "timeGranularity=DAILY",
    `pivot=${encodeURIComponent(params.pivot)}`,
    `dateRange=${encodeDateRange(params.dateRange.start, params.dateRange.end)}`,
    `fields=${params.fields.join(",")}`,
  ];
  if (params.accounts && params.accounts.length > 0) parts.push(`accounts=${encodeRestliList(params.accounts)}`);
  if (params.campaigns && params.campaigns.length > 0) parts.push(`campaigns=${encodeRestliList(params.campaigns)}`);
  if (params.shares && params.shares.length > 0) parts.push(`shares=${encodeRestliList(params.shares)}`);
  return parts.join("&");
}
