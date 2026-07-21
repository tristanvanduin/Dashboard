// GA4 data-access — de ENIGE module die GA4-config en (straks) de GA4 Data API kent. Alle andere
// GA4-modules (signals, context) en de feed-adapter werken uitsluitend op het genormaliseerde
// Ga4Dataset dat hier uitkomt. Zo dupliceert geen enkele consumer GA4-logica.
//
// Config-gate + geen valse zekerheid:
//  - demo-klant  → gemockte dataset (availability "mock").
//  - geen config → availability "absent", lege rijen: de tool draait volledig door zonder GA4.
//  - config aanwezig maar live koppeling nog niet actief → "absent" met een expliciete beperking
//    (we verzinnen géén live cijfers).

import { isGreentechDemo } from "@/lib/demo/greentech-mock";
import { buildGa4DemoDataset } from "@/lib/demo/ga4-demo";
import type { Ga4Config, Ga4Dataset } from "./types";

// Minimale Supabase-vorm die we nodig hebben, zodat data-access niet aan een concrete client
// vastzit (de server-routes geven hun eigen client mee; demo heeft er geen nodig).
export interface Ga4SupabaseLike {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
      };
    };
  };
}

export interface Ga4Deps {
  supabase?: Ga4SupabaseLike | null;
  now?: Date;
}

function parseConfig(raw: unknown): Ga4Config | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const propertyId = typeof o.propertyId === "string" ? o.propertyId : "";
  const keyEvents = Array.isArray(o.keyEvents) ? o.keyEvents.filter((x): x is string => typeof x === "string") : [];
  const funnelSteps = Array.isArray(o.funnelSteps) ? o.funnelSteps.filter((x): x is string => typeof x === "string") : [];
  if (!propertyId || keyEvents.length === 0) return null;
  return { propertyId, keyEvents, funnelSteps };
}

const absent = (limitation: string): Ga4Dataset => ({
  availability: "absent",
  config: null,
  rows: [],
  limitations: [limitation],
});

// Haalt het GA4-dataset voor een klant. Zie de module-header voor de gate-volgorde.
export async function fetchGa4Dataset(clientId: string, deps: Ga4Deps = {}): Promise<Ga4Dataset> {
  const now = deps.now ?? new Date();

  // 1) Demo-klant: gemockte dataset, geen backend nodig.
  if (isGreentechDemo(clientId)) return buildGa4DemoDataset(now);

  // 2) Config opzoeken. Zonder Supabase-client (of zonder config) → absent, alles draait door.
  const sb = deps.supabase ?? null;
  if (!sb) return absent("GA4-config niet opgehaald (geen databaseverbinding meegegeven).");

  let config: Ga4Config | null = null;
  try {
    const { data, error } = await sb.from("client_settings").select("ga4_config").eq("client_id", clientId).maybeSingle();
    if (error) return absent("GA4-config kon niet worden gelezen uit client_settings.");
    config = parseConfig(data?.ga4_config);
  } catch {
    return absent("GA4-config kon niet worden gelezen (onverwachte fout).");
  }
  if (!config) return absent("GA4 niet geconfigureerd voor deze klant.");

  // 3) Config aanwezig, maar de live GA4 Data API-koppeling is nog niet geactiveerd. We geven
  //    GEEN verzonnen cijfers terug — expliciet absent met de reden, zodat de SOP zonder GA4
  //    draait tot de live koppeling er is.
  return {
    availability: "absent",
    config,
    rows: [],
    limitations: [`GA4-config aanwezig (property ${config.propertyId}) maar de live GA4-koppeling is nog niet actief.`],
  };
}
