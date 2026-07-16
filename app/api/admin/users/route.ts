// =====================================================================
// W1.2 (O1, 5e): server-side gebruikersbeheer. Alle handlers staan ALTIJD achter
// requireRole("admin"), onafhankelijk van de O1_AUTH_ENFORCED-flag: gebruikersbeheer
// zonder auth is per definitie onveilig, dus deze route werkt pas zodra er ingelogde
// admins bestaan (seed via scripts/seed-first-admin.mjs). LIVE-ONGETEST: de invite-mail,
// ban en de admin-API vergen de echte Supabase-omgeving, en de reset-redirect moet in de
// Supabase-config als toegestane URL staan.
// =====================================================================

import { requireRole } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isRole } from "@/lib/auth/roles";

function adminUnavailable(): Response {
  return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
}

// Telt de huidige admins; de guards voorkomen dat de laatste admin zichzelf buitensluit.
async function countAdmins(admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<number> {
  const { count } = await admin
    .from("user_roles")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "admin");
  return count ?? 0;
}

export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: roleRows } = await admin.from("user_roles").select("user_id, role");
  const roleByUser = new Map((roleRows ?? []).map((row) => [String(row.user_id), String(row.role)]));

  const users = data.users.map((user) => ({
    id: user.id,
    email: user.email ?? null,
    role: roleByUser.get(user.id) ?? null,
    deactivated: Boolean((user as { banned_until?: string | null }).banned_until),
    lastSignIn: user.last_sign_in_at ?? null,
  }));
  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireRole("admin");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const body = (await request.json().catch(() => null)) as { email?: string; role?: string } | null;
  const email = body?.email?.trim();
  const role = body?.role;
  if (!email || !isRole(role)) {
    return Response.json({ error: "email en een geldige rol (admin, specialist of viewer) zijn verplicht" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/reset`,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const userId = data.user?.id ?? null;
  if (userId) {
    const { error: roleError } = await admin.from("user_roles").upsert({ user_id: userId, role });
    if (roleError) return Response.json({ error: roleError.message }, { status: 500 });
  }
  return Response.json({ ok: true, userId });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const body = (await request.json().catch(() => null)) as { userId?: string; role?: string } | null;
  const userId = body?.userId;
  const role = body?.role;
  if (!userId || !isRole(role)) {
    return Response.json({ error: "userId en een geldige rol zijn verplicht" }, { status: 400 });
  }

  if (role !== "admin") {
    const { data: current } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    if (current?.role === "admin" && (await countAdmins(admin)) <= 1) {
      return Response.json({ error: "De laatste admin kan niet gedegradeerd worden" }, { status: 400 });
    }
  }

  const { error } = await admin.from("user_roles").upsert({ user_id: userId, role });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireRole("admin");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const body = (await request.json().catch(() => null)) as { userId?: string } | null;
  const userId = body?.userId;
  if (!userId) return Response.json({ error: "userId is verplicht" }, { status: 400 });
  if (userId === auth.id) {
    return Response.json({ error: "Je kunt jezelf niet deactiveren" }, { status: 400 });
  }

  const { data: current } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (current?.role === "admin" && (await countAdmins(admin)) <= 1) {
    return Response.json({ error: "De laatste admin kan niet gedeactiveerd worden" }, { status: 400 });
  }

  // Deactiveren via een lange ban: omkeerbaar, in tegenstelling tot verwijderen.
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
