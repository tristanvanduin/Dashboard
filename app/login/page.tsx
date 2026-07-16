"use client";

// W1.2 (O1): login met e-mail en wachtwoord. Invite-only: publieke signup staat uit in
// Supabase; accounts ontstaan via de admin-invite (vervolgstap 5e). Wachtwoord-vergeten
// stuurt de standaard Supabase-resetmail. LIVE-ONGETEST tot de WL.3-activatie.

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setMelding("Supabase is niet geconfigureerd.");
      return;
    }
    setBezig(true);
    setMelding(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBezig(false);
    if (error) {
      setMelding("Inloggen mislukt: controleer e-mail en wachtwoord.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next") || "/";
    window.location.href = next;
  }

  async function wachtwoordVergeten() {
    if (!supabase) {
      setMelding("Supabase is niet geconfigureerd.");
      return;
    }
    if (!email) {
      setMelding("Vul eerst je e-mailadres in.");
      return;
    }
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    setMelding("Als het adres bekend is, is er een resetmail verstuurd.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-gray-900">Inloggen</h1>
        <p className="mb-5 text-sm text-gray-500">Toegang is op uitnodiging.</p>
        <form onSubmit={login} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
              Wachtwoord
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          {melding && <p className="text-sm text-red-600">{melding}</p>}
          <button
            type="submit"
            disabled={bezig}
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {bezig ? "Bezig..." : "Inloggen"}
          </button>
        </form>
        <button
          type="button"
          onClick={wachtwoordVergeten}
          className="mt-4 text-sm text-gray-500 underline hover:text-gray-700"
        >
          Wachtwoord vergeten
        </button>
      </div>
    </div>
  );
}
