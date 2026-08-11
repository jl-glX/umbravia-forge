import type { CommercialFacilityType } from "../db/types.js";

export const COMMERCIAL_TRIAL_DAYS = 31;
export const COMMERCIAL_TRIAL_MS = COMMERCIAL_TRIAL_DAYS * 24 * 60 * 60 * 1000;
export const COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_HOURS = 6;
export const COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS =
  COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_HOURS * 60 * 60 * 1000;

export const commercialFacilityTypes: CommercialFacilityType[] = [
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
];

export const commercialFoundation = {
  productName: "Umbravia Forge",
  vision:
    "Plataforma modular para que cada centro deportivo adapte su gestión, reservas, comunidad, facturación y seguridad a su propia operativa.",
  principle: "Producto primero, conversación después.",
  commitments: [
    "self_service_exploration",
    "no_mandatory_sales_contact",
    "no_unsolicited_calls",
    "editable_configuration",
    "transparent_trial",
  ],
  modules: [
    "management",
    "bookings",
    "attendance_uncertainty",
    "waiting_lists",
    "reputation",
    "members",
    "billing",
    "community",
    "security",
    "account_continuity",
  ],
  developmentOrder: [
    {
      priority: 1,
      area: "bookings",
      capabilities: [
        "editable_builder",
        "attendance_intent",
        "reputation",
        "dynamic_waitlist",
        "uncertainty_management",
      ],
    },
    { priority: 2, area: "billing" },
    {
      priority: 3,
      area: "commercial_experience",
      capabilities: [
        "automatic_trial",
        "templates",
        "31_day_duration",
        "modular_conversion",
        "voluntary_contact",
        "support_pause",
      ],
    },
    { priority: 4, area: "community" },
  ],
  currentCommercialScope: {
    implementedThroughPoint: 7,
    point8FoundationAvailable: true,
    conversionExecutionAvailable: false,
    isolatedTenantProvisioningAvailable: true,
  },
  trialPolicy: {
    durationDays: COMMERCIAL_TRIAL_DAYS,
    finalDataReviewGraceHours: COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_HOURS,
    reminderDays: [1, 14, 24, 28, 31],
    automaticRenewal: false,
    automaticSalesContact: false,
    artificialDiscounts: false,
    lastDayFeatureLock: false,
  },
} as const;

export const commercialTemplates: Record<
  CommercialFacilityType,
  { classTypes: string[]; usualCapacity: number; usesWaitlist: boolean }
> = {
  traditional_gym: {
    classTypes: ["Sala libre", "Clase dirigida"],
    usualCapacity: 24,
    usesWaitlist: true,
  },
  crossfit: {
    classTypes: ["WOD", "Open Box"],
    usualCapacity: 14,
    usesWaitlist: true,
  },
  hyrox: {
    classTypes: ["HYROX", "Técnica de estaciones"],
    usualCapacity: 16,
    usesWaitlist: true,
  },
  functional_training: {
    classTypes: ["Entrenamiento funcional"],
    usualCapacity: 16,
    usesWaitlist: true,
  },
  personal_training: {
    classTypes: ["Sesión individual"],
    usualCapacity: 1,
    usesWaitlist: false,
  },
  powerlifting: {
    classTypes: ["Fuerza", "Técnica"],
    usualCapacity: 10,
    usesWaitlist: true,
  },
  strongman: {
    classTypes: ["Strongman"],
    usualCapacity: 10,
    usesWaitlist: true,
  },
  bodybuilding: {
    classTypes: ["Sala de musculación"],
    usualCapacity: 30,
    usesWaitlist: false,
  },
  martial_arts: {
    classTypes: ["Técnica", "Sparring"],
    usualCapacity: 20,
    usesWaitlist: true,
  },
  yoga: { classTypes: ["Yoga"], usualCapacity: 18, usesWaitlist: true },
  pilates: { classTypes: ["Pilates"], usualCapacity: 14, usesWaitlist: true },
  indoor_cycling: {
    classTypes: ["Ciclo indoor"],
    usualCapacity: 20,
    usesWaitlist: true,
  },
  multidisciplinary: {
    classTypes: ["Actividad dirigida", "Entrenamiento libre"],
    usualCapacity: 20,
    usesWaitlist: true,
  },
  custom: {
    classTypes: ["Actividad personalizada"],
    usualCapacity: 12,
    usesWaitlist: true,
  },
};

export function createTrialSubdomain(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "centro"}-demo`;
}

export function getTrialNotice(
  startedAt: number,
  expiresAt: number,
  now = Date.now(),
) {
  const elapsedDays = Math.max(0, Math.floor((now - startedAt) / 86_400_000));
  const remainingDays = Math.max(0, Math.ceil((expiresAt - now) / 86_400_000));
  const milestone =
    elapsedDays >= 31
      ? 31
      : elapsedDays >= 28
        ? 28
        : elapsedDays >= 24
          ? 24
          : elapsedDays >= 14
            ? 14
            : 1;
  return { elapsedDays, remainingDays, milestone };
}
