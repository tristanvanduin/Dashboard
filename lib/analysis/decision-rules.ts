import type { AccountType } from "@/lib/prompts/sop-prompts";

export type ActionDirection =
  | "expand"
  | "reduce"
  | "investigate"
  | "monitor"
  | "geo_reduce"
  | "geo_expand"
  | "device_reduce"
  | "device_expand";

export interface CampaignDecision {
  campaignName: string;
  campaignId?: string;
  direction: ActionDirection;
  reason: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
}

export interface GeoDecision {
  country: string;
  direction: ActionDirection;
  reason: string;
  evidence: string;
  efficiencyRatio: number;
}

export interface DeviceDecision {
  device: string;
  direction: ActionDirection;
  reason: string;
  evidence: string;
}

export interface DecisionRulesOutput {
  accountStatus: "OP SCHEMA" | "NIET OP SCHEMA" | "KRITIEK";
  campaignDecisions: CampaignDecision[];
  geoDecisions: GeoDecision[];
  deviceDecisions: DeviceDecision[];
  bindingFacts: string;
}

export interface DecisionRulesTargets {
  roasTarget?: number;
  cpaTarget?: number;
  conversionsTarget?: number;
}

export interface DecisionRuleCampaignRow {
  campaign_id?: string | null;
  campaign_name: string;
  roas?: number | null;
  cost_per_conversion?: number | null;
  cost?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
  search_budget_lost_is?: number | null;
}

export interface DecisionRuleGeoRow {
  country: string;
  cost?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
  spend_share?: number | null;
}

export interface DecisionRuleDeviceRow {
  device: string;
  cost?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  conversion_rate?: number | null;
}

export interface DecisionRulesInput {
  accountType: AccountType;
  currentAccount: Record<string, unknown>;
  previousAccount?: Record<string, unknown> | null;
  campaignRows: DecisionRuleCampaignRow[];
  previousCampaignRows?: DecisionRuleCampaignRow[];
  geoRows: DecisionRuleGeoRow[];
  deviceRows: DecisionRuleDeviceRow[];
  targets: DecisionRulesTargets;
}

function num(value: unknown): number {
  return Number(value || 0);
}

function pct(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Number((((cur - prev) / prev) * 100).toFixed(1));
}

function ratioNumerator(row: DecisionRuleGeoRow): number {
  const conversionValue = num(row.conversions_value);
  if (conversionValue > 0) return conversionValue;
  return num(row.conversions);
}

function normalizeDirectionCase(direction: ActionDirection): string {
  return direction.toUpperCase();
}

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
}

function cleanDecisionText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+\|/g, " |")
    .replace(/\|\s+\|/g, "|")
    .replace(/[.;:]+\s*$/g, "")
    .trim();
}

function computeAccountStatus(opts: {
  currentAccount: Record<string, unknown>;
  targets: DecisionRulesTargets;
}): "OP SCHEMA" | "NIET OP SCHEMA" | "KRITIEK" {
  const conversions = num(opts.currentAccount.conversions);
  const roas = num(opts.currentAccount.roas) || (num(opts.currentAccount.conversions_value) > 0 && num(opts.currentAccount.cost) > 0
    ? num(opts.currentAccount.conversions_value) / num(opts.currentAccount.cost)
    : 0);
  const cpa = num(opts.currentAccount.cost_per_conversion) || (conversions > 0 ? num(opts.currentAccount.cost) / conversions : 0);
  const conversionsTarget = num(opts.targets.conversionsTarget);
  const roasTarget = num(opts.targets.roasTarget);
  const cpaTarget = num(opts.targets.cpaTarget);
  const conversionPass = conversionsTarget > 0 ? conversions >= conversionsTarget * 0.95 : conversions > 0;
  const conversionWarn = conversionsTarget > 0 ? conversions >= conversionsTarget * 0.8 : conversions > 0;
  const roasPass = roasTarget > 0 ? roas >= roasTarget * 0.95 : false;
  const cpaPass = cpaTarget > 0 ? cpa <= cpaTarget * 1.05 : false;

  if (conversionPass && (roasPass || cpaPass || (!roasTarget && !cpaTarget))) return "OP SCHEMA";
  if (conversionWarn) return "NIET OP SCHEMA";
  return "KRITIEK";
}

