export const commercialFacilityTypes = [
  "traditional_gym",
  "crossfit",
  "hyrox",
  "functional_training",
  "personal_training",
  "powerlifting",
  "strongman",
  "bodybuilding",
  "martial_arts",
  "yoga",
  "pilates",
  "indoor_cycling",
  "multidisciplinary",
  "custom",
] as const;

export type CommercialFacilityType = (typeof commercialFacilityTypes)[number];

export interface CommercialTrial {
  id: string;
  facilityName: string;
  facilityType: CommercialFacilityType;
  approximateMembers: number | null;
  trainerCount: number | null;
  spaceCount: number | null;
  usualCapacity: number | null;
  classTypes: string[];
  scheduleNotes: string;
  publicDescription: string;
  addressLine: string;
  city: string;
  postalCode: string;
  country: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  linkedinUrl: string;
  pricingDescription: string;
  bonusesDescription: string;
  publicPageEnabled: boolean;
  showPhonePublicly: boolean;
  locale:
    | "es"
    | "en"
    | "de"
    | "de-CH"
    | "fr"
    | "it"
    | "gl"
    | "ca"
    | "ca-valencia"
    | "eu"
    | "oc-aranes";
  currency: string;
  usesBookings: boolean;
  usesWaitlist: boolean;
  status: string;
  subdomain: string;
  realDataDeclaration: "undeclared" | "yes" | "no" | "assistance";
  autoCleanupEligible: boolean;
  dataReviewRequestedAt: number | null;
  cleanupEligibleAt: number | null;
  startedAt: number;
  expiresAt: number;
  notice: { elapsedDays: number; remainingDays: number; milestone: number };
}

export interface CommercialTrialOverview {
  trial: CommercialTrial;
  /**
   * Added to the overview contract after the first commercial-trial release.
   * Keep it optional while clients and servers can be rolled back independently.
   */
  dataReview?: {
    visible: boolean;
    canDeclare: boolean;
    opensAt: number | null;
    serverNow: number;
    declarationBlockReason:
      | "invalid-time"
      | "not-open"
      | "cleanup-started"
      | "already-declared"
      | "inapplicable-state"
      | null;
  };
  branding: {
    logoDataUrl: string;
    accentColor: string;
  };
  environment: {
    isolation: "shared_local_demo";
    routing: "not_provisioned" | "tenant_subdomain";
    subdomainMeaning: "reserved_identifier" | "active_tenant_hostname";
    tenantOrigin: string | null;
    tenantBaseDomain: string | null;
    counts: Record<string, number>;
    modules: string[];
    restorationScope: "commercial_configuration_only";
  };
  events: Array<{
    id: string;
    type: string;
    metadata: Record<string, unknown>;
    createdAt: number;
  }>;
}

export interface PublishedCommercialCentre {
  slug: string;
  name: string;
  logoDataUrl: string;
  accentColor: string;
  facilityType: CommercialFacilityType;
  publicDescription: string;
  addressLine: string;
  city: string;
  postalCode: string;
  country: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  linkedinUrl: string;
  scheduleNotes: string;
  pricingDescription: string;
  bonusesDescription: string;
  phone: string;
  classTypes: string[];
  usesBookings: boolean;
  usesWaitlist: boolean;
}

export interface CommercialTrialSetup {
  tenantBaseDomain: string | null;
}

export type ConversionOrigin =
  "demo_seed" | "user_created" | "imported" | "converted";
export type ConversionDecision = "pending" | "keep" | "discard";
export interface CommercialConversionDraft {
  mode: "classification_only";
  conversionExecuted: false;
  items: Array<{
    category: string;
    origin: ConversionOrigin;
    decision: ConversionDecision;
  }>;
}
