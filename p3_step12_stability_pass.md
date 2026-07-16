# P3 Step 12 Stability Pass

## 1. Scope
- Deterministic: deze pass pakt alleen de Step 12 runtime-blocker aan die de vorige P3-rerun blokkeerde.
- Deterministic: geen wijzigingen aan save-path, acceptance, Germany-thread selection of executive synthese buiten wat nodig was om de Step 12 runtime-variant te stabiliseren.

## 2. Onderzochte bestanden
- [app/api/analysis/monthly/route.ts](/Users/juulr/Desktop/dashboard/app/api/analysis/monthly/route.ts)
  - Step 12 runtime-flow, parse/salvage, availability-injectie en validation-entrypoint.
- [lib/analysis/step-validator.ts](/Users/juulr/Desktop/dashboard/lib/analysis/step-validator.ts)
  - Exacte invalid-redenen voor Step 12.
- [lib/analysis/data-availability.ts](/Users/juulr/Desktop/dashboard/lib/analysis/data-availability.ts)
  - Availability truth voor checkout/schedule/network.
- [lib/prompts/monthly-v2.ts](/Users/juulr/Desktop/dashboard/lib/prompts/monthly-v2.ts)
  - Step 12 promptcontract; alleen gelezen, niet gewijzigd.
- [lib/analysis/helpers.ts](/Users/juulr/Desktop/dashboard/lib/analysis/helpers.ts)
  - `runStep` save-gedrag; alleen gelezen, niet gewijzigd.
- `/tmp/p3-monthly-success.json`
  - Mislukte P3-rerun met Step 12 invalid.
- `/tmp/p2-monthly-rerun.json`
  - Laatst bekende groene Step 12 referentie.
- `/tmp/p3-step12-live.json`
  - Nieuwe live rerun na de fix.

## 3. Exacte failure-analyse
- Deterministic: de mislukte P3-rerun faalde niet op een inhoudelijk checkout/schedule/network-conflict, maar op een lege Step 12 model-output.
- Deterministic: bewijs uit `/tmp/p3-monthly-success.json`:
  - `steps[12].outputLength = 0`
  - `stepValidations[12].valid = false`
  - `stepValidations[12].errors = ["Geen JSON-object gevonden in step output"]`
  - `structured.saved = false`
- Deterministic: de generation job eindigde met:
  - `status = failed`
  - `current_phase = save_outputs`
  - `error_message = "Step 12 is invalid en mag niet door naar structured save/export."`
- Deterministic: dit betekent dat de pipeline stukging op parse/salvage vóór structured save, niet op save-path zelf.
- Inferred: de meest waarschijnlijke oorzaak was stochastic model drift / lege provider-response, niet een P3-regressie in de root-cause code.
  - Onderbouwing:
    - eerdere groene runs hadden een gevulde Step 12 met geldige JSON;
    - de mislukte rerun had exact een lege string;
    - er was geen nieuwe inhoudelijke validatorerror behalve `Geen JSON-object gevonden in step output`.

## 4. Verschil tussen mislukte en succesvolle Step 12
- Deterministic: mislukte rerun (`/tmp/p3-monthly-success.json`)
  - output: `""`
  - validatie: `valid = false`
  - error: `Geen JSON-object gevonden in step output`
  - gevolg: alleen `quality_gate_monthly_v2` werd nieuw weggeschreven; geen nieuwe `full` of `structured_monthly_v2`.
- Deterministic: laatst bekende succesvolle referentie (`/tmp/p2-monthly-rerun.json`)
  - Step 12 output was gevuld JSON
  - validatie: `valid = true`
  - warnings alleen step-purity / cross-ref
  - acceptance: `passed = true`
  - quality gate: `passed = true`
- Deterministic: nieuwe live rerun (`/tmp/p3-step12-live.json`)
  - Step 12 output length: `4531`
  - validatie: `valid = true`
  - errors: `[]`
  - warnings: alleen niet-blocking purity/cross-ref warnings
  - acceptance: `passed = true`
  - quality gate: `passed = true`

## 5. Minimale fix
- Gewijzigd: [app/api/analysis/monthly/route.ts](/Users/juulr/Desktop/dashboard/app/api/analysis/monthly/route.ts)
- Deterministic: toegevoegd:
  - `shouldRepairStep12Runtime(step, validation)`
  - `buildStep12RepairUserMessage(...)`
- Deterministic: nieuw gedrag:
  - alleen voor Step 12;
  - alleen wanneer de output leeg is of de parser exact faalt op `Geen JSON-object gevonden in step output`;
  - dan wordt Step 12 één keer opnieuw uitgevoerd met een striktere herstelinstructie en `jsonMode: true`.
- Deterministic: dit is een smalle runtime-repair voor exact de bewezen failure-variant.
- Deterministic: niet aangepast:
  - save-path logica
  - acceptance/quality-gate regels
  - Germany-thread scoring
  - executive root-cause synthese

