# P2 Executive Thread & Save-Path Pass

## 1. Scope
- `P2-A` Executive thread selection live bewezen op de juiste surface.
- `P2-B` Save-path voor `full` en `structured_monthly_v2` end-to-end geverifieerd en gericht gerepareerd.

## 2. Gewijzigde bestanden
- `/Users/juulr/Desktop/dashboard/lib/analysis/helpers.ts`
  - Deterministic: save helper kan nu artifact rows met een verse `created_at` opslaan via `refreshCreatedAt`.
  - Deterministic: `prepareAnalysisOutputSaveRow` toegevoegd voor testbare save-row voorbereiding.
- `/Users/juulr/Desktop/dashboard/app/api/analysis/monthly/route.ts`
  - Deterministic: `quality_gate_monthly_v2`, `full` en `structured_monthly_v2` worden nu met expliciete save receipts (`id`, `created_at`, `section`) opgeslagen.
  - Deterministic: `structured.saved` leunt nu op bewezen artifact writes in plaats van impliciet op downstream insights/tasks inserts.
  - Deterministic: monthly response bevat nu `structured.saveReceipts`.
- `/Users/juulr/Desktop/dashboard/lib/analysis/monthly-structured.ts`
  - Deterministic: final executive recommendations vallen niet meer terug op `recommendations[0]` als de primary thread geen directe promoted recommendation-match heeft; de primary cluster blijft dan leidend.
- `/Users/juulr/Desktop/dashboard/lib/__tests__/analysis-save-path.test.ts`
  - Deterministic: nieuwe regressietest voor `refreshCreatedAt`.
- `/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-sop-quality.test.ts`
  - Deterministic: nieuwe regressietest tegen promoted-action hijack van de final executive recommendation surface.

## 3. Save-path analyse

### 3.1 Waar werd `structured.saved = true` gezet?
- Deterministic:
  - in `app/api/analysis/monthly/route.ts` werd `structuredSaved` pas op `true` gezet nadat `sop_insights`, `sop_recommendations` en `sop_tasks` inserts liepen.
  - dat zei niets over een bewezen verse save van `full` of `structured_monthly_v2`.

### 3.2 Onder welke voorwaarden werden `full` en `structured_monthly_v2` geschreven?
- Deterministic:
  - beide liepen via `saveAnalysisOutputSection(...)` in `lib/analysis/helpers.ts`.
  - die helper deed een `upsert` op conflict key:
    - `client_id,sop_type,analysis_date,section`

### 3.3 Kon `structured.saved = true` waar zijn terwijl de DB-write niet vers zichtbaar was?
- Deterministic: ja.
- Oorzaak:
  - `structured.saved` was gekoppeld aan downstream inserts, niet aan artifact receipts.
  - `full` en `structured_monthly_v2` werden via `upsert` op dezelfde unieke sleutel bijgewerkt.
  - daardoor bleef het row-id gelijk en bleef `created_at` oud, waardoor een latere “laatste row” check eruitzag alsof er geen verse save was.

### 3.4 Welke save-path oorzaak was het echt?
- Deterministic:
  - geen silent write failure als primaire oorzaak.
  - geen verkeerde section key.
  - geen verkeerde read query als primaire oorzaak.
  - wel: `upsert` + conflict-key + niet-ververste `created_at`.
  - wel: misleidende `structured.saved`-semantiek.

### 3.5 Hard bewijs vóór fix
- Deterministic, live DB query vóór rerun:
  - `quality_gate_monthly_v2`
    - `id = abf4ff4d-fde0-42c6-900a-7e16c1a598bb`
    - `created_at = 2026-04-15T13:52:45.938743+00:00`
  - `structured_monthly_v2`
    - `id = cecf696d-41f0-46a3-9cd0-738a0af49430`
    - `created_at = 2026-04-15T07:06:24.643131+00:00`
  - `full`
    - `id = 69139427-e1c3-473f-ac09-5dfe6adbd00c`
    - `created_at = 2026-04-15T07:06:24.494775+00:00`

## 4. Save-path fix

### 4.1 Oplossing
- Deterministic:
  - artifact saves (`quality_gate_monthly_v2`, `full`, `structured_monthly_v2`) vragen nu `refreshCreatedAt: true`.
  - de helper zet dan een verse `created_at` in de upsert-row.
  - de monthly route vraagt nu `select: "id, created_at"` op voor deze writes.
  - als `full` of `structured_monthly_v2` geen receipt teruggeven, gooit de route een fout in plaats van alsnog `saved: true` te rapporteren.
  - monthly response expose’t nu:
    - `structured.saveReceipts.quality_gate_monthly_v2`
    - `structured.saveReceipts.full`
    - `structured.saveReceipts.structured_monthly_v2`

### 4.2 Trade-off
- Deterministic:
  - het row-id blijft gelijk door de bestaande upsert-architectuur.
  - de “verse write” wordt nu hard bewezen via verse `created_at` en live response receipts, niet via een nieuw row-id.
