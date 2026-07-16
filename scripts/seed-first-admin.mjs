// W1.2 (O1, 5a): eenmalig seed-script voor de eerste admin.
// Gebruik: SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-first-admin.mjs jouw@email.nl
// Bestaat de gebruiker nog niet, dan gaat er een uitnodiging uit; daarna (of bij een
// bestaande gebruiker) wordt de admin-rol geupsert in user_roles.
// Bewust in scripts/ (eenmalig admin-script), NIET in scripts/migrations/ (geen migratie).
// LIVE-ONGETEST: vergt de echte Supabase-omgeving en migratie 001.

import { createClient } from "@supabase/supabase-js";

const email = process.argv[2] || process.env.SEED_ADMIN_EMAIL;
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !url || !key) {
  console.error("Gebruik: SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-first-admin.mjs jouw@email.nl");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) {
  console.error("listUsers faalde:", listError.message);
  process.exit(1);
}

let user = list.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());

if (!user) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
  if (error) {
    console.error("Uitnodigen faalde:", error.message);
    process.exit(1);
  }
  user = data.user;
  console.log(`Uitnodiging verstuurd naar ${email}`);
}

const { error: roleError } = await admin.from("user_roles").upsert({ user_id: user.id, role: "admin" });
if (roleError) {
  console.error("user_roles upsert faalde:", roleError.message);
  process.exit(1);
}
console.log(`Admin-rol gezet voor ${email} (${user.id})`);