function evaluateCampaignDirection(opts: {
  accountType: AccountType;
  current: DecisionRuleCampaignRow;
  previous?: DecisionRuleCampaignRow;
  targets: DecisionRulesTargets;
}): CampaignDecision {
  const campaignName = opts.current.campaign_name;
  const roas = num(opts.current.roas) || (num(opts.current.conversions_value) > 0 && num(opts.current.cost) > 0
    ? num(opts.current.conversions_value) / num(opts.current.cost)
    : 0);
  const cpa = num(opts.current.cost_per_conversion) || (num(opts.current.conversions) > 0 ? num(opts.current.cost) / num(opts.current.conversions) : 0);
  const lostIs = num(opts.current.search_budget_lost_is) * (num(opts.current.search_budget_lost_is) <= 1 ? 100 : 1);
  const spendGrowth = pct(num(opts.current.cost), num(opts.previous?.cost));
  const roasTarget = num(opts.targets.roasTarget);
  const cpaTarget = num(opts.targets.cpaTarget);

  if (opts.accountType === "ecommerce_roas" || opts.accountType === "hybrid") {
    if (roasTarget > 0 && roas < roasTarget * 0.8 && spendGrowth > 40) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "reduce",
        reason: "ROAS ligt ruim onder target terwijl spend te hard groeit.",
        evidence: `ROAS ${roundTwo(roas)} vs target ${roundTwo(roasTarget)} | spend MoM ${spendGrowth > 0 ? "+" : ""}${spendGrowth}%`,
        confidence: "high",
      };
    }
    if (roasTarget > 0 && roas < roasTarget * 0.8) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "investigate",
        reason: "ROAS ligt ruim onder target, maar spendgroei is niet hoog genoeg voor directe reductie.",
        evidence: `ROAS ${roundTwo(roas)} vs target ${roundTwo(roasTarget)} | spend MoM ${spendGrowth > 0 ? "+" : ""}${spendGrowth}%`,
        confidence: "medium",
      };
    }
    if (roasTarget > 0 && roas >= roasTarget * 1.3 && lostIs > 10) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "expand",
        reason: "ROAS ligt ruim boven target en demand capture verliest volume op budget.",
        evidence: `ROAS ${roundTwo(roas)} vs target ${roundTwo(roasTarget)} | Search Lost IS (Budget) ${roundTwo(lostIs)}%`,
        confidence: "high",
      };
    }
    if (roasTarget > 0 && roas >= roasTarget && lostIs > 20 && (cpaTarget <= 0 || cpa < cpaTarget)) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "expand",
        reason: "Campagne haalt target en verliest nog demand door budgetlimiet.",
        evidence: `ROAS ${roundTwo(roas)} vs target ${roundTwo(roasTarget)} | Search Lost IS (Budget) ${roundTwo(lostIs)}% | CPA ${roundTwo(cpa)}`,
        confidence: "high",
      };
    }
    if (roasTarget > 0 && roas >= roasTarget && lostIs <= 20) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "monitor",
        reason: "Campagne haalt target zonder duidelijke budgetcap.",
        evidence: `ROAS ${roundTwo(roas)} vs target ${roundTwo(roasTarget)} | Search Lost IS (Budget) ${roundTwo(lostIs)}%`,
        confidence: "medium",
      };
    }
  }

  if (opts.accountType === "ecommerce_cpa" || opts.accountType === "leadgen_cpa" || opts.accountType === "hybrid") {
    if (cpaTarget > 0 && cpa > cpaTarget * 1.3 && spendGrowth > 30) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "reduce",
        reason: "CPA ligt te ver boven target terwijl spend te hard stijgt.",
        evidence: `CPA ${roundTwo(cpa)} vs target ${roundTwo(cpaTarget)} | spend MoM ${spendGrowth > 0 ? "+" : ""}${spendGrowth}%`,
        confidence: "high",
      };
    }
    if (cpaTarget > 0 && cpa > cpaTarget * 1.3) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "investigate",
        reason: "CPA ligt te ver boven target, maar spendgroei rechtvaardigt geen directe reductie.",
        evidence: `CPA ${roundTwo(cpa)} vs target ${roundTwo(cpaTarget)} | spend MoM ${spendGrowth > 0 ? "+" : ""}${spendGrowth}%`,
        confidence: "medium",
      };
    }
    if (cpaTarget > 0 && cpa < cpaTarget * 0.8 && lostIs > 15) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "expand",
        reason: "CPA ligt duidelijk onder target en de campagne verliest volume op budget.",
        evidence: `CPA ${roundTwo(cpa)} vs target ${roundTwo(cpaTarget)} | Search Lost IS (Budget) ${roundTwo(lostIs)}%`,
        confidence: "high",
      };
    }
    if (cpaTarget > 0 && cpa >= cpaTarget * 0.8 && cpa <= cpaTarget * 1.1) {
      return {
        campaignName,
        campaignId: opts.current.campaign_id ?? undefined,
        direction: "monitor",
        reason: "CPA beweegt binnen de bandbreedte rond target.",
        evidence: `CPA ${roundTwo(cpa)} vs target ${roundTwo(cpaTarget)}`,
        confidence: "medium",
      };
    }
  }

  return {
    campaignName,
    campaignId: opts.current.campaign_id ?? undefined,
    direction: "monitor",
    reason: "Geen harde trigger voor expand, reduce of investigate op basis van de deterministische regels.",
    evidence: `ROAS ${roundTwo(roas)} | CPA ${roundTwo(cpa)} | spend MoM ${spendGrowth > 0 ? "+" : ""}${spendGrowth}%`,
    confidence: "low",
  };
}

