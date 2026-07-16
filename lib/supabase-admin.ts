// W1.2 (O1): de server-side service-role client voor admin-operaties (gebruikersbeheer,
// invites, ban). UITSLUITEND server-side importeren: de service-role key mag nooit in een
// client component of NEXT_PUBLIC-variabele belanden (de 5d-preflight bevestigde: geen lek).
// De bestaande routes houden hun eigen inline client (hete-bestanden-discipline); nieuwe
// server-side admin-code gebruikt deze helper.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
