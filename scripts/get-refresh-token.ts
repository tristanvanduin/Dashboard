/**
 * One-time script to get a Google Ads refresh token.
 *
 * Usage:
 *   npx tsx scripts/get-refresh-token.ts
 *
 * It will:
 * 1. Start a tiny local server on port 3089
 * 2. Open your browser to the Google login page
 * 3. After you log in, Google redirects back to localhost
 * 4. The script catches the code and exchanges it for a refresh token
 */

import * as http from "http";
import { exec } from "child_process";

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET ?? "";
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Zet GOOGLE_ADS_CLIENT_ID en GOOGLE_ADS_CLIENT_SECRET in je omgeving (bijv. .env.local) voordat je dit script draait.",
  );
  process.exit(1);
}
const PORT = 3089;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`;

console.log("\n=== Google Ads Refresh Token Generator ===\n");
console.log("Browser wordt geopend voor Google login...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2>❌ Fout: ${error}</h2><p>Sluit dit venster en probeer opnieuw.</p>`);
    console.error(`\nFout van Google: ${error}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<p>Wachten op authorization code...</p>");
    return;
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const data = await tokenRes.json();

    if (data.error) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h2>❌ Token fout</h2><p>${data.error}: ${data.error_description}</p>`);
      console.error(`\nToken fout: ${data.error} — ${data.error_description}`);
      server.close();
      process.exit(1);
      return;
    }

    if (data.refresh_token) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <h2 style="color: green;">✅ Refresh token ontvangen!</h2>
        <p>Je kunt dit venster sluiten. Check je terminal voor het token.</p>
      `);

      console.log("✅ Refresh token succesvol ontvangen!\n");
      console.log("Voeg deze regel toe aan je .env.local:\n");
      console.log(`GOOGLE_ADS_REFRESH_TOKEN=${data.refresh_token}`);
      console.log("\nHerstart daarna de dev server (npm run dev).\n");
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>⚠️ Geen refresh token ontvangen</h2><p>Check de terminal.</p>");
      console.error("\nGeen refresh token. Response:", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2>❌ Fout</h2><p>${err}</p>`);
    console.error("\nRequest mislukt:", err);
  }

  server.close();
  setTimeout(() => process.exit(0), 500);
});

server.listen(PORT, () => {
  console.log(`Lokale server draait op http://localhost:${PORT}`);
  console.log("Browser openen...\n");

  // Open browser (macOS)
  exec(`open "${authUrl}"`);
});
