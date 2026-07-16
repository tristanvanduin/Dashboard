import type { EntityType, StepOutput } from "@/lib/schema/analysis-schema";
import type { StepDataAvailability } from "@/lib/analysis/data-availability";

export interface StepValidationResult {
  stepNumber: number;
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function isBlockingStepValidation(validation: StepValidationResult): boolean {
  return validation.valid === false;
}

type ActionDomain =
  | "tracking"
  | "budget"
  | "campaign"
  | "adgroup"
  | "keyword"
  | "searchterm"
  | "product"
  | "creative"
  | "audience"
  | "device"
  | "geo"
  | "network"
  | "schedule"
  | "checkout"
  | "synthesis";

export interface StepPurityRule {
  allowedEntityTypes?: EntityType[];
  allowedActionDomains?: ActionDomain[];
  forbiddenNarrativePatterns?: RegExp[];
  note: string;
}

export const STEP_PURITY_RULES: Partial<Record<number, StepPurityRule>> = {
  1: {
    allowedEntityTypes: ["account", "campaign"],
    allowedActionDomains: ["tracking", "budget", "campaign"],
    forbiddenNarrativePatterns: [/zoekterm|keyword|feed|sku|creative|asset|audience|device|land|geo|network|schedule/i],
    note: "Account status, target-gap en KPI-keten; geen diepe oorzaakclaims over latere domeinen.",
  },
  2: {
    allowedEntityTypes: ["campaign", "account"],
    allowedActionDomains: ["budget", "campaign", "tracking"],
    forbiddenNarrativePatterns: [/zoekterm|keyword|feed|sku|creative|asset|audience|device|schedule/i],
    note: "Campagneverschillen en allocatie; geen zoekterm-, feed- of creative-root-cause als hoofdclaim.",
  },
  3: {
    allowedEntityTypes: ["adgroup", "campaign"],
    allowedActionDomains: ["adgroup", "budget", "campaign"],
    forbiddenNarrativePatterns: [/auction|impression share|concurrent|competitor|zoekterm|feed|sku|creative|audience|device|land|geo|network|schedule/i],
    note: "Ad group en subcluster-verklaring; geen auction/feed/search-term/conversion-funnel hoofdconclusies.",
  },
  4: {
    allowedEntityTypes: ["campaign", "account"],
    allowedActionDomains: ["budget", "campaign"],
    forbiddenNarrativePatterns: [/feed|sku|creative|audience|device|searchterm|zoekterm|schedule|checkout/i],
    note: "Auction/rank/impression share/budget caps; geen deep-dive naar creative, feed of zoektermen.",
  },
  5: {
    allowedEntityTypes: ["keyword", "campaign", "adgroup"],
    allowedActionDomains: ["keyword", "campaign"],
    forbiddenNarrativePatterns: [/feed|sku|creative|audience|device|land|geo|network|schedule|checkout/i],
    note: "Keywords, match types en QS; geen search term, geo of feed-hoofdclaims.",
  },
  6: {
    allowedEntityTypes: ["product", "adgroup", "campaign"],
    allowedActionDomains: ["product", "campaign"],
    forbiddenNarrativePatterns: [/audience|device|land|geo|network|schedule|checkout/i],
    note: "Productmix, feed, assortiment en SKU-logica; geen audience/geo/network hoofdclaim.",
  },
  7: {
    allowedEntityTypes: ["searchterm", "keyword", "campaign", "adgroup"],
    allowedActionDomains: ["searchterm", "keyword", "campaign"],
    forbiddenNarrativePatterns: [/creative|asset|audience|device|land|geo|network|schedule|checkout/i],
    note: "Search term intent en routing; geen creative-, geo-, device- of network-hoofdclaim.",
  },
  8: {
    allowedEntityTypes: ["creative", "campaign", "adgroup"],
    allowedActionDomains: ["creative", "campaign"],
    forbiddenNarrativePatterns: [/zoekterm|keyword|feed|sku|audience|device|land|geo|network|schedule|checkout/i],
    note: "Creative en message mismatch; geen feed/search term/geo hoofdclaim.",
  },
  9: {
    allowedEntityTypes: ["audience", "campaign", "adgroup"],
    allowedActionDomains: ["audience", "campaign"],
    forbiddenNarrativePatterns: [/zoekterm|keyword|feed|sku|creative|asset|device|land|geo|network|schedule|checkout/i],
    note: "Audience efficiency; geen geo/network/feed/search term hoofdclaim.",
  },
  10: {
    allowedEntityTypes: ["device", "campaign", "adgroup", "account"],
    allowedActionDomains: ["device", "campaign"],
    forbiddenNarrativePatterns: [/zoekterm|keyword|feed|sku|creative|asset|audience|land|geo|network|schedule/i],
    note: "Device en engagement; geen zoekterm-, geo- of network-hoofdclaim.",
  },
  11: {
    allowedEntityTypes: ["country", "campaign", "account"],
    allowedActionDomains: ["geo", "campaign", "budget"],
    forbiddenNarrativePatterns: [/zoekterm|keyword|feed|sku|creative|asset|audience|device|network|schedule|checkout/i],
    note: "Geo-performance; geen feed/search term/network hoofdclaim.",
  },
  12: {
    allowedEntityTypes: ["schedule", "network", "device", "account", "campaign"],
    allowedActionDomains: ["network", "schedule", "checkout", "campaign"],
    forbiddenNarrativePatterns: [/zoekterm|keyword|feed|sku|creative|asset|audience|land|geo/i],
    note: "Checkout, schedule en network; geen search term, feed of geo-hoofdclaim.",
  },
};

const ACTION_DOMAIN_PATTERNS: Array<[ActionDomain, RegExp]> = [
  ["tracking", /tracking|meting|tag|attribu|valid|meet/i],
  ["budget", /budget|dagbudget|spend|tROAS|tCPA|target|bied|bod/i],
  ["campaign", /campagne|campaign/i],
  ["adgroup", /ad group|adgroup/i],
  ["keyword", /keyword|match type|exact|phrase|broad|quality score|qs/i],
  ["searchterm", /zoekterm|search term|negative|uitsluit/i],
  ["product", /product|sku|merchant|feed|titel|image|prijs|verzend|asset group|productgroep/i],
  ["creative", /creative|asset|copy|rsa|beeld|headline|description/i],
  ["audience", /audience|doelgroep|affinity|in-market|age|gender|income/i],
  ["device", /device|desktop|mobile|tablet/i],
  ["geo", /geo|land|regio|duitsland|nederland|belgie|belgië|germany|netherlands|france/i],
  ["network", /network|youtube|search partners|partner/i],
  ["schedule", /schedule|uur|dagdeel|planning|weekday|weekdag/i],
  ["checkout", /checkout|atc|add to cart|purchase|funnel/i],
  ["synthesis", /hypothese|sprint|executive|thread|samenvatting/i],
];

export function inferActionDomains(text: string): ActionDomain[] {
  return ACTION_DOMAIN_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([domain]) => domain);
}

