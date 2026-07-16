// Types voor de Meta Marketing API insights-laag.
// Belangrijk: de insights-API geeft numerieke velden als STRING terug; parse altijd
// voor opslag. Action-metrieken komen als arrays van { action_type, value }.

export interface MetaActionEntry {
  action_type: string;
  value: string;
}

// Subset van een insights-rij (level account/campaign/adset/ad, time_increment=1).
// Onbekende velden blijven via de index-signatuur beschikbaar voor de raw-kolom.
export interface MetaInsightsRow {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  spend?: string;
  cpm?: string;
  cpc?: string;
  ctr?: string;
  actions?: MetaActionEntry[];
  action_values?: MetaActionEntry[];
  purchase_roas?: MetaActionEntry[];
  video_3sec_watched_actions?: MetaActionEntry[];
  video_thruplay_watched_actions?: MetaActionEntry[];
  video_p25_watched_actions?: MetaActionEntry[];
  video_p50_watched_actions?: MetaActionEntry[];
  video_p75_watched_actions?: MetaActionEntry[];
  video_p100_watched_actions?: MetaActionEntry[];
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
  [key: string]: unknown;
}

// Getypeerde dagrij zoals die in de meta_*_daily tabellen landt. Tellingen die altijd
// een getal zijn (conversies, leads) defaulten naar 0; metrieken die kunnen ontbreken
// of een ongeldige deling zijn, zijn nullable.
export interface MetaDailyRow {
  date: string | null;
  entityId: string | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicksAll: number | null;
  linkClicks: number | null;
  spend: number | null;
  cpm: number | null;
  cpcLink: number | null;
  ctrLink: number | null;
  conversions: number;
  conversionValue: number;
  purchaseRoas: number | null;
  cpa: number | null;
  roas: number | null;
  leads: number;
  addToCart: number;
  initiateCheckout: number;
  landingPageViews: number;
  video3sViews: number;
  videoThruplay: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
  postEngagement: number;
  hookRate: number | null;
  holdRate: number | null;
  qualityRanking: string | null;
  engagementRateRanking: string | null;
  conversionRateRanking: string | null;
}
