# P1 Monthly SOP Pass

## 1. Scope
- `P1-1` Step 12 no-data/evidence conflict hard opgelost.
- `P1-2` Findings-volume teruggebracht onder acceptance-threshold zonder blind te kappen.
- `P1-3` Geo-thread verbreding gericht verbeterd richting country-level Germany-surface waar meerdere DE-signalen dat dragen.

## 2. Gewijzigde bestanden
- `/Users/juulr/Desktop/dashboard/app/api/analysis/monthly/route.ts`
  - Step 12 availability-aware parsing toegevoegd.
  - Step 12 output wordt na parse gereconcileerd met echte availability.
  - Structured findings worden nu gecureerd voor acceptance in plaats van raw canonical findings direct door te geven.
- `/Users/juulr/Desktop/dashboard/lib/analysis/step-validator.ts`
  - No-data conflict-validatie is nu scope-aware in plaats van bot op hele stap.
- `/Users/juulr/Desktop/dashboard/lib/prompts/monthly-v2.ts`
  - Step 12 prompt zegt nu expliciet dat partiële no-data alleen op de missende werkwijze mag slaan.
- `/Users/juulr/Desktop/dashboard/lib/analysis/monthly-structured.ts`
  - Country-level geo-support krijgt extra gewicht bij representative cluster- en executive-thread selectie.
- `/Users/juulr/Desktop/dashboard/lib/analysis/thread-synthesis.ts`
  - Zelfde geo-broadening logica gespiegeld in thread synthesis zodat unit-level threadkeuze niet divergeert van monthly structured.
- `/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-sop-quality.test.ts`
  - Regressietests toegevoegd voor scoped Step 12 no-data en findings-curation.
- `/Users/juulr/Desktop/dashboard/lib/__tests__/thread-synthesis.test.ts`
  - Regressietest toegevoegd voor bredere country-surface bij DE-evidence uit meerdere scopes.

## 3. Implementatie per P1-item

### P1-1 — Step 12 no-data/evidence conflict
- Probleem:
  - Deterministic: step 12 kon tegelijk zeggen dat data niet beschikbaar was en toch deterministic findings met harde evidence genereren. Dat triggerde de validator terecht.
- Oorzaak:
  - Deterministic: de validator keek naar brede no-data tekst op stapniveau, terwijl step 12 drie werkwijzen combineert (`checkout`, `schedule`, `network`) die afzonderlijk beschikbaar of onbeschikbaar kunnen zijn.
- Oplossing:
  - Deterministic: `validateStepOutput` accepteert nu availability-context en controleert no-data alleen op de specifieke unavailable scope.
  - Deterministic: route geeft per stap de echte `StepDataAvailability` mee aan parse + validatie.
  - Deterministic: step 12 krijgt een extra prompt-instructie om alleen de missende werkwijze als unavailable te labelen.
  - Deterministic: `reconcileStep12Output` verwijdert findings voor unavailable sub-scopes en maakt alleen een full no-data fallback als checkout, schedule én network alle drie ontbreken.
- Trade-offs:
  - Inferred: deze fix leunt op consistente scope-herkenning in metric/cause-tekst. Nieuwe step-12 varianten kunnen later nog extra scope-mapping nodig hebben.

### P1-2 — Findings-volume onder acceptance-threshold
- Probleem:
  - Deterministic: acceptance faalde op `31 unieke bevindingen`.
- Oorzaak:
  - Deterministic: canonical findings gingen bijna ongeremd door naar structured acceptance, inclusief meta-signalen zoals `Data Availability` en meerdere smalle varianten op hetzelfde business-surface.
- Oplossing:
  - Deterministic: `curateMonthlyStructuredFindings` filtert eerst meta `Data Availability`-ruis weg.
  - Deterministic: daarna wordt per `cluster_family + entity_identity_key` gecureerd zodat zware clusters maximaal 2 findings houden en lichtere clusters 1.
  - Deterministic: acceptance draait nu op curated findings, niet op de ongecureerde set.
- Trade-offs:
  - Deterministic: er blijft een harde bovengrens van `30`, maar pas ná structuurgebaseerde curation in plaats van een domme vroege slice.
  - Inferred: dit verlaagt ruis zonder de belangrijkste business-signalen te amputeren, maar zeer brede accounts kunnen later nog slimmere severity- of business-impact ranking vragen.

