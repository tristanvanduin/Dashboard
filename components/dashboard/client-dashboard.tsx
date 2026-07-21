"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, Settings, Calendar, Target, Loader2, AlertTriangle, Wifi, Clock, LayoutGrid, Lightbulb, TrendingUp, FolderOpen, Users, Kanban, ClipboardCheck, FileText, Globe, Megaphone, Briefcase, Layers } from "lucide-react";
import { countryLabel } from "@/lib/countries";
import { SyncStatusBadge } from "./sync-status-badge";
import { getClientSettings } from "@/lib/client-settings";
import { SecondOpinionView } from "./second-opinion-view";
import { MetricCards } from "./metric-cards";
import { MonthlyOverview } from "./monthly-overview";
import { PerformanceChart } from "./performance-chart";
import { ClientSettingsPanel } from "./client-settings";
import { InsightsBlock } from "../insights/insights-block";
import { RecommendationsBlock } from "../insights/recommendations-block";
import { TasksBlock } from "../insights/tasks-block";
import { TaskImpactReminder } from "../insights/task-impact-reminder";
import { SopTriggerButtons, type SopError } from "../insights/sop-trigger-buttons";
import { StandaloneAnalyses } from "../insights/standalone-analyses";
import { HypothesesBlock } from "../insights/hypotheses-block";
import { ProposalQueue } from "../insights/proposal-queue";
import { ChannelFilter } from "../insights/channel-filter";
import { MetaCreativeAnalyses } from "../insights/meta-creative-analyses";
import { SignalAnalysisCard } from "./signal-analysis-card";
import { CreativePerformance } from "./creative-performance";
import { ChannelForecast } from "./channel-forecast";
import { CreativeDeepDive } from "./creative-deep-dive";
import { DEMO_GREENTECH_ID } from "@/lib/demo/greentech-mock";
import type { InsightChannel } from "@/lib/insights/channel-of";
import { SprintPlanning } from "../insights/sprint-planning";
import { CampaignTable } from "./campaign-table";
import { SearchTermsTable } from "./search-terms-table";
import { HealthBadge } from "./health-badge";
import { PacingMonitor } from "./pacing-monitor";
import { ClientNotes } from "./client-notes";
import { ForecastTable } from "./forecast-table";
import { ClientFiles } from "./client-files";
import { DgmView } from "./dgm-view";
import { MetaView } from "./meta-view";
import { LinkedInView } from "./linkedin-view";
import { CrossChannelView } from "./cross-channel-view";
import { BrandingView } from "./branding-view";
import { EventSettings } from "./event-settings";
import { GeoCloneSettingsPanel } from "./geo-clone-settings";
import { ChannelConversionSettings } from "./channel-conversion-settings";
import { ChannelStructureAnalysis } from "./channel-structure-analysis";
import { GeoCloneScope } from "./geo-clone-scope";
import { GeoCloneOverview } from "./geo-clone-overview";
import { TrackingAlert } from "./tracking-alert";
import { ClientReporting } from "./client-reporting";
import { useClientData } from "@/lib/use-client-data";
import { ClientDataProvider } from "@/lib/client-data-provider";
import { AnalysisProvider } from "@/lib/analysis-context";

interface Client {
  id: string;
  name: string;
  source?: string;
}

type Tab = "dashboard" | "campaigns" | "forecast" | "insights" | "outcomes" | "sprint" | "reporting" | "dgm" | "second-opinion" | "files" | "settings";

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-rm-blue/10 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-bold text-rm-blue">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

type Channel = "google" | "meta" | "linkedin" | "blended";

const CHANNELS: { id: Channel; label: string; icon: React.ReactNode }[] = [
  { id: "blended", label: "Alle kanalen", icon: <Layers className="w-3.5 h-3.5" /> },
  { id: "google", label: "Google Ads", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "meta", label: "Meta", icon: <Megaphone className="w-3.5 h-3.5" /> },
  { id: "linkedin", label: "LinkedIn", icon: <Briefcase className="w-3.5 h-3.5" /> },
];

