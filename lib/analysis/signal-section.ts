// A-track wiring: de signaal-sectie voor de Google maandpipeline. Pure builder die de al
// geladen route-datasets naar de detector-inputs mapt, de categorie-A/B-detectors en de
// metric-cross-checks draait, en EEN compacte prompt-sectie rendert met de harde instructie:
// elk getriggerd signaal wordt in de relevante stap geadresseerd of expliciet weerlegd.
//
// Drie eerlijkheidsconstructies die hier hard zijn:
// (1) Zonder geladen change-history kan eigen handelen niet uitgesloten worden. De
//     degradatie gebeurt op SECTIE-niveau (downgradeWithoutChangeHistory), niet via een
//     synthetisch change-event: OWN_CHANGE_RESOURCE_TYPES is een whitelist, dus een
//     onbekend-event zou eruit gefilterd worden en de detector zou juist "bewezen" claimen.
// (2) De account-impressies per maand komen uit de impression-share-tabel (zes maanden in
//     de route) en niet uit de account-tabel (alleen de analysemaand). Dat is een subset:
//     search-campagnes met IS-data. De scope-labeling zegt dat er letterlijk bij.
// (3) De sync schrijft *_yoy_pct als PROCENT (yoyPct in de orchestrator: maal 100), de
//     detector verwacht een relatieve fractie. De conversie zit in de route-mapper.

import {
  detectConcurrentiedruk,
  detectBrandOnderVuur,
  type AuctionCampaignInput,
  type OwnChangeEvent,
} from "@/lib/signals/google-auction-competition";
import { detectSeizoenspatroon, detectMarktShiftBevestigd } from "@/lib/signals/google-demand";
import { detectBelofteVersusLevering, type FunnelCampaignInput } from "@/lib/signals/google-funnel";
import { detectWinnerStarves, type StarveCampaignInput } from "@/lib/signals/google-budget";
import { detectScheduleWaste, type ScheduleSlotInput } from "@/lib/signals/google-schedule";
import { detectNetwerkLek, type NetworkRow as NetworkSignalRow } from "@/lib/signals/google-network";
import { detectLpBreukVersusKanaal, type BreachCampaignInput, type BreachDeviceInput } from "@/lib/signals/google-conversion";
import { detectBroadDrift, type SearchTermRow } from "@/lib/signals/google-search-terms";
import { detectNegativeConflicts, type PositiveKeyword, type NegativeKeyword } from "@/lib/signals/google-negative-conflicts";
import { mergeDetections, pct, type DetectionResult, type SignalStory } from "@/lib/signals/types";
import {
  spendWeightedQualityScore,
  classifyRankLossCause,
  decomposeDemandVsShare,
  classifyCpcPressure,
  classifyBudgetLost,
} from "@/lib/analysis/metric-cross-checks";

export const MAX_STORIES_IN_SECTION = 6;
export const BUDGET_LOST_MENTION_THRESHOLD = 0.1; // vanaf tien procent budget-verlies vermelden
export const TOP_CAMPAIGNS_FOR_DETECTION = 8; // op kosten; begrenst de sectie en de rekenlast

export interface CampaignIsRow {
  campaign_name: string | null;
  month: string;
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
  search_impression_share: number | null;
  search_budget_lost_is: number | null;
  search_rank_lost_is: number | null;
  budget_utilization: number | null;
}

export interface KeywordMonthlyRow {
  campaign_name: string | null;
  month: string;
  cost: number | null;
  quality_score: number | null;
  // Voor de conflictchecker: de tabel draagt deze kolommen al.
  ad_group_name?: string | null;
  keyword_text?: string | null;
  match_type?: string | null;
  conversions?: number | null;
}

// ads_negative_keywords (migratie 022): drie niveaus, inclusief gedeelde lijsten.
export interface NegativeKeywordRow {
  level: string | null;
  campaign_name: string | null;
  ad_group_name: string | null;
  list_name: string | null;
  keyword_text: string | null;
  match_type: string | null;
}

// ads_ad_schedule_performance: een venster met period_start en period_end, uitgesplitst
// naar dag en uur. De route laadt hem al.
export interface ScheduleRow {
  day_of_week: string | number | null;
  hour_of_day: number | null;
  cost: number | null;
  clicks: number | null;
  conversions: number | null;
}

