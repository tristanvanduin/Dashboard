# Analyse-logica Dashboard

> Volledig overzicht van hoe analyses worden uitgevoerd, de doelen, en kansen voor verbetering.

---

## 1. Overzicht: Wat doet het systeem?

Het dashboard voert **drie typen SOP-analyses** uit (wekelijks, tweewekelijks, maandelijks) plus **zoekterm-analyse** en **forecasting**. Alle analyses draaien via AI (Gemini Flash via OpenRouter) met gestructureerde prompts en rijke context uit Supabase.

```
Databronnen → Context Building → AI Analyse → Opslag → UI
```

---

## 2. Databronnen (Input)

| Bron | Tabel / API | Wat het levert |
|------|-------------|----------------|
| Supabase | `ads_account_monthly` / `_weekly` | Account-niveau metrics per maand/week |
| Supabase | `ads_campaign_monthly` | Campagne-niveau metrics |
| Supabase | `ads_adgroup_monthly` | Ad group metrics |
| Supabase | `ads_search_terms_wasteful` | Top verspillende zoektermen |
| Supabase | `sop_client_context` | Strategische context per klant |
| Supabase | `sop_hypothesis_tracking` | Geimplementeerde hypotheses |
| Supabase | `ads_change_history` | Recente campagne-wijzigingen |
| Supabase | `ads_leading_indicators` | Week-over-week anomalieen |
| Supabase | `benchmark_sectors` | Sectorgemiddelden (CTR, conv rate, CPA, ROAS) |
| Google Ads API | Search terms, product groups, account structure | Zoektermen, keywords, advertentieteksten |
| Klantsettings | KPI targets, account type, sector, AOV segment | Doelstellingen en classificatie |

---

## 3. Context Building: Expert Layers

Voordat de AI wordt aangeroepen, worden **5 verrijkingslagen** opgebouwd (`lib/analysis/expert-layers.ts`):

### Laag 1: Strategische Context
- Laadt business drivers en marktomstandigheden uit `sop_client_context`

### Laag 2: Portfolio Analyse
- Berekent budget/conversie-verdeling per campagnetype (PMax, Search, Shopping)
- Detecteert concentratierisico (>70% budget in 1 campagne = risico)
- Berekent portfolio ROAS

### Laag 3: Hypothese Tracking
- Haalt geimplementeerde maar nog niet gemeten hypotheses op
- Koppelt aan de tweewekelijkse evaluatie

### Laag 4: Leading Indicators
- Week-over-week anomalie-detectie:
  - CTR dalingen
  - CPC stijgingen
  - Conversieratio crashes
  - Tracking breaks (clicks stabiel maar conversies >80% gedaald)

### Laag 5: Sector Benchmarks
- Laadt branche-specifieke ranges voor CTR, conversieratio, CPA, ROAS
- Gebruikt kwartielen: bottom quartile, mediaan, top quartile, top 10%

---

## 4. Forecast Engine

**Bestand:** `lib/forecast.ts` (1064 regels)

### 4.1 Verwachte waarden (per maand)
- **3 jaar data beschikbaar:** 50% vorig jaar + 30% jaar daarvoor + 20% twee jaar terug
- **2 jaar:** 65% / 35%
- **1 jaar:** 100%
- Ontbrekende maanden worden overgeslagen (niet als 0 geteld)

### 4.2 Performance Factor
- Per gerealiseerde maand: ratio = werkelijk / verwacht
- Gewogen gemiddelde: recentere maanden wegen 2x zwaarder
- Geclampt tussen 0.3x en 3.0x (voorkomt extreme projecties)
- Minimaal 2 "confident months" nodig voordat trend wordt vertrouwd

### 4.3 Anomalie-detectie (5 lagen)
1. **Outliers:** >3x median absolute deviation → geflagd
2. **Tracking breaks:** conversies <10% van mediaan → uitgesloten
3. **Scaling clients:** spend >2x gestegen van eerste naar laatste maand → apart behandeld
4. **Current-year anomalies:** gerealiseerd <15% of >800% van verwacht → uitgesloten
5. **Efficiency collapse:** conversie/spend ratio disproportioneel gedaald