### P1-3 — Geo-thread verbreden
- Probleem:
  - Deterministic uit audit/P0: geo-diagnose werd te smal geformuleerd op een adgroup-achtig surface zoals `DE (Shopping-bleeder_RM)`.
- Oorzaak:
  - Deterministic: zodra een nauwere geo-cluster hoger scoorde dan het landcluster, bleef de executive framing te lokaal, ook als meerdere DE-signalen uit meerdere scopes naar hetzelfde landoppervlak wezen.
- Oplossing:
  - Deterministic: representative cluster-keuze prefereert nu het `country` geo-cluster wanneer hetzelfde geo-root door meerdere scopes wordt ondersteund.
  - Deterministic: `scoreCluster` geeft extra gewicht aan `country` geo_allocation clusters met cross-scope support.
- Trade-offs:
  - Deterministic: de verbreding gebeurt alleen als er minstens 2 scopes support leveren; daardoor blijft een smalle surface staan als die echt op zichzelf staat.
  - Deterministic: live bewijs voor deze verbreding is nog gemengd; zie sectie 5 en 7.

## 4. Tests

### Gedraaide commands
- `npx tsc --noEmit`
  - Deterministic: passed.
- `npx tsx lib/__tests__/thread-synthesis.test.ts`
  - Deterministic: passed, `6 passed / 0 failed`.
- `npx tsx lib/__tests__/monthly-structured.test.ts`
  - Deterministic: passed, `72 passed / 0 failed`.
- `npx tsx lib/__tests__/monthly-sop-quality.test.ts`
  - Deterministic: passed, `82 passed / 0 failed`.
- `npx tsx lib/__tests__/monthly-sop-export.test.ts`
  - Deterministic: passed, `16 passed / 0 failed`.

### Nieuwe/aangepaste regressies
- Step 12 scoped no-data + deterministic findings blijft valide.
- Findings-curation verwijdert `Data Availability`-ruis eerst.
- DE-evidence uit meerdere scopes verbreedt de geo-thread naar country-surface.

## 5. Live rerun

### Prepare run
- Command:
  - `POST /api/analysis/monthly/prepare` voor `gads-3853096192`
- Resultaat:
  - Deterministic: `200`
  - Deterministic: `prepared_context_id = 65969dd9-51b1-4c79-9086-16e2afa2798f`

### Monthly run
- Command:
  - `POST /api/analysis/monthly` voor `gads-3853096192`
- Resultaat:
  - Deterministic: `200`
  - Deterministic: `structured.saved = true`
  - Deterministic: `structured.findings = 29`
  - Deterministic: `structured.acceptance.passed = true`
  - Deterministic: `structured.qualityGate.passed = true`
  - Deterministic: `structured.qualityGate.state = "passed"`
  - Deterministic: `structured.qualityGate.invalid_steps = []`

### Step 12 status
- Deterministic: step 12 is niet meer invalid.
- Deterministic: de eerdere `no data` versus `deterministic evidence` conflict is verdwenen.

### Coverage truth
- Deterministic: coverage in de live rerun liet o.a. zien:
  - `campaign.data_available = true`, `status = covered`
  - `geography.data_available = true`, `status = covered`
  - `network.data_available = true`, `status = covered`
  - `schedule.data_available = true`, `status = covered`

### PDF run
- Command:
  - `GET /api/analysis/pdf?client_id=gads-3853096192&sop_type=monthly&client_name=gads-3853096192`
- Resultaat:
  - Deterministic: `200`
  - Deterministic: `application/pdf`
  - Deterministic: `159825 bytes`

### Storage/save gedrag
- Deterministic:
  - er is een verse `quality_gate_monthly_v2` row zichtbaar op `2026-04-15T13:52:45.938743+00:00` met `passed: true`.
- Deterministic:
  - de laatst direct teruggevonden `full` en `structured_monthly_v2` rows bleven op `2026-04-15T07:06:24...`.
- Inferred:
  - de route beschouwt de run functioneel als opgeslagen (`structured.saved = true`), maar ik heb in deze pass geen verse DB-row voor `full` of `structured_monthly_v2` hard bevestigd. Dat blijft een opslag-observatie die buiten de P1-kernscope valt.

### Tweede rerun na extra geo-score tuning
- Deterministic:
  - er is nog een extra rerun gestart na de laatste geo-scorewijziging.
  - die request schreef binnen de observatieperiode geen response body weg (`/tmp/p1-monthly-rerun-2.json` bleef `0B`), terwijl de PDF-route wel `200` bleef geven.
