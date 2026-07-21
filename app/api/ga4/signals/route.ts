// GA4-signalen voor de Vandaag-feed (real-data pad). Draait server-side omdat GA4-config/-API
// alleen daar bereikbaar is. Voor elke opgevraagde klant: dataset ophalen via de gedeelde
// data-access-laag en de deterministische GA4-detectoren draaien. Zonder GA4-config levert een
// klant simpelweg geen signalen — de feed werkt gewoon door (geen valse zekerheid).
//
// De client-side feed mapt deze SignalStory's via lib/feed/adapters-ga4.ts naar feed-kaarten,
// zodat de mapping op één (pure, geteste) plek blijft.

import { getSupabase } from "@/lib/analysis/helpers";
import { fetchGa4Dataset, type Ga4SupabaseLike } from "@/lib/ga4/data-access";
import { buildGa4TrackingSignals } from "@/lib/ga4/signals";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const raw = url.searchParams.get("clientIds") ?? "";
  const clientIds = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (clientIds.length === 0) return Response.json({ clients: [] });

  const supabase = getSupabase() as unknown as Ga4SupabaseLike | null;

  const clients = await Promise.all(
    clientIds.map(async (clientId) => {
      try {
        const dataset = await fetchGa4Dataset(clientId, { supabase });
        const signals = buildGa4TrackingSignals(dataset.rows);
        return { clientId, availability: dataset.availability, signals: signals.triggered };
      } catch {
        return { clientId, availability: "absent" as const, signals: [] };
      }
    })
  );

  return Response.json({ clients: clients.filter((c) => c.signals.length > 0) });
}
