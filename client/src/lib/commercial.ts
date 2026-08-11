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
  locale: "es" | "en" | "de" | "de-CH";
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
  environment: {
    isolation: "shared_local_demo";
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
