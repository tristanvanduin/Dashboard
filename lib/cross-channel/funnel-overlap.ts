// X4 lens 2: funnelrol en overlap, pure kern. Classificeert elke campagne deterministisch
// naar zijn funnelrol en detecteert wat in geen los kanaalrapport zichtbaar is: meerdere
// kanalen die dezelfde warme pool retargeten (dubbel-betaal-risico op de blended CPA) en het
// ontbreken van prospecting (groeiplafond). Kanaal-eigen signalen, met een expliciet
// onbekend-pad voor niet-herkende waarden: degraderen, niet gokken. Conform de spec-no-go
// draagt elke uitkomst de onderliggende campagnelijst; geen advies zonder de lijst.

import { ATTRIBUTION_FOOTNOTE, type ChannelKey } from "./lens-facts";

export type FunnelRole = "prospecting" | "retargeting" | "branded_capture" | "onbekend";

export type AudienceKind =
  | "broad" // brede of Advantage-plus-achtige targeting
  | "custom_warm" // custom audiences, websitebezoekers, klantenlijsten (de warme pool)
  | "lookalike"
  | "branded_keywords"
  | "onbekend";

export interface CampaignFunnelInput {
  channel: ChannelKey;
  campaignId: string;
  campaignName: string;
  // Kanaal-eigen signalen; wat niet van toepassing is blijft weg.
  campaignType?: string | null; // Google: SEARCH, SHOPPING, PERFORMANCE_MAX, DISPLAY, VIDEO, DEMAND_GEN
  isBranded?: boolean | null; // Google: de campagne draait (vrijwel) alleen op eigen merktermen
  objective?: string | null; // Meta: OUTCOME_*; LinkedIn: LEAD_GENERATION enz.
  audienceKind?: AudienceKind | null; // Meta en LinkedIn: het doelgroeptype
}

export interface ClassifiedCampaign {
  channel: ChannelKey;
  campaignId: string;
  campaignName: string;
  role: FunnelRole;
  basis: string; // waarop de classificatie rust, voor de campagnelijst in de output
}

// De deterministische rolclassificatie. Volgorde: branded capture eerst (het scherpste
// signaal), dan het doelgroeptype (warm is retargeting, breed of lookalike is prospecting),
// dan het Google-campagnetype als terugval. Niet herkend blijft onbekend.
export function classifyFunnelRole(campaign: CampaignFunnelInput): ClassifiedCampaign {
  const base = { channel: campaign.channel, campaignId: campaign.campaignId, campaignName: campaign.campaignName };

  if (campaign.isBranded === true) {
    return { ...base, role: "branded_capture", basis: "draait op eigen merktermen" };
  }

  if (campaign.audienceKind === "custom_warm") {
    return { ...base, role: "retargeting", basis: "warme doelgroep (custom audience, bezoekers of klantenlijst)" };
  }
  if (campaign.audienceKind === "broad" || campaign.audienceKind === "lookalike") {
    return { ...base, role: "prospecting", basis: `${campaign.audienceKind === "broad" ? "brede" : "lookalike"} doelgroep` };
  }
  if (campaign.audienceKind === "branded_keywords") {
    return { ...base, role: "branded_capture", basis: "merkterm-doelgroep" };
  }

  const type = campaign.campaignType?.trim().toUpperCase();
  if (type) {
    if (type === "DISPLAY" || type === "VIDEO" || type === "DEMAND_GEN") {
      return { ...base, role: "prospecting", basis: `campagnetype ${type} is vraag-genererend` };
    }
    if (type === "SEARCH" || type === "SHOPPING" || type === "PERFORMANCE_MAX") {
      // Zonder branded-vlag is search of shopping vraag-vangend maar niet per se branded;
      // we classificeren als prospecting van bestaande vraag, geen retargeting.
      return { ...base, role: "prospecting", basis: `campagnetype ${type} vangt actieve vraag` };
    }
  }

  return { ...base, role: "onbekend", basis: "geen herkend objective, doelgroeptype of campagnetype" };
}

export interface FunnelGapFlag {
  kind: "dubbele_warme_pool" | "geen_prospecting";
  detail: string;
  campaigns: ClassifiedCampaign[]; // de onderliggende lijst, verplicht bij elke flag
}

export interface FunnelOverlapResult {
  classified: ClassifiedCampaign[];
  byRole: Record<FunnelRole, number>;
  flags: FunnelGapFlag[];
  unknownCount: number;
  attributionFootnote: string;
}

// Lens 2: de rolverdeling expliciet, en de twee gaten. Dubbel-betaal: retargeting op de warme
// pool vanuit twee of meer kanalen. Groeiplafond: nul prospecting terwijl er wel campagnes
// draaien. Veel onbekend wordt eerlijk gemeld in plaats van weggemoffeld.
export function analyzeFunnelOverlap(campaigns: CampaignFunnelInput[]): FunnelOverlapResult {
  const classified = campaigns.filter((c) => c.campaignId).map(classifyFunnelRole);

  const byRole: Record<FunnelRole, number> = { prospecting: 0, retargeting: 0, branded_capture: 0, onbekend: 0 };
  for (const c of classified) byRole[c.role] += 1;

  const flags: FunnelGapFlag[] = [];

  // Dubbele warme pool: retargeting vanuit twee of meer kanalen.
  const retargeting = classified.filter((c) => c.role === "retargeting");
  const retargetingChannels = [...new Set(retargeting.map((c) => c.channel))];
  if (retargetingChannels.length >= 2) {
    flags.push({
      kind: "dubbele_warme_pool",
      detail: `${retargetingChannels.join(" en ")} retargeten beide de warme pool; het risico is dat dezelfde persoon dubbel wordt betaald en de blended CPA vertekent`,
      campaigns: retargeting,
    });
  }

  // Geen prospecting terwijl er wel geclassificeerde campagnes draaien: groeiplafond.
  const known = classified.filter((c) => c.role !== "onbekend");
  if (known.length > 0 && byRole.prospecting === 0) {
    flags.push({
      kind: "geen_prospecting",
      detail: "geen enkel kanaal doet prospecting; alle inzet zit op warme of merkvraag en dat is een groeiplafond",
      campaigns: known,
    });
  }

  return {
    classified,
    byRole,
    flags,
    unknownCount: byRole.onbekend,
    attributionFootnote: ATTRIBUTION_FOOTNOTE,
  };
}