function ChannelTabs({ channel, onChange }: { channel: Channel; onChange: (c: Channel) => void }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
      {CHANNELS.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            channel === c.id ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground hover:text-rm-gray"
          }`}
        >
          {c.icon}
          {c.label}
        </button>
      ))}
    </div>
  );
}

// Nieuwe, gegroepeerde IA — VOORLOOPT als demo, uitsluitend voor de demo-greentech-klant.
// De 11 losse tabs worden vier secties met sub-navigatie; de nieuwe termen (Analyseren /
// Bevindingen / Doelen & voortgang) vervangen de oude labels. De tab-INHOUD verandert niet —
// alleen de navigatie hergroepeert (activeTab blijft dezelfde id-set).
const CLIENT_SECTIONS: { id: string; label: string; icon: React.ReactNode; tabs: Tab[] }[] = [
  { id: "prestaties", label: "Prestaties", icon: <BarChart3 className="w-4 h-4" />, tabs: ["dashboard", "campaigns", "forecast"] },
  { id: "analyse", label: "Analyse & advies", icon: <Lightbulb className="w-4 h-4" />, tabs: ["insights", "outcomes", "second-opinion"] },
  { id: "planning", label: "Planning & rapportage", icon: <Kanban className="w-4 h-4" />, tabs: ["sprint", "dgm", "reporting", "files"] },
  { id: "instellingen", label: "Instellingen", icon: <Settings className="w-4 h-4" />, tabs: ["settings"] },
];
const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Overzicht", campaigns: "Campagnes", forecast: "Prognose",
  insights: "Analyseren", outcomes: "Bevindingen", "second-opinion": "Second opinion",
  sprint: "Sprint", dgm: "Doelen & voortgang", reporting: "Rapporten", files: "Bestanden",
  settings: "Instellingen",
};

function GroupedTabNav({ activeTab, onChange, sopErrorCount }: { activeTab: Tab; onChange: (t: Tab) => void; sopErrorCount: number }) {
  const activeSection = CLIENT_SECTIONS.find((s) => s.tabs.includes(activeTab)) ?? CLIENT_SECTIONS[0];
  return (
    <div className="space-y-2">
      {/* Top: de vier secties */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {CLIENT_SECTIONS.map((s) => {
          const active = s.id === activeSection.id;
          const showBadge = s.tabs.includes("files") && sopErrorCount > 0;
          return (
            <button key={s.id} onClick={() => onChange(s.tabs[0])}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${active ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground hover:text-rm-gray"}`}>
              {s.icon}{s.label}
              {showBadge && <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-red-500 text-white">{sopErrorCount}</span>}
            </button>
          );
        })}
      </div>
      {/* Sub-navigatie binnen de sectie (alleen bij meer dan één) */}
      {activeSection.tabs.length > 1 && (
        <div className="flex gap-1 flex-wrap pl-1">
          {activeSection.tabs.map((t) => {
            const active = activeTab === t;
            return (
              <button key={t} onClick={() => onChange(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${active ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"}`}>
                {TAB_LABELS[t]}
                {t === "files" && sopErrorCount > 0 && <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-red-500 text-white">{sopErrorCount}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ClientDashboard({ client }: { client: Client }) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [channel, setChannel] = useState<Channel>("blended");
  // Beurs-scope; initieel en live gestuurd door ?geo= uit het menu (Fase 3), daarna ook
  // via de kiezer in de view aanpasbaar.
  const searchParams = useSearchParams();
  const geoParam = searchParams.get("geo");
  const [geoClone, setGeoClone] = useState<string | null>(geoParam);
  useEffect(() => { setGeoClone(geoParam); }, [geoParam]);
  const [sopErrors, setSopErrors] = useState<SopError[]>([]);
  const clientData = useClientData(client.id);
  const [lagDays, setLagDays] = useState<number>(3);
  const [refreshKey, setRefreshKey] = useState(0);
  const [countryFilter, setCountryFilter] = useState<string | null>(null);

  useEffect(() => {
    const settings = getClientSettings(client.id);
    setLagDays(settings.conversionLagDays ?? 3);
  }, [client.id]);

  return (
    <div className="space-y-6">
      {/* Data source indicator + sync status */}
      {clientData.source === "api" && !clientData.loading && !clientData.error && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
            <Wifi className="w-3.5 h-3.5" />
            Live data uit Google Ads
          </div>
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <Clock className="w-3.5 h-3.5" />
            Conversielag: {lagDays} {lagDays === 1 ? "dag" : "dagen"}
          </div>
          <SyncStatusBadge
            clientId={client.id}
            onSyncComplete={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      )}

      {/* Tab navigation — demo-greentech krijgt de nieuwe gegroepeerde IA (voorproefje) */}
      {client.id === DEMO_GREENTECH_ID ? (
        <GroupedTabNav activeTab={activeTab} onChange={setActiveTab} sopErrorCount={sopErrors.length} />
      ) : (
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { id: "dashboard", label: "Overzicht", icon: <BarChart3 className="w-4 h-4" /> },
          { id: "campaigns", label: "Campagnes", icon: <LayoutGrid className="w-4 h-4" /> },
          { id: "forecast", label: "Prognose", icon: <TrendingUp className="w-4 h-4" /> },
          { id: "insights", label: "Analyses", icon: <Lightbulb className="w-4 h-4" /> },
          { id: "outcomes", label: "Inzichten", icon: <Target className="w-4 h-4" /> },
          { id: "sprint", label: "Sprintplanning", icon: <Kanban className="w-4 h-4" /> },
          { id: "reporting", label: "Rapportage", icon: <FileText className="w-4 h-4" /> },
          { id: "dgm", label: "BMS", icon: <Users className="w-4 h-4" /> },
          { id: "second-opinion", label: "Second Opinion", icon: <ClipboardCheck className="w-4 h-4" /> },
          { id: "files", label: "Bestanden", icon: <FolderOpen className="w-4 h-4" /> },
          { id: "settings", label: "Instellingen", icon: <Settings className="w-4 h-4" /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-white text-rm-blue shadow-sm"
                : "text-muted-foreground hover:text-rm-gray"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "files" && sopErrors.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-red-500 text-white">
                {sopErrors.length}
              </span>
            )}
          </button>
        ))}
      </div>
      )}

      {/* Loading state */}
      {clientData.loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-rm-blue" />
          <p className="text-sm text-muted-foreground">Data ophalen uit Google Ads...</p>
        </div>
      )}

      {/* Error state */}
      {clientData.error && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <p className="text-sm text-red-600 font-medium">Fout bij ophalen data</p>
          <p className="text-xs text-muted-foreground max-w-md text-center">{clientData.error}</p>
        </div>
      )}

      {/* All content wrapped in data provider */}
      {clientData.data && (
        <ClientDataProvider clientId={client.id}>
        <AnalysisProvider>
          <TrackingAlert clientId={client.id} onNavigateToSettings={() => setActiveTab("settings")} />

          <GeoCloneScope value={geoClone} onChange={setGeoClone} />

          {activeTab === "dashboard" && (
            <div className="space-y-6">
              <ChannelTabs channel={channel} onChange={setChannel} />
              {channel === "meta" && <MetaView clientId={client.id} geoClone={geoClone} />}
              {channel === "linkedin" && <LinkedInView clientId={client.id} geoClone={geoClone} />}
              {channel === "blended" && <CrossChannelView clientId={client.id} />}
              {channel === "google" && (
              <>
              <HealthBadge clientId={client.id} />
              {geoClone ? (
                // Beurs gekozen: her-geaggregeerd beursoverzicht (uit campagnedata) i.p.v. de
                // account-brede kaarten, die niet per beurs te splitsen zijn.
                <>
                  <GeoCloneOverview clientId={client.id} geoClone={geoClone} />
                  <ClientNotes clientId={client.id} />
                </>
              ) : (
              <>
              {/* Country filter for dashboard (only if multi-country) */}
              {clientData.detectedCountries && clientData.detectedCountries.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <button
                    onClick={() => setCountryFilter(null)}
                    className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                      countryFilter === null ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                    }`}
                  >
                    Alle landen
                  </button>
                  {clientData.detectedCountries.map((code) => (
                    <button
                      key={code}
                      onClick={() => setCountryFilter(countryFilter === code ? null : code)}
                      className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                        countryFilter === code ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                      }`}
                    >
                      {countryLabel(code)}
                    </button>
                  ))}
                </div>
              )}

              <SectionHeader
                icon={<Calendar className="w-4.5 h-4.5 text-rm-blue" />}
                title={countryFilter ? `Maandprestaties — ${countryLabel(countryFilter)}` : "Maandprestaties"}
                subtitle="Per maand: waar staan we en wat is de trend?"
              />
              <MonthlyOverview clientId={client.id} countryFilter={countryFilter} />
              <PacingMonitor clientId={client.id} countryFilter={countryFilter} />

              <div className="pt-2">
                <SectionHeader
                  icon={<Target className="w-4.5 h-4.5 text-rm-blue" />}
                  title={countryFilter ? `Jaaroverzicht 2026 — ${countryLabel(countryFilter)}` : "Jaaroverzicht 2026"}
                  subtitle="Jaardoelen vs bijgestelde prognose op basis van weektrend"
                />
              </div>
              <MetricCards clientId={client.id} countryFilter={countryFilter} />

              <PerformanceChart clientId={client.id} countryFilter={countryFilter} />
              {/* Quick scan: hoe de advertenties eruitzien, hoe ze presteerden + korte samenvatting. */}
              <CreativePerformance clientId={client.id} channel="google" />
              <ClientNotes clientId={client.id} />
              </>
              )}
              </>
              )}
            </div>
          )}

          {activeTab === "campaigns" && (
            <div className="space-y-6">
              <ChannelTabs channel={channel} onChange={setChannel} />
              {channel === "google" && (
                <div className="space-y-6">
                  <CampaignTable clientId={client.id} geoClone={geoClone} countryFilter={countryFilter} onCountryFilterChange={setCountryFilter} />
                  <SearchTermsTable clientId={client.id} geoClone={geoClone} countryFilter={countryFilter} />
                </div>
              )}
              {channel === "meta" && <MetaView clientId={client.id} geoClone={geoClone} />}
              {channel === "linkedin" && <LinkedInView clientId={client.id} geoClone={geoClone} />}
              {channel === "blended" && <CrossChannelView clientId={client.id} />}
            </div>
          )}

          {activeTab === "forecast" && (
            <div className="space-y-6">
              {geoClone ? (
                // Beurs actief: de event-relatieve projectie (dagen-tot-beurs, blended over de
                // kanalen) is de juiste tool. De kalenderjaar-prognose vertekent bij een event —
                // die staat op "Hele account".
                <>
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[11px] text-blue-800">
                    Je zit in de beurs <strong>{geoClone}</strong>. Hieronder de <strong>event-relatieve prognose</strong>
                    {" "}(dagen-tot-beurs, over alle kanalen) — de juiste projectie voor een beurs. De kalenderjaar-prognose
                    per kanaal staat op <strong>← Hele account</strong>.
                  </div>
                  <SignalAnalysisCard
                    clientId={client.id}
                    endpoint="/api/analysis/geo-clone"
                    extra={{ geo_clone: geoClone }}
                    title={`Beursprognose ${geoClone}`}
                    description="Event-relatief: waar staat de aanloop naar deze editie t.o.v. dezelfde afstand tot de vorige editie, plus de projectie richting de beursdag per kanaal en het blended totaal tegen het doel."
                    runLabel="Draai beursprognose"
                  />
                </>
              ) : (
                <>
                  <ChannelTabs channel={channel} onChange={setChannel} />
                  {channel === "google" && <ForecastTable clientId={client.id} />}
                  {channel === "blended" && (
                    <>
                      <ChannelForecast clientId={client.id} channel="blended" />
                      <CrossChannelView clientId={client.id} />
                    </>
                  )}
                  {(channel === "meta" || channel === "linkedin") && (
                    <ChannelForecast clientId={client.id} channel={channel} />
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === "insights" && (
            <InsightsTab
              clientId={client.id}
              onSopError={(error) => setSopErrors((prev) => [...prev, error])}
            />
          )}

          {activeTab === "outcomes" && <OutcomesTab clientId={client.id} />}

          {activeTab === "sprint" && (
            <SprintPlanning clientId={client.id} />
          )}

          {activeTab === "reporting" && (
            <ClientReporting clientId={client.id} />
          )}

          {activeTab === "dgm" && (
            <DgmView clientId={client.id} />
          )}

          {activeTab === "second-opinion" && (
            <SecondOpinionView clientId={client.id} clientName={client.name} />
          )}

          {activeTab === "files" && (
            <ClientFiles
              clientId={client.id}
              sopErrors={sopErrors}
              onDismissError={(id) => setSopErrors((prev) => prev.filter((e) => e.id !== id))}
              onDismissAllErrors={() => setSopErrors([])}
            />
          )}

          {activeTab === "settings" && (
            <div className="space-y-6">
              {geoClone ? (
                // Beurs gekozen: de eigen instellingen-laag van deze geo-clone (branding, doelen,
                // event-datums) met account-fallback. Het account-niveau blijft eronder zichtbaar.
                <>
                  <GeoCloneSettingsPanel clientId={client.id} geoClone={geoClone} />
                  {/* Alleen de account-brede KPI-instellingen als context. Branding en
                      event/edities zijn hierboven al beurs-specifiek geregeld; die niet
                      nog eens (en al helemaal niet voor álle beurzen) hieronder herhalen. */}
                  <details className="rounded-xl border border-border bg-gray-50/50">
                    <summary className="cursor-pointer px-5 py-3 text-[12px] font-medium text-muted-foreground">
                      Account-instellingen (KPI-doelen, conversie-acties — waarvan deze beurs erft) tonen
                    </summary>
                    <div className="p-5 space-y-6">
                      <ClientSettingsPanel clientId={client.id} clientName={client.name} />
                    </div>
                  </details>
                </>
              ) : (
                <>
                  {/* Beurzen & edities bovenaan: de cadans (jaarlijks/2-jaarlijks) en de
                      editie-datums voeden de dagen-tot-beurs-inzichten en de beursanalyse. */}
                  <EventSettings clientId={client.id} />
                  <details open className="rounded-xl border border-border bg-white shadow-sm">
                    <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-rm-blue">
                      Klantinstellingen (KPI-doelen, conversie-acties, landen, Merchant, logo)
                    </summary>
                    <div className="px-2 pb-2">
                      <ClientSettingsPanel clientId={client.id} clientName={client.name} />
                    </div>
                  </details>
                  {/* Conversie-selectie voor Meta/LinkedIn: het equivalent van de Google-conversie-acties. */}
                  <ChannelConversionSettings clientId={client.id} />
                  <details className="rounded-xl border border-border bg-white shadow-sm">
                    <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-rm-blue">
                      Branding (merk-identiteit en live preview)
                    </summary>
                    <div className="px-2 pb-2">
                      <BrandingView clientId={client.id} clientName={client.name} />
                    </div>
                  </details>
                </>
              )}
            </div>
          )}
        </AnalysisProvider>
        </ClientDataProvider>
      )}
    </div>
  );
}

function InsightsTab({ clientId, onSopError }: { clientId: string; onSopError?: (error: SopError) => void }) {
  const [, setRefreshKey] = useState(0);
  const [analysisChannel, setAnalysisChannel] = useState<Channel>("blended");

  // Het kanaal-subtabje kiest alleen WELKE analyses je draait; het uitkomsten-filter blijft
  // standaard op "Alle kanalen" (geen kanaal is belangrijker) en wisselt alleen op eigen klik.
  const onComplete = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-6">
      {/* Alle analyses draaien hier, per kanaal; de kanaaltabs elders zijn data-weergaven. */}
      <ChannelTabs channel={analysisChannel} onChange={setAnalysisChannel} />

      {analysisChannel === "google" && (
        <>
          <SopTriggerButtons clientId={clientId} onAnalysisComplete={onComplete} onAnalysisError={onSopError} />
          <StandaloneAnalyses clientId={clientId} />
          <CreativeDeepDive clientId={clientId} channel="google" />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/google-funnel"
            title="Funnel-drop-off"
            description="Vertoning → klik → conversie over de recente 4 weken vs de 4 weken ervoor; een verslechterde fase landt in de wachtrij."
            runLabel="Draai funnel-analyse"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/kpi-relations"
            extra={{ channel: "google" }}
            title="KPI-verhoudingen"
            description="Hoe KPI's zich tot elkaar verhouden: CPA-decompositie (klik duurder vs slechter converterend), belofte-kloof, verzadiging, bereik-verdunning en meer."
            runLabel="Analyseer verhoudingen"
          />
        </>
      )}
      {analysisChannel === "meta" && (
        <>
          <SopTriggerButtons clientId={clientId} channel="meta_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} />
          <MetaCreativeAnalyses clientId={clientId} />
          {/* Deterministische structuur-analyse (plaatsing/leeftijd/device), direct uit de data. */}
          <ChannelStructureAnalysis clientId={clientId} channel="meta" />
          <CreativeDeepDive clientId={clientId} channel="meta" />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/meta-funnel"
            title="Funnel-drop-off"
            description="Fase-overgangen (klik → landing → winkelwagen → checkout → conversie) recent vs prior venster; de verslechterde fase landt in de wachtrij."
            runLabel="Draai funnel-analyse"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/kpi-relations"
            extra={{ channel: "meta" }}
            title="KPI-verhoudingen"
            description="Hoe KPI's zich tot elkaar verhouden: CPA-decompositie (klik duurder vs slechter converterend), belofte-kloof, verzadiging, bereik-verdunning en meer."
            runLabel="Analyseer verhoudingen"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/meta-signals"
            title="Meta-signalen"
            description="Deterministische detectie: creative fatigue, frequency-saturatie, ranking-zwakte, hook/hold. Voedt de goedkeuringswachtrij."
          />
        </>
      )}
      {analysisChannel === "linkedin" && (
        <>
          <SopTriggerButtons clientId={clientId} channel="linkedin_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} />
          {/* Deterministische structuur-analyse (functie/seniority/industrie/bedrijfsgrootte), direct uit de data. */}
          <ChannelStructureAnalysis clientId={clientId} channel="linkedin" />
          <CreativeDeepDive clientId={clientId} channel="linkedin" />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/linkedin-icp-fit"
            title="ICP-fit"
            description="Welk deel van de spend en leads valt binnen het ideale klantprofiel, wat is de waste en wat kost een ICP-lead vs een niet-ICP-lead."
            runLabel="Draai ICP-fit"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/linkedin-funnel"
            title="Funnel-drop-off"
            description="Vertoning → klik → landingspagina → form-open → lead over twee 28-dagen-vensters; een verslechterde fase landt in de wachtrij."
            runLabel="Draai funnel-analyse"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/kpi-relations"
            extra={{ channel: "linkedin" }}
            title="KPI-verhoudingen"
            description="Hoe KPI's zich tot elkaar verhouden: CPA-decompositie (klik duurder vs slechter converterend), belofte-kloof, verzadiging, bereik-verdunning en meer."
            runLabel="Analyseer verhoudingen"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/linkedin-signals"
            title="LinkedIn-signalen"
            description="Deterministische detectie: lead-form drop-off, CPL-druk, engagement- en video-zwakte. Voedt de goedkeuringswachtrij."
          />
        </>
      )}
      {analysisChannel === "blended" && (
        <SignalAnalysisCard
          clientId={clientId}
          endpoint="/api/analysis/cross-channel"
          title="Cross-channel-signalen"
          description="Deterministische detectie tussen kanalen: zaai-oogst, CPL-arbitrage, mix-shift, doelgroep-samenhang én de cross-funnel (blended totaal, fase-achterblijver, divergentie). Voedt de goedkeuringswachtrij."
        />
      )}

      <p className="text-[11px] text-muted-foreground">
        De uitkomsten (wachtrij, inzichten, aanbevelingen, hypotheses, taken) staan in het tabblad <strong>Inzichten</strong>.
      </p>
    </div>
  );
}

// De uitkomsten-laag, losgetrokken van het draaien van analyses zodat beide pagina's
// behapbaar blijven: wachtrij, inzichten, aanbevelingen, hypotheses-workflows en taken,
// met het kanaal-filter (standaard Alle) over alles heen.
function OutcomesTab({ clientId }: { clientId: string }) {
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [channelFilter, setChannelFilter] = useState<InsightChannel | null>(null);

  return (
    <div className="space-y-6">
      <TaskImpactReminder clientId={clientId} />
      {/* Kanaal-filter over inzichten, aanbevelingen, hypotheses, wachtrij en taken. */}
      <ChannelFilter value={channelFilter} onChange={setChannelFilter} />
      <ProposalQueue clientId={clientId} refreshKey={refreshKey} channel={channelFilter} onWorkflowChange={() => setRefreshKey((k) => k + 1)} />
      <InsightsBlock
        clientId={clientId}
        selectedInsightId={selectedInsightId}
        onSelectInsight={setSelectedInsightId}
        refreshKey={refreshKey}
        channel={channelFilter}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <RecommendationsBlock clientId={clientId} selectedInsightId={selectedInsightId} refreshKey={refreshKey} channel={channelFilter} />
          <HypothesesBlock clientId={clientId} refreshKey={refreshKey} onWorkflowChange={() => setRefreshKey((k) => k + 1)} channel={channelFilter} />
        </div>
        <TasksBlock clientId={clientId} selectedInsightId={selectedInsightId} refreshKey={refreshKey} channel={channelFilter} />
      </div>
    </div>
  );
}