// ads_network_performance_monthly: per campagne per netwerk per maand.
export interface NetworkMonthlyRow {
  campaign_name: string | null;
  month: string;
  network_type: string | null;
  cost: number | null;
  clicks: number | null;
  conversions: number | null;
}

// ads_device_performance_monthly: per apparaat per maand (level en campagne erbij).
export interface DeviceMonthlyRow {
  month: string;
  device: string | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
}

// ads_search_terms_monthly: match_type is sinds de aggregatie-fix het DOMINANTE match-type
// van die zoekterm in die maand.
export interface SearchTermMonthlyLite {
  month: string;
  match_type: string | null;
  cost: number | null;
  clicks: number | null;
  conversions: number | null;
}

export interface ChangeHistoryRow {
  resource_type: string | null;
  campaign_name: string | null;
}

export interface CampaignMonthlyRow {
  campaign_name: string | null;
  month: string;
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
  conversions: number | null;
}

export interface SignalSectionInput {
  periodMonth: string; // YYYY-MM van de analysemaand
  prevMonth: string; // YYYY-MM van de maand ervoor
  campaignIs: CampaignIsRow[]; // meerdere maanden; de route laadt er zes
  // De impression-share-tabel draagt geen conversies, dus de funnel-check heeft de
  // campagne-maandtabel nodig. Leeg laten is toegestaan: dan slaat de check zichzelf over.
  campaignMonthly: CampaignMonthlyRow[];
  keywords: KeywordMonthlyRow[];
  // Leeg laten is toegestaan: de schedule-check slaat zichzelf dan over.
  schedule: ScheduleRow[];
  // Leeg laten is toegestaan: de netwerk-check slaat zichzelf dan over.
  networks: NetworkMonthlyRow[];
  // De PMax-campagnes; die vallen af bij de netwerk-check want daar horen meerdere netwerken.
  pmaxCampaignNames: string[];
  // Leeg laten is toegestaan: de LP-breuk-check valt dan terug op het sitewide-verhaal.
  devices: DeviceMonthlyRow[];
  // Leeg laten is toegestaan: de broad-drift-check slaat zichzelf dan over.
  searchTerms: SearchTermMonthlyLite[];
  // Leeg laten is toegestaan: de conflictchecker slaat zichzelf dan over.
  negatives: NegativeKeywordRow[];
  yoyImpressionsDeltaFraction: number | null; // RELATIEF (0,15 = plus vijftien procent), null als onbekend
  // De zoektermvolumes van de analysemaand en de maand ervoor (som van de
  // zoekterm-impressies). Dit is de DERDE onafhankelijke bron voor de marktshift-
  // bevestiging; null betekent dat de bron ontbreekt en de detector zwijgt.
  searchTermsVolume: number | null;
  prevSearchTermsVolume: number | null;
  changeHistory: ChangeHistoryRow[] | null; // null = bron niet geladen, dus degradatie
  hasPmaxCampaign: boolean;
}

export interface SignalSectionResult {
  section: string; // leeg als er niets te melden valt
  triggeredCount: number;
  checkedIds: string[];
  uncontrollable: string[];
}

const monthKey = (value: string) => String(value).slice(0, 7);

function isBrandedName(name: string): boolean {
  return /\bbrand\b|\bmerk\b|branded/i.test(name);
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (typeof v === "number" && Number.isFinite(v) ? v : 0), 0);
}

