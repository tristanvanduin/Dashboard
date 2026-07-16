# P5b Monthly Commit Readiness

## 1. Scope
- Deterministic: deze pass pakte alleen de vier resterende executive live-output issues uit `p5_monthly_quality_pass.md` aan:
  - primary-thread label serialization
  - `What is NOT the problem` in stored output
  - thread/object continuity voor Fit-achtige cases
  - live-safe executive hygiene ter voorbereiding van een nieuwe Mobiliteitexpert-run
- Deterministic: niet gedaan:
  - geen brede refactor
  - geen nieuwe ranking-experimenten buiten deze scope
  - geen gate/save/export-herbouw
  - geen extra accounts buiten de gevraagde vier

## 2. Gewijzigde bestanden
- [lib/analysis/monthly-structured.ts](/Users/juulr/Desktop/dashboard/lib/analysis/monthly-structured.ts)
  - truncated executive thread detectie toegevoegd en fallback naar `qa_self_check.chosen_primary_thread`
  - `What is NOT the problem` fallback gehard zodat rejected alternatives ook in de uiteindelijke stored output landen
  - executive final recommendations/tasks geforceerd naar het primary-cluster surface wanneer promoted step-actions op een ander object landen
- [lib/__tests__/monthly-sop-quality.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-sop-quality.test.ts)
  - regressies toegevoegd voor:
    - Fit surface continuity
    - `What is NOT the problem` in final stored markdown
    - bestaande executive hygiene rond labels en metrics bleef groen

## 3. Implementatie per resterend issue

### 3.1 Executive primary-thread label serialization
- Probleem:
  - Deterministic pre-P5b: stored executive threads konden afkappen naar vormen als `Campagne: 2.` of `Campagne: 1.`
- Oorzaak:
  - Deterministic: de final executive string kon in de laatste synthesis-pass te kort eindigen, terwijl `qa_self_check.chosen_primary_thread` vaak al de volledige thread bevatte
- Oplossing:
  - Deterministic: `looksTruncatedExecutiveThread(...)` toegevoegd
  - Deterministic: als `final_sop.primary_thread` afgekapt oogt en `qa_self_check.chosen_primary_thread` volledig is, wordt de primary thread hersteld vanuit die QA-keuze
- Trade-off:
  - Deterministic: dit is een smalle repair in de executive synthesis, geen ranking-herbouw

### 3.2 `What is NOT the problem` moet in stored output landen
- Probleem:
  - Deterministic pre-P5b: de placeholder kon nog in stored output blijven staan, terwijl er rejected alternatives of veilige secondary threads beschikbaar waren
- Oorzaak:
  - Deterministic: de fallback was niet hard genoeg in de final-SOP/revision-laag
- Oplossing:
  - Deterministic: fallback toegevoegd vanuit `qa_self_check.rejected_alternative_threads`
  - Deterministic: dezelfde fallback blijft ook actief in de revision-pass zodat de stored `final_sop` en markdown niet leeg terugvallen
- Trade-off:
  - Deterministic: de bullets blijven conservatief en claimen expliciet alleen “verworpen als hoofdverklaring door lagere business impact”

### 3.3 Thread/object continuity bij Fit
- Probleem:
  - Deterministic pre-P5b: executive diagnose en recommendation/task object konden op een ander surface landen
- Oorzaak:
  - Deterministic: promoted step-actions konden de executive recommendation-objecten overnemen, ook als die niet meer op het selected primary cluster surface zaten
- Oplossing:
  - Deterministic: in `buildFinalRecommendations(...)` wordt nu gecontroleerd of de gekozen `primaryRecommendation` echt op hetzelfde surface zit als `primaryCluster`
  - Deterministic: als dat niet zo is, worden executive recommendation/task objectvelden hard teruggelijnd naar het primary-cluster surface
- Trade-off:
  - Deterministic: voor de executive laag is objectcontinuïteit nu belangrijker dan het letterlijk overnemen van een promoted step-action object

### 3.4 Mobiliteitexpert-style metric / executive hygiene
- Probleem:
  - Deterministic pre-P5b: Mobiliteitexpert had eerder kapotte labelweergave en onmogelijke executive metric-output
- Oplossing in deze pass:
  - Deterministic: geen nieuwe metric-engineering toegevoegd; bestaande hygiene bleef in tests groen
  - Deterministic: deze pass richtte zich erop dat een nieuwe rerun veilig dezelfde executive laag kon gebruiken
