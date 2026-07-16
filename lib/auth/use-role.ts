"use client";

// W1.2 (O1, 5c): de UI-gating-hook. Comfort: knoppen voor runs, settings en sync
// verbergen onder viewer; de server-guard blijft de waarheid. Zonder sessie (of zolang
// de O1-flag uit staat) geeft /api/me een 401 en blijft de rol null.

import { useEffect, useState } from "react";
import type { Role } from "./roles";

export function useRole(): { role: Role | null; loading: boolean } {
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { role?: Role } | null) => {
        if (live) setRole(data?.role ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return { role, loading };
}
