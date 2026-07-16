# P5 Monthly Quality Pass

## 1. Scope
- Deze ronde pakte alleen de resterende executive quality-gaps aan:
  - `P5-1` primary-thread ranking
  - `P5-2` `What is NOT the problem`
  - `P5-3` executive label / metric / root-cause hygiene
- Niet gedaan:
  - geen nieuwe gates
  - geen save/export-herbouw
  - geen brede step-refactor
  - geen nieuwe infrastructuur

## 2. Startobservaties uit de 4 cases

Deterministic observaties uit de pre-P5 rows:

| Account | Pre-P5 primary thread | Grootste executive gap |
|---|---|---|
| Broedservice (`gads-8714777147`) | `Zoektermverspilling concentreert zich rond Zoekterm: kippenvoerbak.` | te smalle query-hook |
| Fit-fysiotherapie (`gads-7649590091`) | `Zoektermverspilling concentreert zich rond Zoekterm: fysio haarlem.` | te smalle query-hook |
| Minismus (`gads-3853096192`) | Germany was de beste current reference | moest niet regressen |
| Mobiliteitexpert (`gads-1426896617`) | `Campagne: 1.` | kapot executive label + CVR-weergave |

Deterministic gedeelde gaps:
- `What is NOT the problem` was leeg of viel terug op de generieke placeholder.
- Executive labels konden semantisch afkappen.
- Search-term / keyword threads kregen nog te vaak te veel executive gewicht.

## 3. Gewijzigde bestanden

- [lib/analysis/monthly-structured.ts](/Users/juulr/Desktop/dashboard/lib/analysis/monthly-structured.ts)
  - executive thread ranking in de live synthese verzwaard tegen smalle query-drivers
  - extra geo-voorkeur toegevoegd tegen generieke PMAX-diagnose als country evidence breder is
  - sentence splitting gehard tegen genummerde labels zoals `Campagne: 2. ...`
  - root-cause dedupe verbeterd zodat dezelfde clause minder snel dubbel terugkomt
  - `What is NOT the problem` fallback aangescherpt in de final SOP builder
  - decision-condition hygiene aangescherpt tegen dubbele formuleringen
- [lib/analysis/thread-synthesis.ts](/Users/juulr/Desktop/dashboard/lib/analysis/thread-synthesis.ts)
  - helper-level ranking gelijkgetrokken met de intended live P5-thread logica
- [lib/__tests__/thread-synthesis.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/thread-synthesis.test.ts)
  - regressietest voor bredere campaign driver boven search-term hook
- [lib/__tests__/monthly-sop-quality.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-sop-quality.test.ts)
  - regressies voor broad-thread ranking, not-the-problem fallback, numbered-label hygiene, CVR hygiene, geo-vs-PMAX selectie en root-cause dedupe

## 4. Implementatie per P5-item

### P5-1. Primary-thread ranking

Probleem:
- de executive laag koos nog te vaak een keyword/search-term surface wanneer er een bredere campaign/geo-surface beschikbaar was

Oorzaak:
- de helperfile en de live monthly synthese liepen niet volledig gelijk
- de live `createThreads(...)` in `monthly-structured.ts` miste nog de laatste reorder-demotion die al in de aparte helperlogica zat
- generieke PMAX-diagnoses kregen nog te weinig straf als een bredere geo-diagnose inhoudelijk sterker was

Oplossing:
- narrow query drivers krijgen nu ook in `monthly-structured.ts` een executive reorder-penalty ten gunste van bredere business threads
- generieke `pmax_cannibalization` wordt extra gedegradeerd als er een breed gedragen country-level geo thread bestaat

Trade-off:
- dit is bewust smal gehouden; geen nieuw ranking-framework

### P5-2. `What is NOT the problem`

Probleem:
- executive output bleef te vaak leeg en viel terug op de placeholder

Oorzaak:
- de live synthese miste nog een harde fallback in de final SOP builder zelf

Oplossing:
- als veilige positieve signalen ontbreken, wordt nu geprobeerd te vallen op secundaire threads
- dit is in de live final-SOP builder gezet, niet alleen in een helper

Trade-off:
- de bullets blijven conservatief; geen agressieve hallucinerende positive framing

### P5-3. Executive QA / render hygiene

Probleem:
- afgekorte labels
- dubbele root-cause clauses
- decision rules met dubbele aanloop

Oorzaak:
- sentence splitting brak op genummerde labels
- root-cause merge voegde soms hetzelfde semantische fragment twee keer samen
- decision-condition sanitisatie stripte niet alle dubbele prefixes

