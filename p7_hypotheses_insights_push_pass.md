# P7 Hypotheses Insights Push Pass

## 1. Scope
- Deze pass rondt alleen de hypotheses-workflow af binnen de bestaande `structured_monthly_v2 -> insights -> sprintplanning` keten.
- Wel gedaan:
  - hypotheses expliciet in structured output houden
  - insights read-path hard op `structured_monthly_v2` zetten
  - hypothesis state hard manual-only maken
  - hypothesis -> finding -> recommendation -> task links behouden
  - accept/reject live koppelen aan sprintplanning
  - duplicate sprint-items bij heracceptatie na verse rerun blokkeren
- Niet gedaan:
  - geen brede monthly refactor
  - geen nieuwe infrastructuur
  - geen PDF-first oplossing

## 2. Aangepaste bestanden
- [lib/analysis/monthly-structured.ts](/Users/juulr/Desktop/dashboard/lib/analysis/monthly-structured.ts)
  - hypotheses zijn first-class structured objects gebleven en uitgebreid met toetsbaarheidsvelden
  - hypotheses worden nu in normaal Nederlands opgebouwd met expliciete causal expectation + evaluation window
- [app/api/analysis/monthly/route.ts](/Users/juulr/Desktop/dashboard/app/api/analysis/monthly/route.ts)
  - `structured_monthly_v2` bewaart top-level `findings` plus volledige `operating_detail`
- [lib/analysis/monthly-hypotheses-insights.ts](/Users/juulr/Desktop/dashboard/lib/analysis/monthly-hypotheses-insights.ts)
  - nieuwe payload-builder voor insights
  - structured hypotheses worden 1-op-1 doorgegeven inclusief linked findings, recommendations en tasks
  - stale accepted/rejected states worden genegeerd tenzij ze bij dezelfde `structured_created_at` horen
- [app/api/insights/monthly-hypotheses/route.ts](/Users/juulr/Desktop/dashboard/app/api/insights/monthly-hypotheses/route.ts)
  - insights API leest nu uit latest `structured_monthly_v2`
  - accept/reject gebruikt expliciete metadata met `source_hypothesis_id` + `source_structured_created_at`
  - accept hergebruikt bestaande sprint-items per taaktekst en expiret open duplicaten
- [components/insights/hypotheses-block.tsx](/Users/juulr/Desktop/dashboard/components/insights/hypotheses-block.tsx)
  - hypotheses-block leest de nieuwe insights payload
- [components/dashboard/client-dashboard.tsx](/Users/juulr/Desktop/dashboard/components/dashboard/client-dashboard.tsx)
  - hypotheses-block refresh blijft op dezelfde payloadflow
- [lib/__tests__/monthly-hypotheses-insights.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-hypotheses-insights.test.ts)
- [lib/__tests__/monthly-sop-quality.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-sop-quality.test.ts)
- [lib/__tests__/monthly-sop-export.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-sop-export.test.ts)

## 3. Exacte root cause

Deterministic:
- De inzichten-pagina las oorspronkelijk niet uit `structured_monthly_v2`, maar uit legacy `sprint_hypotheses` plus heuristische taakmatching.
- Daardoor was de hypothesis-laag in de PDF wel zichtbaar, maar niet betrouwbaar beschikbaar als workflow-object in insights.

Deterministic:
- Een verse rerun kon bovendien een oude accepted/rejected state erven doordat persistence niet hard genoeg op de nieuwe structured save werd geankerd.
- De kern van die bug zat in twee plekken:
  - read-path: persisted status werd niet uitsluitend aan de actuele `structured_created_at` gekoppeld
  - write-path: `ensurePersistedHypothesisRow(...)` hergebruikte een oude `sprint_hypotheses` row op basis van `analysis_id + hypothesis text`
- Omdat `full` en `structured_monthly_v2` per dag via upsert hetzelfde row-id houden en alleen `created_at` verversen, kon een oude accepted hypothesis-row opnieuw gebruikt worden zonder handmatige user action.

