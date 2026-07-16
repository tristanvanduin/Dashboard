# P0 Monthly SOP Pass

## 1. Scope
- Deterministic: aangepakt zijn alleen `P0-1` invalid-step blocking, `P0-2` acceptance blocking, `P0-3` prepared-context coverage truth, `P0-4` decision-rule hygiene en `P0-5` thread/recommendation continuity.
- Deterministic: geen brede refactor, geen promptverbreding en geen nieuwe P2/P3-scope toegevoegd.

## 2. Gewijzigde bestanden
- `app/api/analysis/monthly/route.ts`
  - Quality-gate toegevoegd vóór `full` / `structured_monthly_v2` save.
  - Nieuwe `quality_gate_monthly_v2` section wordt altijd opgeslagen.
  - Route geeft nu `422` terug bij blocked quality runs.
  - Coverage truth gebruikt nu prepared-context aware availability voor campaign/adgroup.
- `app/api/analysis/pdf/route.ts`
  - Monthly PDF-route leest eerst `quality_gate_monthly_v2`.
  - PDF export blokkeert nu met `409` als de laatste monthly quality gate `passed: false` heeft.
- `lib/analysis/monthly-acceptance.ts`
  - Acceptance kijkt nu ook naar invalid official step outputs.
  - `buildMonthlyQualityGate()` toegevoegd voor expliciete blocking state.
- `lib/analysis/monthly-structured.ts`
  - Decision-rule condition sanitizing gecentraliseerd.
  - Acroniem-hygiëne voor `ROAS` / `CPA` hersteld.
  - Final recommendation selectie prioriteert nu primary-thread / primary-surface beter.
  - Action-to-cluster matching gebruikt nu surface/domain cues om side-thread hijacks te verminderen.
- `lib/analysis/decision-rules.ts`
  - Binding-facts string rendering opgeschoond zodat kapotte separators en rommelige tekst niet meer doorlekken.
- `lib/analysis/step-validator.ts`
  - `isBlockingStepValidation()` toegevoegd voor expliciete blocking semantics.
- `lib/__tests__/decision-rules.test.ts`
  - Hygiene-regressie toegevoegd voor schone binding-facts rendering.
- `lib/__tests__/monthly-sop-quality.test.ts`
  - Nieuwe regressies voor quality gate, prepared-context coverage truth, continuity en metric acronym hygiene.

## 3. Implementatiedetails per P0

### P0-1 — Invalid step outputs mogen niet meer stilletjes door
- Probleem
  - Deterministic: `valid: false` steps gingen nog steeds door naar een normale monthly success-flow.
- Oorzaak
  - Deterministic: step validation werd alleen gelogd in `app/api/analysis/monthly/route.ts`.
- Oplossing
  - Deterministic: official step-validations (1-13) gaan nu door `buildMonthlyQualityGate()`.
  - Deterministic: bij een invalid final step stopt de route vóór `full` en `structured_monthly_v2`.
  - Deterministic: de route schrijft wel een expliciete `quality_gate_monthly_v2` diagnostic row en returned `422`.
- Trade-off
  - Deterministic: meer runs zullen nu zichtbaar falen in plaats van stilletjes slechte output op te slaan.

### P0-2 — Acceptance=false mag niet meer “groen” doorlopen
- Probleem
  - Deterministic: acceptance `passed: false` was advisory.
- Oorzaak
  - Deterministic: acceptance report werd niet gebruikt als blocking gate.
- Oplossing
  - Deterministic: acceptance bevat nu ook `AC-15` voor invalid final steps.
  - Deterministic: `buildMonthlyQualityGate()` blokkeert nu ook runs met acceptance failure, zelfs zonder invalid step.
  - Deterministic: `full`, `structured_monthly_v2`, downstream insights/recommendations/tasks en PDF-export zijn niet langer onderdeel van een groene flow als quality gate faalt.
- Trade-off
  - Deterministic: functionele run en kwalitatief geslaagde run zijn nu expliciet gescheiden.

### P0-3 — Coverage truth bij prepared context
- Probleem
  - Deterministic: coverage kon `campaign` als unavailable markeren terwijl campaign-signalen via prepared context of meta-data wel degelijk aanwezig waren.
- Oorzaak
  - Deterministic: availability keek te smal naar `campaignData.length > 0`.
- Oplossing
  - Deterministic: `buildCoverageDimensionAvailability()` gebruikt nu raw campaign rows, campaign meta-data en prepared campaign/adgroup comparison facts.
