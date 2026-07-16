// Test voor het pure O1-autorisatiebeleid (W1.2). Deterministisch, geen IO.
// Draaien: npx tsx lib/auth/__auth_roles_test.ts

import { hasRequiredRole, isRole, isPublicPath, isCronPath, minRoleForApi } from "./roles";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Rol-rangorde: hoger omvat lager
assert(hasRequiredRole("admin", "viewer") && hasRequiredRole("admin", "specialist") && hasRequiredRole("admin", "admin"), "admin mag alles");
assert(hasRequiredRole("specialist", "viewer") && hasRequiredRole("specialist", "specialist"), "specialist mag viewer- en specialist-acties");
assert(!hasRequiredRole("specialist", "admin"), "specialist mag geen admin-acties");
assert(hasRequiredRole("viewer", "viewer") && !hasRequiredRole("viewer", "specialist"), "viewer mag alleen lezen");
assert(!hasRequiredRole(null, "viewer") && !hasRequiredRole(undefined, "viewer"), "geen rol betekent geen toegang");

// isRole
assert(isRole("admin") && isRole("specialist") && isRole("viewer"), "de drie rollen zijn geldig");
assert(!isRole("owner") && !isRole("") && !isRole(null), "onbekende waarden zijn geen rol");

// Publieke paden
assert(isPublicPath("/login"), "/login is publiek");
assert(isPublicPath("/auth/callback") && isPublicPath("/auth/reset"), "auth-callbacks zijn publiek");
assert(isPublicPath("/_next/static/chunk.js") && isPublicPath("/favicon.ico"), "Next-internals zijn publiek");
assert(isPublicPath("/logo.png") && isPublicPath("/fonts/inter.woff2"), "statische assets zijn publiek");
assert(!isPublicPath("/") && !isPublicPath("/dashboard"), "de app zelf is niet publiek");
assert(!isPublicPath("/api/analysis/monthly"), "API-routes zijn niet publiek");
assert(!isPublicPath("/api/sync/cron"), "cron is geen publiek pad (eigen secret-patroon)");

// Cron-paden
assert(isCronPath("/api/sync/cron") && isCronPath("/api/sync/cron/daily"), "cron-paden herkend");
assert(!isCronPath("/api/sync") && !isCronPath("/api/sync/linkedin"), "gewone sync-routes zijn geen cron");

// Minimale rol per API-verzoek
assert(minRoleForApi("/api/clients", "GET") === "viewer", "lezen is minimaal viewer");
assert(minRoleForApi("/api/analysis/monthly", "POST") === "specialist", "een run starten is minimaal specialist");
assert(minRoleForApi("/api/settings", "PUT") === "specialist" && minRoleForApi("/api/sprint", "DELETE") === "specialist", "mutaties zijn minimaal specialist");
assert(minRoleForApi("/api/sync", "POST") === "specialist", "een sync starten is minimaal specialist");
assert(minRoleForApi("/api/admin/users", "POST") === "admin", "gebruikersbeheer is admin");
assert(minRoleForApi("/api/users", "GET") === "admin", "de gebruikerslijst is ook voor lezen admin");
assert(minRoleForApi("/api/connections/meta", "GET") === "admin", "kanaal-koppelingen zijn admin, ook lezen");
assert(minRoleForApi("/api/invite", "POST") === "admin", "uitnodigen is admin");

assert(minRoleForApi("/api/me", "GET") === "viewer", "/api/me is voor elke ingelogde gebruiker (viewer)");
assert(minRoleForApi("/api/admin/users", "PATCH") === "admin", "rol wijzigen is admin");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
