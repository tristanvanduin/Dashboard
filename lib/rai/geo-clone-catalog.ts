// RAI geo-clone-catalogus plus het campagnenaam-filter. Alle beurzen van een merk zitten in
// een account; het onderscheid tussen geo-clones zit in de campagnenaam via een afkorting per
// locatie (bijv. AQM voor Aquatech Mexico, ICC voor Interclean China). Dit bestand bevat alle
// bekende varianten en het filter dat een campagne aan een variant koppelt op die afkorting.
// Een variant waarvan de afkorting in geen enkele campagnenaam voorkomt, wordt niet getoond.
//
// LET OP over de afkortingen: alleen AQM en ICC zijn door Tristan bevestigd. De overige zijn
// een consistente best-guess (merkcode plus locatieletter) en staan als confirmed: false. Ze
// zijn triviaal te corrigeren, want alle afkortingen staan hieronder op een plek. De
// filterlogica werkt onafhankelijk van of de afkorting juist geraden is.

import type { FairCadence } from "./event-comparison";

export interface GeoCloneVariant {
  brand: string;
  location: string;
  abbreviation: string; // de code die in de campagnenaam staat; tevens de geoClone-sleutel
  confirmed: boolean; // is de afkorting bevestigd tegen RAI's conventie?
  cadence: FairCadence;
}

// Comprehensief, voor de veiligheid. Corrigeer de afkortingen (confirmed: false) waar nodig.
export const RAI_GEO_CLONES: GeoCloneVariant[] = [
  // Aquatech (watertechnologie)
  { brand: "Aquatech", location: "Amsterdam", abbreviation: "AQA", confirmed: false, cadence: "biennial" },
  { brand: "Aquatech", location: "Mexico", abbreviation: "AQM", confirmed: true, cadence: "annual" },
  { brand: "Aquatech", location: "China", abbreviation: "AQC", confirmed: false, cadence: "annual" },
  // Interclean (professioneel schoonmaak)
  { brand: "Interclean", location: "Amsterdam", abbreviation: "ICA", confirmed: false, cadence: "biennial" },
  { brand: "Interclean", location: "China", abbreviation: "ICC", confirmed: true, cadence: "annual" },
  // Intertraffic (verkeerstechnologie)
  { brand: "Intertraffic", location: "Amsterdam", abbreviation: "ITA", confirmed: false, cadence: "biennial" },
  { brand: "Intertraffic", location: "China", abbreviation: "ITC", confirmed: false, cadence: "annual" },
  { brand: "Intertraffic", location: "Americas", abbreviation: "ITM", confirmed: false, cadence: "custom" },
  { brand: "Intertraffic", location: "Istanbul", abbreviation: "ITI", confirmed: false, cadence: "biennial" },
  { brand: "Intertraffic", location: "Asia", abbreviation: "ITB", confirmed: false, cadence: "custom" },
  // GreenTech (tuinbouwtechnologie)
  { brand: "GreenTech", location: "Amsterdam", abbreviation: "GTA", confirmed: false, cadence: "annual" },
  { brand: "GreenTech", location: "Americas", abbreviation: "GTAM", confirmed: false, cadence: "custom" },
  { brand: "GreenTech", location: "North America", abbreviation: "GTNA", confirmed: false, cadence: "custom" },
  // Overwegend Amsterdam of nationaal (een variant; afkortingen te bevestigen)
  { brand: "METSTRADE", location: "Amsterdam", abbreviation: "MET", confirmed: false, cadence: "annual" },
  { brand: "Rematec", location: "Amsterdam", abbreviation: "REM", confirmed: false, cadence: "biennial" },
  { brand: "Horecava", location: "Amsterdam", abbreviation: "HOR", confirmed: false, cadence: "annual" },
  { brand: "Huishoudbeurs", location: "Amsterdam", abbreviation: "HHB", confirmed: false, cadence: "annual" },
  { brand: "Negenmaandenbeurs", location: "Amsterdam", abbreviation: "NMB", confirmed: false, cadence: "annual" },
  { brand: "Amsterdam Drone Week", location: "Amsterdam", abbreviation: "ADW", confirmed: false, cadence: "annual" },
  { brand: "Superyacht Forum", location: "Amsterdam", abbreviation: "SYF", confirmed: false, cadence: "annual" },
];

// Zoekt een afkorting als afgebakende token in de campagnenaam (case-ongevoelig). Afgebakend
// betekent begrensd door het begin, het einde of een niet-alfanumeriek teken, zodat AQM niet
// binnen AQMX of XAQM matcht.
export function abbreviationInName(abbreviation: string, campaignName: string): boolean {
  const abbr = abbreviation.trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!abbr) return false;
  const re = new RegExp(`(^|[^A-Z0-9])${abbr}([^A-Z0-9]|$)`);
  return re.test(campaignName.toUpperCase());
}

// Koppelt een campagnenaam aan een variant op de afkorting. Bij meerdere matches wint de
// langste afkorting (meest specifiek, bijv. GTAM boven GTA). Geen match geeft null (onbekend).
export function matchGeoCloneByCampaignName(campaignName: string, catalog: GeoCloneVariant[] = RAI_GEO_CLONES): GeoCloneVariant | null {
  const matches = catalog
    .filter((v) => abbreviationInName(v.abbreviation, campaignName))
    .sort((a, b) => b.abbreviation.length - a.abbreviation.length);
  return matches[0] ?? null;
}

// De varianten die daadwerkelijk in de gegeven campagnenamen voorkomen. Een variant waarvan de
// afkorting nergens matcht, wordt niet getoond. Dit is de directe invulling van de eis: geen
// afkorting in de campagnenaam betekent de variant niet vertonen.
export function visibleGeoClones(campaignNames: string[], catalog: GeoCloneVariant[] = RAI_GEO_CLONES): GeoCloneVariant[] {
  return catalog.filter((v) => campaignNames.some((name) => abbreviationInName(v.abbreviation, name)));
}

export interface CampaignAssignment {
  campaignName: string;
  variant: GeoCloneVariant | null;
}

// Wijst elke campagne toe aan zijn variant (of null = onbekend). Onbekende campagnes worden
// nooit stilzwijgend bij een variant opgeteld; ze zijn expliciet apart te behandelen.
export function assignCampaigns(campaignNames: string[], catalog: GeoCloneVariant[] = RAI_GEO_CLONES): CampaignAssignment[] {
  return campaignNames.map((campaignName) => ({ campaignName, variant: matchGeoCloneByCampaignName(campaignName, catalog) }));
}
