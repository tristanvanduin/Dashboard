import type { Finding } from "@/lib/schema/analysis-schema";

export type EntityScope =
  | "account"
  | "campaign"
  | "adgroup"
  | "keyword"
  | "product"
  | "searchterm"
  | "creative"
  | "audience"
  | "device"
  | "country"
  | "network"
  | "schedule";

export interface EntityIdentity {
  entity_type: Finding["entity_type"];
  entity_scope: EntityScope;
  canonical_entity_name: string;
  canonical_geo_id: string | null;
  parent_campaign: string | null;
  parent_adgroup: string | null;
  display_label: string;
  identity_key: string;
}

const COUNTRY_ALIASES: Array<[RegExp, string]> = [
  [/^belgium(\s*\(be\))?$/i, "België"],
  [/^belgi[eë](\s*\(be\))?$/i, "België"],
  [/^germany(\s*\(de\))?$/i, "Duitsland"],
  [/^duitsland(\s*\(de\))?$/i, "Duitsland"],
  [/^netherlands(\s*\(nl\))?$/i, "Nederland"],
  [/^nederland(\s*\(nl\))?$/i, "Nederland"],
  [/^france(\s*\(fr\))?$/i, "Frankrijk"],
  [/^frankrijk(\s*\(fr\))?$/i, "Frankrijk"],
];

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function detectCanonicalGeoId(...values: Array<string | null | undefined>): string | null {
  const haystack = values
    .filter(Boolean)
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/\b(duitsland|germany)\b/.test(haystack) || /\bde\b/.test(haystack)) return "de";
  if (/\b(nederland|netherlands)\b/.test(haystack) || /\bnl\b/.test(haystack)) return "nl";
  if (/\b(belgie|belgium)\b/.test(haystack) || /\bbe\b/.test(haystack)) return "be";
  if (/\b(frankrijk|france)\b/.test(haystack) || /\bfr\b/.test(haystack)) return "fr";
  return null;
}

export function normalizeScopedEntityName(raw: string, entityType: Finding["entity_type"]): string {
  let name = (raw || "").trim().replace(/\s+/g, " ");

  if (entityType === "country") {
    for (const [pattern, canonical] of COUNTRY_ALIASES) {
      if (pattern.test(name)) return canonical;
    }
    return name.replace(/\s*\(([A-Z]{2})\)\s*$/i, "").trim();
  }

  if (entityType === "account") {
    if (/^account(\s+(overall|performance|wide|level))?$/i.test(name) || /^gads-\d+$/i.test(name)) {
      return "Account";
    }
    return name;
  }

  // Strip trailing system suffixes, but never convert short labels like "DE"
  return name.replace(/\s*\((search|shopping|pmax|pmx)\)\s*$/i, "").trim();
}

export function defaultEntityScope(entityType: Finding["entity_type"]): EntityScope {
  switch (entityType) {
    case "account":
      return "account";
    case "campaign":
      return "campaign";
    case "adgroup":
      return "adgroup";
    case "keyword":
      return "keyword";
    case "product":
      return "product";
    case "searchterm":
      return "searchterm";
    case "creative":
      return "creative";
    case "audience":
      return "audience";
    case "device":
      return "device";
    case "country":
      return "country";
    case "network":
      return "network";
    case "schedule":
      return "schedule";
  }
}

export function buildDisplayLabel(identity: {
  entity_type: Finding["entity_type"];
  canonical_entity_name: string;
  parent_campaign?: string | null;
  parent_adgroup?: string | null;
}): string {
  const { entity_type, canonical_entity_name, parent_campaign, parent_adgroup } = identity;
  switch (entity_type) {
    case "country":
      return `Land: ${canonical_entity_name}`;
    case "adgroup":
      return parent_campaign
        ? `Ad group: ${canonical_entity_name} (Campagne: ${parent_campaign})`
        : `Ad group: ${canonical_entity_name}`;
    case "campaign":
      return `Campagne: ${canonical_entity_name}`;
    case "keyword":
      return parent_adgroup
        ? `Keyword: ${canonical_entity_name} (Ad group: ${parent_adgroup})`
        : `Keyword: ${canonical_entity_name}`;
    case "product":
      return parent_campaign
        ? `Product: ${canonical_entity_name} (Campagne: ${parent_campaign})`
        : `Product: ${canonical_entity_name}`;
    case "searchterm":
      return `Zoekterm: ${canonical_entity_name}`;
    case "creative":
      return parent_adgroup
        ? `Creative: ${canonical_entity_name} (Ad group: ${parent_adgroup})`
        : `Creative: ${canonical_entity_name}`;
    case "audience":
      return `Audience: ${canonical_entity_name}`;
    case "device":
      return `Device: ${canonical_entity_name}`;
    case "network":
      return `Netwerk: ${canonical_entity_name}`;
    case "schedule":
      return `Planning: ${canonical_entity_name}`;
    case "account":
      return `Account: ${canonical_entity_name}`;
    default:
      return canonical_entity_name;
  }
}

export function deriveEntityIdentity(finding: Pick<Finding, "entity_type" | "entity_name" | "entity_scope" | "parent_campaign" | "parent_adgroup" | "display_label">): EntityIdentity {
  const entity_scope = (finding.entity_scope as EntityScope | undefined) ?? defaultEntityScope(finding.entity_type);
  const canonical_entity_name = normalizeScopedEntityName(finding.entity_name, finding.entity_type);
  const parent_campaign = finding.parent_campaign?.trim() || null;
  const parent_adgroup = finding.parent_adgroup?.trim() || null;
  const canonical_geo_id = detectCanonicalGeoId(canonical_entity_name, parent_campaign, parent_adgroup);
  const display_label = finding.display_label?.trim() || buildDisplayLabel({
    entity_type: finding.entity_type,
    canonical_entity_name,
    parent_campaign,
    parent_adgroup,
  });
  const identity_key = [
    finding.entity_type,
    entity_scope,
    slugify(canonical_entity_name),
    slugify(parent_campaign || ""),
    slugify(parent_adgroup || ""),
  ].join("::");

  return {
    entity_type: finding.entity_type,
    entity_scope,
    canonical_entity_name,
    canonical_geo_id,
    parent_campaign,
    parent_adgroup,
    display_label,
    identity_key,
  };
}