Deterministic:
- Daardoor waren er twee symptomen:
  - hypotheses konden ten onrechte accepted lijken op een verse rerun
  - accept na een nieuwe rerun kon bestaande sprint-items dupliceren of aan de verkeerde persistence-row hangen

## 4. Oude read/save path vs nieuwe read/save path

Oud:
- monthly output genereerde hypotheses in operating detail
- insights gebruikte legacy `sprint_hypotheses`
- linked tasks werden heuristisch benaderd op render-tijd
- accept/reject waren niet hard verankerd aan de actuele structured monthly save

Nieuw:
- monthly builder zet hypotheses expliciet in `structured_monthly_v2.output.operating_detail.hypotheses_and_next_month_proof`
- `structured_monthly_v2` bewaart ook top-level `findings`
- insights GET laadt:
  - latest `full`
  - latest `structured_monthly_v2`
  - daarna alleen persisted workflow-state die exact dezelfde `source_structured_created_at` draagt
- insights POST accept/reject schrijft explicit workflow metadata terug in `sprint_hypotheses`
- accept gebruikt de linked task ids uit structured output en synchroniseert alle gekoppelde tasks naar `sprint_items`

## 5. Hypothesis -> finding -> recommendation -> task linkage

Deterministic model in structured output:
- per hypothese:
  - `id`
  - `title`
  - `label`
  - `hypothesis`
  - `why_we_think_this`
  - `validation_or_exploitation_step`
  - `success_next_month`
  - `expected_change`
  - `success_metrics`
  - `guardrail_metrics`
  - `evaluation_window`
  - `accept_if`
  - `reject_if`
  - `linked_primary_thread`
  - `linked_finding_ids`
  - `linked_recommendation_ids`
  - `linked_task_ids`
  - `status`
  - `rejected_reason`
  - `accepted_into_sprint`

Deterministic linkage-regel:
- de insights payload reconstrueert niets heuristisch uit de UI
- linked findings, recommendations en tasks komen rechtstreeks uit de structured row
- accept gebruikt exact `linked_task_ids`
- reject gebruikt exact dezelfde hypothesis id, maar maakt geen sprint-items

## 6. Waarom hypotheses nu normaler Nederlands zijn

Deterministic:
- hypotheses worden niet meer opgebouwd uit recommendation/task-zinnen.
- de builder gebruikt nu een vast verwachtingspatroon:
  - zin 1: `Als ... klopt, dan verwachten we dat ... leidt tot ...`
  - zin 2: `Dat zien we terug in ... binnen ...`

Deterministic live voorbeeld MPC UK:
- `Als de diagnose rond UK-MPC - Apple - Generic - Automated klopt, dan verwachten we dat een gerichte afbakening van de verlieslatende druk leidt tot minder verspilling en stabieler rendement op UK-MPC - Apple - Generic - Automated. Dat zien we terug in Search Lost IS (Budget), ROAS en Conversies binnen 7 dagen.`

Deterministic live voorbeeld extra case:
- `Als de diagnose rond 2. Pmax Haarlem klopt, dan verwachten we dat een gerichte afbakening van de verlieslatende druk leidt tot minder verspilling en stabieler rendement op 2. Pmax Haarlem. Dat zien we terug in CPA binnen 7 dagen.`

Inferred:
- de hypotheses zijn nu duidelijk hypothesis-tekst en niet meer vermomde tasks of recommendations
- ze zijn nog formulematig, maar inhoudelijk bruikbaar en toetsbaar

## 7. Coverage en toetsbaarheid

Deterministic:
- `structured_monthly_v2` bewaart weer top-level `findings`
- hypotheses dragen expliciete `linked_finding_ids`
- step 13 is daardoor niet meer alleen een samenvattende tekstlaag, maar een expliciet doorverbonden hypotheses-laag