- Trade-off
  - Deterministic: truth is hersteld in de canonical coverage-laag zelf, niet alleen in de tekstweergave.

### P0-4 — Decision-rule string hygiene
- Probleem
  - Deterministic: malformed of lelijk gecomposeerde beslisregels konden doorlekken.
- Oorzaak
  - Deterministic: string composition in de final recommendation layer stripte lead-ins onvolledig en kon acroniemen beschadigen.
- Oplossing
  - Deterministic: `sanitizeDecisionCondition()` centraliseert de condition-cleanup.
  - Deterministic: route-fragmenten zoals `Continueer alleen als ...` / `Ga alleen door ...` worden nu eerst gestript en daarna schoon heropgebouwd.
  - Deterministic: `ROAS` / `CPA` blijven nu intact en worden niet meer `rOAS` / `cPA`.
  - Deterministic: binding-facts rendering is opgeschoond tegen dubbele separators en rommelige spacing.
- Trade-off
  - Deterministic: geen inhoudelijke rankingwijziging; alleen structurele teksthygiëne.

### P0-5 — Thread / recommendation continuity
- Probleem
  - Deterministic: aanbevelingen en tasks konden op een ander business surface landen dan de primary thread.
- Oorzaak
  - Deterministic: promoted step-actions konden te makkelijk een cluster claimen op basis van campaign-name overlap; final recommendation selection kon daarna op de verkeerde surface landen.
- Oplossing
  - Deterministic: action-to-cluster matching gebruikt nu ook action domains en intent-match.
  - Deterministic: final recommendation selection prefereert eerst de echte primary-thread / primary-cluster surface, daarna pas bredere fallbacks.
- Trade-off
  - Inferred: continuity is aantoonbaar beter, maar de ranking-theorie is nog niet “af”.

## 4. Tests
- Deterministic: `npx tsc --noEmit` — passed
- Deterministic: `npx tsx lib/__tests__/decision-rules.test.ts` — passed (`9 passed / 0 failed`)
- Deterministic: `npx tsx lib/__tests__/thread-synthesis.test.ts` — passed (`4 passed / 0 failed`)
- Deterministic: `npx tsx lib/__tests__/monthly-structured.test.ts` — passed (`72 passed / 0 failed`)
- Deterministic: `npx tsx lib/__tests__/monthly-sop-quality.test.ts` — passed (`78 passed / 0 failed`)
- Deterministic: `npx tsx lib/__tests__/monthly-sop-export.test.ts` — passed (`16 passed / 0 failed`)

Nieuwe of aangepaste regressies:
- Deterministic: invalid-step quality gate blokkeert.
- Deterministic: prepared-context campaign coverage blijft `true`.
- Deterministic: final recommendation surface blijft beter aligned met dominante thread.
- Deterministic: decision rules behouden metric acronyms schoon.
- Deterministic: binding-facts rendering blijft separator-clean.

## 5. Live rerun

### Commands
- Deterministic: prepare run
```bash
set -a
source .env.local
set +a
npx tsx <<'TS'
import { NextRequest } from 'next/server';
import prepareRoute from './app/api/analysis/monthly/prepare/route.ts';
const req = new NextRequest('http://localhost:3000/api/analysis/monthly/prepare', {
  method: 'POST',
  body: JSON.stringify({ client_id: 'gads-3853096192' }),
  headers: { 'content-type': 'application/json' },
});
const res = await prepareRoute.POST(req);
console.log(await res.text());
TS
```

- Deterministic: monthly run
```bash
set -a
source .env.local
set +a
npx tsx <<'TS'
import { NextRequest } from 'next/server';
import monthlyRoute from './app/api/analysis/monthly/route.ts';
const req = new NextRequest('http://localhost:3000/api/analysis/monthly', {
  method: 'POST',
  body: JSON.stringify({
    client_id: 'gads-3853096192',
    job_id: '6e4a3fd2-2af5-4703-8d55-737665f0f6fb'
  }),
  headers: { 'content-type': 'application/json' },
});
const res = await monthlyRoute.POST(req);
console.log(res.status);
console.log(await res.text());
TS
```

- Deterministic: PDF run
```bash
set -a
source .env.local
set +a
npx tsx <<'TS'
import { NextRequest } from 'next/server';
import pdfRoute from './app/api/analysis/pdf/route.ts';
const req = new NextRequest('http://localhost:3000/api/analysis/pdf?client_id=gads-3853096192&sop_type=monthly&client_name=Audit+Client&job_id=19883fb0-81b8-44be-8ef2-0f5f8e6cd7ee', {
  method: 'GET',
});
const res = await pdfRoute.GET(req);
console.log(res.status);
console.log(await res.text());
TS
```

