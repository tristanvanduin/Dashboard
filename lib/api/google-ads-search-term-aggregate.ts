// Zoekterm-aggregatie: dicht een STILLE dataverliesbug in de sync.
//
// HET PROBLEEM: getSearchTermsByMonth vraagt segments.search_term_match_type EN
// segments.month op. Een segment SPLITST rijen, dus een zoekterm die in dezelfde maand via
// zowel BROAD als PHRASE matchte komt terug als TWEE rijen. De orchestrator dedupliceert
// daarna op (client_id, search_term, campaign_name, ad_group_name, month) zonder
// match_type, en dedup doet `seen.set(key, row)`: last wins. Een van de twee rijen
// verdwijnt dus geruisloos, MET zijn impressies, klikken, kosten en conversies. De
// upsert-conflictsleutel zou hetzelfde doen. Gevolg: de metrics van elke zoekterm die via
// meerdere match-types binnenkwam zijn te laag, zonder dat iets dat meldt.
//
// DE FIX, bewust zonder migratie: hier optellen VOORDAT de dedup toeslaat, en het
// dominante match-type kiezen. De tabelvorm, de sleutel en de index blijven daardoor
// ongemoeid; de dedup in de orchestrator wordt een vangnet in plaats van een zeef.
//
// DE PRIJS, eerlijk: match_type is daarmee het DOMINANTE match-type van die term in die
// maand, niet een exacte uitsplitsing. Wie de volledige uitsplitsing wil, moet match_type
// aan de sleutel EN aan de unieke index toevoegen; dat is een migratie en een grondwijziging
// van de tabel. Voor de vraag "hoeveel van onze kosten loopt via broad" is het dominante
// type ruim voldoende, en de metrics kloppen weer.

import type { SearchTermMonthlyRow } from "./google-ads";

function keyOf(row: SearchTermMonthlyRow): string {
  return [row.date, row.campaignId, row.adGroupId, row.searchTerm].join("|||");
}

export function aggregateSearchTermsByMonth(rows: SearchTermMonthlyRow[]): SearchTermMonthlyRow[] {
  const grouped = new Map<string, { row: SearchTermMonthlyRow; byMatchType: Map<string, number> }>();

  for (const row of rows) {
    const key = keyOf(row);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        row: { ...row },
        byMatchType: new Map(row.matchType ? [[row.matchType, row.impressions]] : []),
      });
      continue;
    }
    // De metrics tellen op: dat is precies wat er nu verloren gaat.
    existing.row.impressions += row.impressions;
    existing.row.clicks += row.clicks;
    existing.row.cost += row.cost;
    existing.row.conversions += row.conversions;
    existing.row.conversionsValue += row.conversionsValue;
    if (row.matchType) {
      existing.byMatchType.set(row.matchType, (existing.byMatchType.get(row.matchType) ?? 0) + row.impressions);
    }
  }

  return [...grouped.values()].map(({ row, byMatchType }) => {
    // Het dominante match-type op impressies. Bij een gelijkstand wint de alfabetisch
    // eerste, zodat dezelfde input altijd dezelfde output geeft.
    const dominant = [...byMatchType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { ...row, matchType: dominant ? dominant[0] : "" };
  });
}
