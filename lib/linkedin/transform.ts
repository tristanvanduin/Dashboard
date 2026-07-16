// Pure transform van een LinkedIn adAnalytics-element naar een getypeerde dagrij. Geen
// I/O, dus los testbaar. Drie aandachtspunten uit de API: datums komen als object
// (year/month/day), bedragen kunnen als string komen, en door de circa 20-velden-limiet
// per request worden twee veldensets in aparte calls opgehaald die per dag plus entiteit
// gemerged moeten worden voor er een complete rij is.

import type {
  LinkedInAnalyticsElement,
  LinkedInDailyRow,
  LinkedInDateRange,
  LinkedInDemographicRow,
  LinkedInPivotType,
} from "./types";

// Parseert een LinkedIn-waarde (getal of string) naar een getal. Leeg of niet-numeriek geeft null.
export function parseNum(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Deelt veilig: deler null of 0 geeft null, zodat een metriek nooit Infinity of NaN wordt.
function safeDiv(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

// Telling: ontbrekend of niet-numeriek wordt 0 (geen data betekent nul voorvallen).
function count(value: unknown): number {
  return parseNum(value) ?? 0;
}

// LinkedIn geeft datums als object; pak de start van de dateRange als YYYY-MM-DD.
export function dateRangeToIso(range: LinkedInDateRange | undefined): string | null {
  const d = range?.start;
  if (!d || d.year == null || d.month == null || d.day == null) return null;
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}

// De merge-sleutel: dag plus de volledige pivotValues-keten, zodat twee veldensets van
// hetzelfde segment op dezelfde dag samenvallen.
function mergeKey(el: LinkedInAnalyticsElement): string {
  return `${dateRangeToIso(el.dateRange) ?? ""}|${(el.pivotValues ?? []).join(",")}`;
}

// Merget twee veldensets (opgehaald in aparte requests vanwege de velden-limiet) tot
// een set elementen, gekeyed op dag plus entiteit. Velden uit set B vullen ALLEEN
// ontbrekende velden in set A aan; bestaande waarden in A blijven staan (set A wint).
export function mergeFieldSets(
  setA: LinkedInAnalyticsElement[],
  setB: LinkedInAnalyticsElement[]
): LinkedInAnalyticsElement[] {
  const merged = new Map<string, LinkedInAnalyticsElement>();
  for (const el of setA) merged.set(mergeKey(el), { ...el });
  for (const el of setB) {
    const key = mergeKey(el);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...el });
      continue;
    }
    for (const [k, v] of Object.entries(el)) {
      if (existing[k] == null) existing[k] = v;
    }
  }
  return Array.from(merged.values());
}