### 4.4 Spend-adjusted Efficiency
Scheidt budgetbeperkingen van campagneprestaties:
```
Als spend = 85% van verwacht, maar conversies = 90%
→ Efficiency factor = 90% / 85% = 105.9%
→ Forecast = verwacht × spend_factor × efficiency_factor
```

### 4.5 Budget Recommendation
- Berekent huidige CPA uit gerealiseerde maanden
- Bij achterstand op target: extra spend = (target gap × huidige CPA)
- Verdeelt extra spend over resterende maanden

### 4.6 Weekverdeling
- Gerealiseerde weken als individuele datapunten
- Forecast verdeeld per week op basis van historisch weekpatroon
- Voedt de pacing monitor

---

## 5. SOP-Analyses

### 5.1 Maandelijkse Analyse (6 stappen)
**Bestand:** `app/api/analysis/monthly/route.ts`

| Stap | Naam | Wat het doet |
|------|------|-------------|
| 1 | Account Performance | MoM + YoY vergelijking op alle metrics. Seizoenscorrectie: MoM negatief + YoY negatief = seizoen; MoM negatief + YoY positief = structureel probleem. Statistische significantie: <20 conv = 30% drempel, 20-100 = 20%, >100 = 10% |
| 2 | Campaign Performance | Verklaart account-bevindingen op campagneniveau. Detecteert over/underperformers (±15% vs gemiddelde). Portfolio diagnose: PMax/Search kannibalisatie |
| 3 | Ad Group & Zoektermen | Aggregeert ad group performance. Detecteert breakpoints (>30% MoM verandering). Best/worst ad group per campagne |
| 4 | Optimalisatie Aanbevelingen | Scale-kansen in non-brand generiek. Bleeders detectie. Budgetherverdeling. Biedstrategie-aanpassingen |
| 5 | Hypothese Validatie | Meet geimplementeerde hypotheses: verwacht vs gerealiseerd. Impact scoring (high/medium/low). Volgende experimenten |
| 6 | Risico Assessment | Tracking break detectie. Efficiency collapse. Budget pressure (>20% IS lost to budget). Seizoen vs structureel |

**AI Settings per stap:**
- Model: `google/gemini-3-flash-preview` via OpenRouter
- Temperature: 0.1 (deterministisch)
- Max tokens: 4096-8192

### 5.2 Wekelijkse Analyse (Health Check)
**Bestand:** `app/api/analysis/weekly/route.ts`

- Rolling window: 14 dagen
- Focus: anomalieen en spending bleeders
- Input: top 30 verspillende zoektermen + change history + leading indicators
- Doel: snelle actie op urgente problemen

### 5.3 Tweewekelijkse Analyse (Check-in)
**Bestand:** `app/api/analysis/biweekly/route.ts`

- Window: 3 maanden historisch
- Evalueert hypothese-tracking voortgang
- Refereert aan vorige maandelijkse analyse voor continuiteit
- Checkt of geimplementeerde hypotheses meetbaar effect tonen

---

## 6. Zoekterm-analyse

**Bestand:** `app/api/analysis/search-terms/route.ts`

### Flow
1. **Ophalen:** Google Ads API → alle zoektermen met clicks
2. **Context verzamelen:** campagnestructuur, keywords per ad group, locatietargets, advertentieteksten, producttitels (top 30)
3. **Batch-verwerking:** 50 termen per batch, 3 concurrent batches
4. **AI Scoring:**
   - Relevantiescore 1-5 (5 = perfect relevant, 1 = duidelijk irrelevant)
   - Verdict: relevant / partially_relevant / uncertain / irrelevant
   - Actie: keep / negative_exact / negative_phrase / monitor / investigate
5. **Opslag:** `search_term_analysis` tabel met analysis_date

---

## 7. Health Score

**Bestand:** `lib/health-score.ts`

Score 0-100 met A-F grading, gebaseerd op 5 factoren (elk 20 punten):

| Factor | Wat het meet |
|--------|-------------|
| Target Tracking | Voortgang richting KPI targets |
| Spend Efficiency | ROAS/CPA vs doelstellingen |
| Trend | MoM ontwikkeling |
| Budget Utilization | Besteding vs beschikbaar budget |
| Account Hygiene | Anomalieen: MoM >30% changes, CPC >25% stijging, conv rate >25% daling |