export function isFindingAlignedWithStep(stepNumber: number, entityType: EntityType, rules: Partial<Record<number, StepPurityRule>> = STEP_PURITY_RULES): boolean {
  const rule = rules[stepNumber];
  if (!rule?.allowedEntityTypes || rule.allowedEntityTypes.length === 0) return true;
  return rule.allowedEntityTypes.includes(entityType);
}

export function isActionAlignedWithStep(stepNumber: number, action: string, rules: Partial<Record<number, StepPurityRule>> = STEP_PURITY_RULES): boolean {
  const rule = rules[stepNumber];
  if (!rule?.allowedActionDomains || rule.allowedActionDomains.length === 0) return true;
  const domains = inferActionDomains(action);
  if (domains.length === 0) return true;
  const genericOverlayDomains: ActionDomain[] = ["budget", "campaign", "tracking", "synthesis"];
  const specificDomains = domains.filter((domain) => !genericOverlayDomains.includes(domain));
  if (specificDomains.length === 0) return true;
  return specificDomains.every((domain) => rule.allowedActionDomains?.includes(domain));
}

export function extractMetricContext(text: string, entity: string, metric: string): string | null {
  const sentences = text.split(/[.!?]+/);
  for (const sentence of sentences) {
    if (sentence.includes(entity) || sentence.includes(metric)) {
      return sentence;
    }
  }
  return null;
}

