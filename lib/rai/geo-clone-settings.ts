// Fase 2 van de geo-clone-projecten: per geo-clone een eigen laag instellingen (branding,
// doelstellingen, event-datums) MET account-fallback. Elke beurs/geo-clone kan afwijken; laat
// je een veld leeg, dan erft het van het account. Dit bestand bevat puur de shapes en de
// resolver (override over account, veld voor veld). Opslag: tabel geo_clone_settings
// (migratie 025), sleutel (client_id, geo_clone). Los getest.

import type { BrandVisualIdentity } from "@/lib/branding/theme";

export type Cadence = "annual" | "biennial" | "custom";
export interface Edition { date: string; label: string }

// Branding-override: de merknaam plus de visuele identiteit (zelfde velden als de brand guide).
export interface GeoCloneBranding extends BrandVisualIdentity {
  brandName?: string | null;
}

// Doel-override: alleen de absolute/target-waarden. 0 of leeg betekent "erf van account".
export interface GeoCloneGoals {
  conversionsAbsolute?: number | null;
  revenueAbsolute?: number | null;
  roasTarget?: number | null;
  cpaTarget?: number | null;
}

// Event-override: cadans en afgelopen edities voor déze geo-clone (bijv. GreenTech Americas
// heeft eigen datums, los van GreenTech Amsterdam in hetzelfde account).
export interface GeoCloneEvent {
  cadence?: Cadence | null;
  editions?: Edition[] | null;
}

export interface GeoCloneSettings {
  branding?: GeoCloneBranding | null;
  goals?: GeoCloneGoals | null;
  event?: GeoCloneEvent | null;
}

// Het account-niveau waarop teruggevallen wordt als de geo-clone een veld leeg laat.
export interface AccountSettings {
  branding: GeoCloneBranding;
  goals: GeoCloneGoals;
  event: GeoCloneEvent;
}

// Aanwezig? Een override-veld telt alleen als het echt ingevuld is: strings niet leeg,
// getallen > 0, arrays niet leeg. Anders erft het van het account.
function presentStr(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function presentNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export interface Resolved<T> {
  effective: T;
  /** Per veldnaam: true als de waarde van het account is geërfd (niet door de geo-clone gezet). */
  inherited: Record<string, boolean>;
}

const BRAND_STR_KEYS: (keyof GeoCloneBranding)[] = ["brandName", "primaryColor", "accentColor", "secondaryColor", "logoUrl", "headingFont"];

export function resolveBranding(account: GeoCloneBranding, override: GeoCloneBranding | null | undefined): Resolved<GeoCloneBranding> {
  const o = override ?? {};
  const effective: GeoCloneBranding = {};
  const inherited: Record<string, boolean> = {};
  for (const k of BRAND_STR_KEYS) {
    const ov = o[k] as string | null | undefined;
    if (presentStr(ov)) { effective[k] = ov.trim(); inherited[k] = false; }
    else { effective[k] = (account[k] ?? null) as string | null; inherited[k] = true; }
  }
  return { effective, inherited };
}

const GOAL_KEYS: (keyof GeoCloneGoals)[] = ["conversionsAbsolute", "revenueAbsolute", "roasTarget", "cpaTarget"];

export function resolveGoals(account: GeoCloneGoals, override: GeoCloneGoals | null | undefined): Resolved<GeoCloneGoals> {
  const o = override ?? {};
  const effective: GeoCloneGoals = {};
  const inherited: Record<string, boolean> = {};
  for (const k of GOAL_KEYS) {
    const ov = o[k];
    if (presentNum(ov)) { effective[k] = ov; inherited[k] = false; }
    else { effective[k] = account[k] ?? null; inherited[k] = true; }
  }
  return { effective, inherited };
}

export function resolveEvent(account: GeoCloneEvent, override: GeoCloneEvent | null | undefined): Resolved<GeoCloneEvent> {
  const o = override ?? {};
  const inherited: Record<string, boolean> = {};
  const effective: GeoCloneEvent = {};

  if (presentStr(o.cadence)) { effective.cadence = o.cadence; inherited.cadence = false; }
  else { effective.cadence = account.cadence ?? null; inherited.cadence = true; }

  const oEd = (o.editions ?? []).filter((e) => presentStr(e.date));
  if (oEd.length > 0) { effective.editions = oEd; inherited.editions = false; }
  else { effective.editions = account.editions ?? []; inherited.editions = true; }

  return { effective, inherited };
}

// Alles-in-één: de volledige effectieve instellingen voor een geo-clone, met account-fallback
// per domein. De inherited-vlaggen zijn per domein beschikbaar voor de UI ("erft van account").
export interface ResolvedGeoCloneSettings {
  branding: Resolved<GeoCloneBranding>;
  goals: Resolved<GeoCloneGoals>;
  event: Resolved<GeoCloneEvent>;
}

export function resolveGeoCloneSettings(account: AccountSettings, override: GeoCloneSettings | null | undefined): ResolvedGeoCloneSettings {
  const o = override ?? {};
  return {
    branding: resolveBranding(account.branding, o.branding),
    goals: resolveGoals(account.goals, o.goals),
    event: resolveEvent(account.event, o.event),
  };
}