Deterministic:
- toetsbaarheid is uitgebreid via:
  - `expected_change`
  - `success_metrics`
  - `guardrail_metrics`
  - `evaluation_window`
  - `accept_if`
  - `reject_if`

Inferred:
- dit brengt coverage en hypothesis-testability aantoonbaar omhoog omdat step 13 nu expliciet terughaakt op eerdere findings én beslisregels bevat voor de volgende maand

## 8. Tests

Gedraaid:
- `npx tsc --noEmit`
- `npx tsx lib/__tests__/monthly-hypotheses-insights.test.ts`
- `npx tsx lib/__tests__/monthly-sop-quality.test.ts`
- `npx tsx lib/__tests__/monthly-structured.test.ts`
- `npx tsx lib/__tests__/monthly-sop-export.test.ts`
- `npx tsx lib/__tests__/thread-synthesis.test.ts`

Resultaten:
- `monthly-hypotheses-insights`: `9 passed / 0 failed`
- `monthly-sop-quality`: `134 passed / 0 failed`
- `monthly-structured`: `72 passed / 0 failed`
- `monthly-sop-export`: `17 passed / 0 failed`
- `thread-synthesis`: `8 passed / 0 failed`
- `tsc`: passed

Nieuwe/uitgebreide regressies:
- hypotheses starten default als `pending`
- stale accepted row mag een verse rerun niet auto-accepten
- hypothesis payload count == structured hypothesis count
- hypothesis links naar findings/recommendations/tasks blijven intact
- accept planning pusht alle linked tasks
- accept is idempotent
- existing sprint-items uit oudere hypotheses zijn herbruikbaar op een verse rerun
- reject bewaart rejected state en blokkeert sprint-success
- partial sprint push wordt niet stilzwijgend als success gemarkeerd
- hypotheses blijven renderbaar uit stored rows met alleen `display_findings`

## 9. Live bewijs per case

### 9.1 MPC UK — `gads-8794436501`

Verse monthly rerun:
- `monthly` status: `200`
- `structured.saved`: `true`
- `acceptance.passed`: `true`
- `qualityGate.state`: `passed`
- `invalid_steps`: `[]`

Verse saves:
- `full`: `28424917-8b1e-44bf-923b-3836d3d1e37c` at `2026-04-16T15:28:38.835+00:00`
- `structured_monthly_v2`: `59e39032-e058-4012-abbc-f69c1e46d54b` at `2026-04-16T15:28:38.900+00:00`

Insights proof:
- `GET /api/insights/monthly-hypotheses?client_id=gads-8794436501` → `200`
- hypotheses-count: `3`
- eerste hypothesis:
  - `status = pending`
  - `accepted_into_sprint = false`
  - `linked_findings = 6`
  - `linked_recommendations = 1`
  - `linked_tasks = 2`
  - `sprint_items = 0`

Accept proof:
- handmatige `POST accept` op `hypothesis-1`
- response:
  - `status = accepted`
  - `accepted_into_sprint = true`
  - `sprint_items = 2`
  - `linked_tasks = 2`

DB proof:
- matched persisted hypothesis row: `a10868b3-7807-4107-9eda-f1cdd8b6bf80`
- `sprint_item_count = 2`
- tweede accept bleef `sprint_items = 2`

Deterministic conclusie:
- accept stuurt alle gekoppelde taken door
- tweede accept dupliceert niet

### 9.2 Extra live reject-case — `gads-1426896617`

Verse monthly rerun:
- `monthly` status: `200`
- `structured.saved`: `true`
- `acceptance.passed`: `true`
- `qualityGate.state`: `passed`
- `invalid_steps`: `[]`

Verse saves:
- `full`: `0bf321ed-d227-435a-b1bd-01f98144e145` at `2026-04-16T15:28:38.295+00:00`
- `structured_monthly_v2`: `63b6d849-ecb9-4871-a6f5-6def899ea8d9` at `2026-04-16T15:28:38.358+00:00`

