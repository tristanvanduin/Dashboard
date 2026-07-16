// Types voor de LinkedIn Marketing API adAnalytics-laag.
// De adAnalytics-API geeft per element een dateRange als OBJECT (year/month/day, niet
// als string), een pivotValues-array (de entiteit-URN's) en de metric-velden. Bedragen
// komen als string of getal (costInLocalCurrency); tellingen als getal. Door de limiet
// van circa 20 metric-velden per request worden twee veldensets in aparte calls
// opgehaald en per dag plus entiteit-URN gemerged voor opslag.

export interface LinkedInDatePart {
  year: number;
  month: number;
  day: number;
}

export interface LinkedInDateRange {
  start?: LinkedInDatePart;
  end?: LinkedInDatePart;
}

// Een adAnalytics-element (timeGranularity=DAILY). Onbekende velden blijven via de
// index-signatuur beschikbaar voor de raw-kolom.
export interface LinkedInAnalyticsElement {
  dateRange?: LinkedInDateRange;
  pivotValues?: string[];
  impressions?: number | string;
  clicks?: number | string;
  costInLocalCurrency?: number | string;
  landingPageClicks?: number | string;
  oneClickLeadFormOpens?: number | string;
  oneClickLeads?: number | string;
  externalWebsiteConversions?: number | string;
  externalWebsitePostClickConversions?: number | string;
  conversionValueInLocalCurrency?: number | string;
  videoStarts?: number | string;
  videoViews?: number | string;
  videoCompletions?: number | string;
  totalEngagements?: number | string;
  follows?: number | string;
  reactions?: number | string;
  comments?: number | string;
  shares?: number | string;
  [key: string]: unknown;
}

// Getypeerde dagrij zoals die in de linkedin_*_daily tabellen landt. Tellingen
// defaulten naar 0; bedragen (spend) en beschikbaarheid-afhankelijke velden
// (conversion_value) en afgeleide ratio's zijn nullable. Let op: conversion_value is
// ENKELVOUD (zoals Meta en LinkedIn), niet meervoud zoals de Google-tabellen.
export interface LinkedInDailyRow {
  date: string | null;
  entityUrn: string | null;
  impressions: number;
  clicks: number;
  spend: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  landingPageClicks: number;
  oneClickLeadFormOpens: number;
  oneClickLeads: number;
  externalWebsiteConversions: number;
  postClickConversions: number;
  conversionValue: number | null;
  cpl: number | null;
  formCompletionRate: number | null;
  videoStarts: number;
  videoViews: number;
  videoCompletions: number;
  videoCompletionRate: number | null;
  totalEngagements: number;
  follows: number;
  reactions: number;
  comments: number;
  shares: number;
}

// De zes member-pivottypes die LinkedIn ondersteunt voor demografie. Niet combineerbaar:
// een pivot per adAnalytics-call.
export type LinkedInPivotType =
  | "MEMBER_JOB_FUNCTION"
  | "MEMBER_SENIORITY"
  | "MEMBER_INDUSTRY"
  | "MEMBER_COMPANY_SIZE"
  | "MEMBER_REGION"
  | "MEMBER_COUNTRY";

// Een getypeerde demografie-dagrij (LONG format): een rij per segment per dag.
// Subset van metrieken; coverage_pct staat op de samenvattingsrij (pivotValueUrn = TOTAL).
export interface LinkedInDemographicRow {
  date: string | null;
  level: string;
  entityUrn: string | null;
  pivotType: LinkedInPivotType;
  pivotValueUrn: string;
  impressions: number;
  clicks: number;
  spend: number | null;
  leads: number;
  conversions: number;
  coveragePct: number | null;
}
