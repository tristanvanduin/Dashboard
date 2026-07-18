"use client";

import { useState, useMemo } from "react";
import { ArrowUpDown, Search, Globe } from "lucide-react";
import { useClientDataState } from "@/lib/client-data-provider";
import { matchGeoCloneByCampaignName } from "@/lib/rai/geo-clone-catalog";
import type { AccountStructureData } from "@/lib/use-client-data";
import { detectCountryFromName, countryLabel } from "@/lib/countries";

interface CampaignRow {
  name: string;
  type: string;
  purpose: string;
  bucketLabel: string | null;
  biddingStrategy: string;
  spend: number;
  conversions: number;
  cpa: number;
  roas: number;
  impressions: number;
  adGroupCount: number;
  assetGroupCount: number;
  country: string | null;
  countryShares: Record<string, number> | null;
}

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

const PURPOSE_COLORS: Record<string, string> = {
  brand: "bg-blue-100 text-blue-700",
  generic: "bg-green-100 text-green-700",
  category: "bg-emerald-100 text-emerald-700",
  shopping: "bg-teal-100 text-teal-700",
  pmax: "bg-violet-100 text-violet-700",
  remarketing: "bg-orange-100 text-orange-700",
  awareness: "bg-cyan-100 text-cyan-700",
  competitor: "bg-red-100 text-red-700",
  dsa: "bg-amber-100 text-amber-700",
  display: "bg-pink-100 text-pink-700",
};

const PURPOSE_LABELS: Record<string, string> = {
  brand: "Brand",
  generic: "Generic",
  category: "Categorie",
  shopping: "Shopping",
  pmax: "PMax",
  remarketing: "Remarketing",
  awareness: "Awareness",
  competitor: "Concurrent",
  dsa: "DSA",
  display: "Display",
};

const BIDDING_LABELS: Record<string, string> = {
  TARGET_CPA: "tCPA",
  TARGET_ROAS: "tROAS",
  MAXIMIZE_CONVERSIONS: "Max Conv.",
  MAXIMIZE_CONVERSION_VALUE: "Max Value",
  MANUAL_CPC: "Manual CPC",
  ENHANCED_CPC: "eCPC",
  TARGET_SPEND: "Max Clicks",
  UNKNOWN: "—",
};

type SortKey = "name" | "spend" | "conversions" | "cpa" | "roas" | "impressions";

interface CampaignTableProps {
  clientId: string;
  geoClone?: string | null;
  countryFilter?: string | null;
  onCountryFilterChange?: (country: string | null) => void;
}

