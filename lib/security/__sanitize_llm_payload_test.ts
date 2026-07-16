// Verificatie van de SEC1 LLM-payload-sanitization.
// Draaien: npx tsx lib/security/__sanitize_llm_payload_test.ts

import { sanitizeLLMPayload } from "./sanitize-llm-payload";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// --- Secrets worden geredigeerd ---
console.log("Secrets worden geweerd");
const k = sanitizeLLMPayload("De sleutel is sk-or-v1-abcdef0123456789abcdef0123456789 in de config.");
check("openrouter-key geredigeerd", k.sanitized.includes("[REDACTED_SECRET]") && !k.sanitized.includes("sk-or-v1-"));
check("key telt als secret", k.report.redactedSecrets === 1 && !k.report.clean);

const jwt = sanitizeLLMPayload("token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N");
check("JWT geredigeerd", jwt.sanitized.includes("[REDACTED_SECRET]") && !jwt.sanitized.includes("eyJhbGci"));

const aws = sanitizeLLMPayload("Key AKIAIOSFODNN7EXAMPLE staat hier.");
check("AWS-key geredigeerd", aws.sanitized.includes("[REDACTED_SECRET]") && !aws.sanitized.includes("AKIA"));

const bearer = sanitizeLLMPayload("Authorization header: Bearer abcdefghijklmnopqrstuvwxyz123456");
check("bearer-token geredigeerd, Bearer behouden", bearer.sanitized.includes("Bearer [REDACTED_SECRET]") && !bearer.sanitized.includes("abcdefghijklmnop"));

const assign = sanitizeLLMPayload('config: { "api_key": "ABCD1234EFGH5678", "password": "geheimwachtwoord123" }');
check("api_key-waarde geredigeerd, sleutel behouden", assign.sanitized.includes("api_key") && !assign.sanitized.includes("ABCD1234EFGH5678"));
check("password-waarde geredigeerd", !assign.sanitized.includes("geheimwachtwoord123"));
check("twee toewijzingen geteld", assign.report.redactedSecrets === 2);

// --- E-mails worden gemaskeerd ---
console.log("\nE-mails worden gemaskeerd");
const mail = sanitizeLLMPayload("Contact: jan.jansen@bedrijf.nl voor vragen.");
check("e-mail gemaskeerd", mail.sanitized.includes("[EMAIL]") && !mail.sanitized.includes("@bedrijf.nl"));
check("e-mail telt", mail.report.maskedEmails === 1);

const noMail = sanitizeLLMPayload("Contact: jan.jansen@bedrijf.nl", { maskEmails: false });
check("e-mail blijft als maskEmails false", noMail.sanitized.includes("@bedrijf.nl") && noMail.report.clean);

// --- CRUCIAAL: echte analyse-inhoud blijft onaangeroerd ---
console.log("\nEchte analyse-inhoud blijft onaangeroerd (geen false positives)");
const analyse = "In campagne 'Brand - NL - Search' daalt de CTR. Zoekterm 'merknaam schoenen kopen' en product 'Model X Pro 2025' presteren stabiel. ROAS 4.2, CPA 12.50, conversies 340.";
const a = sanitizeLLMPayload(analyse);
check("analyse-tekst identiek", a.sanitized === analyse && a.report.clean, "sanitized week af van input");
check("rapport meldt schoon", a.report.clean && a.report.redactedSecrets === 0 && a.report.maskedEmails === 0);

// --- Schone tekst ---
console.log("\nSchone tekst geeft clean rapport");
const clean = sanitizeLLMPayload("Gewone prompt zonder gevoelige data.");
check("clean is true, tekst onveranderd", clean.report.clean && clean.sanitized === "Gewone prompt zonder gevoelige data.");

// --- Lege en niet-string input ---
const empty = sanitizeLLMPayload("");
check("lege string veilig", empty.report.clean && empty.sanitized === "");

// --- Extra-patroon optie ---
console.log("\nExtra-patroon optie werkt");
const extra = sanitizeLLMPayload("Klantcode KLANT-9988 hier.", { extraPatterns: [{ name: "klantcode", regex: /KLANT-\d+/g, replacement: "[KLANT]" }] });
check("extra-patroon toegepast", extra.sanitized.includes("[KLANT]") && extra.report.hits.some(h => h.name === "klantcode"));

// --- Gecombineerd: secret plus e-mail plus schone inhoud ---
console.log("\nGecombineerde payload");
const combo = sanitizeLLMPayload("Campagne 'Zomer 2025' loopt goed. Debug: token=XYZ123ABC456DEF789 en mail support@klant.nl.");
check("campagnenaam behouden", combo.sanitized.includes("Zomer 2025"));
check("secret en e-mail beide weg", !combo.sanitized.includes("XYZ123ABC456DEF789") && !combo.sanitized.includes("support@klant.nl"));
check("rapport telt beide", combo.report.redactedSecrets === 1 && combo.report.maskedEmails === 1);

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