---

## 8. Sprint Planning & Hypothese Tracking

| Tabel | Doel |
|-------|------|
| `sprint_hypotheses` | Hypothese, verwacht resultaat, meetmetric, tijdframe, ICE scores |
| `sprint_items` | Taken per week, status (todo/ongoing/done/expired) |
| `sop_hypothesis_tracking` | Geimplementeerd op, meetmetric, gemeten op, meetresultaat |

- ICE Score = Impact (0-10) × Confidence (0-10) × Ease (0-10)
- Tweewekelijkse analyse checkt automatisch of hypotheses meetbaar effect tonen

---

## 9. Campagne-analyse Logica

**Bestand:** `lib/campaign-analysis.ts`

### Classificatie
Campagnes worden geclassificeerd op type: brand, generic, category, shopping, pmax, remarketing, awareness, competitor

### Metrics per campagne (12+)
ROAS, CPA, CTR, conversieratio, CPC, impressies, clicks, conversies, omzet, kosten, CPM, impression share

### Detectie
- **Bleeders:** hoge kosten, lage conversies
- **Declining:** dalende trend over meerdere maanden
- **Scale opportunities:** goede ROAS maar laag volume
- **Manual checks:** Quality Score, Auction Insights, tracking validatie

---

## 10. Prompts & Account Type Awareness

**Bestand:** `lib/prompts/sop-prompts.ts`

Het systeem herkent 5 account types met aangepaste benchmarks:

| Type | Primaire KPI | Benchmark focus |
|------|-------------|----------------|
| `ecommerce_roas` | ROAS | ROAS ranges per sector |
| `ecommerce_cpa` | CPA | CPA targets per productcategorie |
| `leadgen_cpa` | CPA | Cost per lead targets |
| `leadgen_volume` | Volume | Aantal leads |
| `hybrid` | Mix | Combinatie metrics |

Elke prompt bevat:
- Rol: "Senior SEA specialist"
- Account type-specifieke benchmarks
- Berekeningsregels (MoM, YoY, seizoenscorrectie)
- Benchmark interpretatie (bottom quartile → top 10%)

---

## 11. Kansen voor Verbetering

### A. Data & Input
| # | Kans | Impact | Toelichting |
|---|------|--------|-------------|
| 1 | **Automatische data-refresh scheduling** | Hoog | Nu handmatig getriggerd; een cron/scheduler zorgt dat data altijd actueel is |
| 2 | **Google Ads API real-time koppeling** | Hoog | Directe API calls i.p.v. periodieke imports → altijd up-to-date |
| 3 | **Meta Ads integratie** | Hoog | Nu alleen Google Ads; Meta data toevoegen geeft cross-channel beeld |
| 4 | **GA4 / server-side tracking data** | Medium | Conversiedata valideren tegen analytics → tracking break detectie verbeteren |
| 5 | **Competitor data (Auction Insights)** | Medium | Nu niet geimporteerd; zou context geven aan IS-verlies en CPC-stijgingen |

### B. Forecast Engine
| # | Kans | Impact | Toelichting |
|---|------|--------|-------------|
| 6 | **Seizoenspatroon per branche** | Hoog | Nu generieke YoY weging; branche-specifieke seizoenscurves (fashion vs B2B) zouden accurater zijn |
| 7 | **Budget-change aware forecasting** | Hoog | Als budget 30% stijgt, moet forecast dat meenemen i.p.v. alleen historisch patroon |
| 8 | **Confidence intervals** | Medium | Nu punt-schattingen; bandbreedte toevoegen (optimistisch/pessimistisch scenario) |
| 9 | **Campaign-level forecasting** | Medium | Nu alleen account-niveau; per campagne forecasen geeft preciezere steering |
| 10 | **Externe factoren** | Laag | Weer, feestdagen, markttrends als input → verfijnde seizoenscorrectie |

