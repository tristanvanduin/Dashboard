// De transform voor de negatives-sync: van de drie API-vormen naar databaserijen.
// Pure functie, dus los testbaar zonder API.
//
// DRIE REGELS die hier hard zijn:
// (1) Lege strings in plaats van null voor de optionele niveaus, want de primaire sleutel
//     van ads_negative_keywords kan geen expressies bevatten (Postgres staat coalesce niet
//     toe in een PRIMARY KEY) en werkt dus op gewone kolommen.
// (2) Een rij zonder zoekwoordtekst valt af: die kan geen conflict vormen en zou de sleutel
//     alleen vervuilen.
// (3) Dedupliceren op de volledige sleutel, want dezelfde negative kan uit twee bronnen
//     komen (bijvoorbeeld een gedeelde lijst die aan meerdere campagnes hangt terwijl er ook
//     een campagne-negative met dezelfde tekst staat). Zonder dedup geeft de upsert een
//     conflict op zichzelf.

import type { NegativeKeywordRow } from "./google-ads";

export interface NegativeKeywordDbRow {
  client_id: string;
  level: "campaign" | "ad_group" | "shared_set";
  campaign_name: string;
  ad_group_name: string;
  list_name: string;
  keyword_text: string;
  match_type: string;
  synced_at: string;
}

export function negativeToDbRow(row: NegativeKeywordRow, clientId: string, syncedAt: string): NegativeKeywordDbRow | null {
  const keywordText = (row.keywordText ?? "").trim();
  if (keywordText.length === 0) return null;
  return {
    client_id: clientId,
    level: row.level,
    campaign_name: row.campaignName ?? "",
    ad_group_name: row.adGroupName ?? "",
    list_name: row.listName ?? "",
    keyword_text: keywordText,
    // Hoofdletters, zodat de conflictmatcher niet op casing hoeft te letten.
    match_type: (row.matchType ?? "").trim().toUpperCase() || "UNKNOWN",
    synced_at: syncedAt,
  };
}

export function negativesToDbRows(rows: NegativeKeywordRow[], clientId: string, syncedAt: string): NegativeKeywordDbRow[] {
  const seen = new Map<string, NegativeKeywordDbRow>();
  for (const row of rows) {
    const db = negativeToDbRow(row, clientId, syncedAt);
    if (!db) continue;
    const key = [db.level, db.campaign_name, db.ad_group_name, db.list_name, db.keyword_text, db.match_type].join("|||");
    seen.set(key, db);
  }
  return [...seen.values()];
}
