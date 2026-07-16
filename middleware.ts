// =====================================================================
// W1.2 (O1): centrale toegangscontrole. VEILIG TE MERGEN: zonder O1_AUTH_ENFORCED=true
// is dit een pass-through en verandert er niets aan de app. De activatie is een bewuste
// WL.3-stap, gecoordineerd met migratie 001 (user_roles plus eerste admin-seed) en 017
// (RLS-lockdown). LIVE-ONGETEST: sessies, cookies, redirects en de rol-lookup zijn pas
// tegen een echte Supabase-omgeving te verifieren.
// =====================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isPublicPath, isCronPath, minRoleForApi, hasRequiredRole, isRole } from "@/lib/auth/roles";

export async function middleware(request: NextRequest) {
  if (process.env.O1_AUTH_ENFORCED !== "true") return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Cron blijft op het bestaande CRON_SECRET-headerpatroon: de route valideert zelf.
  if (isCronPath(pathname)) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Enforcement zonder configuratie kan niet; expliciet loggen en doorlaten zodat een
    // misconfiguratie de app niet onzichtbaar plat legt.
    console.error("[middleware] O1_AUTH_ENFORCED staat aan maar Supabase-env ontbreekt");
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isApi = pathname.startsWith("/api/");
  if (!user) {
    if (isApi) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isApi) {
    const required = minRoleForApi(pathname, request.method);
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const role = isRole(roleRow?.role) ? roleRow.role : null;
    if (!hasRequiredRole(role, required)) {
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });
    }
  }

  return response;
}

export const config = {
  // Alles behalve de statische Next-assets; de fijnmazige uitzonderingen (login, auth,
  // bestanden, cron) zitten in het pure beleid hierboven.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