function isLowerBetterMetric(metric: string): boolean {
  return /^(CPA|CPC|Bounce|Bounce Rate|Cost|Spend)$/i.test(metric.trim());
}

// F3 4c: vaste SOP-logformat-frasen per stap, letterlijk overgenomen uit SOP_LOG_FORMATS in
// lib/prompts/monthly-v2.ts (niet verzonnen). Een log_entry die het format volgt matcht minstens
// een van deze frasen. Stap 13 heeft geen format (synthese) en staat hier bewust niet in.
export const LOG_FORMAT_SKELETONS: Record<number, RegExp[]> = {
  1: [/is te verklaren door/i, /maand op maand/i],
  2: [/dragen sterk bij aan/i, /breuklijn te identificeren/i, /presteert (boven|onder)gemiddeld/i],
  3: [/dragen sterk bij aan/i, /breuklijn te identificeren/i, /presteert (boven|onder)gemiddeld/i],
  4: [/sinds de week van/i, /is sinds .{0,40}zichtbaar/i],
  5: [/geïdentificeerd als/i, /trend charts/i, /vertoningen/i],
  6: [/breuklijn te identificeren/i, /under-index/i, /over-index/i],
  7: [/geïdentificeerd als/i, /spendeerde deze zoekterm/i],
  8: [/presteert sinds tijdframe/i, /kijkende naar de asset/i],
  9: [/presteert (boven|onder)gemiddeld/i, /trend zichtbaar/i],
  10: [/presteerde afgelopen maand (boven|onder)gemiddeld/i, /bounce rate/i, /engagement rate/i],
  11: [/(boven|onder)gemiddeld afgelopen maand/i, /waarneembaar sinds/i],
  12: [/drop-off/i, /over de laatste 2 maanden/i, /blijft deze observatie in stand/i],
};

// G4 4a: formuleringen waarmee het model een term als niet-bestaand of toekomstig wegzet. Als de
// twijfel-zin een product-versie-term bevat die WEL in de live data voorkomt, is het waarschijnlijk
// een kennis-cutoff-artefact (bijvoorbeeld iPhone 17 in 2026) en geen echt niet-bestaand product.
const WORLD_KNOWLEDGE_DOUBT_PATTERNS: RegExp[] = [
  /niet[- ]bestaande?/i,
  /niet[- ]bestaan/i,
  /bestaat\s+(nog\s+)?niet/i,
  /toekomstig(e)?\s+(model|product|variant|versie|generatie|iphone|telefoon)/i,
  /future intent waste/i,
  /fictief\s+product/i,
];