- Deterministic:
  - ik gebruik die tweede rerun daarom niet als bewijs voor een geslaagde inhoudsverandering.

## 6. Wat nu aantoonbaar beter is
- Deterministic: step 12 blokkeert de hele flow niet meer onterecht door een intern no-data/evidence conflict.
- Deterministic: acceptance komt onder de findings-threshold uit (`29` in plaats van `31`).
- Deterministic: quality gate gaat nu verder dan in de P0-pass; de run haalt weer `200` en PDF-export `200`.
- Deterministic: prepared-context coverage truth voor campaign/geography/network/schedule is in de live rerun coherent.
- Deterministic: decision-rule hygiene uit P0 blijft groen; er zijn in deze P1-pass geen regressies op de bestaande quality/export/thread tests ontstaan.

## 7. Wat nog niet goed genoeg is
- P1-3 geo-thread verbreding:
  - Deterministic: unit-tests voor bredere DE-country framing slagen.
  - Deterministic: de eerder succesvolle live rerun gebruikte in `fullOutput` nog steeds een PMax-led primary thread: `PMax verschuift volume, maar is niet automatisch het hoofdprobleem.`
  - Inferred: de geo-thread is in de engine beter voorbereid op verbreding, maar ik heb nog geen harde live rerun-output die bewijst dat de executive primary thread nu daadwerkelijk naar een Germany-surface verschuift.
- Opslagbewijslast:
  - Deterministic: `quality_gate_monthly_v2` wordt vers opgeslagen.
  - Deterministic: een verse `full` of `structured_monthly_v2` row heb ik niet hard teruggevonden na de geslaagde rerun.
  - Inferred: er zit mogelijk nog een save-path inconsistentie buiten de kern van deze P1-scope.
- Runtime-stabiliteit:
  - Deterministic: een tweede rerun bleef hangen zonder response body.
  - Inferred: dat wijst op een nog niet uitgezochte runtime-instabiliteit, maar is in deze pass niet diep uitgewerkt.

## 8. Beste volgende stap
- P2 zou ik nu nog niet breed maken.
- Beste eerstvolgende stap:
  - Deterministic: doe een gerichte vervolgpass op executive thread selection versus stored `full/structured` save path.
  - Concreet:
    - verifieer waarom een kwalitatief geslaagde rerun geen verse `full` / `structured_monthly_v2` row laat zien;
    - forceer of bewijs daarna met één live rerun dat de primary thread, root cause en recommendations inhoudelijk op dezelfde Germany-surface blijven wanneer DE-signalen multi-scope dominant zijn.

## 9. Self-check
- Heb ik echt alleen P1-scope aangepakt?
  - Deterministic: ja. Alleen step-12 consistentie, findings-curation en geo-thread scoring/representative selectie zijn aangepast.
- Welke bestanden zijn gewijzigd?
  - Deterministic: `app/api/analysis/monthly/route.ts`, `lib/analysis/step-validator.ts`, `lib/prompts/monthly-v2.ts`, `lib/analysis/monthly-structured.ts`, `lib/analysis/thread-synthesis.ts`, `lib/__tests__/monthly-sop-quality.test.ts`, `lib/__tests__/thread-synthesis.test.ts`, `p1_monthly_sop_pass.md`.
- Is step 12 inhoudelijk opgelost?
  - Deterministic: ja, voor het specifieke no-data/evidence conflict. Live rerun gaf geen invalid step 12 meer.
- Is het findings-volume verbeterd?
  - Deterministic: ja. Live rerun ging naar `29` findings en acceptance passeerde.
- Is de geo-thread stabieler en beter geformuleerd?
  - Deterministic: gedeeltelijk. Unit-tests slagen op de bredere country-surface.
  - Deterministic: nog geen hard live bewijs dat de executive primary thread nu ook echt verschuift naar Germany.
- Zijn er regressierisico’s?
  - Deterministic: beperkt maar aanwezig rond save-path gedrag en runtime-hangs bij een extra rerun.
- Is de live Monthly SOP-run nu zowel functioneel als kwaliteitsmatig verder gekomen?
  - Deterministic: ja. De eerste live rerun kwam van `422 blocked_invalid_steps` in P0 naar `200 passed` met PDF `200`.
