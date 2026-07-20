// Gedeelde demo-mode-detectie: via ?demo=1 in de URL óf de env-flag NEXT_PUBLIC_DEMO_MODE.
// Puur voor review/presentatie zonder live data of keys. Eén bron zodat elke plek dezelfde
// beslissing neemt (Vandaag-feed, klantenlijst, data-invoerpunten).
export function isDemoMode(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return true;
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  } catch {
    return false;
  }
}
