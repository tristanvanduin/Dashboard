"use client";

import { useState, useEffect } from "react";
import { Save, RotateCcw, Check, CircleDot, CircleOff, Target, TrendingUp, DollarSign, BarChart3, CheckSquare, Square, Filter, Building2, AlertTriangle, Clock, ImageIcon, Upload, Trash2, Globe, X } from "lucide-react";
import { COUNTRY_MAP, countryLabel, detectCountriesFromCampaigns } from "@/lib/countries";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ClientSettings,
  type ConversionAction,
  type KpiTargets,
  getClientSettings,
  mergeConversionActionsWithLiveStatus,
  saveClientSettings,
} from "@/lib/client-settings";
import { useClientDataState } from "@/lib/client-data-provider";
import { invalidateClientCache } from "@/lib/use-client-data";

interface Props {
  clientId: string;
  clientName: string;
}

type KpiPeriod = "year" | "month";
type KpiInputMode = "absolute" | "growth";

interface KpiConfig {
  enabled: boolean;
  value: number;
  period: KpiPeriod;
  inputMode: KpiInputMode;
  growthPct: number;
}

export function ClientSettingsPanel({ clientId, clientName }: Props) {
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [convSearch, setConvSearch] = useState("");
  const dataState = useClientDataState();

  // Separate KPI state with enabled/period toggles
  const [kpiConversions, setKpiConversions] = useState<KpiConfig>({ enabled: false, value: 0, period: "year", inputMode: "absolute", growthPct: 10 });
  const [kpiRevenue, setKpiRevenue] = useState<KpiConfig>({ enabled: false, value: 0, period: "year", inputMode: "absolute", growthPct: 10 });
  const [kpiRoas, setKpiRoas] = useState<KpiConfig>({ enabled: false, value: 0, period: "year", inputMode: "absolute", growthPct: 0 });
  const [kpiCpa, setKpiCpa] = useState<KpiConfig>({ enabled: false, value: 0, period: "month", inputMode: "absolute", growthPct: 0 });
  const [sector, setSector] = useState<string>("");
  const [aovSegment, setAovSegment] = useState<string>("");
  const [convOverrides, setConvOverrides] = useState<Record<string, number>>({});
  const [conversionLagDays, setConversionLagDays] = useState<number>(3);
  const [activeCountries, setActiveCountries] = useState<string[]>([]);
  const [detectedCountries, setDetectedCountries] = useState<string[]>([]);
  const [merchantAccountId, setMerchantAccountId] = useState("");
  const [merchantFeedLabel, setMerchantFeedLabel] = useState("");
  const [merchantContentLanguage, setMerchantContentLanguage] = useState("");
  const [merchantChannel, setMerchantChannel] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  // Logo must load before the early return to keep hook order stable
  useEffect(() => {
    async function loadLogo() {
      if (!supabase) return;
      const path = `${clientId}/logo.png`;
      const { data } = await supabase.storage.from("client-files").createSignedUrl(path, 3600);
      if (data?.signedUrl) setLogoUrl(data.signedUrl);
    }
    loadLogo();
  }, [clientId]);

  useEffect(() => {
    const baseSettings = getClientSettings(clientId);

    // Merge API conversion actions
    if (dataState?.conversionActions && dataState.conversionActions.length > 0) {
      const apiActions: ConversionAction[] = mergeConversionActionsWithLiveStatus(
        baseSettings.conversionActions,
        dataState.conversionActions,
      );
      baseSettings.conversionActions = apiActions;
    }

    setSettings(baseSettings);
    setSector(baseSettings.sector ?? "");
    setAovSegment(baseSettings.aovSegment ?? "");
    setConvOverrides(baseSettings.kpiTargets.conversionOverrides ?? {});
    setConversionLagDays(baseSettings.conversionLagDays ?? 3);
    setActiveCountries(baseSettings.activeCountries ?? []);
    setMerchantAccountId(baseSettings.merchantAccountId ?? "");
    setMerchantFeedLabel(baseSettings.merchantFeedLabel ?? "");
    setMerchantContentLanguage(baseSettings.merchantContentLanguage ?? "");
    setMerchantChannel(baseSettings.merchantChannel ?? "");

    // Use API-detected countries (from geo data), fallback to campaign name parsing
    if (dataState?.detectedCountries && dataState.detectedCountries.length > 0) {
      setDetectedCountries(dataState.detectedCountries);
    } else if (dataState?.accountStructure?.campaigns) {
      const names = dataState.accountStructure.campaigns.map((c) => c.name);
      setDetectedCountries(detectCountriesFromCampaigns(names));
    }

    // Initialize KPI state from settings
    const kpi = baseSettings.kpiTargets;
    setKpiConversions({
      enabled: kpi.conversionsAbsolute > 0 || kpi.conversionsGrowthPct > 0,
      value: kpi.conversionsAbsolute,
      period: "year",
      inputMode: kpi.conversionsMode === "growth" ? "growth" : "absolute",
      growthPct: kpi.conversionsGrowthPct,
    });
    setKpiRevenue({
      enabled: kpi.revenueAbsolute > 0 || kpi.revenueGrowthPct > 0,
      value: kpi.revenueAbsolute,
      period: "year",
      inputMode: kpi.revenueMode === "growth" ? "growth" : "absolute",
      growthPct: kpi.revenueGrowthPct,
    });
    setKpiRoas({
      enabled: kpi.roasTarget > 0,
      value: kpi.roasTarget,
      period: "year",
      inputMode: "absolute",
      growthPct: 0,
    });
    setKpiCpa({
      enabled: kpi.cpaTarget > 0,
      value: kpi.cpaTarget,
      period: "month",
      inputMode: "absolute",
      growthPct: 0,
    });

    setSaved(false);
  }, [clientId, dataState?.conversionActions]);

  if (!settings) return null;

  const { conversionActions } = settings;

  // ── Conversion action helpers ──

  function toggleConversion(convId: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        conversionActions: prev.conversionActions.map((c) =>
          c.id === convId ? { ...c, includedInDashboard: !c.includedInDashboard } : c
        ),
      };
    });
    setSaved(false);
  }

  function selectAllConversions() {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        conversionActions: prev.conversionActions.map((c) => ({ ...c, includedInDashboard: true })),
      };
    });
    setSaved(false);
  }

  function selectNoneConversions() {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        conversionActions: prev.conversionActions.map((c) => ({ ...c, includedInDashboard: false })),
      };
    });
    setSaved(false);
  }

  function selectOnlyConversion(convId: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        conversionActions: prev.conversionActions.map((c) => ({
          ...c,
          includedInDashboard: c.id === convId,
        })),
      };
    });
    setSaved(false);
  }

  // ── Save / Reset ──

  function handleSave() {
    if (!settings) return;

    // Build KPI targets from the separate state
    const kpiTargets: KpiTargets = {
      conversionsMode: kpiConversions.inputMode === "growth" ? "growth" : "absolute",
      conversionsGrowthPct: kpiConversions.enabled ? kpiConversions.growthPct : 0,
      conversionsAbsolute: kpiConversions.enabled && kpiConversions.inputMode === "absolute"
        ? (kpiConversions.period === "month" ? kpiConversions.value * 12 : kpiConversions.value)
        : 0,
      revenueMode: kpiRevenue.inputMode === "growth" ? "growth" : "absolute",
      revenueGrowthPct: kpiRevenue.enabled ? kpiRevenue.growthPct : 0,
      revenueAbsolute: kpiRevenue.enabled && kpiRevenue.inputMode === "absolute"
        ? (kpiRevenue.period === "month" ? kpiRevenue.value * 12 : kpiRevenue.value)
        : 0,
      roasTarget: kpiRoas.enabled ? kpiRoas.value : 0,
      cpaTarget: kpiCpa.enabled ? kpiCpa.value : 0,
      conversionOverrides: Object.keys(convOverrides).length > 0 ? convOverrides : undefined,
    };

    saveClientSettings({
      ...settings,
      kpiTargets,
      sector: sector || null,
      aovSegment: aovSegment || null,
      conversionLagDays,
      activeCountries: activeCountries.length > 0 ? activeCountries : null,
      merchantAccountId: merchantAccountId.trim() || null,
      merchantFeedLabel: merchantFeedLabel.trim() || null,
      merchantContentLanguage: merchantContentLanguage.trim() || null,
      merchantChannel: merchantChannel.trim() || null,
    });
    invalidateClientCache(clientId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    if (typeof window !== "undefined") {
      localStorage.removeItem(`rm-dashboard-settings-${clientId}`);
    }
    setSettings(getClientSettings(clientId));
    setKpiConversions({ enabled: false, value: 0, period: "year", inputMode: "absolute", growthPct: 10 });
    setKpiRevenue({ enabled: false, value: 0, period: "year", inputMode: "absolute", growthPct: 10 });
    setKpiRoas({ enabled: false, value: 0, period: "year", inputMode: "absolute", growthPct: 0 });
    setKpiCpa({ enabled: false, value: 0, period: "month", inputMode: "absolute", growthPct: 0 });
    setSector("");
    setAovSegment("");
    setMerchantAccountId("");
    setMerchantFeedLabel("");
    setMerchantContentLanguage("");
    setMerchantChannel("");
    setSaved(false);
  }

  // ── Logo management ──

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !supabase) return;
    setLogoUploading(true);
    try {
      const path = `${clientId}/logo.png`;
      await supabase.storage.from("client-files").upload(path, file, { contentType: file.type, upsert: true });
      const { data } = await supabase.storage.from("client-files").createSignedUrl(path, 3600);
      if (data?.signedUrl) setLogoUrl(data.signedUrl);
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleLogoDelete() {
    if (!supabase) return;
    await supabase.storage.from("client-files").remove([`${clientId}/logo.png`]);
    setLogoUrl(null);
  }

  // ── Filtered conversions ──

  const filteredActions = conversionActions.filter((c) =>
    c.name.toLowerCase().includes(convSearch.toLowerCase())
  );
  const selectedCount = conversionActions.filter((c) => c.includedInDashboard).length;

  return (
    <div className="space-y-6">
      {/* ── KPI Doelstellingen (bovenaan: waar stuurt de klant op) ── */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="w-5 h-5 text-rm-blue" />
          <h2 className="text-base font-semibold text-rm-blue">KPI Doelstellingen</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Activeer de KPIs waar deze klant op stuurt. Vul alleen in wat relevant is.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiCard
            label="Conversies"
            icon={<Target className="w-4 h-4" />}
            config={kpiConversions}
            onChange={(c) => { setKpiConversions(c); setSaved(false); }}
            periodOptions
            allowGrowthMode
            format={(v) => v.toLocaleString("nl-NL")}
            placeholder="bijv. 5000"
          />
          <KpiCard
            label="Omzet"
            icon={<DollarSign className="w-4 h-4" />}
            config={kpiRevenue}
            onChange={(c) => { setKpiRevenue(c); setSaved(false); }}
            periodOptions
            allowGrowthMode
            prefix="€"
            format={(v) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 0 }).format(v)}
            placeholder="bijv. 150000"
          />
          <KpiCard
            label="ROAS"
            icon={<TrendingUp className="w-4 h-4" />}
            config={kpiRoas}
            onChange={(c) => { setKpiRoas(c); setSaved(false); }}
            suffix="x"
            step={0.1}
            format={(v) => `${v.toFixed(1)}x`}
            placeholder="bijv. 5.0"
            description="Minimale return on ad spend"
          />
          <KpiCard
            label="CPA"
            icon={<DollarSign className="w-4 h-4" />}
            config={kpiCpa}
            onChange={(c) => { setKpiCpa(c); setSaved(false); }}
            prefix="€"
            step={0.5}
            format={(v) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(v)}
            placeholder="bijv. 18.50"
            description="Maximale cost per conversie"
          />
        </div>
      </div>

      {/* ── Conversion Actions ── */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-rm-blue" />
            <h2 className="text-base font-semibold text-rm-blue">Conversie-acties</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {selectedCount} van {conversionActions.length} geselecteerd
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Selecteer welke conversie-acties meegenomen worden in het dashboard.
        </p>

        {/* Bulk actions + search */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex gap-2">
            <button
              onClick={selectAllConversions}
              className="flex items-center gap-1.5 text-[11px] font-medium text-rm-blue hover:underline"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Alles aan
            </button>
            <span className="text-muted-foreground text-[11px]">·</span>
            <button
              onClick={selectNoneConversions}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:underline"
            >
              <Square className="w-3.5 h-3.5" />
              Alles uit
            </button>
          </div>
          {conversionActions.length > 8 && (
            <div className="flex-1">
              <input
                type="text"
                placeholder="Zoek conversie-actie..."
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:border-rm-blue"
              />
            </div>
          )}
        </div>

        {/* Conversion list */}
        <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
          {filteredActions.map((action) => (
            <div
              key={action.id}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors ${
                action.includedInDashboard
                  ? "border-rm-blue/20 bg-blue-50/50"
                  : "border-border bg-gray-50/50 opacity-60"
              }`}
            >
              {/* Toggle */}
              <button onClick={() => toggleConversion(action.id)} className="shrink-0">
                {action.includedInDashboard ? (
                  <CircleDot className="w-5 h-5 text-rm-blue" />
                ) : (
                  <CircleOff className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {/* Name + category */}
              <button onClick={() => toggleConversion(action.id)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-rm-gray truncate">{action.name}</span>
                  <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                    action.category === "primary" ? "bg-rm-blue/10 text-rm-blue" : "bg-gray-200 text-gray-600"
                  }`}>
                    {action.category}
                  </span>
                </div>
              </button>

              {/* "Only" button */}
              <button
                onClick={() => selectOnlyConversion(action.id)}
                className="text-[10px] text-muted-foreground hover:text-rm-blue shrink-0 px-2 py-1 rounded hover:bg-rm-blue/5 transition-colors"
                title="Selecteer alleen deze"
              >
                <Filter className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sector & AOV ── */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-5 h-5 text-rm-blue" />
          <h2 className="text-base font-semibold text-rm-blue">Sector & Benchmarks</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Kies de sector voor sectorale benchmark vergelijkingen in de analyses.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Sector dropdown */}
          <div>
            <label className="block text-sm font-medium text-rm-gray mb-1.5">Sector</label>
            <select
              value={sector}
              onChange={(e) => { setSector(e.target.value); setSaved(false); }}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-rm-blue"
            >
              <option value="">— Selecteer sector —</option>
              <optgroup label="E-commerce">
                <option value="ecommerce_laag_ticket">E-commerce (laag ticket, AOV &lt; €50)</option>
                <option value="ecommerce_mid_ticket">E-commerce (mid ticket, AOV €50-€250)</option>
                <option value="ecommerce_hoog_ticket">E-commerce (hoog ticket, AOV &gt; €250)</option>
                <option value="ecommerce_fashion">E-commerce fashion</option>
                <option value="ecommerce_electronics">E-commerce elektronica</option>
                <option value="ecommerce_huisdieren">E-commerce huisdieren</option>
              </optgroup>
              <optgroup label="Zorg & Welzijn">
                <option value="fysiotherapie">Fysiotherapie</option>
                <option value="zorg_generiek">Gezondheidszorg</option>
              </optgroup>
              <optgroup label="B2B">
                <option value="b2b_saas">B2B SaaS / Software</option>
                <option value="b2b_leadgen">B2B dienstverlening</option>
              </optgroup>
              <optgroup label="Leadgen">
                <option value="leadgen_generiek">Lokale dienstverlening</option>
                <option value="automotive">Automotive</option>
                <option value="legal">Juridische dienstverlening</option>
                <option value="finance">Finance &amp; Verzekeringen</option>
                <option value="horeca">Horeca</option>
                <option value="retail_local">Lokale retail</option>
              </optgroup>
              <optgroup label="Overig">
                <option value="hybrid">Hybrid</option>
              </optgroup>
            </select>
          </div>

          {/* AOV segment dropdown — alleen bij e-commerce sectoren */}
          {sector.startsWith("ecommerce_") && (
            <div>
              <label className="block text-sm font-medium text-rm-gray mb-1.5">AOV segment</label>
              <select
                value={aovSegment}
                onChange={(e) => { setAovSegment(e.target.value); setSaved(false); }}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-rm-blue"
              >
                <option value="">— Selecteer AOV —</option>
                <option value="low_ticket">Laag ticket (AOV &lt; €50)</option>
                <option value="mid_ticket">Mid ticket (AOV €50-€250)</option>
                <option value="high_ticket">Hoog ticket (AOV &gt; €250)</option>
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Bepaalt de ROAS context: lager ticket = hogere ROAS nodig voor winstgevendheid.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Conversielag ── */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-semibold text-amber-600">Conversielag</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Aantal dagen dat conversies vertraagd binnenkomen. Voorkomt valse waarschuwingen in recente periodes.
        </p>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            max={30}
            value={conversionLagDays}
            onChange={(e) => { setConversionLagDays(Math.max(0, Math.min(30, parseInt(e.target.value) || 0))); setSaved(false); }}
            className="w-24 text-sm"
          />
          <span className="text-sm text-muted-foreground">dagen (standaard: 3)</span>
        </div>
      </div>

      {/* ── Conversion Overrides ── */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-5 h-5 text-rm-orange" />
          <h2 className="text-base font-semibold text-rm-orange">Conversie Overrides</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Vul hier handmatig conversies in voor maanden met kapotte tracking. De forecast engine gebruikt deze waarden in plaats van de echte (0) data.
        </p>

        <div className="space-y-2">
          {(() => {
            const currentYear = new Date().getFullYear();
            const currentMonth = new Date().getMonth(); // 0-based
            const months = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
            // Show only realized months (up to current month)
            return Array.from({ length: currentMonth + 1 }, (_, i) => {
              const key = `${currentYear}-${String(i + 1).padStart(2, "0")}`;
              const hasOverride = convOverrides[key] !== undefined && convOverrides[key] > 0;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-sm text-rm-gray w-16">{months[i]} {currentYear}</span>
                  <Input
                    type="number"
                    placeholder="—"
                    value={hasOverride ? convOverrides[key] : ""}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setConvOverrides((prev) => {
                        const next = { ...prev };
                        if (isNaN(val) || val <= 0) {
                          delete next[key];
                        } else {
                          next[key] = val;
                        }
                        return next;
                      });
                      setSaved(false);
                    }}
                    className="w-32 text-sm"
                  />
                  {hasOverride && (
                    <span className="text-[10px] text-rm-orange font-medium">Override actief</span>
                  )}
                </div>
              );
            });
          })()}
        </div>
        {Object.keys(convOverrides).length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-3">
            {Object.keys(convOverrides).length} override(s) actief. De forecast gebruikt deze waarden i.p.v. de echte tracking data.
          </p>
        )}
      </div>

      {/* ── Landen configuratie ── */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-rm-orange" />
          <h2 className="text-base font-semibold text-rm-orange">Actieve landen</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Selecteer de landen waarin dit account actief adverteert. Wordt gebruikt voor land-filtering en multi-country rapportages.
        </p>

        {/* Detected countries */}
        {detectedCountries.length > 0 && activeCountries.length === 0 && (
          <div className="mb-4">
            <p className="text-[11px] text-muted-foreground mb-2">Gedetecteerd op basis van campagnenamen:</p>
            <div className="flex flex-wrap gap-1.5">
              {detectedCountries.map((code) => (
                <button
                  key={code}
                  onClick={() => { setActiveCountries([...activeCountries, code]); setSaved(false); }}
                  className="px-2.5 py-1 text-xs rounded-md border border-dashed border-rm-orange/40 text-rm-orange hover:bg-orange-50 transition-colors"
                >
                  + {countryLabel(code)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active countries */}
        <div className="flex flex-wrap gap-2 mb-3">
          {activeCountries.map((code) => (
            <span key={code} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rm-orange/10 text-rm-orange border border-rm-orange/20">
              {countryLabel(code)}
              <button onClick={() => { setActiveCountries(activeCountries.filter((c) => c !== code)); setSaved(false); }} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        {/* Add country dropdown */}
        <select
          value=""
          onChange={(e) => {
            if (e.target.value && !activeCountries.includes(e.target.value)) {
              setActiveCountries([...activeCountries, e.target.value]);
              setSaved(false);
            }
          }}
          className="text-sm border border-border rounded-lg px-3 py-1.5 text-muted-foreground"
        >
          <option value="">Land toevoegen...</option>
          {Object.entries(COUNTRY_MAP)
            .filter(([code]) => !activeCountries.includes(code))
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))
          }
        </select>
      </div>

      {/* ── Merchant Center ── */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-rm-blue" />
          <h2 className="text-base font-semibold text-rm-blue">Merchant Center</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Koppel hier de Merchant productbron voor deze klant. Deze instellingen worden gebruikt voor product-relevantie, Merchant snapshots en veiligere SOP-beslissingen.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-rm-gray mb-1.5">Merchant account ID</label>
            <Input
              value={merchantAccountId}
              onChange={(e) => { setMerchantAccountId(e.target.value); setSaved(false); }}
              placeholder="bijv. 123456789"
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Vereist voor Merchant API snapshots. Dit is het Merchant Center account waarvan processed products gelezen worden.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-rm-gray mb-1.5">Feed label</label>
            <Input
              value={merchantFeedLabel}
              onChange={(e) => { setMerchantFeedLabel(e.target.value); setSaved(false); }}
              placeholder="bijv. NL"
              className="text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-rm-gray mb-1.5">Content language</label>
            <Input
              value={merchantContentLanguage}
              onChange={(e) => { setMerchantContentLanguage(e.target.value); setSaved(false); }}
              placeholder="bijv. nl"
              className="text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-rm-gray mb-1.5">Kanaal</label>
            <select
              value={merchantChannel}
              onChange={(e) => { setMerchantChannel(e.target.value); setSaved(false); }}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-rm-blue"
            >
              <option value="">— Niet filteren —</option>
              <option value="online">online</option>
              <option value="local">local</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Client Logo ── */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <ImageIcon className="w-5 h-5 text-rm-blue" />
          <h2 className="text-base font-semibold text-rm-blue">Client Logo</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Upload het logo van de klant. Dit wordt gebruikt op de cover van maandrapportages.
        </p>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <div className="flex items-center gap-4">
              <img src={logoUrl} alt="Client logo" className="h-12 max-w-[200px] object-contain rounded border border-border p-1" />
              <button
                onClick={handleLogoDelete}
                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Verwijderen
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-border hover:border-rm-blue/40 cursor-pointer transition-colors">
              {logoUploading ? (
                <span className="text-sm text-muted-foreground">Uploaden...</span>
              ) : (
                <>
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Logo uploaden (PNG, JPG)</span>
                </>
              )}
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={handleLogoUpload} className="hidden" />
            </label>
          )}
        </div>
      </div>

      {/* Save / Reset */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} className="bg-rm-blue hover:bg-rm-blue-light text-white gap-2">
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? "Opgeslagen!" : "Instellingen opslaan"}
        </Button>
        <Button variant="outline" onClick={handleReset} className="gap-2">
          <RotateCcw className="w-4 h-4" />
          Reset naar standaard
        </Button>
      </div>
    </div>
  );
}

// ── KPI Card component ──

function KpiCard({
  label,
  icon,
  config,
  onChange,
  periodOptions,
  allowGrowthMode,
  prefix,
  suffix,
  step = 1,
  format,
  placeholder,
  description,
}: {
  label: string;
  icon: React.ReactNode;
  config: KpiConfig;
  onChange: (config: KpiConfig) => void;
  periodOptions?: boolean;
  allowGrowthMode?: boolean;
  prefix?: string;
  suffix?: string;
  step?: number;
  format: (v: number) => string;
  placeholder?: string;
  description?: string;
}) {
  return (
    <div className={`rounded-xl border p-4 transition-colors ${
      config.enabled
        ? "border-rm-blue/20 bg-rm-blue/5"
        : "border-border bg-gray-50/30"
    }`}>
      {/* Header with toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={config.enabled ? "text-rm-blue" : "text-gray-400"}>
            {icon}
          </div>
          <span className={`text-sm font-semibold ${config.enabled ? "text-rm-blue" : "text-gray-400"}`}>
            {label}
          </span>
        </div>
        <button
          onClick={() => onChange({ ...config, enabled: !config.enabled })}
          className={`w-10 h-5 rounded-full transition-colors relative ${
            config.enabled ? "bg-rm-blue" : "bg-gray-300"
          }`}
        >
          <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
            config.enabled ? "translate-x-5" : "translate-x-0.5"
          }`} />
        </button>
      </div>

      {config.enabled && (
        <div className="space-y-3">
          {/* Input mode: absolute vs growth (only for conv/revenue) */}
          {allowGrowthMode && (
            <div className="flex gap-1 bg-white rounded-lg p-0.5 border border-border">
              <button
                onClick={() => onChange({ ...config, inputMode: "absolute" })}
                className={`flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors ${
                  config.inputMode === "absolute"
                    ? "bg-rm-blue text-white"
                    : "text-muted-foreground hover:text-rm-gray"
                }`}
              >
                Vast doel
              </button>
              <button
                onClick={() => onChange({ ...config, inputMode: "growth" })}
                className={`flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors ${
                  config.inputMode === "growth"
                    ? "bg-rm-blue text-white"
                    : "text-muted-foreground hover:text-rm-gray"
                }`}
              >
                % Groei tov vorig jaar
              </button>
            </div>
          )}

          {/* Growth mode */}
          {config.inputMode === "growth" ? (
            <div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step={1}
                  value={config.growthPct || ""}
                  onChange={(e) => onChange({ ...config, growthPct: parseFloat(e.target.value) || 0 })}
                  placeholder="bijv. 10"
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">% groei</span>
              </div>
              {config.growthPct > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  +{config.growthPct}% ten opzichte van vorig jaar
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Period selector (only for conv/revenue in absolute mode) */}
              {periodOptions && (
                <div className="flex gap-1 bg-white rounded-lg p-0.5 border border-border">
                  <button
                    onClick={() => onChange({ ...config, period: "year" })}
                    className={`flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors ${
                      config.period === "year"
                        ? "bg-rm-blue text-white"
                        : "text-muted-foreground hover:text-rm-gray"
                    }`}
                  >
                    Per jaar
                  </button>
                  <button
                    onClick={() => onChange({ ...config, period: "month" })}
                    className={`flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors ${
                      config.period === "month"
                        ? "bg-rm-blue text-white"
                        : "text-muted-foreground hover:text-rm-gray"
                    }`}
                  >
                    Per maand
                  </button>
                </div>
              )}

              {/* Value input */}
              <div className="flex items-center gap-2">
                {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
                <Input
                  type="number"
                  step={step}
                  min={0}
                  value={config.value || ""}
                  onChange={(e) => onChange({ ...config, value: parseFloat(e.target.value) || 0 })}
                  placeholder={placeholder}
                  className="flex-1"
                />
                {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
              </div>

              {/* Summary */}
              {config.value > 0 && (
                <p className="text-xs text-muted-foreground">
                  {periodOptions && config.period === "month"
                    ? `${format(config.value)}/maand = ${format(config.value * 12)}/jaar`
                    : periodOptions && config.period === "year"
                      ? `${format(config.value)}/jaar = ${format(Math.round(config.value / 12))}/maand`
                      : `Doel: ${format(config.value)}`
                  }
                </p>
              )}
            </>
          )}

          {description && (
            <p className="text-[11px] text-muted-foreground">{description}</p>
          )}
        </div>
      )}

      {!config.enabled && (
        <p className="text-xs text-muted-foreground">
          Niet actief — klik de toggle om een doel in te stellen
        </p>
      )}
    </div>
  );
}