## 6. Tests
- Deterministic: `npx tsc --noEmit` — passed
- Deterministic: `npx tsx lib/__tests__/monthly-route-step12.test.ts` — passed
- Deterministic: `npx tsx lib/__tests__/monthly-sop-quality.test.ts` — passed (`88 passed / 0 failed`)
- Deterministic: `npx tsx lib/__tests__/monthly-structured.test.ts` — passed (`72 passed / 0 failed`)
- Deterministic: `npx tsx lib/__tests__/monthly-sop-export.test.ts` — passed (`16 passed / 0 failed`)

Nieuwe regressietest:
- [lib/__tests__/monthly-route-step12.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-route-step12.test.ts)
  - empty Step 12 output triggert repair
  - malformed non-JSON output triggert repair
  - geldige Step 12 output triggert repair niet
  - andere stappen triggeren repair niet

## 7. Live rerun
Case:
- `client_id = gads-3853096192`
- `job_id = 49df4614-0585-49a1-b013-3dcddefa8ca7`

Commands:
```bash
curl -sS -X POST http://localhost:3000/api/analysis/monthly/prepare \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"gads-3853096192"}'

curl -sS -X POST http://localhost:3000/api/analysis/monthly \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"gads-3853096192","job_id":"49df4614-0585-49a1-b013-3dcddefa8ca7"}'

curl -sS -D /tmp/p3-step12-pdf.headers \
  -o /tmp/p3-step12-pdf.pdf \
  'http://localhost:3000/api/analysis/pdf?client_id=gads-3853096192&sop_type=monthly&client_name=gads-3853096192'
```

Resultaat:
- Deterministic: prepare — `200`
- Deterministic: monthly — `200`
- Deterministic: `structured.saved = true`
- Deterministic: `structured.acceptance.passed = true`
- Deterministic: `structured.qualityGate.state = "passed"`
- Deterministic: `invalid_steps = []`
- Deterministic: Step 12 validatie:
  - `valid = true`
  - `errors = []`
- Deterministic: PDF export — `200`
- Deterministic: PDF grootte — `163475 bytes`

Live save receipts:
- Deterministic: `quality_gate_monthly_v2`
  - `id = c64de4a9-e018-4182-837f-6d3b6021ecfc`
  - `created_at = 2026-04-16T07:21:24.021+00:00`
- Deterministic: `full`
  - `id = 7fec232f-2bd4-45a7-8318-2c4e1e226dac`
  - `created_at = 2026-04-16T07:21:24.188+00:00`
- Deterministic: `structured_monthly_v2`
  - `id = 04d57b5b-7f6d-4385-9f97-a4bbddd62d96`
  - `created_at = 2026-04-16T07:21:24.449+00:00`

## 8. Wat nu hard bewezen is
- Deterministic: de vorige mislukte P3-rerun faalde op een lege Step 12 output, niet op save-path of een nieuwe executive regressie.
- Deterministic: de nieuwe fix is smal en gericht op exact die runtime-variant.
- Deterministic: er is weer een groene live monthly rerun.
- Deterministic: save receipts voor `quality_gate_monthly_v2`, `full` en `structured_monthly_v2` staan weer overeind.
- Deterministic: Germany-thread continuity bleef intact in de verse stored `structured_monthly_v2` row:
  - primary thread: `Geo-allocatie rond Land: DE is uit balans.`
  - root cause: `Duitsland absorbeert 31.6% van het budget tegen een onacceptabele ROAS van 0.83x en CPA van €24.51.`
  - recommendations: alle drie op `Duitsland`
  - tasks: alle operator-taken blijven op `Duitsland`
- Deterministic: P3-root-cause beoordeling kan nu pas weer geldig gebeuren, omdat er weer een geslaagde full + structured save bestaat na de mislukte rerun.

## 9. Wat nog niet bewezen is
- Deterministic: in deze pass is niet live bewezen dat de Step 12 repair branch daadwerkelijk geactiveerd moest worden in de succesvolle rerun.
  - De succesvolle rerun kwam direct groen door; de repair is dus regressietest-gedekt, maar niet live getriggerd.
- Inferred: dit is acceptabel voor deze ronde, omdat het doel was de blocker te stabiliseren en weer een groene live rerun te krijgen, niet om kunstmatig een lege provider-response uit te lokken.

## 10. Beste volgende stap
- Deterministic: hervat nu pas de inhoudelijke P3 root-cause quality pass.
- Concreet:
  - gebruik de verse `structured_monthly_v2` row `04d57b5b-7f6d-4385-9f97-a4bbddd62d96` als nieuwe live basis;
  - beoordeel daarna pas of de executive root-cause sentence nog verdere kwaliteitsverbetering nodig heeft.