- Uitkomst:
  - Deterministic: de live rerun voor Mobiliteitexpert haalde geen nieuwe `full` + `structured_monthly_v2` artifact-save, dus de metric-hygiëne is in deze pass niet opnieuw live bevestigd op een verse row

## 4. Tests
- Deterministic gedraaid:
  - `npx tsc --noEmit`
  - `npx tsx lib/__tests__/thread-synthesis.test.ts`
  - `npx tsx lib/__tests__/monthly-sop-quality.test.ts`
  - `npx tsx lib/__tests__/monthly-structured.test.ts`
  - `npx tsx lib/__tests__/monthly-sop-export.test.ts`
- Deterministic uitslag:
  - `tsc` passed
  - `thread-synthesis`: `8 passed, 0 failed`
  - `monthly-sop-quality`: `113 passed, 0 failed`
  - `monthly-structured`: `72 passed, 0 failed`
  - `monthly-sop-export`: `16 passed, 0 failed`
- Nieuwe gerichte regressies:
  - executive recommendations/tasks blijven op het primary Fit-surface
  - `What is NOT the problem` wordt in final stored markdown gerenderd in plaats van de generieke placeholder

## 5. Rerun-resultaten per account

### Broedservice — `gads-8714777147`
- Deterministic live statuses:
  - prepare: `200`
  - monthly: `200`
  - pdf: `200`
  - acceptance: `passed`
  - quality gate: `passed`
  - invalid steps: `[]`
  - structured.saved: `true`
- Deterministic save proof:
  - `quality_gate_monthly_v2`: `2026-04-16T09:34:02.442+00:00 -> 2026-04-16T09:45:44.043+00:00`
  - `full`: `2026-04-16T09:34:02.535+00:00 -> 2026-04-16T09:45:44.116+00:00`
  - `structured_monthly_v2`: `2026-04-16T09:34:02.643+00:00 -> 2026-04-16T09:45:44.228+00:00`
  - Deterministic: ids bleven gelijk door upsert, maar `created_at` verschoof op alle drie de artifacts; dat bewijst een nieuwe save
- Deterministic executive beoordeling:
  - primary thread: `PMax verschuift volume, maar is niet automatisch het hoofdprobleem.`
  - root cause: `Extreme spend-schaling (+1700%) leidde tot CVR-verwatering en verlies van rendementscontrole.`
  - `What is NOT the problem`: gevuld met 2 bullets
  - label truncatie: opgelost, geen `Campagne: 2.`
- Deterministic nuance:
  - recommendation/task continuity is technisch consistent, maar de executive surface blijft hier een vrij generieke PMAX-diagnose

### Fit-fysiotherapie — `gads-7649590091`
- Deterministic live statuses:
  - prepare: `200`
  - monthly: `422`
  - pdf: niet uitgevoerd
  - structured.saved: `false`
- Deterministic live blocker:
  - live server log: Step 6 `valid: false`
  - exacte fout: `Evidence-level "deterministic" op finding "Account Totaal::ROAS" terwijl het narratief aangeeft dat data niet beschikbaar is`
- Deterministic save proof:
  - alleen `quality_gate_monthly_v2` refreshed:
    - `2026-04-16T09:36:46.275+00:00 -> 2026-04-16T09:48:24.45+00:00`
  - geen nieuwe `full`
  - geen nieuwe `structured_monthly_v2`
- Deterministic stored-output beoordeling op de nieuwste geldige row:
  - primary thread: `Campagne: Fit-fysiotherapie - NL - Search - Non-branded mist vraag door budgetbeperking.`
  - recommendations/tasks: objecten blijven op `Fit-fysiotherapie - NL - Search - Non-branded`
  - `What is NOT the problem`: gevuld
- Deterministic conclusie:
  - de continuity-fix is zichtbaar in de nieuwste geldige stored output
  - maar deze pass leverde geen nieuwe geldige `full` + `structured_monthly_v2` rerun op voor Fit

### Minismus — `gads-3853096192`
- Deterministic live statuses:
  - prepare: `200`
  - monthly: `200`
  - pdf: `200`
  - acceptance: `passed`
  - quality gate: `passed`
  - invalid steps: `[]`
  - structured.saved: `true`