Oplossing:
- sentence splitter merge-t nu genummerde labeldelen
- root-cause merge vergelijkt nu meaning keys zonder `voorwaarde:`-suffix
- decision-condition sanitation verwijdert extra lead-ins

Trade-off:
- compactheid blijft prioriteit; geen langere executive root causes toegevoegd

## 5. Tests

Deterministic gedraaid en groen:

- `npx tsc --noEmit`
- `npx tsx lib/__tests__/thread-synthesis.test.ts`
  - `8 passed, 0 failed`
- `npx tsx lib/__tests__/monthly-sop-quality.test.ts`
  - `108 passed, 0 failed`
- `npx tsx lib/__tests__/monthly-structured.test.ts`
  - `72 passed, 0 failed`
- `npx tsx lib/__tests__/monthly-sop-export.test.ts`
  - `16 passed, 0 failed`

Nieuwe / aangescherpte regressies:
- broader campaign diagnosis beats narrow search-term hook
- not-the-problem fallback from rejected alternatives
- numbered campaign labels stay intact
- impossible CVR rendering blocked
- Germany surface beats generic PMAX diagnosis when geo evidence is broader
- executive root cause does not duplicate the same clause

## 6. Rerun-resultaten per account

### Belangrijke live nuance

Deterministic:
- de eerste 4-case rerun draaide tegen een dev-server process dat gestart was vóór de laatste P5-patches
- dat leidde tot drie nieuwe groene artifact-saves, maar met executive output die nog niet volledig overeenkwam met de test-backed code op schijf
- ik heb daarna de dev-server op `3000` herstart en nog één schone rerun gestart
- die fresh-server rerun leverde binnen de wachttijd geen nieuwe artifacts op en is daarom **niet** als inhoudelijk bewijs gebruikt

Daarom is de eindbeoordeling hieronder gebaseerd op:
- de nieuwste geldige P5 rows voor Broedservice, Fit en Minismus
- de laatste geldige Mobiliteitexpert row

### Broedservice (`gads-8714777147`)

Deterministic latest valid row:
- `structured_monthly_v2`: `17011a11-0f02-4467-97a6-0309a6e14121`
- `created_at`: `2026-04-16T09:23:10.233+00:00`
- acceptance: `passed`
- quality gate: `passed`

Observed output:
- primary thread: `Campagne: 2.`
- QA chosen thread: `Campagne: 2. Broedmachine_RM mist vraag door budgetbeperking`
- root cause: `Forse spend-verhoging (+94%) leidt tot massale budget-lekkage.`

Assessment:
- deterministic improvement vs pre-P5: ja, de search-term hook is weg als executive hoofdthread
- deterministic remaining gap: label truncatie blijft zichtbaar in de final executive sentence
- deterministic remaining gap: `What is NOT the problem` bleef leeg

### Fit-fysiotherapie (`gads-7649590091`)

Deterministic latest valid row:
- `structured_monthly_v2`: `ae7254fd-5478-4c6b-a289-1a32a08ff351`
- `created_at`: `2026-04-16T09:25:50.622+00:00`
- acceptance: `passed`
- quality gate: `passed`

Observed output:
- primary thread: `Keyword: fysiotherapie rotterdam (Phrase): CPA.`
- root cause: compacter dan pre-P5, maar nog steeds te smal
- recommendation/task object surface: `fit fysiotherapie (Utrecht)` terwijl de thread op Rotterdam-keyword zit

Assessment:
- deterministic improvement vs pre-P5: beperkt; search-term hook verschoof naar keyword-surface, maar bleef executive te smal
- deterministic regression risk: diagnose en actie blijven niet netjes op dezelfde surface
- deterministic remaining gap: `What is NOT the problem` bleef leeg

### Minismus (`gads-3853096192`)

Deterministic latest valid row:
- `structured_monthly_v2`: `04d57b5b-7f6d-4385-9f97-a4bbddd62d96`
- `created_at`: `2026-04-16T09:28:26.352+00:00`
- acceptance: `passed`
- quality gate: `passed`

Observed output:
- primary thread: `Duitsland trekt disproportioneel budget zonder rendementsmatch.`
- root cause: `Expansie naar DE vreet 25% van het budget op met een negatieve ROI, wat de account-efficiency zwaar onderdrukt.`
- recommendations/tasks: allemaal op `Duitsland`

Assessment:
- deterministic improvement: de Germany-surface is behouden en is opnieuw de best current reference
- deterministic remaining gap: evidence bullets zijn nog te lang en bevatten nog teveel ruwe cause-compressie
- deterministic remaining gap: `What is NOT the problem` bleef leeg

