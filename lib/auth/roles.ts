// W1.2 (O1): het pure autorisatiebeleid. Rollen en padclassificatie op EEN plek, los
// testbaar zonder omgeving. De middleware en de server-guards consumeren dit beleid;
// de enforcement zelf staat achter de O1_AUTH_ENFORCED-flag tot de gecoordineerde
// activatie in WL.3 (samen met migratie 017 en de eerste admin-seed).
//
// Rolmodel conform migratie 001_user_roles.sql en de O1-spec:
// viewer = alles lezen, niets muteren en geen runs starten;
// specialist = runs starten, settings en targets beheren, sprint muteren;
// admin = alles plus gebruikersbeheer en kanaal-koppelingen.

export type Role = "admin" | "specialist" | "viewer";

const ROLE_ORDER: Record<Role, number> = { viewer: 0, specialist: 1, admin: 2 };

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "specialist" || value === "viewer";
}

// Hogere rollen omvatten de rechten van lagere rollen.
export function hasRequiredRole(actual: Role | null | undefined, required: Role): boolean {
  if (!actual) return false;
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}

// Publieke paden: login, auth-callbacks, Next-internals en statische assets.
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/auth/")) return true;
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") return true;
  if (/\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$/i.test(pathname)) return true;
  return false;
}

// Cron-paden blijven op het bestaande CRON_SECRET-headerpatroon: de route valideert de
// header zelf (zie app/api/sync/cron/route.ts); de middleware laat ze daarom door.
export function isCronPath(pathname: string): boolean {
  return pathname === "/api/sync/cron" || pathname.startsWith("/api/sync/cron/");
}

// Gebruikersbeheer en kanaal-koppelingen zijn admin-only, ook voor lezen.
const ADMIN_PREFIXES = ["/api/admin", "/api/users", "/api/invite", "/api/connections"];

// De minimale rol per API-verzoek, conform de O1-spec: reads minimaal viewer; mutaties
// en run-starts minimaal specialist; admin-prefixen altijd admin. De middleware dwingt
// dit centraal af; requireRole blijft beschikbaar voor fijnmazige checks in routes.
export function minRoleForApi(pathname: string, method: string): Role {
  if (ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return "admin";
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return "viewer";
  return "specialist";
}
