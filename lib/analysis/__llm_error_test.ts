// Verificatie van de SEC3 LLM-fout-classificatie.
// Draaien: npx tsx lib/analysis/__llm_error_test.ts

import { classifyLLMError } from "./llm-error";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

function mk(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

console.log("Fouttypes correct geclassificeerd");
const abort = classifyLLMError(mk("AbortError", "The operation was aborted"));
check("AbortError is timeout, retrybaar", abort.type === "timeout" && abort.retryable === true);

check("401 is auth, niet retrybaar", (() => { const c = classifyLLMError(new Error("OpenRouter 401: invalid key")); return c.type === "auth" && c.retryable === false; })());
check("403 is permission, niet retrybaar", (() => { const c = classifyLLMError(new Error("OpenRouter 403: forbidden")); return c.type === "permission" && c.retryable === false; })());
check("429 is rate_limit, retrybaar", (() => { const c = classifyLLMError(new Error("OpenRouter 429: too many requests")); return c.type === "rate_limit" && c.retryable === true; })());
check("400 is bad_request, niet retrybaar", (() => { const c = classifyLLMError(new Error("OpenRouter 400: bad payload")); return c.type === "bad_request" && c.retryable === false; })());
check("422 is bad_request, niet retrybaar", (() => { const c = classifyLLMError(new Error("OpenRouter 422: unprocessable")); return c.type === "bad_request" && c.retryable === false; })());
check("500 is provider, retrybaar", (() => { const c = classifyLLMError(new Error("OpenRouter 500: server error")); return c.type === "provider" && c.retryable === true; })());
check("503 is provider, retrybaar", (() => { const c = classifyLLMError(new Error("OpenRouter 503: unavailable")); return c.type === "provider" && c.retryable === true; })());

const net = classifyLLMError(mk("TypeError", "fetch failed"));
check("fetch failed is network, retrybaar", net.type === "network" && net.retryable === true);
const econn = classifyLLMError(new Error("connect ECONNREFUSED 127.0.0.1:443"));
check("ECONNREFUSED is network, retrybaar", econn.type === "network" && econn.retryable === true);

const unknown = classifyLLMError(new Error("iets onverwachts"));
check("onbekende fout is unknown, retrybaar (gedrag behouden)", unknown.type === "unknown" && unknown.retryable === true);

const nonError = classifyLLMError("gewone string");
check("niet-Error input veilig", nonError.type === "unknown");

console.log("\nGebruikersboodschappen zijn Nederlands en niet-leeg");
for (const m of ["OpenRouter 401: x", "OpenRouter 429: x", "OpenRouter 500: x", "fetch failed"]) {
  const c = classifyLLMError(m === "fetch failed" ? mk("TypeError", m) : new Error(m));
  check("boodschap gevuld voor " + c.type, c.userMessage.length > 10);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