- Deterministic save proof:
  - `quality_gate_monthly_v2`: `2026-04-16T09:39:20.555+00:00 -> 2026-04-16T09:50:51.904+00:00`
  - `full`: `2026-04-16T09:39:20.618+00:00 -> 2026-04-16T09:50:51.982+00:00`
  - `structured_monthly_v2`: `2026-04-16T09:39:20.713+00:00 -> 2026-04-16T09:50:52.078+00:00`
  - Deterministic: ids bleven gelijk door upsert, maar `created_at` verschoof op alle drie de artifacts
- Deterministic executive beoordeling:
  - primary thread: `Duitsland trekt disproportioneel budget zonder rendementsmatch.`
  - root cause: `Duitsland verbruikt 25% van het budget met een efficiency ratio van slechts 0.56, ver onder de winstgevendheidsdrempel.`
  - `What is NOT the problem`: gevuld met 2 bullets
  - recommendations/tasks: blijven op `Duitsland`
- Deterministic conclusie:
  - Germany continuity bleef intact
  - executive readability is schoner dan pre-P5

### Mobiliteitexpert — `gads-1426896617`
- Deterministic live statuses:
  - prepare: `200`
  - monthly: `422`
  - pdf: niet uitgevoerd
  - structured.saved: `false`
- Deterministic live blocker:
  - live server log: Step 2 `valid: false`
  - exacte fout: `Verboden woord in actie: "Voeg de merknaam toe als negatief zoekwoord op accountniveau (of PMAX exclusion list) om de cannibalisatie van '1. brand_RM' door PMAX te onderzoeken."`
- Deterministic save proof:
  - alleen `quality_gate_monthly_v2` refreshed:
    - `2026-04-16T09:41:54.707+00:00 -> 2026-04-16T09:53:31.421+00:00`
  - geen nieuwe `full`
  - geen nieuwe `structured_monthly_v2`
- Deterministic beoordeling van de nieuwste geldige stored row:
  - primary thread: `Campagne: 1. brand_RM laat rendabele vraag liggen.`
  - `What is NOT the problem`: gevuld
  - onmogelijke metric-string `CVR 105.00% (-93%)`: niet aanwezig in deze opgeslagen row
- Deterministic conclusie:
  - label/metric hygiene oogt beter in de laatst geldige stored output
  - maar deze pass leverde niet de vereiste nieuwe geldige `full` + `structured_monthly_v2` save voor Mobiliteitexpert

## 6. Commit-readiness check
- Deterministic check tegen de gevraagde succescriteria:
  - Broedservice geen afgekapt executive label meer: **ja**
  - Fit correcte thread/object continuity: **ja in de nieuwste geldige stored output**
  - `What is NOT the problem` zichtbaar beter in stored output: **ja**
  - Mobiliteitexpert nieuwe geldige `full` + `structured_monthly_v2` row: **nee**
  - 4 geldige reruns met nieuwe `full` + `structured_monthly_v2` artifacts: **nee**
- Deterministic consequentie:
  - commit-readiness is nog niet gehaald volgens de expliciete opdrachtdefinitie

## 7. Wat nog resteert
- Deterministic blockers:
  - Fit live rerun blokkeert nu op een Step 6 no-data/evidence conflict
  - Mobiliteitexpert live rerun blokkeert nu op een Step 2 forbidden-action validatorfout
  - daardoor ontbreken voor 2 van de 4 accounts nieuwe geldige `full` + `structured_monthly_v2` artifacts
- Inferred nuance:
  - de P5b executive fixes zelf lijken inhoudelijk grotendeels goed te landen in stored output
  - de actuele commit/push blocker is nu minder de executive layer zelf, en meer dat twee live account-runs opnieuw op step-validatie stranden

## 8. Eindoordeel: commit + push ja/nee
- Nee.
- Deterministic reden:
  - de opdracht eiste 4 geldige reruns met nieuwe artifacts als bewijs
  - Broedservice en Minismus voldeden daaraan
  - Fit en Mobiliteitexpert niet
- Inferred best next step:
  - geen brede nieuwe pass
  - één smalle follow-up op alleen:
    - Fit Step 6 no-data/evidence conflict
    - Mobiliteitexpert Step 2 forbidden-action phrasing
  - daarna exact dezelfde 4-account confirmatieronde opnieuw
