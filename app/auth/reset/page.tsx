"use client";

// W1.2 (O1): de wachtwoord-reset-landing. De resetmail en de invite-mail landen hier met
// een recovery-sessie; de gebruiker zet het nieuwe wachtwoord via updateUser. Publiek pad
// (isPublicPath dekt /auth/). LIVE-ONGETEST tot de WL.3-activatie.

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ResetPage() {
  const [password, setPassword] = useState("");
  const [herhaal, setHerhaal] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [klaar, setKlaar] = useState(false);
  const [bezig, setBezig] = useState(false);

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setMelding("Supabase is niet geconfigureerd.");
      return;
    }
    if (password.length < 8) {
      setMelding("Kies een wachtwoord van minimaal 8 tekens.");
      return;
    }
    if (password !== herhaal) {
      setMelding("De wachtwoorden komen niet overeen.");
      return;
    }
    setBezig(true);
    setMelding(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBezig(false);
    if (error) {
      setMelding("Opslaan mislukt: open de link uit de mail opnieuw en probeer het nog een keer.");
      return;
    }
    setKlaar(true);
  }

  if (klaar) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-gray-900">Wachtwoord ingesteld</h1>
          <p className="mb-4 text-sm text-gray-600">Je kunt nu inloggen met je nieuwe wachtwoord.</p>
          <a href="/login" className="text-sm font-medium text-gray-900 underline">Naar inloggen</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-gray-900">Nieuw wachtwoord</h1>
        <p className="mb-5 text-sm text-gray-500">Ingesteld via de link uit je mail.</p>
        <form onSubmit={opslaan} className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
              Nieuw wachtwoord
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
          <div>
            <label htmlFor="herhaal" className="mb-1 block text-sm font-medium text-gray-700">
              Herhaal wachtwoord
            </label>
            <input
              id="herhaal"
              type="password"
              required
              value={herhaal}
              onChange={(e) => setHerhaal(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          {melding && <p className="text-sm text-red-600">{melding}</p>}
          <button
            type="submit"
            disabled={bezig}
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {bezig ? "Bezig..." : "Opslaan"}
          </button>
        </form>
      </div>
    </div>
  );
}
