// GA4 insight layer — gedeelde types. GA4 is GEEN losse rapportagepagina maar een herbruikbare
// signalerings-/verklaringslaag die de Vandaag-feed, de kanaal-SOP's en Analyse & Advies voedt.
// Alle consumers werken uitsluitend op deze genormaliseerde shapes; alleen lib/ga4/data-access
// raakt de echte GA4-config/-API aan. Zo dupliceert niemand GA4-logica.

// Beschikbaarheid van de GA4-data voor een klant. Bepaalt of (en met welk voorbehoud) GA4 mag
// meepraten. "absent" ⇒ de tool draait volledig door zonder GA4 (geen valse zekerheid).
export type Ga4Availability = "live" | "mock" | "partial" | "absent";

// De bewijs-basis van een conclusie. Elke SOP-uitkomst die GA4 raakt moet expliciet aangeven
// waar ze op rust — advertentieplatform, GA4, een combinatie, of een schatting.
export type EvidenceBasis = "platform" | "ga4" | "combined" | "estimated";

// Onze kanaal-union, gemapt uit GA4 sessionSource/Medium. "other" = verkeer buiten paid Google/
// Meta/LinkedIn (organisch, direct, e-mail): telt mee voor het website-totaal, niet per kanaal.
export type Ga4Channel = "google" | "meta" | "linkedin" | "other";

// GA4 deviceCategory. Optioneel op de dagrij: detectoren die device negeren aggregeren gewoon
// over alle waarden; de device-CRO-detector kijkt alleen naar rijen met een device.
export type Ga4Device = "mobile" | "desktop" | "tablet";

// Per-klant GA4-configuratie (uit client_settings.ga4_config). keyEvents = de events die als
// key event/conversie tellen; funnelSteps = de geordende events van de website-funnel.
export interface Ga4Config {
  propertyId: string;
  keyEvents: string[];
  funnelSteps: string[];
}

// Genormaliseerde GA4-dagrij per kanaal. funnel bevat de tellingen per funnel-event.
export interface Ga4DailyRow {
  date: string; // YYYY-MM-DD
  channel: Ga4Channel;
  device?: Ga4Device; // optioneel: aanwezig zodra de device-breakdown is opgehaald
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  funnel: Record<string, number>;
}

// Het resultaat van data-access: de rijen plus de betrouwbaarheids-/beperkingscontext die de
// consumers nodig hebben om GA4 eerlijk te labelen.
export interface Ga4Dataset {
  availability: Ga4Availability;
  config: Ga4Config | null;
  rows: Ga4DailyRow[];
  limitations: string[]; // mensleesbare beperkingen (bv. "alleen laatste 14 dagen beschikbaar")
}