- Inferred:
  - dit is de kleinste gerichte fix zonder schemawijziging of opslagrefactor.

## 5. Executive thread analyse

### 5.1 Waarom bleef de eerdere live rerun op een PMax-led primary thread?
- Deterministic:
  - de stored executive thread stond toen op `PMax verschuift volume, maar is niet automatisch het hoofdprobleem.`
  - tegelijk bestond er een executive continuity-bug:
    - zodra promoted step-actions aanwezig waren, konden final recommendations op een ander surface landen.
- Deterministic:
  - in `buildFinalRecommendations(...)` viel de code uiteindelijk terug op `recommendations[0]`.
  - als de primary thread geen directe promoted recommendation-match had, kon een willekeurige eerste promoted recommendation het executive action surface kapen.

### 5.2 Gerichte fix
- Deterministic:
  - als er wel een primary cluster is maar geen recommendation die daarop matcht, valt de final executive laag nu niet meer terug op `recommendations[0]`.
  - de primary cluster blijft dan leidend voor de final recommendation synthesis.

### 5.3 Live inhoudelijk resultaat na rerun
- Deterministic:
  - primary thread: `Geo-allocatie rond Land: DE (Duitsland) is uit balans.`
  - root cause: `Structurele mismatch tussen aanbod`
  - recommendation 1 object/surface: `Duitsland`
  - recommendation 2 object/surface: `Duitsland`
  - recommendation 3 object/surface: `Duitsland`
  - tasks blijven ook op `Duitsland`
- Deterministic:
  - de live rerun bewijst dus dat primary thread, root cause, final recommendations en tasks op hetzelfde Germany-surface zitten.

### 5.4 Is Germany inhoudelijk terecht?
- Deterministic, live stored evidence:
  - supporting evidence noemt:
    - `Land: DE (Duitsland) — CPA €18.38 (+67%)`
    - `Land: Duitsland — ROAS 0.83x`
    - `DE absorbeert 31.6% van het budget`
  - QA self-check verwerpt:
    - `PMax verschuift volume, maar is niet automatisch het hoofdprobleem`
    - `Product: DE new: ROAS`
- Inferred:
  - Germany is hier inhoudelijk terecht als executive surface, omdat de rerun nu meerdere DE-signalen samenbrengt op landniveau in plaats van op een smallere campaign/adgroup/asset surface.

## 6. Tests

### Gedraaide commands
- `npx tsc --noEmit`
  - Deterministic: passed.
- `npx tsx lib/__tests__/analysis-save-path.test.ts`
  - Deterministic: passed, `3 passed / 0 failed`.
- `npx tsx lib/__tests__/thread-synthesis.test.ts`
  - Deterministic: passed, `6 passed / 0 failed`.
- `npx tsx lib/__tests__/monthly-structured.test.ts`
  - Deterministic: passed, `72 passed / 0 failed`.
- `npx tsx lib/__tests__/monthly-sop-quality.test.ts`
  - Deterministic: passed, `84 passed / 0 failed`.
- `npx tsx lib/__tests__/monthly-sop-export.test.ts`
  - Deterministic: passed, `16 passed / 0 failed`.

### Nieuwe/aangepaste regressies
- `analysis-save-path.test.ts`
  - Deterministic: test op `refreshCreatedAt`.
- `monthly-sop-quality.test.ts`
  - Deterministic: promoted actions mogen de final executive recommendation surface niet hijacken.

## 7. Live rerun

### 7.1 Prepare
- Command:
  - `POST /api/analysis/monthly/prepare`
- Resultaat:
  - Deterministic: `200`
  - Deterministic: `prepared_context_id = 65969dd9-51b1-4c79-9086-16e2afa2798f`

### 7.2 Monthly
- Command:
  - `POST /api/analysis/monthly` met `job_id = p2-rerun-saveproof`
- Resultaat:
  - Deterministic: `200`
  - Deterministic: `structured.saved = true`
  - Deterministic: `structured.findings = 28`
  - Deterministic: `structured.acceptance.passed = true`
  - Deterministic: `structured.qualityGate.state = "passed"`
  - Deterministic: `invalid_steps = []`
  - Deterministic: response bevat `saveReceipts` voor alle drie artifact-secties

### 7.3 PDF
- Command:
  - `GET /api/analysis/pdf?client_id=gads-3853096192&sop_type=monthly&client_name=gads-3853096192`
- Resultaat:
  - Deterministic: `200`
  - Deterministic: `application/pdf`
  - Deterministic: `159825 bytes`

## 8. Hard storage proof

### 8.1 Save receipts uit live response
- Deterministic:
  - `quality_gate_monthly_v2`
    - `id = abf4ff4d-fde0-42c6-900a-7e16c1a598bb`
    - `created_at = 2026-04-15T14:39:51.491+00:00`
  - `full`
    - `id = 69139427-e1c3-473f-ac09-5dfe6adbd00c`
    - `created_at = 2026-04-15T14:39:51.552+00:00`
  - `structured_monthly_v2`
    - `id = cecf696d-41f0-46a3-9cd0-738a0af49430`
    - `created_at = 2026-04-15T14:39:51.641+00:00`