### Resultaat
- Deterministic: prepare run slaagde
  - `prepared_context_id = 65969dd9-51b1-4c79-9086-16e2afa2798f`
  - `analysis_date = 2026-03-30`
- Deterministic: monthly run gaf nu `422`
  - `qualityGate.passed = false`
  - `qualityGate.state = blocked_invalid_steps`
  - `invalid_steps = [12]`
- Deterministic: step 12 is nog steeds invalid
  - errors:
    - `Evidence-level "deterministic" ... terwijl het narratief aangeeft dat data niet beschikbaar is`
- Deterministic: acceptance faalt nog steeds
  - `AC-03` faalt op `31 unieke bevindingen`
  - `AC-15` faalt op `Invalid steps: 12`
- Deterministic: structured save gebeurt niet meer als groene output
  - response: `structured.saved = false`
  - response: `fullOutput = null`
- Deterministic: er is wel een nieuwe `quality_gate_monthly_v2` row opgeslagen
  - created_at: `2026-04-15T13:52:45.938743+00:00`
- Deterministic: er is géén nieuwe `full` of `structured_monthly_v2` row weggeschreven voor deze failed rerun
  - latest `full`: `2026-04-15T07:06:24.494775+00:00`
  - latest `structured_monthly_v2`: `2026-04-15T07:06:24.643131+00:00`
- Deterministic: PDF export blokkeert nu correct
  - status `409`
  - error: `Monthly PDF export geblokkeerd: Step 12 is invalid en mag niet door naar structured save/export.`

### Inhoudelijke checks op de rerun
- Deterministic: coverage truth is hersteld
  - `campaign.data_available = true`
  - `campaign.status = covered`
  - `campaign.findings_surfaced = 8`
- Deterministic: decision-rule strings zijn schoon opgebouwd
  - voorbeeld reconstructie:
    - `Houd deze route alleen aan als ROAS binnen de meetperiode verbetert; ...`
    - `Continueer alleen als ROAS binnen 1-2 weken aantoonbaar verbetert; ...`
    - `Continueer schaal alleen als CPA blijft stabiel of verbetert gedurende minimaal 7 dagen vóór extra schaal; ...`
- Deterministic: thread → recommendation continuity is strakker op dezelfde surface
  - reconstructie van de blocked run laat zien:
    - `primaryThread = "Geo-allocatie rond Ad group: DE (Shopping-bleeder_RM) is uit balans."`
    - alle final recommendation objects wijzen naar `Duitsland`
- Inferred: continuity is beter dan in het auditrapport, maar de primary thread blijft nog erg smal op `DE (Shopping-bleeder_RM)` in plaats van een bredere Germany-surface.

## 6. Wat nu aantoonbaar beter is
- Deterministic: invalid final steps eindigen niet meer in een normale full/structured export-flow.
- Deterministic: acceptance failure kan niet meer geruisloos doorlopen als groene monthly deliverable.
- Deterministic: PDF export kan een mislukte quality run niet meer verhullen met een oude of schijnbaar geslaagde export.
- Deterministic: coverage truth voor `campaign` klopt weer bij prepared-context gebruik.
- Deterministic: decision-rule strings zijn opgeschoond en houden metric acronyms intact.
- Deterministic: recommendation objects blijven bij de live blocked rerun op hetzelfde business surface als de dominante geo-thread.

## 7. Wat nog niet goed genoeg is
- Deterministic: step 12 blijft invalid door no-data versus deterministic-evidence conflict.
- Deterministic: acceptance blijft nog failen op `31` unieke findings.
- Inferred: thread continuity is beter, maar de primaire geo-framing kan nog te smal op adgroup-niveau landen.
- Inferred: er zijn nog veel warnings op step purity en math consistency; die blokkeren nu niet als de step formeel valid blijft.

## 8. Beste volgende stap
- Inferred: de beste volgende stap is nu geen brede refactor, maar een tweede gerichte kwaliteitspass op de echte resterende blockers:
  - step 12 no-data/evidence conflict hard oplossen
  - finding-volume terug onder acceptance-threshold brengen
  - geo-thread van `DE (Shopping-bleeder_RM)` verbreden naar stabieler Germany-surface waar dat inhoudelijk gerechtvaardigd is
