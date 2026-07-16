// W1.2 (O1): de eigen identiteit plus rol, voor de useRole-UI-gating. GET is
// viewer-niveau: elke ingelogde gebruiker mag de eigen rol zien. LIVE-ONGETEST tot WL.3.

import { requireUser } from "@/lib/auth/server";

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  return Response.json({ id: auth.id, email: auth.email, role: auth.role });
}