export function CampaignTable({ clientId, geoClone, countryFilter: externalCountryFilter, onCountryFilterChange }: CampaignTableProps) {
  const dataState = useClientDataState();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [purposeFilter, setPurposeFilter] = useState<string | null>(null);

  // Use external filter if provided, otherwise local state
  const [localCountryFilter, setLocalCountryFilter] = useState<string | null>(null);
  const countryFilter = externalCountryFilter !== undefined ? externalCountryFilter : localCountryFilter;
  const setCountryFilter = onCountryFilterChange ?? setLocalCountryFilter;

  const campaigns = useMemo((): CampaignRow[] => {
    const structure = dataState?.accountStructure;
    if (!structure) return [];

    const geoMap = dataState?.campaignCountryMap ?? {};
    const sharesMap = dataState?.campaignCountryShares ?? {};

    return structure.campaigns.map((c) => ({
      name: c.name,
      type: c.type,
      purpose: c.purpose,
      bucketLabel: c.bucketLabel,
      biddingStrategy: c.biddingStrategy,
      spend: c.cost30d,
      conversions: c.conversions30d,
      cpa: c.conversions30d > 0 ? c.cost30d / c.conversions30d : c.cost30d > 0 ? Infinity : 0,
      roas: 0,
      impressions: c.impressions30d,
      adGroupCount: c.adGroupCount,
      assetGroupCount: c.assetGroupCount,
      // Primary: geo data (real country from Google Ads). Fallback: campaign name parsing.
      country: geoMap[c.name] ?? detectCountryFromName(c.name),
      // All countries this campaign targets with spend shares
      countryShares: sharesMap[c.name] ?? null,
    }));
  }, [dataState?.accountStructure, dataState?.campaignCountryMap, dataState?.campaignCountryShares]);

  // Get unique purposes for filter
  const purposes = useMemo(() => {
    const set = new Set(campaigns.map((c) => c.purpose));
    return Array.from(set).sort();
  }, [campaigns]);

  // Get unique countries for filter — prefer API-detected countries (from geo data), fallback to campaign-derived
  const countries = useMemo(() => {
    // If API provides detected countries from geo data, use those
    if (dataState?.detectedCountries && dataState.detectedCountries.length > 0) {
      return dataState.detectedCountries;
    }
    // Fallback: extract from campaign data
    const counts = new Map<string, number>();
    for (const c of campaigns) {
      if (c.country) counts.set(c.country, (counts.get(c.country) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);
  }, [campaigns, dataState?.detectedCountries]);

  const showCountryFilter = countries.length > 1;

  // Filter and sort
  const filtered = useMemo(() => {
    let result = campaigns;

    if (search) {
      const s = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(s));
    }
    if (purposeFilter) {
      result = result.filter((c) => c.purpose === purposeFilter);
    }
    if (countryFilter) {
      result = result.filter((c) => {
        // Show campaign if it has ANY spend in the selected country
        if (c.countryShares && (c.countryShares[countryFilter] ?? 0) > 0) return true;
        return c.country === countryFilter;
      });
    }
    if (geoClone) {
      result = result.filter((c) => matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone);
    }

    result.sort((a, b) => {
      let va: number | string, vb: number | string;
      switch (sortBy) {
        case "name": va = a.name; vb = b.name;
          return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        case "spend": va = a.spend; vb = b.spend; break;
        case "conversions": va = a.conversions; vb = b.conversions; break;
        case "cpa": va = a.cpa === Infinity ? 999999 : a.cpa; vb = b.cpa === Infinity ? 999999 : b.cpa; break;
        case "roas": va = a.roas; vb = b.roas; break;
        case "impressions": va = a.impressions; vb = b.impressions; break;
        default: return 0;
      }
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });

    return result;
  }, [campaigns, search, purposeFilter, countryFilter, geoClone, sortBy, sortDir]);

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  // Totals
  const totalSpend = filtered.reduce((s, c) => s + c.spend, 0);
  const totalConv = filtered.reduce((s, c) => s + c.conversions, 0);
  const avgCpa = totalConv > 0 ? totalSpend / totalConv : 0;

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 shadow-sm text-center">
        <p className="text-muted-foreground">Campagne data wordt geladen...</p>
      </div>
    );
  }

  const SortTh = ({ col, label, align }: { col: SortKey; label: string; align?: string }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-rm-blue transition-colors whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === col ? (
          <span>{sortDir === "asc" ? "↑" : "↓"}</span>
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </span>
    </th>
  );

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">
              Campagnes
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {filtered.length} campagnes · {num(totalConv)} conversies · {fmt(totalSpend)} spend · Gem. CPA {fmt(avgCpa)} (30 dagen)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Country filter pills (only if multi-country) */}
            {showCountryFilter && (
              <div className="flex gap-1 items-center">
                <Globe className="w-3.5 h-3.5 text-muted-foreground mr-0.5" />
                <button
                  onClick={() => setCountryFilter(null)}
                  className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                    countryFilter === null ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                  }`}
                >
                  Alle landen
                </button>
                {countries.map((code) => (
                  <button
                    key={code}
                    onClick={() => setCountryFilter(countryFilter === code ? null : code)}
                    className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                      countryFilter === code ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                    }`}
                  >
                    {countryLabel(code)}
                  </button>
                ))}
              </div>
            )}
            {/* Purpose filter pills */}
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setPurposeFilter(null)}
                className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                  purposeFilter === null ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"
                }`}
              >
                Alle
              </button>
              {purposes.map((p) => (
                <button
                  key={p}
                  onClick={() => setPurposeFilter(purposeFilter === p ? null : p)}
                  className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                    purposeFilter === p ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"
                  }`}
                >
                  {PURPOSE_LABELS[p] ?? p}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Zoek..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg w-40 focus:outline-none focus:border-rm-blue"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50/50 border-b border-border">
            <tr>
              <SortTh col="name" label="Campagne" />
              <th className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Type</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Bidding</th>
              <SortTh col="impressions" label="Impressies" align="right" />
              <SortTh col="spend" label="Spend" align="right" />
              <SortTh col="conversions" label="Conv." align="right" />
              <SortTh col="cpa" label="CPA" align="right" />
              <th className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Structuur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((campaign, i) => {
              const purposeColor = PURPOSE_COLORS[campaign.purpose] ?? "bg-gray-100 text-gray-600";
              const isZeroConv = campaign.conversions === 0 && campaign.spend > 0;
              const highCpa = campaign.cpa > avgCpa * 2 && campaign.cpa !== Infinity;

              return (
                <tr key={i} className={`hover:bg-gray-50/50 transition-colors ${isZeroConv ? "bg-red-50/30" : ""}`}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-rm-gray truncate max-w-[250px]" title={campaign.name}>
                        {campaign.name}
                      </span>
                      {campaign.bucketLabel && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                          {campaign.bucketLabel}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${purposeColor}`}>
                      {PURPOSE_LABELS[campaign.purpose] ?? campaign.purpose}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">
                      {BIDDING_LABELS[campaign.biddingStrategy] ?? campaign.biddingStrategy}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs text-muted-foreground">{num(campaign.impressions)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-sm font-medium text-rm-gray">{fmt(campaign.spend)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`text-sm font-semibold ${isZeroConv ? "text-red-500" : "text-rm-gray"}`}>
                      {num(campaign.conversions)}
                      {isZeroConv && <span className="text-[9px] text-red-400 ml-1">⚠</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`text-sm ${
                      campaign.cpa === 0 ? "text-gray-300" :
                      campaign.cpa === Infinity ? "text-red-500 font-semibold" :
                      highCpa ? "text-red-500" :
                      "text-rm-gray"
                    }`}>
                      {campaign.cpa === 0 ? "—" : campaign.cpa === Infinity ? "∞" : fmt(campaign.cpa)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-[10px] text-muted-foreground">
                      {campaign.adGroupCount > 0 && `${campaign.adGroupCount} AG`}
                      {campaign.assetGroupCount > 0 && `${campaign.assetGroupCount} ASG`}
                      {campaign.adGroupCount === 0 && campaign.assetGroupCount === 0 && "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