// Mapt een adAnalytics-element naar een getypeerde dagrij met afgeleide metrieken.
// Afgeleid: ctr (clicks/impressions), cpc (spend/clicks), cpm (spend/impressions*1000),
// cpl (spend/leads), form_completion_rate (leads/form_opens), video_completion_rate
// (completions/starts). De API levert deze ratio's niet rechtstreeks.
export function mapAnalyticsElement(
  el: LinkedInAnalyticsElement,
  opts: { round?: boolean } = {}
): LinkedInDailyRow {
  const round = opts.round ?? true;
  const r = (v: number | null): number | null => (v == null ? null : round ? Math.round(v * 10000) / 10000 : v);

  const impressions = count(el.impressions);
  const clicks = count(el.clicks);
  const spend = parseNum(el.costInLocalCurrency);
  const formOpens = count(el.oneClickLeadFormOpens);
  const oneClickLeads = count(el.oneClickLeads);
  const videoStarts = count(el.videoStarts);
  const videoCompletions = count(el.videoCompletions);
  const cpmBase = safeDiv(spend, impressions > 0 ? impressions : null);

  return {
    date: dateRangeToIso(el.dateRange),
    entityUrn: el.pivotValues && el.pivotValues.length > 0 ? el.pivotValues[0] : null,
    impressions,
    clicks,
    spend,
    ctr: r(safeDiv(clicks, impressions > 0 ? impressions : null)),
    cpc: r(safeDiv(spend, clicks > 0 ? clicks : null)),
    cpm: r(cpmBase == null ? null : cpmBase * 1000),
    landingPageClicks: count(el.landingPageClicks),
    oneClickLeadFormOpens: formOpens,
    oneClickLeads,
    externalWebsiteConversions: count(el.externalWebsiteConversions),
    postClickConversions: count(el.externalWebsitePostClickConversions),
    conversionValue: parseNum(el.conversionValueInLocalCurrency),
    cpl: r(safeDiv(spend, oneClickLeads > 0 ? oneClickLeads : null)),
    formCompletionRate: r(safeDiv(oneClickLeads, formOpens > 0 ? formOpens : null)),
    videoStarts,
    videoViews: count(el.videoViews),
    videoCompletions,
    videoCompletionRate: r(safeDiv(videoCompletions, videoStarts > 0 ? videoStarts : null)),
    totalEngagements: count(el.totalEngagements),
    follows: count(el.follows),
    reactions: count(el.reactions),
    comments: count(el.comments),
    shares: count(el.shares),
  };
}


// Mapt een demografie-pivot-element naar een getypeerde segmentrij (LONG format).
// Metrics-subset: impressions, clicks, spend, leads, conversions. coverage_pct blijft
// null op segmentrijen; alleen de TOTAL-samenvattingsrij draagt de dekking.
export function mapDemographicElement(
  el: LinkedInAnalyticsElement,
  meta: { level: string; entityUrn: string; pivotType: LinkedInPivotType }
): LinkedInDemographicRow {
  return {
    date: dateRangeToIso(el.dateRange),
    level: meta.level,
    entityUrn: meta.entityUrn,
    pivotType: meta.pivotType,
    pivotValueUrn: el.pivotValues && el.pivotValues.length > 0 ? el.pivotValues[0] : "UNKNOWN",
    impressions: count(el.impressions),
    clicks: count(el.clicks),
    spend: parseNum(el.costInLocalCurrency),
    leads: count(el.oneClickLeads),
    conversions: count(el.externalWebsiteConversions),
    coveragePct: null,
  };
}

// Berekent de demografie-dekking voor een dag: de som van de segment-impressies gedeeld
// door de totale impressies van die dag (uit de entiteit-dagrij). Privacy-drempels
// onderdrukken kleine segmenten, dus de som is vaak kleiner dan het totaal; coverage_pct
// maakt dat expliciet voor L2. Geeft de samenvattingsrij met pivot_value_urn = TOTAL terug.
export function buildCoverageSummaryRow(
  segments: LinkedInDemographicRow[],
  totalImpressions: number,
  meta: { date: string; level: string; entityUrn: string; pivotType: LinkedInPivotType }
): LinkedInDemographicRow {
  const segmentImpressions = segments.reduce((sum, seg) => sum + (seg.impressions || 0), 0);
  const coveragePct =
    totalImpressions > 0 ? Math.round((segmentImpressions / totalImpressions) * 10000) / 10000 : null;
  const spends = segments.map((seg) => seg.spend).filter((v): v is number => v != null);
  return {
    date: meta.date,
    level: meta.level,
    entityUrn: meta.entityUrn,
    pivotType: meta.pivotType,
    pivotValueUrn: "TOTAL",
    impressions: segmentImpressions,
    clicks: segments.reduce((sum, seg) => sum + (seg.clicks || 0), 0),
    spend: spends.length > 0 ? spends.reduce((a, b) => a + b, 0) : null,
    leads: segments.reduce((sum, seg) => sum + (seg.leads || 0), 0),
    conversions: segments.reduce((sum, seg) => sum + (seg.conversions || 0), 0),
    coveragePct,
  };
}