### Mobiliteitexpert (`gads-1426896617`)

Deterministic latest valid row:
- `structured_monthly_v2`: `63b6d849-ecb9-4871-a6f5-6def899ea8d9`
- `created_at`: `2026-04-16T08:19:38.019+00:00`
- acceptance: `passed`
- quality gate: `passed`

Observed output:
- primary thread: `Campagne: 1.`
- evidence: nog steeds `CVR 105.00% (-93%)`

Live rerun status:
- een latere rerun leverde alleen een nieuwe `quality_gate_monthly_v2` row op, geen nieuwe `full`/`structured_monthly_v2`
- de fresh-server confirmatierun leverde binnen de wachttijd geen nieuw artifact op

Assessment:
- deterministic: deze case is **niet** opnieuw hard bevestigd op een nieuwe geldige P5 artifact-save
- deterministic: daarom is de inhoudelijke beoordeling hier nog gebaseerd op de laatste geldige pre-P5 row

## 7. Nieuwe ranking per criterium

### Rubric per case

Scores zijn inferred, maar direct gebaseerd op de opgeslagen output tegen dezelfde rubric uit het auditrapport.

| Case | SOP-dekking | Inzicht / waarom | Actionability | Leesbaarheid |
|---|---:|---:|---:|---:|
| Benchmark | 8.5 | 9.0 | 9.0 | 8.5 |
| Minismus | 8.2 | 8.2 | 8.0 | 7.4 |
| Broedservice | 7.7 | 7.2 | 7.0 | 5.9 |
| Fit-fysiotherapie | 7.5 | 6.8 | 6.0 | 5.6 |
| Mobiliteitexpert | 7.0 | 6.8 | 6.6 | 4.8 |

### Best current reference

Deterministic:
- Minismus blijft de best current reference

Inferred:
- Broedservice is inhoudelijk beter dan pre-P5 qua thread-breedte, maar nog niet qua readability
- Fit is nog niet op benchmark-niveau omdat continuity tussen thread en actie niet goed genoeg is

## 8. Wat nu aantoonbaar beter is

Deterministic:
- de testlaag voor executive ranking/readability is sterker en groen
- Broedservice eindigt niet meer op `kippenvoerbak` als primary thread
- Minismus is weer terug op een Germany-surface met aligned recommendations/tasks
- root-cause duplicatie is in de testlaag aantoonbaar beter afgevangen

Inferred:
- de live engine zit dichter bij het gewenste monthly-diagnosis memo voor Broedservice dan vóór P5

## 9. Wat nog resteert

Deterministic resterende gaps:
- Broedservice executive label truncatie: `Campagne: 2.`
- Fit executive thread blijft te smal op keyword-surface
- Fit continuity breekt nog tussen primary thread (`fysiotherapie rotterdam`) en action object (`fit fysiotherapie (Utrecht)`)
- `What is NOT the problem` bleef in alle nieuwste geldige rows leeg
- Mobiliteitexpert heeft nog geen nieuwe geldige P5 artifact-save
- Mobiliteitexpert executive metric hygiene is dus nog niet live bewezen verbeterd

Inferred root cause van deze restgaps:
- een deel van de P5-fixes zit inhoudelijk goed op schijf en in tests, maar is nog niet volledig live bevestigd over alle vier de accounts
- de live engine gebruikt nog steeds promoties / task-object selectie die keyword-surface en object-surface kunnen ontkoppelen

## 10. Eindoordeel: klaar om te committen ja/nee

Nee.

Deterministic redenen:
- niet alle 4 reruns zijn groen bevestigd met nieuwe `full` + `structured_monthly_v2` artifacts
- Mobiliteitexpert is nog niet live opnieuw bewezen
- `What is NOT the problem` is nog niet inhoudelijk verbeterd in de opgeslagen output
- Broedservice en Fit hebben nog zichtbare executive gaps

Inferred management-oordeel:
- de richting van P5 is inhoudelijk juist
- Minismus bewijst dat de gewenste executive kwaliteit haalbaar is
- maar deze pass is nog geen nette commit/push-grens

Beste volgende stap:
- één smalle follow-up alleen op live executive serialization / continuity:
  - final primary-thread label serialization
  - object-surface continuity tussen thread en recommendations
  - not-the-problem fallback die aantoonbaar in stored output terechtkomt
  - daarna opnieuw precies deze 4 accounts bevestigen
