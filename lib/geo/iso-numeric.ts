// world-atlas identificeert landen met hun numerieke ISO 3166-1-code (feature.id, bv. 528 = NL),
// terwijl onze ad-data alpha-2-codes gebruikt (NL, US, CA). Deze tabel koppelt numeriek → alpha-2
// voor de belangrijkste markten (EU/EEA + Noord/Zuid-Amerika + grote APAC/MEA). Landen die hier
// niet in staan kleuren simpelweg niet mee op de kaart (ze blijven in de tabel eronder zichtbaar).
// Sleutels zonder voorloopnullen; de kaart normaliseert feature.id met String(Number(id)).

export const NUMERIC_TO_ALPHA2: Record<string, string> = {
  "528": "NL", "840": "US", "124": "CA", "826": "GB", "372": "IE", "276": "DE", "250": "FR",
  "56": "BE", "442": "LU", "380": "IT", "724": "ES", "620": "PT", "40": "AT", "756": "CH",
  "752": "SE", "578": "NO", "208": "DK", "246": "FI", "616": "PL", "203": "CZ", "703": "SK",
  "348": "HU", "642": "RO", "100": "BG", "300": "GR", "191": "HR", "705": "SI", "233": "EE",
  "428": "LV", "440": "LT", "352": "IS", "470": "MT", "196": "CY", "484": "MX", "76": "BR",
  "32": "AR", "152": "CL", "170": "CO", "156": "CN", "392": "JP", "356": "IN", "36": "AU",
  "554": "NZ", "702": "SG", "410": "KR", "344": "HK", "784": "AE", "682": "SA", "376": "IL",
  "792": "TR", "710": "ZA", "818": "EG", "504": "MA", "643": "RU", "804": "UA",
};
