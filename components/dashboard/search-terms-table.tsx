"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, ArrowUpDown, Sparkles } from "lucide-react";
import { useClientDataState } from "@/lib/client-data-provider";
import { matchGeoCloneByCampaignName } from "@/lib/rai/geo-clone-catalog";
import { detectSearchTermCountries } from "@/lib/countries";
import { SearchTermAnalysisTab } from "./search-term-analysis-tab";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

type SortKey = "cost" | "clicks" | "term";

export function SearchTermsTable({ clientId, countryFilter, geoClone }: { clientId?: string; countryFilter?: string | null; geoClone?: string | null }) {
  const dataState = useClientDataState();
  const countryShares = dataState?.campaignCountryShares ?? {};
  const countryMap = dataState?.campaignCountryMap ?? {};

  // Check if a campaign has any spend in the selected country
  // Uses campaignCountryShares for multi-country attribution (>0% spend = included)
  // Falls back to dominant country map if shares unavailable
  const campaignMatchesCountry = (campaignName: string, country: string): boolean => {
    const shares = countryShares[campaignName];
    if (shares) return (shares[country] ?? 0) > 0;
    return countryMap[campaignName] === country;
  };

  // For search terms: also check the language of the search term itself.
  // This handles multi-country campaigns where all countries are in 1 campaign.
  // German terms → DE, French terms → FR, Dutch/neutral → NL + BE
  const termMatchesCountry = (searchTerm: string, campaignName: string, country: string): boolean => {
    // First: campaign-level geo attribution
    if (campaignMatchesCountry(campaignName, country)) {
      // If the campaign targets multiple countries, use language to narrow down
      const shares = countryShares[campaignName];
      const countryCount = shares ? Object.keys(shares).filter((k) => (shares[k] ?? 0) > 0).length : 1;
      if (countryCount <= 1) return true; // Single-country campaign, no need for language filter
      // Multi-country campaign: check if the search term language matches
      const termCountries = detectSearchTermCountries(searchTerm);
      return termCountries.includes(country);
    }
    return false;
  };

  // Filter all data by country if a country filter is active
  const allTerms = dataState?.wastefulSearchTerms ?? [];
  const allBleeders = dataState?.adGroupBleeders ?? [];
  const allProductBleeders = dataState?.productBleeders ?? [];

  const geoOk = (campaignName: string): boolean =>
    !geoClone || matchGeoCloneByCampaignName(campaignName)?.abbreviation === geoClone;

  const terms = allTerms.filter(
    (t) => geoOk(t.campaignName) && (!countryFilter || termMatchesCountry(t.searchTerm, t.campaignName, countryFilter))
  );
  const bleeders = allBleeders.filter(
    (b) => geoOk(b.campaignName) && (!countryFilter || campaignMatchesCountry(b.campaignName, countryFilter))
  );
  const productBleeders = allProductBleeders.filter(
    (p) => geoOk(p.campaignName) && (!countryFilter || campaignMatchesCountry(p.campaignName, countryFilter))
  );
  const resolvedClientId = clientId || (dataState?.googleAdsCustomerId ? `gads-${dataState.googleAdsCustomerId}` : "");
  const [subtab, setSubtab] = useState<"terms" | "adgroups" | "products" | "ai">("terms");
  const [sortBy, setSortBy] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("desc"); }
  }

  const sortedTerms = useMemo(() => {
    return [...terms].sort((a, b) => {
      if (sortBy === "term") return sortDir === "asc" ? a.searchTerm.localeCompare(b.searchTerm) : b.searchTerm.localeCompare(a.searchTerm);
      if (sortBy === "clicks") return sortDir === "asc" ? a.clicks - b.clicks : b.clicks - a.clicks;
      return sortDir === "asc" ? a.cost - b.cost : b.cost - a.cost;
    });
  }, [terms, sortBy, sortDir]);

  const totalWaste = terms.reduce((s, t) => s + t.cost, 0);
  const totalBleederCost = bleeders.reduce((s, b) => s + b.cost, 0);
  const totalProductBleederCost = productBleeders.reduce((s, p) => s + p.cost, 0);

  const SortTh = ({ col, label, align }: { col: SortKey; label: string; align?: string }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-rm-blue ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === col ? <span>{sortDir === "asc" ? "↑" : "↓"}</span> : <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header with subtabs */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setSubtab("terms")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subtab === "terms" ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
            }`}
          >
            Verspilde zoektermen
            {terms.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-red-100 text-red-600">
                {terms.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSubtab("adgroups")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subtab === "adgroups" ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
            }`}
          >
            Ad group bleeders
            {bleeders.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-red-100 text-red-600">
                {bleeders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSubtab("products")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subtab === "products" ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
            }`}
          >
            Product bleeders
            {productBleeders.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-red-100 text-red-600">
                {productBleeders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSubtab("ai")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subtab === "ai" ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              AI Analyse
            </span>
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {subtab === "terms"
            ? `${fmt(totalWaste)} verspild aan 0-conversie zoektermen (30d)`
            : subtab === "adgroups"
            ? `${fmt(totalBleederCost)} in ad groups met 0 conversies (30d)`
            : subtab === "products"
            ? `${fmt(totalProductBleederCost)} in producten met ROAS < 1 (30d)`
            : "AI-beoordeling van alle zoektermen"}
        </span>
      </div>

      {/* Search terms table */}
      {subtab === "terms" && (
        terms.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Geen verspilde zoektermen gevonden. Goed bezig!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50/50 border-b border-border">
                <tr>
                  <SortTh col="term" label="Zoekterm" />
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Campagne</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Ad Group</th>
                  <SortTh col="clicks" label="Clicks" align="right" />
                  <SortTh col="cost" label="Kosten" align="right" />
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedTerms.map((term, i) => (
                  <tr key={i} className="hover:bg-red-50/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span className="text-sm text-rm-gray font-medium">{term.searchTerm}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">{term.campaignName}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[150px]">{term.adGroupName}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-rm-gray">{term.clicks}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-semibold text-red-500">{fmt(term.cost)}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-red-500 font-semibold">0</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-gray-50/50">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-rm-gray">Totaal verspild</td>
                  <td className="px-4 py-2.5 text-right text-sm font-bold text-red-600">{fmt(totalWaste)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {/* Ad group bleeders table */}
      {subtab === "adgroups" && (
        bleeders.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Geen ad group bleeders gevonden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50/50 border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Ad Group</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Campagne</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Impressies</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Clicks</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Kosten</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bleeders.map((ag, i) => (
                  <tr key={i} className="hover:bg-red-50/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span className="text-sm text-rm-gray font-medium truncate max-w-[200px]">{ag.adGroupName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">{ag.campaignName}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{ag.impressions.toLocaleString("nl-NL")}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-rm-gray">{ag.clicks}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-semibold text-red-500">{fmt(ag.cost)}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-red-500 font-semibold">0</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-gray-50/50">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-rm-gray">Totaal verspild</td>
                  <td className="px-4 py-2.5 text-right text-sm font-bold text-red-600">{fmt(totalBleederCost)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {/* Product bleeders table */}
      {subtab === "products" && (
        productBleeders.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Geen product bleeders gevonden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50/50 border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Product</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Campagne</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Impressies</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Clicks</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Kosten</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {productBleeders.map((p, i) => (
                  <tr key={i} className="hover:bg-red-50/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="text-sm text-rm-gray font-medium truncate block max-w-[250px]">{p.productTitle}</span>
                          {p.productId && (
                            <span className="text-[9px] text-muted-foreground">{p.productId}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">{p.campaignName}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{p.impressions.toLocaleString("nl-NL")}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-rm-gray">{p.clicks}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-semibold text-red-500">{fmt(p.cost)}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-red-500 font-semibold">0</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-gray-50/50">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-rm-gray">Totaal verspild</td>
                  <td className="px-4 py-2.5 text-right text-sm font-bold text-red-600">{fmt(totalProductBleederCost)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
      {/* AI Analysis tab */}
      {subtab === "ai" && resolvedClientId && (
        <SearchTermAnalysisTab clientId={resolvedClientId} />
      )}

      {subtab === "ai" && !resolvedClientId && (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          Geen client ID beschikbaar voor AI-analyse.
        </div>
      )}
    </div>
  );
}