Insights proof:
- `GET /api/insights/monthly-hypotheses?client_id=gads-1426896617` → `200`
- hypotheses-count: `3`
- eerste hypothesis:
  - `status = pending`
  - `accepted_into_sprint = false`
  - `linked_tasks = 2`
  - `sprint_items = 0`

Reject proof:
- handmatige `POST reject` op `hypothesis-1`
- `rejected_reason = "Nog niet de eerstvolgende sprintprioriteit."`
- response:
  - `status = rejected`
  - `accepted_into_sprint = false`
  - `sprint_items = 0`

DB proof:
- matched persisted hypothesis row: `9682322d-ddca-48d1-8018-7434f7c464b5`
- `matched_status = rejected`
- `sprint_item_count = 0`

Deterministic conclusie:
- reject bewaart de status
- reject maakt geen sprint-items

### 9.3 Aanvullende save/read-path proof — `gads-8714777147`
- verse `full`: `ffd6d907-97db-4ff9-905f-2864d6ecc6b9` at `2026-04-16T15:31:53.159+00:00`
- verse `structured_monthly_v2`: `17011a11-0f02-4467-97a6-0309a6e14121` at `2026-04-16T15:31:53.245+00:00`
- insights hypotheses-count: `3`
- eerste hypothesis:
  - `status = pending`
  - `accepted_into_sprint = false`
  - `linked_findings = 6`
  - `linked_recommendations = 1`
  - `linked_tasks = 2`

### 9.4 Aanvullende save/read-path proof — `gads-8375102493`
- verse `full`: `a3d44885-b80c-435b-8d30-3e9905f55ff4` at `2026-04-16T15:31:56.720+00:00`
- verse `structured_monthly_v2`: `e86b7829-dd6f-479e-a9d7-2e049ff37e3a` at `2026-04-16T15:31:56.798+00:00`
- insights hypotheses-count: `3`
- eerste hypothesis:
  - `status = pending`
  - `accepted_into_sprint = false`
  - `linked_findings = 6`
  - `linked_recommendations = 1`
  - `linked_tasks = 2`

## 10. Expliciete ja/nee-antwoorden
- hypotheses zichtbaar op inzichten-pagina vanuit `structured_monthly_v2`: **ja**
- hypotheses-count in insights payload == hypotheses-count in structured row: **ja**
- linked findings aanwezig in insights payload: **ja**
- linked recommendations aanwezig in insights payload: **ja**
- linked tasks aanwezig in insights payload: **ja**
- nieuwe hypotheses starten altijd als `pending`: **ja**
- nieuwe hypotheses starten met `accepted_into_sprint = false`: **ja**
- nieuwe hypotheses starten met `rejected_reason = null`: **ja**
- accept stuurt alle gekoppelde taken door naar sprintplanning: **ja**
- reject blokkeert gekoppelde taken en maakt geen sprint-items: **ja**
- duplicaten bij tweede accept: **nee**
- `accepted_into_sprint` wordt alleen true bij volledige taak-fanout: **ja**

## 11. Wat nog niet perfect is

Inferred:
- hypothesis-tekst is nu menselijker en toetsbaarder, maar nog bewust sjabloonmatig
- de hypotheses zijn functioneel goed genoeg voor workflow en evaluatie, maar kunnen inhoudelijk nog rijker en minder repetitief worden als daar later een aparte quality-pass voor komt

## 12. Eindoordeel
- hypotheses op inzichten-pagina: **ja**
- accept stuurt alle gekoppelde taken door: **ja**
- reject blokkeert gekoppelde taken: **ja**
- duplicaten bij tweede accept: **nee**
- P7 klaar om te committen: **ja**

Deterministic eindconclusie:
- de drie vereiste ketens zijn nu live bewezen:
  - data-save
  - insights rendering
  - accept/reject -> sprintplanning

Dus: **P7 klaar**.
