// Data-volledigheid: welk kanaal registreert wél conversies (en draagt budget) maar GEEN
// conversiewaarde? Dan is blended ROAS en elke waarde-gebaseerde vergelijking onberekenbaar — je
// kunt dat kanaal alleen op CPA/CPL beoordelen, niet op rendement. Dat is geen prestatie-oordeel
// maar een tracking-config-gat: een gerichte, actioneerbare nudge. Puur, los getest.

import { type DetectionResult, type SignalStory, type SignalEvidence } from "./types";

export interface ChannelValueAgg {
  channel: string;
  conversions: number;
  conversionValue: number;
  spend: number;
}

export const DATAGAP_MIN_CONVERSIONS = 20; // het kanaal moet materieel converteren
export const DATAGAP_MIN_SPEND = 500;      // en materieel budget dragen
export const DATAGAP_NEAR_ZERO_VALUE = 1;  // "€0 waarde" met wat marge

const CHANNEL_LABEL: Record<string, string> = { google_ads: "Google", meta_ads: "Meta", linkedin_ads: "LinkedIn" };
const eur = (v: number): string => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

export function buildBlendedDataGapSignals(rows: ChannelValueAgg[]): DetectionResult {
  const id = "blended_conversion_value_gap";
  const triggered: SignalStory[] = [];

  // Alleen zinvol om te oordelen als minstens één kanaal WEL conversiewaarde meet (anders is het
  // waarschijnlijk een account dat bewust op volume i.p.v. waarde stuurt, geen tracking-gat).
  const anyValue = rows.some((r) => r.conversionValue > DATAGAP_NEAR_ZERO_VALUE);
  if (!anyValue) return { triggered: [], checked: [id] };

  for (const r of [...rows].sort((a, b) => b.spend - a.spend)) {
    if (r.conversions < DATAGAP_MIN_CONVERSIONS || r.spend < DATAGAP_MIN_SPEND) continue;
    if (r.conversionValue > DATAGAP_NEAR_ZERO_VALUE) continue;
    const label = CHANNEL_LABEL[r.channel] ?? r.channel;
    triggered.push({
      id: `blended_datagap_${r.channel}`,
      category: "conversie_meting",
      scope: `${label}-tracking (conversiewaarde)`,
      story: `${label} registreert ${Math.round(r.conversions)} conversies over ${eur(r.spend)} spend maar €0 conversiewaarde: blended ROAS en waarde-gebaseerde vergelijking tussen de kanalen zijn hierdoor niet te berekenen.`,
      actionDirection: `zet waarde-tracking aan voor ${label} (aankoopwaarde of een lead-waarde), zodat dit kanaal in de blended ROAS meetelt in plaats van alleen op CPA/CPL beoordeeld te worden`,
      certainty: "bewezen_binnen_platform",
      evidence: [
        ev(`${label} conversies`, String(Math.round(r.conversions))),
        ev(`${label} spend`, eur(r.spend)),
        ev(`${label} conversiewaarde`, eur(r.conversionValue)),
      ],
    });
  }

  return { triggered, checked: [id] };
}