// Bouwt per campagne (top N op kosten in de analysemaand) de detector-input.
export function buildCampaignInputs(input: SignalSectionInput): AuctionCampaignInput[] {
  const current = input.campaignIs.filter((r) => monthKey(r.month) === input.periodMonth && r.campaign_name);
  const previous = new Map(
    input.campaignIs.filter((r) => monthKey(r.month) === input.prevMonth && r.campaign_name).map((r) => [r.campaign_name as string, r])
  );

  const qsFor = (campaign: string, month: string): number | null =>
    spendWeightedQualityScore(
      input.keywords
        .filter((k) => k.campaign_name === campaign && monthKey(k.month) === month)
        .map((k) => ({ cost: k.cost ?? 0, quality_score: k.quality_score }))
    );

  // Bij een ontbrekende bron blijft de lijst leeg; de certainty-degradatie gebeurt daarna
  // op sectie-niveau, want een synthetisch event zou door de whitelist gefilterd worden.
  const changesFor = (campaign: string): OwnChangeEvent[] =>
    (input.changeHistory ?? [])
      .filter((c) => c.campaign_name === campaign || c.campaign_name == null)
      .map((c) => ({ resource_type: c.resource_type ?? "onbekend", campaign_name: c.campaign_name }));

  return current
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
    .slice(0, TOP_CAMPAIGNS_FOR_DETECTION)
    .map((row) => {
      const name = row.campaign_name as string;
      const prev = previous.get(name);
      return {
        campaignName: name,
        isBranded: isBrandedName(name),
        impressionShare: row.search_impression_share ?? 0,
        prevImpressionShare: prev?.search_impression_share ?? 0,
        rankLostIs: row.search_rank_lost_is ?? 0,
        prevRankLostIs: prev?.search_rank_lost_is ?? 0,
        cpc: (row.clicks ?? 0) > 0 ? (row.cost ?? 0) / (row.clicks as number) : 0,
        prevCpc: prev && (prev.clicks ?? 0) > 0 ? (prev.cost ?? 0) / (prev.clicks as number) : 0,
        impressions: row.impressions ?? 0,
        prevImpressions: prev?.impressions ?? 0,
        spendWeightedQs: qsFor(name, input.periodMonth),
        prevSpendWeightedQs: qsFor(name, input.prevMonth),
        ownChanges: changesFor(name),
      };
    });
}

// De eerlijkheidsdegradatie: zonder change-history-bron mag geen verhaal "bewezen" claimen,
// want de bewijsvoering van die detectors leunt op de afwezigheid van eigen wijzigingen.
export function downgradeWithoutChangeHistory(stories: SignalStory[]): SignalStory[] {
  return stories.map((story) =>
    story.certainty === "bewezen_binnen_platform"
      ? {
          ...story,
          certainty: "indicatie" as const,
          story: `${story.story} Let op: de wijzigingshistorie is niet beschikbaar in deze run, dus eigen bod- of budgetwijzigingen zijn niet uit te sluiten als oorzaak.`,
        }
      : story
  );
}

function renderStory(story: SignalStory): string {
  const evidence = story.evidence.map((e) => `${e.metric}: ${e.value}${e.prev != null ? ` (vorige periode ${e.prev})` : ""}`).join("; ");
  return `- [${story.certainty}] ${story.scope}: ${story.story} Bewijs: ${evidence}. Betekenis: ${story.actionDirection}`;
}