### 8.2 Directe DB-readback na rerun
- Deterministic:
  - `quality_gate_monthly_v2`, `full` en `structured_monthly_v2` staan alle drie op de nieuwe save-window rond `14:39:51Z`.
  - `full` en `structured_monthly_v2` zijn dus nu hard vers bevestigd.

### 8.3 Uitleg van de row-id’s
- Deterministic:
  - de row-id’s bleven gelijk.
  - de verse write zit nu aantoonbaar in `created_at`, omdat de save-helper die timestamp bewust refresht op artifact-upserts.
- Inferred:
  - dit is voldoende voor live save-proof zolang de huidige tabel unieke upserts per dag/sectie gebruikt.

## 9. Hard thread proof

### 9.1 Live `full` output
- Deterministic:
  - primary thread: `Geo-allocatie rond Land: DE (Duitsland) is uit balans.`
  - root cause: `Structurele mismatch tussen aanbod`
  - final recommendations blijven allemaal op `Duitsland`

### 9.2 Live `structured_monthly_v2`
- Deterministic:
  - `final_sop.primary_thread = Geo-allocatie rond Land: DE (Duitsland) is uit balans.`
  - `final_sop.root_cause = Structurele mismatch tussen aanbod`
  - `final_sop.recommendations[*].object = Duitsland`
  - `final_sop.tasks[*].object = Duitsland`
  - `qa_self_check.chosen_primary_thread = Geo-allocatie rond Land: DE (Duitsland) is uit balans`
  - `qa_self_check.rejected_alternative_threads` bevat expliciet de oude PMax-thread

### 9.3 Conclusie
- Deterministic:
  - de executive primary thread is live bewezen op Germany-surface.
  - de final recommendations zijn live bewezen aligned met diezelfde Germany-surface.

## 10. Wat nu aantoonbaar beter is
- Deterministic:
  - `full` en `structured_monthly_v2` hebben nu een verse, live verifieerbare `created_at` bij succesvolle reruns.
- Deterministic:
  - monthly response expose’t save receipts en maakt artifact saves expliciet bewijsbaar.
- Deterministic:
  - `structured.saved` is niet meer blind gebaseerd op downstream inserts alleen.
- Deterministic:
  - de executive continuity-bug waarbij promoted actions een vreemd surface konden kapen is gerepareerd.
- Deterministic:
  - live rerun bewijst nu een Germany-led executive thread met Germany-led recommendations en tasks.

## 11. Wat nog niet goed genoeg is
- Root cause kwaliteit:
  - Deterministic: de live root cause string is nu `Structurele mismatch tussen aanbod`.
  - Inferred: dat is inhoudelijk te kort en lijkt afgesneden; de executive root cause mag nog scherper geformuleerd worden zonder causaliteit te verliezen.
- Save-path semantiek:
  - Deterministic: de writes zijn nu vers bewijsbaar via `created_at`.
  - Deterministic: het blijven nog steeds dezelfde row-id’s door de bestaande upsert-architectuur.
  - Inferred: als echte history per rerun nodig is, vraagt dat later een schema- of opslagstrategie-aanpassing buiten deze scope.

## 12. Beste volgende stap
- Beste volgende stap:
  - Deterministic: een kleine vervolgpass op root-cause sentence compression in de final executive laag.
  - Concreet:
    - verifieer waarom de root cause nu op `Structurele mismatch tussen aanbod` afkapt;
    - behoud de nieuwe Germany-surface en save-path receipts;
    - verbeter alleen de compactheid/volledigheid van de root cause sentence zonder de rest van de monthly pipeline open te trekken.

## 13. Self-check
- Heb ik echt alleen deze twee scope-items aangepakt?
  - Deterministic: ja. Alleen save-path/observability en executive recommendation continuity rond de primary thread.
- Heb ik save-path end-to-end bewezen?
  - Deterministic: ja. Voor-rerun DB state, live response receipts en post-rerun DB readback zijn alle drie vastgelegd.
- Is een verse `full` row hard bevestigd?
  - Deterministic: ja, via `created_at = 2026-04-15T14:39:51.552+00:00`.
- Is een verse `structured_monthly_v2` row hard bevestigd?
  - Deterministic: ja, via `created_at = 2026-04-15T14:39:51.641+00:00`.
- Is de executive primary thread live bewezen?
  - Deterministic: ja, live `full` en live `structured_monthly_v2` tonen beide Duitsland als primary thread surface.
- Is de Germany-surface inhoudelijk terecht of niet?
  - Deterministic: terecht volgens de live stored supporting evidence en de QA self-check.
- Zijn er regressierisico’s?
  - Deterministic: beperkt.
  - Inferred: vooral rond de afgekorte root cause-string en de keuze om verse writes via `created_at` te bewijzen binnen de bestaande upsert-architectuur.
- Wat is nu de grootste resterende bottleneck?
  - Deterministic: de executive root cause-string is inhoudelijk nog te afgekapt.
