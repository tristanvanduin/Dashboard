"use client";

// W1.2 (O1, 5e): admin-beheer. De server-side API (app/api/admin/users, altijd achter
// requireRole admin) is de waarheid; deze pagina is de bediening: gebruikerslijst met
// rol wijzigen en deactiveren, plus uitnodigen met rolkeuze. LIVE-ONGETEST tot WL.3.

import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/lib/auth/roles";

interface AdminUser {
  id: string;
  email: string | null;
  role: Role | null;
  deactivated: boolean;
  lastSignIn: string | null;
}

const ROLES: Role[] = ["viewer", "specialist", "admin"];

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [laden, setLaden] = useState(true);
  const [melding, setMelding] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("specialist");
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    setLaden(true);
    const res = await fetch("/api/admin/users");
    if (res.status === 401 || res.status === 403) {
      setMelding("Log in als admin om gebruikers te beheren.");
      setUsers([]);
      setLaden(false);
      return;
    }
    const data = (await res.json().catch(() => null)) as { users?: AdminUser[]; error?: string } | null;
    if (!res.ok) {
      setMelding(data?.error ?? "Laden mislukt.");
      setLaden(false);
      return;
    }
    setUsers(data?.users ?? []);
    setMelding(null);
    setLaden(false);
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    setBezig(false);
    if (!res.ok) {
      setMelding(data?.error ?? "Uitnodigen mislukt.");
      return;
    }
    setMelding(`Uitnodiging verstuurd naar ${inviteEmail}.`);
    setInviteEmail("");
    void laad();
  }

  async function wijzigRol(userId: string, role: Role) {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setMelding(data?.error ?? "Rol wijzigen mislukt.");
      return;
    }
    setMelding(null);
    void laad();
  }

  async function deactiveer(userId: string, email: string | null) {
    if (!window.confirm(`Weet je zeker dat je ${email ?? "deze gebruiker"} wilt deactiveren?`)) return;
    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setMelding(data?.error ?? "Deactiveren mislukt.");
      return;
    }
    setMelding(null);
    void laad();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Gebruikersbeheer</h1>
      <p className="mb-6 text-sm text-gray-500">
        Uitnodigen, rollen wijzigen en deactiveren. Alleen voor admins.
      </p>

      <form onSubmit={invite} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="grow">
          <label htmlFor="invite-email" className="mb-1 block text-sm font-medium text-gray-700">
            E-mail uitnodigen
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="invite-role" className="mb-1 block text-sm font-medium text-gray-700">
            Rol
          </label>
          <select
            id="invite-role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={bezig}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {bezig ? "Bezig..." : "Uitnodigen"}
        </button>
      </form>

      {melding && <p className="mb-4 text-sm text-red-600">{melding}</p>}

      {laden ? (
        <p className="text-sm text-gray-500">Laden...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">E-mail</th>
                <th className="px-4 py-2 font-medium">Rol</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-900">{user.email ?? user.id}</td>
                  <td className="px-4 py-2">
                    <select
                      value={user.role ?? ""}
                      onChange={(e) => void wijzigRol(user.id, e.target.value as Role)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
                    >
                      {user.role === null && <option value="">geen rol</option>}
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{user.deactivated ? "gedeactiveerd" : "actief"}</td>
                  <td className="px-4 py-2 text-right">
                    {!user.deactivated && (
                      <button
                        type="button"
                        onClick={() => void deactiveer(user.id, user.email)}
                        className="text-sm text-red-600 underline hover:text-red-700"
                      >
                        Deactiveren
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Geen gebruikers zichtbaar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