function evaluateGeoDecisions(geoRows: DecisionRuleGeoRow[]): GeoDecision[] {
  const totalSpend = geoRows.reduce((sum, row) => sum + num(row.cost), 0);
  const totalConversionValue = geoRows.reduce((sum, row) => sum + ratioNumerator(row), 0);

  return geoRows
    .filter((row) => num(row.cost) > 0)
    .map((row) => {
      const spendShare = num(row.spend_share) > 0 ? num(row.spend_share) : (totalSpend > 0 ? num(row.cost) / totalSpend : 0);
      const conversionShare = totalConversionValue > 0 ? ratioNumerator(row) / totalConversionValue : 0;
      const efficiencyRatio = spendShare > 0 ? conversionShare / spendShare : 0;
      if (efficiencyRatio < 0.7) {
        return {
          country: row.country,
          direction: "geo_reduce" as const,
          reason: "Land absorbeert meer spend dan het teruggeeft in conversie-aandeel.",
          evidence: `Spend share ${roundTwo(spendShare * 100)}% | conversion share ${roundTwo(conversionShare * 100)}%`,
          efficiencyRatio: roundTwo(efficiencyRatio),
        };
      }
      if (efficiencyRatio > 1.2) {
        return {
          country: row.country,
          direction: "geo_expand" as const,
          reason: "Land levert disproportioneel veel conversiewaarde voor zijn spend-aandeel.",
          evidence: `Spend share ${roundTwo(spendShare * 100)}% | conversion share ${roundTwo(conversionShare * 100)}%`,
          efficiencyRatio: roundTwo(efficiencyRatio),
        };
      }
      return {
        country: row.country,
        direction: "monitor" as const,
        reason: "Land zit binnen de neutrale efficiency-bandbreedte.",
        evidence: `Spend share ${roundTwo(spendShare * 100)}% | conversion share ${roundTwo(conversionShare * 100)}%`,
        efficiencyRatio: roundTwo(efficiencyRatio),
      };
    });
}

function evaluateDeviceDecisions(deviceRows: DecisionRuleDeviceRow[], currentAccount: Record<string, unknown>): DeviceDecision[] {
  const accountCvr = num(currentAccount.conversion_rate) || (() => {
    const totalClicks = deviceRows.reduce((sum, row) => sum + num(row.clicks), 0);
    const totalConversions = deviceRows.reduce((sum, row) => sum + num(row.conversions), 0);
    return totalClicks > 0 ? totalConversions / totalClicks : 0;
  })();
  const totalSpend = deviceRows.reduce((sum, row) => sum + num(row.cost), 0);

  return deviceRows
    .filter((row) => num(row.cost) > 0)
    .map((row) => {
      const deviceCvr = num(row.conversion_rate) || (num(row.clicks) > 0 ? num(row.conversions) / num(row.clicks) : 0);
      const spendShare = totalSpend > 0 ? num(row.cost) / totalSpend : 0;
      if (accountCvr > 0 && deviceCvr < accountCvr * 0.5 && spendShare > 0.2) {
        return {
          device: row.device,
          direction: "device_reduce" as const,
          reason: "Device converteert veel slechter dan het accountgemiddelde terwijl het materieel spend krijgt.",
          evidence: `CVR ${roundTwo(deviceCvr * 100)}% vs account ${roundTwo(accountCvr * 100)}% | spend share ${roundTwo(spendShare * 100)}%`,
        };
      }
      if (accountCvr > 0 && deviceCvr > accountCvr * 1.5) {
        return {
          device: row.device,
          direction: "device_expand" as const,
          reason: "Device converteert duidelijk beter dan het accountgemiddelde.",
          evidence: `CVR ${roundTwo(deviceCvr * 100)}% vs account ${roundTwo(accountCvr * 100)}%`,
        };
      }
      return {
        device: row.device,
        direction: "monitor" as const,
        reason: "Device zit binnen de neutrale bandbreedte ten opzichte van het accountgemiddelde.",
        evidence: `CVR ${roundTwo(deviceCvr * 100)}% vs account ${roundTwo(accountCvr * 100)}%`,
      };
    });
}

