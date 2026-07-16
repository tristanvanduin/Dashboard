// =====================================================================
// W1.2 (O1): server-side guards voor route-handlers. LIVE-ONGETEST: sessie-cookies en
// de rol-lookup zijn pas tegen een echte Supabase-omgeving te verifieren. De centrale
// enforcement zit in middleware.ts (achter de O1_AUTH_ENFORCED-flag); deze helpers zijn
// voor fijnmazige checks binnen routes, bijvoorbeeld admin-only sub-acties.
// =====================================================================

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { hasRequiredRole, isRole, type Role } from "./roles";

export interface AuthUser {
  id: string;
  email: string | null;
  role: Role | null;
}

// Leest de ingelogde gebruiker plus rol uit de sessie-cookies. Null zonder sessie of
// zonder Supabase-configuratie. De user_roles-read werkt onder RLS via de eigen-rij-policy
// uit migratie 001.
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Route-handlers muteren hier geen cookies; sessie-refresh doet de middleware.
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  return { id: user.id, email: user.email ?? null, role: isRole(roleRow?.role) ? roleRow.role : null };
}

// Geeft de gebruiker terug, of een 401-Response die de route direct kan returnen.
export async function requireUser(): Promise<AuthUser | Response> {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  return user;
}

// Geeft de gebruiker terug mits de rol volstaat, anders een 401- of 403-Response.
export async function requireRole(minRole: Role): Promise<AuthUser | Response> {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!hasRequiredRole(user.role, minRole)) {
    return Response.json({ error: "Onvoldoende rechten" }, { status: 403 });
  }
  return user;
}
