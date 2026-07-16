// Pure datum-vensters voor de LinkedIn-sync. Geen I/O, dus los testbaar. Alles in UTC en
// als ISO YYYY-MM-DD, zodat de sync deterministisch is ongeacht de serverzone. Spiegelt het
// Meta-patroon (channel-geisoleerd), met een trailing van 30 dagen.
//
// De 30-daagse her-upsert is geen detail: LinkedIn herschrijft conversies met terugwerkende
// kracht binnen het attributievenster, dus de daily sync moet altijd de laatste 30 dagen
// opnieuw upserten in plaats van alleen gisteren.

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Vandaag in UTC als YYYY-MM-DD.
export function todayUTC(now: Date = new Date()): string {
  return toISO(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

// Schuift een ISO-datum een aantal dagen op (negatief voor terug).
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISO(new Date(Date.UTC(y, m - 1, d + days)));
}

// Het trailing venster voor de daily incremental: eindigt op endDate en strekt 'days'
// dagen terug (inclusief), default 30 voor de attributie-herstatement.
export function trailingWindow(endDate: string, days = 30): { since: string; until: string } {
  const until = endDate;
  const since = addDaysISO(until, -(Math.max(1, days) - 1));
  return { since, until };
}

// Het backfill-venster: van de eerste dag van de maand 'months' maanden geleden tot en met
// endDate. Default 13 maanden zodat een volledig jaar plus de lopende maand beschikbaar is.
export function backfillWindow(endDate: string, months = 13): { since: string; until: string } {
  const [y, m] = endDate.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - (months - 1), 1));
  return { since: toISO(start), until: endDate };
}

// Splitst een venster in maand-chunks (eerste tot laatste dag per maand, geclamped op de
// vensterranden), zodat een grote backfill in behapbare async-pulls kan en binnen de
// dagelijkse app-quota blijft.
export function monthlyChunks(since: string, until: string): { since: string; until: string }[] {
  const chunks: { since: string; until: string }[] = [];
  const [sy, sm] = since.split("-").map(Number);
  let cursor = new Date(Date.UTC(sy, sm - 1, 1));
  const end = new Date(until + "T00:00:00Z");
  while (cursor <= end) {
    const monthStart = toISO(cursor);
    const monthEnd = toISO(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)));
    chunks.push({
      since: monthStart < since ? since : monthStart,
      until: monthEnd > until ? until : monthEnd,
    });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return chunks;
}