function renderBindingFacts(output: DecisionRulesOutput): string {
  const lines: string[] = [];
  lines.push("## BINDENDE ACTIERICHTINGEN (door data bepaald, NIET wijzigen)");
  lines.push("");
  lines.push(`Account status: ${output.accountStatus}`);
  lines.push("");
  lines.push("### Campagne-richtingen");
  if (output.campaignDecisions.length === 0) {
    lines.push("- Geen campagne-richtingen beschikbaar.");
  } else {
    output.campaignDecisions.forEach((decision) => {
      lines.push(`- ${cleanDecisionText(decision.campaignName)}: ${normalizeDirectionCase(decision.direction)} | ${cleanDecisionText(decision.reason)} | Data: ${cleanDecisionText(decision.evidence)}`);
    });
  }
  lines.push("");
  lines.push("### Geo-richtingen");
  if (output.geoDecisions.length === 0) {
    lines.push("- Geen geo-richtingen beschikbaar.");
  } else {
    output.geoDecisions.forEach((decision) => {
      lines.push(`- ${cleanDecisionText(decision.country)}: ${normalizeDirectionCase(decision.direction)} | ${cleanDecisionText(decision.reason)} | Efficiency ratio: ${decision.efficiencyRatio.toFixed(2)}`);
    });
  }
  lines.push("");
  lines.push("### Device-richtingen");
  if (output.deviceDecisions.length === 0) {
    lines.push("- Geen device-richtingen beschikbaar.");
  } else {
    output.deviceDecisions.forEach((decision) => {
      lines.push(`- ${cleanDecisionText(decision.device)}: ${normalizeDirectionCase(decision.direction)} | ${cleanDecisionText(decision.reason)}`);
    });
  }
  lines.push("");
  lines.push("REGEL: Formuleer GEEN acties die tegengesteld zijn aan bovenstaande richtingen.");
  lines.push("REDUCE = je mag NIET \"verhoog budget\" adviseren voor deze entiteit.");
  lines.push("EXPAND = je mag NIET \"verlaag budget\" adviseren voor deze entiteit.");
  lines.push("INVESTIGATE = formuleer alleen onderzoeksacties, geen directe wijzigingen.");
  lines.push("MONITOR = formuleer geen budget/bid wijzigingen, alleen monitoring.");
  return lines.join("\n");
}

export function computeDecisionRules(input: DecisionRulesInput): DecisionRulesOutput {
  const previousCampaignMap = new Map((input.previousCampaignRows ?? []).map((row) => [row.campaign_name, row]));
  const campaignDecisions = input.campaignRows
    .filter((row) => row.campaign_name)
    .map((row) => evaluateCampaignDirection({
      accountType: input.accountType,
      current: row,
      previous: previousCampaignMap.get(row.campaign_name),
      targets: input.targets,
    }));
  const dedupedCampaigns = Array.from(new Map(campaignDecisions.map((decision) => [decision.campaignName, decision])).values());
  const geoDecisions = evaluateGeoDecisions(input.geoRows);
  const deviceDecisions = evaluateDeviceDecisions(input.deviceRows, input.currentAccount);
  const output: DecisionRulesOutput = {
    accountStatus: computeAccountStatus({
      currentAccount: input.currentAccount,
      targets: input.targets,
    }),
    campaignDecisions: dedupedCampaigns,
    geoDecisions,
    deviceDecisions,
    bindingFacts: "",
  };
  output.bindingFacts = renderBindingFacts(output);
  return output;
}