export function buildGoogleSignalsSection(input: SignalSectionInput): SignalSectionResult {
  const detections: DetectionResult[] = [];
  const uncontrollable: string[] = [];

  // Categorie A: per campagne concurrentiedruk en brand-onder-vuur.
  for (const campaign of buildCampaignInputs(input)) {
    detections.push(detectConcurrentiedruk(campaign));
    detections.push(detectBrandOnderVuur(campaign));
  }
  if (input.hasPmaxCampaign) {
    uncontrollable.push("PMax-kannibalisatie: de PMax-categorielabels zitten niet in de sync, dus de overlap met de eigen zoektermen is niet meetbaar");
  }

  // Diagnose-check 5: belofte versus levering, per campagne op de analysemaand.
  const funnelInputs: FunnelCampaignInput[] = input.campaignMonthly
    .filter((r) => monthKey(r.month) === input.periodMonth && r.campaign_name)
    .map((r) => ({
      campaignName: r.campaign_name as string,
      impressions: r.impressions ?? 0,
      clicks: r.clicks ?? 0,
      conversions: r.conversions ?? 0,
    }));
  detections.push(detectBelofteVersusLevering(funnelInputs));

  // Categorie F: winner starves. Combineert de campagne-maanddata (kosten en conversies,
  // twee maanden) met het budget-verlies uit de IS-tabel.
  const budgetLostByCampaign = new Map<string, number>(
    input.campaignIs
      .filter((r) => monthKey(r.month) === input.periodMonth && r.campaign_name)
      .map((r) => [r.campaign_name as string, r.search_budget_lost_is ?? 0])
  );
  const prevMonthly = new Map<string, CampaignMonthlyRow>(
    input.campaignMonthly.filter((r) => monthKey(r.month) === input.prevMonth && r.campaign_name).map((r) => [r.campaign_name as string, r])
  );
  const starveInputs: StarveCampaignInput[] = input.campaignMonthly
    .filter((r) => monthKey(r.month) === input.periodMonth && r.campaign_name && prevMonthly.has(r.campaign_name as string))
    .map((r) => {
      const prev = prevMonthly.get(r.campaign_name as string) as CampaignMonthlyRow;
      return {
        campaignName: r.campaign_name as string,
        cost: r.cost ?? 0,
        prevCost: prev.cost ?? 0,
        conversions: r.conversions ?? 0,
        prevConversions: prev.conversions ?? 0,
        budgetLostIs: budgetLostByCampaign.get(r.campaign_name as string) ?? 0,
      };
    });
  detections.push(detectWinnerStarves(starveInputs));

  // Diagnose-check 8: schedule-waste. De tabel draagt een eigen venster (period_start en
  // period_end) en is dus niet naar de analysemaand te filteren; de check kijkt naar wat er
  // in dat venster staat.
  const scheduleInputs: ScheduleSlotInput[] = input.schedule
    .filter((r) => r.day_of_week != null && r.hour_of_day != null)
    .map((r) => ({
      dayOfWeek: r.day_of_week as string | number,
      hourOfDay: r.hour_of_day as number,
      cost: r.cost ?? 0,
      clicks: r.clicks ?? 0,
      conversions: r.conversions ?? 0,
    }));
  detections.push(detectScheduleWaste(scheduleInputs));

  // Netwerk-lek per campagne. Bewust naast de accountbrede netwerk-mix in
  // pmax-expert-layer.ts: die telt alle netwerken over het account op en verbergt daardoor
  // een enkele zoekcampagne die naar Display lekt zodra er PMax draait.
  const networkInputs: NetworkSignalRow[] = input.networks
    .filter((r) => monthKey(r.month) === input.periodMonth && r.campaign_name && r.network_type)
    .map((r) => ({
      campaignName: r.campaign_name as string,
      networkType: r.network_type as string,
      cost: r.cost ?? 0,
      clicks: r.clicks ?? 0,
      conversions: r.conversions ?? 0,
    }));
  detections.push(detectNetwerkLek(networkInputs, new Set(input.pmaxCampaignNames)));

  // Categorie E: LP-breuk versus kanaalprobleem. De eigenaarsvraag: zakt de conversieratio
  // bij vrijwel alle campagnes tegelijk terwijl de CTR staat, dan ligt het achter de klik.
  const pairFor = (rows: CampaignMonthlyRow[]) => {
    const now = rows.filter((r) => monthKey(r.month) === input.periodMonth);
    const prev = new Map(rows.filter((r) => monthKey(r.month) === input.prevMonth && r.campaign_name).map((r) => [r.campaign_name as string, r]));
    return now
      .filter((r) => r.campaign_name && prev.has(r.campaign_name as string))
      .map((r) => {
        const p = prev.get(r.campaign_name as string) as CampaignMonthlyRow;
        return {
          campaignName: r.campaign_name as string,
          impressions: r.impressions ?? 0,
          clicks: r.clicks ?? 0,
          conversions: r.conversions ?? 0,
          prevImpressions: p.impressions ?? 0,
          prevClicks: p.clicks ?? 0,
          prevConversions: p.conversions ?? 0,
        } as BreachCampaignInput;
      });
  };
  const deviceAgg = new Map<string, BreachDeviceInput>();
  for (const row of input.devices) {
    if (!row.device) continue;
    const isNow = monthKey(row.month) === input.periodMonth;
    const isPrev = monthKey(row.month) === input.prevMonth;
    if (!isNow && !isPrev) continue;
    const entry = deviceAgg.get(row.device) ?? { device: row.device, impressions: 0, clicks: 0, conversions: 0, prevImpressions: 0, prevClicks: 0, prevConversions: 0 };
    if (isNow) {
      entry.impressions += row.impressions ?? 0;
      entry.clicks += row.clicks ?? 0;
      entry.conversions += row.conversions ?? 0;
    } else {
      entry.prevImpressions += row.impressions ?? 0;
      entry.prevClicks += row.clicks ?? 0;
      entry.prevConversions += row.conversions ?? 0;
    }
    deviceAgg.set(row.device, entry);
  }
  detections.push(detectLpBreukVersusKanaal({ campaigns: pairFor(input.campaignMonthly), devices: [...deviceAgg.values()] }));

  // Categorie G: broad-drift. Draait op dezelfde zoektermtabel die de marktshift-check al
  // gebruikt, dus de route heeft er geen extra query voor nodig.
  detections.push(
    detectBroadDrift({
      rows: input.searchTerms.map((r) => ({
        month: r.month,
        matchType: r.match_type,
        cost: r.cost ?? 0,
        clicks: r.clicks ?? 0,
        conversions: r.conversions ?? 0,
      })) as SearchTermRow[],
      periodMonth: input.periodMonth,
      prevMonth: input.prevMonth,
    })
  );

  // Categorie G: negative-conflicten. De keyword-tabel levert de positieve kant (met tekst
  // en match-type), migratie 022 de negatieve kant inclusief de gedeelde lijsten.
  const positives: PositiveKeyword[] = input.keywords
    .filter((k) => monthKey(k.month) === input.periodMonth && k.keyword_text && k.campaign_name)
    .map((k) => ({
      campaignName: k.campaign_name as string,
      adGroupName: k.ad_group_name ?? "",
      keywordText: k.keyword_text as string,
      matchType: k.match_type ?? "",
      cost: k.cost ?? 0,
      conversions: k.conversions ?? 0,
    }));
  const negativeInputs: NegativeKeyword[] = input.negatives
    .filter((n) => n.keyword_text && n.level)
    .map((n) => ({
      level: n.level as NegativeKeyword["level"],
      campaignName: n.campaign_name ?? "",
      adGroupName: n.ad_group_name ?? "",
      listName: n.list_name ?? "",
      keywordText: n.keyword_text as string,
      matchType: n.match_type ?? "",
    }));
  detections.push(detectNegativeConflicts({ positives, negatives: negativeInputs }));

  // Categorie B: seizoen. De account-impressies komen uit de IS-tabel (zes maanden); dat is
  // de subset search-campagnes met IS-data en de scope zegt dat erbij.
  const isCurrent = input.campaignIs.filter((r) => monthKey(r.month) === input.periodMonth);
  const isPrev = input.campaignIs.filter((r) => monthKey(r.month) === input.prevMonth);
  const imprCurrent = sum(isCurrent.map((r) => r.impressions));
  const imprPrev = sum(isPrev.map((r) => r.impressions));
  if (imprPrev > 0) {
    detections.push(
      detectSeizoenspatroon({
        scope: "account (search-campagnes met impression share)",
        momDeltaPct: (imprCurrent - imprPrev) / imprPrev,
        yoySameMonthDeltaPct: input.yoyImpressionsDeltaFraction,
      })
    );
  }

  // De decompositie wordt HIER berekend, VOOR de merge: hij voedt zowel de
  // marktshift-detector als de cross-check-regel. Een detector die na mergeDetections
  // gepusht wordt, komt nooit in de verhalen terecht.
  const weightedIs = (rows: CampaignIsRow[]): number => {
    const weight = sum(rows.map((r) => r.impressions));
    return weight > 0 ? sum(rows.map((r) => (r.search_impression_share ?? 0) * (r.impressions ?? 0))) / weight : 0;
  };
  const accIsNow = weightedIs(isCurrent);
  const accIsPrev = weightedIs(isPrev);
  const decomposition =
    imprPrev > 0 && accIsNow > 0 && accIsPrev > 0
      ? decomposeDemandVsShare({ impressions: imprCurrent, impressionShare: accIsNow, prevImpressions: imprPrev, prevImpressionShare: accIsPrev })
      : null;

  // Categorie B: marktshift-bevestiging. Deze detector eist DRIE onafhankelijke bronnen (de
  // decompositie, de zoektermvolumes en de jaar-op-jaar-beweging) en is daarmee het
  // zwaarste bewijs in de bibliotheek. Ontbreekt een bron, dan zwijgt hij uit zichzelf.
  if (decomposition) {
    if (input.searchTermsVolume != null && input.prevSearchTermsVolume != null) {
      detections.push(
        detectMarktShiftBevestigd({
          scope: "account (search-campagnes met impression share)",
          decomposition,
          searchTermsVolume: input.searchTermsVolume,
          prevSearchTermsVolume: input.prevSearchTermsVolume,
          yoyImpressionsPct: input.yoyImpressionsDeltaFraction,
        })
      );
    } else {
      uncontrollable.push("Marktshift-bevestiging: de zoektermvolumes van deze twee maanden ontbreken, dus de derde bevestigingsbron is er niet");
    }
  }

  const merged = mergeDetections(detections);
  const triggered = input.changeHistory == null ? downgradeWithoutChangeHistory(merged.triggered) : merged.triggered;
  const stories = triggered.slice(0, MAX_STORIES_IN_SECTION);

  // De cross-checks: impressie-gewogen op accountniveau plus budgetverlies per campagne.
  const crossLines: string[] = [];
  if (decomposition) {
    crossLines.push(`- Vraag versus aandeel: ${decomposition.verdict}. ${decomposition.detail}`);

    const accountQs = spendWeightedQualityScore(
      input.keywords.filter((k) => monthKey(k.month) === input.periodMonth).map((k) => ({ cost: k.cost ?? 0, quality_score: k.quality_score }))
    );
    const rankLostWeighted = sum(isCurrent.map((r) => (r.search_rank_lost_is ?? 0) * (r.impressions ?? 0))) / Math.max(imprCurrent, 1);
    const rankLoss = classifyRankLossCause(rankLostWeighted, accountQs);
    crossLines.push(`- Rangverlies-oorzaak (impressie-gewogen): ${rankLoss.cause}. ${rankLoss.detail}`);

    const clicksNow = sum(isCurrent.map((r) => r.clicks));
    const clicksPrev = sum(isPrev.map((r) => r.clicks));
    if (clicksNow > 0 && clicksPrev > 0) {
      const cpcPressure = classifyCpcPressure({
        cpc: sum(isCurrent.map((r) => r.cost)) / clicksNow,
        prevCpc: sum(isPrev.map((r) => r.cost)) / clicksPrev,
        impressionShare: accIsNow,
        prevImpressionShare: accIsPrev,
      });
      crossLines.push(`- CPC-druk: ${cpcPressure.pressure}. ${cpcPressure.detail}`);
    }
  }

  for (const row of isCurrent
    .filter((r) => (r.search_budget_lost_is ?? 0) >= BUDGET_LOST_MENTION_THRESHOLD)
    .sort((a, b) => (b.search_budget_lost_is ?? 0) - (a.search_budget_lost_is ?? 0))
    .slice(0, 3)) {
    const verdict = classifyBudgetLost(row.search_budget_lost_is ?? 0, row.budget_utilization);
    crossLines.push(`- Budgetverlies ${row.campaign_name}: ${verdict.verdict} (verlies ${pct(row.search_budget_lost_is ?? 0)}). ${verdict.detail}`);
  }

  if (stories.length === 0 && crossLines.length === 0) {
    return { section: "", triggeredCount: 0, checkedIds: merged.checked, uncontrollable };
  }

  const lines: string[] = [];
  lines.push("## Deterministisch gedetecteerde signalen en cross-checks");
  lines.push("");
  lines.push(
    "Deze bevindingen zijn vooraf uit de ruwe data berekend. VERPLICHT: adresseer elke getriggerde bevinding in de stap waar zij thuishoort, of weerleg haar beargumenteerd; stilzwijgend negeren is een kwaliteitsfout. Neem de zekerheidslabels letterlijk over en claim nooit meer zekerheid dan het label geeft."
  );
  lines.push("");
  if (stories.length > 0) {
    lines.push("### Getriggerde signalen");
    for (const story of stories) lines.push(renderStory(story));
    lines.push("");
  }
  if (crossLines.length > 0) {
    lines.push("### Cross-checks");
    lines.push(...crossLines);
    lines.push("");
  }
  lines.push("### Gecontroleerd, niet getriggerd");
  lines.push(merged.checked.filter((id) => !stories.some((s) => s.id === id)).join(", ") || "geen");
  if (uncontrollable.length > 0) {
    lines.push("");
    lines.push("### Niet controleerbaar in deze run");
    for (const reason of uncontrollable) lines.push(`- ${reason}`);
  }

  return { section: lines.join("\n"), triggeredCount: stories.length, checkedIds: merged.checked, uncontrollable };
}