export function validateStepOutput(
  stepNumber: number,
  output: StepOutput,
  priorStepConclusion?: string,
  options?: {
    availability?: StepDataAvailability | null;
    liveTerms?: string[];
    purityRules?: Partial<Record<number, StepPurityRule>>;
    logFormatSkeletons?: Record<number, RegExp[]>;
  }
): StepValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  // Kanaal-bewuste regels: de adapter kan eigen purity-regels en log-format-skeletons leveren
  // (Meta verschilt van Google). Zonder override gelden de Google-constanten, dus byte-identiek.
  const purityRules = options?.purityRules ?? STEP_PURITY_RULES;
  const logFormatSkeletons = options?.logFormatSkeletons ?? LOG_FORMAT_SKELETONS;

  if (stepNumber > 1) {
    const opensWithRecap = /^(In stap \d|In de vorige stap)/i.test(output.narrative.trim());
    if (opensWithRecap) {
      warnings.push("AC-06: Narratief opent met een recap van een eerdere stap; begin direct met de eigen bevinding.");
    }
    if (!priorStepConclusion?.trim()) {
      warnings.push("Cross-reference context ontbreekt vanuit vorige stapconclusie");
    }
  }

  if (output.log_entries.length === 0) {
    errors.push("AC-07: Geen log entries gevonden");
  }

  if (output.top_3_findings.length !== 3) {
    warnings.push(`Verwacht 3 findings, kreeg ${output.top_3_findings.length}`);
  }

  for (const finding of output.top_3_findings) {
    if (!isFindingAlignedWithStep(stepNumber, finding.entity_type, purityRules)) {
      warnings.push(`Step-purity: finding "${finding.entity_name}::${finding.metric}" ligt buiten het primaire domein van stap ${stepNumber}`);
    }
  }

  const keys = output.top_3_findings.map((finding) => `${finding.entity_name}::${finding.metric}`);
  const uniqueKeys = new Set(keys);
  if (uniqueKeys.size < keys.length) {
    warnings.push("Duplicate entity+metric combinatie binnen dezelfde stap");
  }

  for (const action of output.actions) {
    if (/(consolideer|optimaliseer|onderzoek|analyseer)/i.test(action.actie)) {
      errors.push(`Verboden woord in actie: "${action.actie}"`);
    }
    if (!isActionAlignedWithStep(stepNumber, action.actie, purityRules)) {
      warnings.push(`Step-purity: actie "${action.actie}" ligt waarschijnlijk buiten het primaire domein van stap ${stepNumber}`);
    }
  }

  const hasNumbers = /\d+[,.]?\d*%|\€\d+|\d+[,.]?\d*x/.test(output.narrative);
  if (!hasNumbers) {
    warnings.push("Narratief bevat geen concrete cijfers");
  }

  const narrative = output.narrative;
  const weakestEvidenceOnly = output.top_3_findings.every(
    (finding) => finding.evidence_level === "hypothesis" || finding.evidence_level === "unknown" || !finding.evidence_level
  );
  if (weakestEvidenceOnly && /\b(bevestigt|toont aan|bewijst|is de oorzaak van)\b/i.test(narrative)) {
    warnings.push("Narratief klinkt te stellig voor findings met alleen hypothesis/unknown evidence");
  }
  const purityRule = purityRules[stepNumber];
  if (purityRule?.forbiddenNarrativePatterns?.some((pattern) => pattern.test(narrative))) {
    warnings.push(`Step-purity: narratief van stap ${stepNumber} lijkt buiten het eigen analyse-domein te redeneren`);
  }
  if (stepNumber < 13 && /\b(root cause|hoofdoorzaak|definitieve oorzaak|definitief verklaart)\b/i.test(narrative) && weakestEvidenceOnly) {
    warnings.push("Causale claim te stellig voor deze stap en evidence-sterkte");
  }
  if (stepNumber < 13 && /\b(jaartrend|structureel probleem|blijvend patroon)\b/i.test(narrative) && !/yoy|vorig jaar|13 maanden|3 maanden/i.test(narrative)) {
    warnings.push("Structurele claim zonder expliciete trend- of historieonderbouwing");
  }
  if (stepNumber < 13 && /\b(onder target|boven benchmark|onder benchmark|op schema|niet op schema)\b/i.test(narrative) && !/\b(target|benchmark|maandtarget|sector)\b/i.test(narrative)) {
    warnings.push("Status-, target- en benchmarktaal lijken door elkaar te lopen");
  }
  for (const finding of output.top_3_findings) {
    if (finding.current_value !== null && finding.previous_value !== null) {
      const actualDirection = finding.current_value > finding.previous_value ? "up" : "down";
      const entityMention = narrative.includes(finding.entity_name) || narrative.includes(finding.metric);
      if (entityMention) {
        const metricContext = extractMetricContext(narrative, finding.entity_name, finding.metric);
        if (metricContext) {
          const narrativeSaysUp = /stijg|steeg|toena|verbeter|groei|hoger|boven/i.test(metricContext);
          const narrativeSaysDown = /daal|daalde|kelderd|afna|verslechter|krimp|lager|onder/i.test(metricContext);
          const lowerIsBetter = isLowerBetterMetric(finding.metric);

          if (actualDirection === "up" && narrativeSaysDown && !lowerIsBetter) {
            warnings.push(
              `Wiskundige inconsistentie: ${finding.entity_name} ${finding.metric} steeg (${finding.previous_value} -> ${finding.current_value}) maar narratief suggereert daling`
            );
          }
          if (actualDirection === "down" && narrativeSaysUp && !lowerIsBetter) {
            warnings.push(
              `Wiskundige inconsistentie: ${finding.entity_name} ${finding.metric} daalde (${finding.previous_value} -> ${finding.current_value}) maar narratief suggereert stijging`
            );
          }
          if (actualDirection === "up" && narrativeSaysUp && lowerIsBetter && /verbeter|beter/i.test(metricContext)) {
            warnings.push(
              `Wiskundige inconsistentie: ${finding.entity_name} ${finding.metric} steeg (${finding.previous_value} -> ${finding.current_value}) maar narratief suggereert verbetering`
            );
          }
          if (actualDirection === "down" && narrativeSaysDown && lowerIsBetter && /verslechter|slechter/i.test(metricContext)) {
            warnings.push(
              `Wiskundige inconsistentie: ${finding.entity_name} ${finding.metric} daalde (${finding.previous_value} -> ${finding.current_value}) maar narratief suggereert verslechtering`
            );
          }
        }
      }
    }
  }

  const scopedUnavailableDimensions = new Set(
    (options?.availability?.dimensions ?? [])
      .filter((dimension) => !dimension.available)
      .map((dimension) => {
        const normalized = dimension.name.toLowerCase();
        if (normalized.includes("checkout")) return "checkout";
        if (normalized.includes("schedule")) return "schedule";
        if (normalized.includes("network")) return "network";
        if (normalized.includes("audience")) return "audience";
        if (normalized.includes("engagement")) return "engagement";
        if (normalized.includes("device")) return "device";
        if (normalized.includes("creative")) return "creative";
        if (normalized.includes("keyword")) return "keyword";
        if (normalized.includes("product")) return "product";
        if (normalized.includes("geo")) return "geo";
        return normalized;
      })
  );
  const narrativeWithLogs = `${output.narrative}\n${output.log_entries.join("\n")}`;
  const explicitlyUnavailableScopes = new Set<string>();
  if (/checkout(?: funnel)? data niet beschikbaar|geen checkout funnel data beschikbaar/i.test(narrativeWithLogs)) explicitlyUnavailableScopes.add("checkout");
  if (/schedule data niet beschikbaar|geen schedule data beschikbaar|geen ad schedule data beschikbaar/i.test(narrativeWithLogs)) explicitlyUnavailableScopes.add("schedule");
  if (/network data niet beschikbaar|geen network data beschikbaar/i.test(narrativeWithLogs)) explicitlyUnavailableScopes.add("network");
  if (/audience data niet beschikbaar/i.test(narrativeWithLogs)) explicitlyUnavailableScopes.add("audience");
  if (/engagement kpi data niet beschikbaar/i.test(narrativeWithLogs)) explicitlyUnavailableScopes.add("engagement");
  if (/productdata niet beschikbaar|geen productdata beschikbaar|custom labels\/categories\): data niet beschikbaar door ontbrekende merchant center koppeling/i.test(narrativeWithLogs)) explicitlyUnavailableScopes.add("product");
  const allUnavailable = options?.availability?.dimensions?.length
    ? options.availability.dimensions.every((dimension) => !dimension.available)
    : false;
  const hasGlobalNoDataClaim = allUnavailable || (
    /geen data beschikbaar|niet uitvoerbaar/i.test(output.narrative)
    && explicitlyUnavailableScopes.size === 0
  );
  const findingAvailabilityScope = (finding: StepOutput["top_3_findings"][number]): string | null => {
    if (finding.entity_type === "schedule" || finding.issue_cluster === "schedule_waste") return "schedule";
    if (finding.entity_type === "network" || finding.issue_cluster === "network_quality" || finding.issue_cluster === "search_partner_waste") return "network";
    if (/checkout|funnel|purchase|add to cart|begin checkout/i.test(`${finding.issue_cluster} ${finding.metric} ${finding.cause || ""}`)) return "checkout";
    if (finding.entity_type === "audience") return "audience";
    if (finding.entity_type === "device") return "device";
    if (finding.entity_type === "product" || finding.issue_cluster === "product_mix") return "product";
    return null;
  };

  if (hasGlobalNoDataClaim || explicitlyUnavailableScopes.size > 0) {
    for (const finding of output.top_3_findings) {
      const findingScope = findingAvailabilityScope(finding);
      const conflictsWithUnavailableScope = hasGlobalNoDataClaim
        || (findingScope != null && explicitlyUnavailableScopes.has(findingScope) && scopedUnavailableDimensions.has(findingScope));
      if (finding.evidence_level === "deterministic" && conflictsWithUnavailableScope) {
        errors.push(
          `Evidence-level "deterministic" op finding "${finding.entity_name}::${finding.metric}" terwijl het narratief aangeeft dat data niet beschikbaar is`
        );
      }
      if (finding.severity === "critical" && conflictsWithUnavailableScope) {
        warnings.push(
          `Severity "critical" bij afwezige data voor "${finding.entity_name}::${finding.metric}" - overweeg "high" of "medium"`
        );
      }
    }
  }

  if (purityRule && output.step_conclusion && purityRule.forbiddenNarrativePatterns?.some((pattern) => pattern.test(output.step_conclusion))) {
    warnings.push(`Step-purity: step_conclusion van stap ${stepNumber} trekt waarschijnlijk een later-domein conclusie. ${purityRule.note}`);
  }

  // AC-08: minimaal 60 procent van de relevante log_entries volgt het SOP-logformat (matcht een
  // skeleton-frase) EN bevat een concreet getal. Werkwijze-kopjes en data-niet-beschikbaar tellen niet mee.
  const skeletons = logFormatSkeletons[stepNumber];
  if (skeletons && skeletons.length > 0 && output.log_entries.length > 0) {
    const relevantEntries = output.log_entries.filter((entry) => {
      const trimmed = entry.trim();
      return !/^werkwijze/i.test(trimmed) && !/data niet beschikbaar/i.test(trimmed);
    });
    if (relevantEntries.length > 0) {
      const conforms = (entry: string) => skeletons.some((skeleton) => skeleton.test(entry)) && /\d/.test(entry);
      const conformingCount = relevantEntries.filter(conforms).length;
      if (conformingCount / relevantEntries.length < 0.6) {
        const firstDeviating = relevantEntries.find((entry) => !conforms(entry));
        warnings.push(
          `AC-08: log_entries volgen het SOP-logformat onvoldoende (${conformingCount}/${relevantEntries.length} conform)` +
            (firstDeviating ? `; voorbeeld afwijking: "${firstDeviating.slice(0, 120)}"` : "")
        );
      }
    }
  }

  // G4 4a: wereldkennis-gronding. Een twijfel-zin die een product-versie-term noemt die in de live
  // campagne-, zoekterm- of productdata voorkomt, is waarschijnlijk een kennis-cutoff-artefact.
  const liveTerms = options?.liveTerms;
  if (liveTerms && liveTerms.length > 0) {
    const liveTermSet = liveTerms.map((term) => term.toLowerCase()).filter((term) => term.length >= 3);
    const text = `${output.narrative} ${output.log_entries.join(" ")}`;
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      if (!WORLD_KNOWLEDGE_DOUBT_PATTERNS.some((pattern) => pattern.test(sentence))) continue;
      const candidates = (sentence.match(/\b[\p{L}]+\s?\d{1,4}\b/giu) || []).map((candidate) => candidate.toLowerCase().replace(/\s+/g, " ").trim());
      const hit = candidates.find((candidate) => liveTermSet.some((term) => term.includes(candidate)));
      if (hit) {
        warnings.push(`Wereldkennis: "${hit}" wordt als niet-bestaand of toekomstig bestempeld, maar komt voor in de live campagne-, zoekterm- of productdata; dit is waarschijnlijk een kennis-cutoff-artefact en mag niet zonder andere onderbouwing als niet-bestaand of waste worden geclassificeerd.`);
        break;
      }
    }
  }

  return {
    stepNumber,
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
