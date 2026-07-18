"use client";

import { useState, useEffect } from "react";
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
import { SprintPlanning } from "../insights/sprint-planning";
import { CampaignTable } from "./campaign-table";
import { SearchTermsTable } from "./search-terms-table";
import { ReportExport } from "./report-export";
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

type Tab = "dashboard" | "campaigns" | "forecast" | "insights" | "sprint" | "reporting" | "dgm" | "second-opinion" | "files" | "settings";

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
  { id: "google", label: "Google Ads", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "meta", label: "Meta", icon: <Megaphone className="w-3.5 h-3.5" /> },
  { id: "linkedin", label: "LinkedIn", icon: <Briefcase className="w-3.5 h-3.5" /> },
  { id: "blended", label: "Alle kanalen", icon: <Layers className="w-3.5 h-3.5" /> },
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

export function ClientDashboard({ client }: { client: Client }) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [channel, setChannel] = useState<Channel>("google");
  const [geoClone, setGeoClone] = useState<string | null>(null);
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

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { id: "dashboard", label: "Overzicht", icon: <BarChart3 className="w-4 h-4" /> },
          { id: "campaigns", label: "Campagnes", icon: <LayoutGrid className="w-4 h-4" /> },
          { id: "forecast", label: "Prognose", icon: <TrendingUp className="w-4 h-4" /> },
          { id: "insights", label: "Analyses", icon: <Lightbulb className="w-4 h-4" /> },
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
              {channel === "meta" && <MetaView clientId={client.id} />}
              {channel === "linkedin" && <LinkedInView clientId={client.id} />}
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
              {channel === "meta" && <MetaView clientId={client.id} />}
              {channel === "linkedin" && <LinkedInView clientId={client.id} />}
              {channel === "blended" && <CrossChannelView clientId={client.id} />}
            </div>
          )}

          {activeTab === "forecast" && (
            <div className="space-y-6">
              <ChannelTabs channel={channel} onChange={setChannel} />
              {channel === "google" && <ForecastTable clientId={client.id} />}
              {channel === "blended" && <CrossChannelView clientId={client.id} />}
              {(channel === "meta" || channel === "linkedin") && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
                  Prognose voor {channel === "meta" ? "Meta" : "LinkedIn"} volgt zodra de sync en de kanaal-analyse-laag live zijn.
                </div>
              )}
            </div>
          )}

          {activeTab === "insights" && (
            <InsightsTab
              clientId={client.id}
              onSopError={(error) => setSopErrors((prev) => [...prev, error])}
            />
          )}

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
              <ClientSettingsPanel clientId={client.id} clientName={client.name} />
              <EventSettings clientId={client.id} />
              <BrandingView clientId={client.id} clientName={client.name} />
            </div>
          )}
        </AnalysisProvider>
        </ClientDataProvider>
      )}
    </div>
  );
}

function InsightsTab({ clientId, onSopError }: { clientId: string; onSopError?: (error: SopError) => void }) {
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <SopTriggerButtons
        clientId={clientId}
        onAnalysisComplete={() => setRefreshKey((k) => k + 1)}
        onAnalysisError={onSopError}
      />
      <StandaloneAnalyses clientId={clientId} />
      <TaskImpactReminder clientId={clientId} />
      <InsightsBlock
        clientId={clientId}
        selectedInsightId={selectedInsightId}
        onSelectInsight={setSelectedInsightId}
        refreshKey={refreshKey}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <RecommendationsBlock clientId={clientId} selectedInsightId={selectedInsightId} refreshKey={refreshKey} />
          <HypothesesBlock clientId={clientId} refreshKey={refreshKey} onWorkflowChange={() => setRefreshKey((k) => k + 1)} />
        </div>
        <TasksBlock clientId={clientId} selectedInsightId={selectedInsightId} refreshKey={refreshKey} />
      </div>
      <ReportExport clientId={clientId} />
    </div>
  );
}
