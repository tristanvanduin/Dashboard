/**
 * PMAX Expert Layer — deterministic PMAX intelligence signals.
 *
 * Computes structured PMAX insights from Supabase-resident data.
 * Used by SOP analysis and Second Opinion.
 *
 * Signals computed:
 * 1. Network mix quality (Search vs Display/Video drift)
 * 2. Asset group concentration / inefficiency
 * 3. Asset weakness / creative drag
 * 4. Placement waste risk
 * 5. Search category dilution
 * 6. Product inefficiency inside PMAX
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PmaxSignal {
  type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  confidence: "high" | "medium" | "low";
  affectedEntity?: string;
}

export interface PmaxInsights {
  hasPmaxCampaigns: boolean;
  campaignCount: number;
  signals: PmaxSignal[];
  networkMix: { network: string; costPct: number; convPct: number }[];
  assetGroupSummary: { name: string; cost: number; conversions: number; roas: number }[];
  /** Formatted text block for SOP prompt injection */
  promptContext: string;
}

// ── Main function ──────────────────────────────────────────────────────────

export async function computePmaxInsights(
  supabase: SupabaseClient,
  clientId: string
): Promise<PmaxInsights> {
  const signals: PmaxSignal[] = [];

  // Check if PMAX campaigns exist
  const { data: pmaxMeta } = await supabase
    .from("ads_campaign_metadata")
    .select("campaign_id, campaign_name")
    .eq("client_id", clientId)
    .eq("campaign_type", "PERFORMANCE_MAX");

  const pmaxCampaigns = pmaxMeta ?? [];
  if (pmaxCampaigns.length === 0) {
    return {
      hasPmaxCampaigns: false, campaignCount: 0, signals: [],
      networkMix: [], assetGroupSummary: [], promptContext: "",
    };
  }

  // Fetch PMAX data in parallel
  const [networkData, assetGroupData, assetData, placementData, searchCatData] = await Promise.all([
    supabase.from("ads_pmax_network_breakdown").select("*").eq("client_id", clientId).order("cost", { ascending: false }),
    supabase.from("ads_asset_group_performance_monthly").select("*").eq("client_id", clientId).order("cost", { ascending: false }),
    supabase.from("ads_pmax_asset_performance").select("*").eq("client_id", clientId),
    supabase.from("ads_pmax_placements").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(100),
    supabase.from("ads_pmax_search_categories").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(50),
  ]);

  const networks = (networkData.data ?? []) as Array<Record<string, unknown>>;
  const assetGroups = (assetGroupData.data ?? []) as Array<Record<string, unknown>>;
  const assets = (assetData.data ?? []) as Array<Record<string, unknown>>;
  const placements = (placementData.data ?? []) as Array<Record<string, unknown>>;
  const searchCats = (searchCatData.data ?? []) as Array<Record<string, unknown>>;

  // ── Signal 1: Network Mix Quality ──

  const networkMix: PmaxInsights["networkMix"] = [];
  if (networks.length > 0) {
    const totalCost = networks.reduce((s, n) => s + (Number(n.cost) || 0), 0);
    const totalConv = networks.reduce((s, n) => s + (Number(n.conversions) || 0), 0);

    const byNetwork = new Map<string, { cost: number; conv: number }>();
    for (const n of networks) {
      const nt = String(n.network_type || "OTHER");
      const existing = byNetwork.get(nt) ?? { cost: 0, conv: 0 };
      existing.cost += Number(n.cost) || 0;
      existing.conv += Number(n.conversions) || 0;
      byNetwork.set(nt, existing);
    }

    for (const [network, data] of byNetwork) {
      networkMix.push({
        network,
        costPct: totalCost > 0 ? Math.round((data.cost / totalCost) * 100) : 0,
        convPct: totalConv > 0 ? Math.round((data.conv / totalConv) * 100) : 0,
      });
    }

    // Check for Display/Video dominance with low conversion share
    const displayCost = (byNetwork.get("CONTENT")?.cost ?? 0) + (byNetwork.get("YOUTUBE_WATCH")?.cost ?? 0);
    const displayConv = (byNetwork.get("CONTENT")?.conv ?? 0) + (byNetwork.get("YOUTUBE_WATCH")?.conv ?? 0);
    const displayCostPct = totalCost > 0 ? displayCost / totalCost : 0;
    const displayConvPct = totalConv > 0 ? displayConv / totalConv : 0;

    if (displayCostPct > 0.4 && displayConvPct < 0.15) {
      signals.push({
        type: "network_mix",
        severity: "high",
        title: "Display/Video domineert PMAX spend zonder evenredige conversies",
        description: `${Math.round(displayCostPct * 100)}% van PMAX spend gaat naar Display/Video, maar slechts ${Math.round(displayConvPct * 100)}% van conversies komt daaruit. PMAX groeit mogelijk via lage-kwaliteit inventory.`,
        confidence: "high",
      });
    }

    const searchCost = byNetwork.get("SEARCH")?.cost ?? 0;
    const searchCostPct = totalCost > 0 ? searchCost / totalCost : 0;
    if (searchCostPct < 0.2 && totalCost > 100) {
      signals.push({
        type: "network_mix",
        severity: "medium",
        title: "Lage Search-aandeel in PMAX",
        description: `Slechts ${Math.round(searchCostPct * 100)}% van PMAX spend gaat naar Search. De campagne leunt zwaar op Display/Video/Shopping.`,
        confidence: "medium",
      });
    }
  }

  // ── Signal 2: Asset Group Concentration ──

  const assetGroupSummary: PmaxInsights["assetGroupSummary"] = [];
  if (assetGroups.length > 0) {
    // Get latest month data
    const months = [...new Set(assetGroups.map((a) => String(a.month)))].sort();
    const latestMonth = months[months.length - 1];
    const latestAG = assetGroups.filter((a) => String(a.month) === latestMonth);

    const totalCost = latestAG.reduce((s, a) => s + (Number(a.cost) || 0), 0);

    for (const ag of latestAG) {
      const cost = Number(ag.cost) || 0;
      const conv = Number(ag.conversions) || 0;
      const value = Number(ag.conversions_value) || 0;
      assetGroupSummary.push({
        name: String(ag.asset_group_name),
        cost,
        conversions: conv,
        roas: cost > 0 ? Math.round((value / cost) * 100) / 100 : 0,
      });
    }

    // Concentration check
    if (latestAG.length > 1) {
      const topAG = latestAG[0];
      const topCostPct = totalCost > 0 ? (Number(topAG.cost) || 0) / totalCost : 0;
      if (topCostPct > 0.7) {
        signals.push({
          type: "asset_group_concentration",
          severity: "medium",
          title: "Asset group concentratierisico",
          description: `${String(topAG.asset_group_name)} neemt ${Math.round(topCostPct * 100)}% van het PMAX budget. Spreiding over meerdere asset groups kan risico verlagen.`,
          confidence: "high",
          affectedEntity: String(topAG.asset_group_name),
        });
      }
    }

    // Zero-conversion asset groups
    const zeroConvAGs = latestAG.filter((a) => (Number(a.conversions) || 0) === 0 && (Number(a.cost) || 0) > 10);
    if (zeroConvAGs.length > 0) {
      const wasteCost = zeroConvAGs.reduce((s, a) => s + (Number(a.cost) || 0), 0);
      signals.push({
        type: "asset_group_waste",
        severity: "high",
        title: `${zeroConvAGs.length} asset group(s) zonder conversies`,
        description: `€${Math.round(wasteCost)} spend over ${zeroConvAGs.length} asset groups met 0 conversies: ${zeroConvAGs.map((a) => String(a.asset_group_name)).slice(0, 3).join(", ")}.`,
        confidence: "high",
      });
    }
  }

  // ── Signal 3: Asset Weakness ──

  if (assets.length > 0) {
    const lowPerf = assets.filter((a) => String(a.performance_label) === "LOW");
    const bestPerf = assets.filter((a) => String(a.performance_label) === "BEST");

    if (lowPerf.length > bestPerf.length * 2 && lowPerf.length >= 3) {
      signals.push({
        type: "asset_weakness",
        severity: "medium",
        title: "Veel laag-presterende assets",
        description: `${lowPerf.length} assets met label LOW vs ${bestPerf.length} met BEST. Creative vernieuwing kan performance verbeteren.`,
        confidence: "medium",
      });
    }

    // Check asset type coverage
    const types = new Set(assets.map((a) => String(a.asset_type)));
    const hasImages = types.has("IMAGE") || types.has("MEDIA_BUNDLE");
    const hasVideo = types.has("YOUTUBE_VIDEO");
    if (!hasVideo && assets.length > 5) {
      signals.push({
        type: "asset_coverage",
        severity: "low",
        title: "Geen video-assets in PMAX",
        description: "Toevoegen van YouTube video-assets kan YouTube en Display performance verbeteren.",
        confidence: "medium",
      });
    }
  }

  // ── Signal 4: Placement Waste ──

  if (placements.length > 0) {
    const wasteThreshold = 20; // €20+
    const wastePlacements = placements.filter((p) => (Number(p.cost) || 0) > wasteThreshold && (Number(p.conversions) || 0) === 0);
    const totalWaste = wastePlacements.reduce((s, p) => s + (Number(p.cost) || 0), 0);

    if (wastePlacements.length > 0 && totalWaste > 50) {
      signals.push({
        type: "placement_waste",
        severity: "high",
        title: `€${Math.round(totalWaste)} verspild op plaatsingen zonder conversies`,
        description: `${wastePlacements.length} plaatsing(en) met >€${wasteThreshold} spend en 0 conversies. Top: ${wastePlacements.slice(0, 3).map((p) => String(p.placement)).join(", ")}.`,
        confidence: "high",
      });
    }
  }

  // ── Signal 5: Search Category Dilution ──

  if (searchCats.length > 0) {
    const totalCost = searchCats.reduce((s, c) => s + (Number(c.cost) || 0), 0);
    const zeroConvCats = searchCats.filter((c) => (Number(c.conversions) || 0) === 0 && (Number(c.cost) || 0) > 10);
    const wasteCost = zeroConvCats.reduce((s, c) => s + (Number(c.cost) || 0), 0);

    if (zeroConvCats.length > 3 && wasteCost > totalCost * 0.2) {
      signals.push({
        type: "search_dilution",
        severity: "medium",
        title: "PMAX zoekt breed zonder conversies in meerdere categorieën",
        description: `${zeroConvCats.length} zoekcategorieën zonder conversies verbruiken ${Math.round((wasteCost / totalCost) * 100)}% van de search-spend. PMAX breidt mogelijk uit naar irrelevante zoekthema's.`,
        confidence: "medium",
      });
    }
  }

  // ── Signal 6: Search Category Quality & Language Leakage ──

  if (searchCats.length > 0) {
    // Detect foreign language search terms (PMAX expanding to non-targeted markets)
    const foreignPatterns = /[\u0600-\u06FF]|[\u0400-\u04FF]|[\u4E00-\u9FFF]|[\u3040-\u309F]|[\u30A0-\u30FF]/; // Arabic, Cyrillic, Chinese, Japanese
    const nonTargetLanguages = ["civciv", "makinesi", "kuluçka", "yumurta", "csirke", "keltetö", "wylegarnia", "chocadeira", "couveuse"]; // Common non-NL/DE/FR terms
    const foreignTerms = searchCats.filter((c) => {
      const label = String(c.category_label || "").toLowerCase();
      return foreignPatterns.test(label) || nonTargetLanguages.some((t) => label.includes(t));
    });
    const foreignCost = foreignTerms.reduce((s, c) => s + (Number(c.cost) || 0), 0);
    const foreignImpr = foreignTerms.reduce((s, c) => s + (Number(c.impressions) || 0), 0);

    if (foreignTerms.length > 0 && (foreignCost > 10 || foreignImpr > 500)) {
      signals.push({
        type: "search_language_leakage",
        severity: foreignCost > 50 ? "high" : "medium",
        title: `PMAX taal-lekkage: ${foreignTerms.length} zoekcategorieën in niet-getargete talen`,
        description: `€${Math.round(foreignCost)} spend en ${foreignImpr} impressies op termen in buitenlandse talen (o.a. ${foreignTerms.slice(0, 3).map((c) => `"${String(c.category_label)}"`).join(", ")}). PMAX breidt uit naar markten die niet getarget worden. Controleer taalinstellingen en voeg negatieve zoekwoorden toe.`,
        confidence: "high",
      });
    }

    // Analyze search category quality: high-impr zero-conv categories
    const highImprZeroConv = searchCats.filter((c) => (Number(c.impressions) || 0) > 5000 && (Number(c.conversions) || 0) === 0);
    if (highImprZeroConv.length > 0) {
      const wastedImpr = highImprZeroConv.reduce((s, c) => s + (Number(c.impressions) || 0), 0);
      signals.push({
        type: "search_category_waste",
        severity: "medium",
        title: `${highImprZeroConv.length} zoekcategorieën met >5K impressies maar 0 conversies`,
        description: `Categorieën zoals ${highImprZeroConv.slice(0, 3).map((c) => `"${String(c.category_label)}"`).join(", ")} genereren samen ${wastedImpr.toLocaleString()} impressies zonder conversies. PMAX verspilt bereik op irrelevante zoekthema's.`,
        confidence: "high",
      });
    }
  }

  // ── Signal 7: PMAX vs Search/Shopping Cannibalization ──

  // Fetch campaign monthly data to detect PMAX growth vs Search/Shopping decline
  const { data: campMonthly } = await supabase
    .from("ads_campaign_monthly")
    .select("campaign_name, month, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .gte("month", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
    .order("month");

  if (campMonthly && campMonthly.length > 0) {
    const months = [...new Set(campMonthly.map((r) => String(r.month).slice(0, 7)))].sort();
    if (months.length >= 2) {
      const latestMonth = months[months.length - 1];
      const prevMonth = months[months.length - 2];

      const pmaxNames = new Set(pmaxCampaigns.map((c) => String(c.campaign_name)));
      let pmaxCostCur = 0, pmaxCostPrev = 0, pmaxConvCur = 0, pmaxConvPrev = 0;
      let otherCostCur = 0, otherCostPrev = 0, otherConvCur = 0, otherConvPrev = 0;

      for (const r of campMonthly) {
        const m = String(r.month).slice(0, 7);
        const isPmax = pmaxNames.has(String(r.campaign_name));
        const cost = Number(r.cost) || 0;
        const conv = Number(r.conversions) || 0;

        if (m === latestMonth) {
          if (isPmax) { pmaxCostCur += cost; pmaxConvCur += conv; }
          else { otherCostCur += cost; otherConvCur += conv; }
        } else if (m === prevMonth) {
          if (isPmax) { pmaxCostPrev += cost; pmaxConvPrev += conv; }
          else { otherCostPrev += cost; otherConvPrev += conv; }
        }
      }

      // Detect cannibalization: PMAX grows, others shrink, TOTAL doesn't grow proportionally
      const pmaxConvGrowth = pmaxConvPrev > 0 ? ((pmaxConvCur - pmaxConvPrev) / pmaxConvPrev) : 0;
      const otherConvGrowth = otherConvPrev > 0 ? ((otherConvCur - otherConvPrev) / otherConvPrev) : 0;
      const totalConvCur = pmaxConvCur + otherConvCur;
      const totalConvPrev = pmaxConvPrev + otherConvPrev;
      const totalGrowth = totalConvPrev > 0 ? ((totalConvCur - totalConvPrev) / totalConvPrev) : 0;

      if (pmaxConvGrowth > 0.2 && otherConvGrowth < -0.15) {
        const cannibalPct = totalGrowth < pmaxConvGrowth * 0.5 ? "hoog" : "mogelijk";
        signals.push({
          type: "pmax_cannibalization",
          severity: cannibalPct === "hoog" ? "critical" : "high",
          title: `PMAX cannibalisatie ${cannibalPct}: Search/Shopping conversies dalen terwijl PMAX groeit`,
          description: `PMAX conv. ${pmaxConvGrowth > 0 ? "+" : ""}${Math.round(pmaxConvGrowth * 100)}% MoM, Search/Shopping conv. ${Math.round(otherConvGrowth * 100)}% MoM. Totaal account groeit slechts ${Math.round(totalGrowth * 100)}%. PMAX lijkt conversies van bestaande campagnes over te nemen i.p.v. incrementeel te groeien.`,
          confidence: cannibalPct === "hoog" ? "high" : "medium",
        });
      }
    }
  }

  // ── Build prompt context ──

  const promptContext = buildPmaxPromptContext(pmaxCampaigns.length, signals, networkMix, assetGroupSummary, placements, searchCats);

  return {
    hasPmaxCampaigns: true,
    campaignCount: pmaxCampaigns.length,
    signals,
    networkMix,
    assetGroupSummary,
    promptContext,
  };
}

// ── Prompt context builder ─────────────────────────────────────────────────

function buildPmaxPromptContext(
  campaignCount: number,
  signals: PmaxSignal[],
  networkMix: PmaxInsights["networkMix"],
  assetGroupSummary: PmaxInsights["assetGroupSummary"],
  placements?: Array<Record<string, unknown>>,
  searchCats?: Array<Record<string, unknown>>
): string {
  if (campaignCount === 0) return "";

  const lines: string[] = [];
  lines.push(`\n\n## PMAX Intelligence (${campaignCount} campagne(s))`);

  if (networkMix.length > 0) {
    lines.push("\n### Network verdeling (waar gaat het PMAX budget naartoe?)");
    // Calculate efficiency ratio per network
    for (const n of networkMix) {
      const efficiency = n.costPct > 0 ? (n.convPct / n.costPct).toFixed(2) : "0";
      const label = Number(efficiency) > 1.2 ? "EFFICIËNT" : Number(efficiency) < 0.5 ? "INEFFICIËNT" : "NEUTRAAL";
      lines.push(`- ${n.network}: ${n.costPct}% spend → ${n.convPct}% conversies (efficiency ratio: ${efficiency} = ${label})`);
    }
  }

  if (assetGroupSummary.length > 0) {
    lines.push("\n### Asset group overzicht");
    const totalCost = assetGroupSummary.reduce((s, ag) => s + ag.cost, 0);
    for (const ag of assetGroupSummary.slice(0, 8)) {
      const share = totalCost > 0 ? Math.round((ag.cost / totalCost) * 100) : 0;
      lines.push(`- ${ag.name}: €${Math.round(ag.cost)} (${share}% van PMAX spend), ${Math.round(ag.conversions)} conv, ROAS ${ag.roas}x`);
    }
  }

  // Top search themes (what queries trigger PMAX?)
  if (searchCats && searchCats.length > 0) {
    lines.push("\n### PMAX Search Themes (welke zoekthema's triggeren PMAX?)");
    const topCats = searchCats.slice(0, 10);
    for (const cat of topCats) {
      const cost = Number(cat.cost) || 0;
      const conv = Number(cat.conversions) || 0;
      const label = String(cat.category_label || "Onbekend");
      const roas = cost > 0 ? ((Number(cat.conversions_value) || 0) / cost).toFixed(2) : "0";
      lines.push(`- "${label}": €${Math.round(cost)} spend, ${Math.round(conv)} conv, ROAS ${roas}x${conv === 0 && cost > 10 ? " ⚠️ GEEN CONVERSIES" : ""}`);
    }
  }

  // Top waste placements (where is budget leaking?)
  if (placements && placements.length > 0) {
    const wastePlacements = placements.filter((p) => (Number(p.cost) || 0) > 5 && (Number(p.conversions) || 0) === 0);
    if (wastePlacements.length > 0) {
      const totalWaste = wastePlacements.reduce((s, p) => s + (Number(p.cost) || 0), 0);
      lines.push(`\n### Placement waste (€${Math.round(totalWaste)} op plaatsingen zonder conversies)`);
      for (const p of wastePlacements.slice(0, 5)) {
        const placement = String(p.placement || "onbekend");
        const type = String(p.placement_type || "");
        lines.push(`- ${placement} (${type}): €${Math.round(Number(p.cost))} spend, ${Number(p.impressions)} impr, 0 conv`);
      }
    }
  }

  if (signals.length > 0) {
    lines.push("\n### PMAX signalen (voorberekend — gebruik deze conclusies)");
    for (const s of signals) {
      const icon = s.severity === "critical" ? "🔴" : s.severity === "high" ? "🟠" : s.severity === "medium" ? "🟡" : "🔵";
      lines.push(`- ${icon} [${s.severity.toUpperCase()}] ${s.title}`);
      lines.push(`  ${s.description}`);
    }
  }

  return lines.join("\n");
}