### C. Analyse Pipeline
| # | Kans | Impact | Toelichting |
|---|------|--------|-------------|
| 11 | **Stap-afhankelijkheid in maandanalyse** | Hoog | Stap 2 krijgt nu niet altijd de output van stap 1 als context mee; dit doorvoeren maakt analyses coherenter |
| 12 | **Gestructureerde AI output (JSON)** | Hoog | Nu vrije tekst per stap; JSON output maakt het machine-leesbaar → automatische acties mogelijk |
| 13 | **Feedback loop / kwaliteitsscore** | Hoog | Gebruiker kan aangeven of analyse klopt → model fine-tuning of prompt-aanpassing |
| 14 | **Multi-model vergelijking** | Medium | Nu alleen Gemini Flash; output vergelijken met Claude/GPT-4 voor kwaliteitscheck |
| 15 | **Automatische hypothese-generatie** | Medium | Op basis van analyse-output automatisch hypotheses aanmaken in sprint_hypotheses |
| 16 | **Historische analyse-vergelijking** | Medium | Vorige maandanalyse automatisch meegeven als context → trends over maanden detecteren |

### D. Zoekterm-analyse
| # | Kans | Impact | Toelichting |
|---|------|--------|-------------|
| 17 | **Automatische negative keyword implementatie** | Hoog | Na goedkeuring direct via API toevoegen als negatives |
| 18 | **Zoekterm clustering** | Medium | Gerelateerde termen groeperen → bulkacties i.p.v. per term |
| 19 | **Historische zoekterm trends** | Medium | Dezelfde term over tijd volgen → seizoenspatronen in zoekgedrag |
| 20 | **N-gram analyse** | Laag | Zonder AI: puur statistische n-gram analyse als snelle pre-filter |

### E. UX & Workflow
| # | Kans | Impact | Toelichting |
|---|------|--------|-------------|
| 21 | **One-click analyse → actie** | Hoog | Van analyse-output direct naar implementatie (budget wijzigen, negatives toevoegen) |
| 22 | **Analyse-vergelijking over tijd** | Medium | Dashboard dat analyses naast elkaar zet → is het account verbeterd? |
| 23 | **Alert systeem** | Medium | Push notificaties bij kritieke signalen (tracking break, budget overschrijding) |
| 24 | **Export naar klantrapportage** | Medium | Analyse-output formatteren als klant-friendly rapport |

### F. Architectuur
| # | Kans | Impact | Toelichting |
|---|------|--------|-------------|
| 25 | **Prompt versioning** | Hoog | Prompts nu hardcoded; versioning maakt A/B testing en rollback mogelijk |
| 26 | **Caching van AI responses** | Medium | Zelfde data + prompt = zelfde antwoord; cache voorkomt onnodige API calls |
| 27 | **Error handling & retry logic** | Medium | Nu geen automatische retry bij OpenRouter failures |
| 28 | **Observability / logging** | Medium | Gestructureerde logs per analyse-stap → debugging en kwaliteitsbewaking |

---

## 12. Bestandsoverzicht

| Bestand | Regels | Functie |
|---------|--------|---------|
| `lib/forecast.ts` | 1064 | Forecast engine met anomalie-detectie |
| `lib/campaign-analysis.ts` | 687 | Campagne-analyse met type-classificatie |
| `lib/analysis/expert-layers.ts` | 500+ | 5 verrijkingslagen voor context |
| `lib/analysis/helpers.ts` | 340 | Core helpers (OpenRouter, Supabase, dates) |
| `lib/analysis/compute-targets.ts` | 193 | Forecast input builder |
| `lib/analysis/aggregate-adgroups.ts` | 265 | Ad group aggregatie & breakpoint detectie |
| `app/api/analysis/monthly/route.ts` | 838 | 6-staps maandelijkse pipeline |
| `app/api/analysis/weekly/route.ts` | 100 | Wekelijkse health check |
| `app/api/analysis/biweekly/route.ts` | 112 | Tweewekelijkse check-in |
| `app/api/analysis/search-terms/route.ts` | 365 | Zoekterm-analyse met batching |
| `lib/prompts/sop-prompts.ts` | 600+ | Systeem-prompts per analyse type |
| `lib/prompts/search-term-prompts.ts` | 82 | Zoekterm scoring prompt |
| `lib/health-score.ts` | 100+ | Health score (0-100, A-F) |
| `lib/analysis-context.tsx` | 154 | React context voor job management |
