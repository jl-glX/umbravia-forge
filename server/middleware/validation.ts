import { NextFunction, Request, Response } from "express";
import {
  body,
  param,
  query,
  ValidationChain,
  validationResult,
} from "express-validator";
import {
  MAX_PASSWORD_BYTES,
  isPasswordWithinHashLimit,
} from "../lib/password-policy.js";
import { isSupportId } from "../lib/support-id.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECOVERY_USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.]{2,31}$/;
const roles = ["member", "trainer", "admin"];
const commercialFacilityTypes = [
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

const enforcePasswordHashLimit = (value: string): boolean => {
  if (!isPasswordWithinHashLimit(value)) {
    throw new Error(
      `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
    );
  }
  return true;
};

const strictBody = (allowedFields: string[], requireAtLeastOne = false) =>
  body().custom((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Request body must be an object");
    }

    const fields = Object.keys(value);
    const unknownFields = fields.filter(
      (field) => !allowedFields.includes(field),
    );

    if (unknownFields.length > 0) {
      throw new Error(`Unknown fields: ${unknownFields.join(", ")}`);
    }

    if (requireAtLeastOne && fields.length === 0) {
      throw new Error("At least one field must be provided");
    }

    return true;
  });

const emptyObjectOrMissing = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length > 0
  ) {
    throw new Error("This request does not accept fields");
  }
  return true;
};

function validateRequest(
  validations: ValidationChain[],
): Array<
  ValidationChain | ((req: Request, res: Response, next: NextFunction) => void)
> {
  return [
    ...validations,
    (req: Request, res: Response, next: NextFunction) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const details = errors.array({ onlyFirstError: true }).map((error) => ({
          type: error.type,
          location: "location" in error ? error.location : undefined,
          path: "path" in error ? error.path : undefined,
          message: error.msg,
        }));

        res.status(400).json({
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details,
        });
        return;
      }

      next();
    },
  ];
}

export const validateId = (name: string) =>
  validateRequest([
    param(name)
      .isString()
      .matches(ID_PATTERN)
      .withMessage(`${name} must be a valid identifier`),
  ]);

export const signupValidation = validateRequest([
  strictBody([
    "email",
    "name",
    "lastName",
    "password",
    "countryCode",
    "locale",
    "acceptedTerms",
    "acceptedPrivacy",
    "captchaToken",
    "accountType",
    "facilityName",
    "facilityType",
  ]),
  body("email")
    .isString()
    .trim()
    .isEmail()
    .normalizeEmail()
    .isLength({ max: 254 }),
  body("name").isString().trim().isLength({ min: 1, max: 100 }),
  body("lastName").isString().trim().isLength({ min: 1, max: 100 }),
  body("countryCode")
    .isString()
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{2}$/),
  body("locale").isIn(["es", "en", "de", "de-CH"]),
  body("accountType").optional().isIn(["member", "administrator"]),
  body("facilityName")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 120 }),
  body("facilityType").optional().isIn(commercialFacilityTypes),
  body().custom((_, { req }) => {
    const administrator = req.body.accountType === "administrator";
    if (administrator && (!req.body.facilityName || !req.body.facilityType)) {
      throw new Error(
        "Administrator signup requires a facility name and facility type",
      );
    }
    if (
      !administrator &&
      (req.body.facilityName !== undefined ||
        req.body.facilityType !== undefined)
    ) {
      throw new Error("Facility data is only valid for administrator signup");
    }
    return true;
  }),
  body("acceptedTerms")
    .isBoolean()
    .custom((value) => value === true),
  body("acceptedPrivacy")
    .isBoolean()
    .custom((value) => value === true),
  body("captchaToken").optional().isString().isLength({ min: 1, max: 2048 }),
  body("password")
    .isString()
    .isLength({ min: 12, max: 128 })
    .custom(enforcePasswordHashLimit)
    .matches(/[a-z]/)
    .matches(/[A-Z]/)
    .matches(/[0-9]/),
]);

export const loginValidation = validateRequest([
  strictBody([
    "identifier",
    "password",
    "accessPortal",
    "rememberDevice",
    "captchaToken",
  ]),
  body("captchaToken").optional().isString().isLength({ min: 1, max: 2048 }),
  body("identifier")
    .isString()
    .trim()
    .isLength({ min: 3, max: 254 })
    .custom((value) => {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      const isPhone = /^\+?[0-9\s()-]{7,20}$/.test(value);
      if (!isEmail && !isPhone) {
        throw new Error("Identifier must be an email address or phone number");
      }
      return true;
    }),
  body("password")
    .isString()
    .isLength({ min: 1, max: 128 })
    .custom(enforcePasswordHashLimit),
  body("accessPortal").isIn(["member", "staff"]),
  body("rememberDevice").optional().isBoolean(),
]);

const commercialTrialFields = [
  "facilityName",
  "facilityType",
  "subdomain",
  "classTypes",
  "scheduleNotes",
  "locale",
  "currency",
  "usesBookings",
  "usesWaitlist",
  "publicDescription",
  "addressLine",
  "city",
  "postalCode",
  "country",
  "websiteUrl",
  "instagramUrl",
  "facebookUrl",
  "tiktokUrl",
  "youtubeUrl",
  "linkedinUrl",
  "pricingDescription",
  "bonusesDescription",
  "publicPageEnabled",
  "logoDataUrl",
  "accentColor",
];

function optionalPublicUrl(value: string): boolean {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const optionalCommercialTrialFields = () => [
  body("subdomain")
    .optional()
    .isString()
    .trim()
    .toLowerCase()
    .isLength({ min: 1, max: 63 })
    .matches(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u),
  body("classTypes").optional().isArray({ max: 20 }),
  body("classTypes.*")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 80 }),
  body("scheduleNotes").optional().isString().trim().isLength({ max: 2_000 }),
  body("locale").optional().isIn(["es", "en", "de", "de-CH"]),
  body("currency")
    .optional()
    .isString()
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{3}$/),
  body("usesBookings").optional().isBoolean(),
  body("usesWaitlist").optional().isBoolean(),
  body("publicDescription")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 2_000 }),
  body("addressLine").optional().isString().trim().isLength({ max: 240 }),
  body("city").optional().isString().trim().isLength({ max: 120 }),
  body("postalCode").optional().isString().trim().isLength({ max: 24 }),
  body("country").optional().isString().trim().isLength({ max: 120 }),
  ...[
    "websiteUrl",
    "instagramUrl",
    "facebookUrl",
    "tiktokUrl",
    "youtubeUrl",
    "linkedinUrl",
  ].map((field) =>
    body(field)
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .custom(optionalPublicUrl),
  ),
  body("pricingDescription")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 4_000 }),
  body("bonusesDescription")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 4_000 }),
  body("publicPageEnabled").optional().isBoolean(),
  body("accentColor")
    .optional()
    .isString()
    .matches(/^#[0-9a-fA-F]{6}$/),
  body("logoDataUrl")
    .optional()
    .isString()
    .custom((value: string) => {
      if (value === "") return true;
      const match = value.match(
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
      );
      if (!match) throw new Error("Logo must be a PNG, JPEG or WebP image");
      return Buffer.byteLength(match[2], "base64") <= 512 * 1024;
    }),
];

export const createCommercialTrialValidation = validateRequest([
  strictBody(commercialTrialFields),
  body("facilityName").isString().trim().isLength({ min: 2, max: 120 }),
  body("facilityType").isIn(commercialFacilityTypes),
  ...optionalCommercialTrialFields(),
]);

export const updateCommercialTrialValidation = validateRequest([
  strictBody(commercialTrialFields, true),
  body("facilityName")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 120 }),
  body("facilityType").optional().isIn(commercialFacilityTypes),
  ...optionalCommercialTrialFields(),
]);

export const commercialPublicPhoneVisibilityValidation = validateRequest([
  strictBody(["showPhonePublicly"]),
  body("showPhonePublicly").isBoolean(),
]);

export const emptyCommercialTrialActionValidation = validateRequest([
  body().custom(emptyObjectOrMissing),
  query().custom(emptyObjectOrMissing),
]);

export const commercialTrialDataDeclarationValidation = validateRequest([
  strictBody(["decision"]),
  body("decision").isIn(["yes", "no", "assistance"]),
]);

export const commercialConversionDraftValidation = validateRequest([
  strictBody(["category", "origin", "decision"]),
  body("category").isIn([
    "facility_configuration",
    "classes",
    "schedules",
    "real_members",
    "fictional_members",
    "real_trainers",
    "simulated_invoices",
    "legitimate_invoices",
    "booking_rules",
    "artificial_statistics",
  ]),
  body("origin").isIn(["demo_seed", "user_created", "imported", "converted"]),
  body("decision").isIn(["pending", "keep", "discard"]),
]);

const commercialRequestFields = [
  "name",
  "facilityName",
  "email",
  "phone",
  "subject",
  "message",
  "preferredChannel",
  "preferredTime",
  "contactConsent",
  "includeEnvironmentSummary",
  "problemCategory",
];

export const commercialRequestValidation = validateRequest([
  strictBody(commercialRequestFields),
  body("name").isString().trim().isLength({ min: 2, max: 120 }),
  body("facilityName").isString().trim().isLength({ min: 2, max: 160 }),
  body("email").isEmail().normalizeEmail(),
  body("phone")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ min: 7, max: 30 }),
  body("subject").optional().isString().trim().isLength({ max: 160 }),
  body("message").isString().trim().isLength({ min: 10, max: 4_000 }),
  body("preferredChannel").isIn(["email", "phone", "whatsapp"]),
  body("preferredTime").optional().isString().trim().isLength({ max: 160 }),
  body("contactConsent").isBoolean(),
  body("includeEnvironmentSummary").optional().isBoolean(),
  body("problemCategory")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 80 }),
]);

export const mfaCodeValidation = validateRequest([
  strictBody(["code"]),
  body("code")
    .isString()
    .trim()
    .matches(/^(?:\d{6}|[A-Fa-f0-9]{6}-?[A-Fa-f0-9]{6})$/)
    .withMessage("Code must be a 6-digit TOTP or a recovery code"),
]);

export const emailVerificationValidation = validateRequest([
  strictBody(["code"]),
  body("code")
    .isString()
    .trim()
    .matches(/^\d{6}$/),
]);

const recoveryMethodValidation = body("method").isIn([
  "email",
  "username",
  "public_id",
]);

const recoveryIdentifierValidation = body("identifier")
  .isString()
  .trim()
  .isLength({ min: 3, max: 254 })
  .custom((value: string, { req }) => {
    const method = req.body.method;
    if (method === "email") {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    if (method === "username") {
      return RECOVERY_USERNAME_PATTERN.test(value.toLowerCase());
    }
    if (method === "public_id") {
      return isSupportId(value.toUpperCase());
    }
    return false;
  })
  .withMessage("Recovery identifier does not match the selected method")
  .customSanitizer((value: string, { req }) => {
    const trimmed = value.trim();
    return req.body.method === "public_id"
      ? trimmed.toUpperCase()
      : trimmed.toLowerCase();
  });

export const accountRecoveryRequestValidation = validateRequest([
  strictBody(["method", "identifier", "captchaToken"]),
  body("captchaToken").optional().isString().isLength({ min: 1, max: 2048 }),
  recoveryMethodValidation,
  recoveryIdentifierValidation,
]);

export const accountRecoveryResetValidation = validateRequest([
  strictBody(["method", "identifier", "code", "newPassword"]),
  recoveryMethodValidation,
  recoveryIdentifierValidation,
  body("code")
    .isString()
    .trim()
    .matches(/^\d{6}$/),
  body("newPassword")
    .isString()
    .isLength({ min: 12, max: 128 })
    .custom(enforcePasswordHashLimit)
    .matches(/[a-z]/)
    .matches(/[A-Z]/)
    .matches(/[0-9]/),
]);

export const accountMfaConfirmationValidation = validateRequest([
  strictBody(["password", "code"]),
  body("password")
    .isString()
    .isLength({ min: 1, max: 128 })
    .custom(enforcePasswordHashLimit),
  body("code")
    .isString()
    .trim()
    .matches(/^(?:\d{6}|[A-Fa-f0-9]{6}-?[A-Fa-f0-9]{6})$/),
]);

export const accountCompromiseValidation = validateRequest([
  strictBody(["password", "code"]),
  body("password")
    .isString()
    .isLength({ min: 1, max: 128 })
    .custom(enforcePasswordHashLimit),
  body("code")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .matches(/^(?:\d{6}|[A-Fa-f0-9]{6}-?[A-Fa-f0-9]{6})$/),
]);

export const passwordConfirmationValidation = validateRequest([
  strictBody(["password"]),
  body("password")
    .isString()
    .isLength({ min: 1, max: 128 })
    .custom(enforcePasswordHashLimit),
]);

export const emailChangeRequestValidation = validateRequest([
  strictBody(["email", "password"]),
  body("email")
    .isString()
    .trim()
    .isLength({ min: 3, max: 254 })
    .isEmail()
    .normalizeEmail(),
  body("password")
    .isString()
    .isLength({ min: 1, max: 128 })
    .custom(enforcePasswordHashLimit),
]);

export const emailChangeConfirmValidation = validateRequest([
  strictBody(["code"]),
  body("code")
    .isString()
    .trim()
    .matches(/^\d{6}$/),
]);

export const passkeyAuthenticationOptionsValidation = validateRequest([
  strictBody(["identifier", "accessPortal", "rememberDevice", "captchaToken"]),
  body("captchaToken").optional().isString().isLength({ min: 1, max: 2048 }),
  body("identifier")
    .isString()
    .trim()
    .isLength({ min: 3, max: 254 })
    .custom((value) => {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      const isPhone = /^\+?[0-9\s()-]{7,20}$/.test(value);
      if (!isEmail && !isPhone) {
        throw new Error("Identifier must be an email address or phone number");
      }
      return true;
    }),
  body("accessPortal").isIn(["member", "staff"]),
  body("rememberDevice").optional().isBoolean(),
]);

export const passkeyResponseValidation = validateRequest([
  strictBody(["response"]),
  body("response").isObject(),
]);

export const sessionIdValidation = validateRequest([
  param("sessionId")
    .isString()
    .matches(/^[a-f0-9]{64}$/i),
]);

export const sessionSettingsValidation = validateRequest([
  strictBody(["timeoutMinutes"]),
  body("timeoutMinutes").isInt({ min: 15, max: 43_200 }).toInt(),
]);

export const inactivityPreferenceValidation = validateRequest([
  strictBody(["inactivityMonths"]),
  body("inactivityMonths").custom((value) => {
    if (value === null || value === "disabled") return true;
    return [6, 12, 18, 24, 36].includes(Number(value));
  }),
]);

export const deletionReviewValidation = validateRequest([
  strictBody(["selectedCategories", "intent"]),
  body("selectedCategories").isArray({ max: 8 }),
  body("selectedCategories.*").isIn([
    "account_profile",
    "preferences",
    "bookings",
    "sessions",
    "authentication_factors",
    "delegations",
    "billing_records",
    "security_events",
  ]),
  body("intent").isIn(["selected_data", "account_closure"]),
]);

export const accountRepresentationValidation = validateRequest([
  strictBody(["supportIdentifier", "scopes", "reason", "expiresAt"]),
  body("supportIdentifier")
    .isString()
    .trim()
    .toUpperCase()
    .matches(/^GT-U-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/),
  body("scopes").isArray({ min: 1, max: 6 }),
  body("scopes.*").isIn([
    "cancel_bookings",
    "stop_subscriptions",
    "download_authorized_documents",
    "manage_pending_payments",
    "contact_support",
    "request_account_closure",
  ]),
  body("reason").isIn([
    "hospitalization",
    "temporary_incapacity",
    "permanent_incapacity",
    "death_contingency",
    "other",
  ]),
  body("expiresAt").optional({ nullable: true }).isInt().toInt(),
]);

export const accountRepresentationIdValidation = validateRequest([
  param("representationId").isString().matches(ID_PATTERN),
  body().custom(emptyObjectOrMissing),
  query().custom(emptyObjectOrMissing),
]);

export const emptyAccountDeletionRequestValidation = validateRequest([
  body().custom(emptyObjectOrMissing),
  query().custom(emptyObjectOrMissing),
]);

export const scheduleAccountDeletionValidation = validateRequest([
  strictBody(["password", "totpCode", "emailCode"]),
  body("password")
    .optional({ nullable: true })
    .isString()
    .isLength({ min: 1, max: 128 })
    .custom(enforcePasswordHashLimit),
  body("totpCode")
    .optional({ nullable: true })
    .isString()
    .matches(/^\d{6}$/u),
  body("emailCode")
    .optional({ nullable: true })
    .isString()
    .matches(/^\d{6}$/u),
]);

export const accountDeletionCodeRequestValidation = validateRequest([
  body().custom(emptyObjectOrMissing),
  query().custom(emptyObjectOrMissing),
]);

export const inactivityReviewAnswerValidation = validateRequest([
  strictBody(["stage", "answer"]),
  body("stage").isIn(["usage", "deletion"]),
  body("answer").isIn(["yes", "no"]),
]);

export const retentionPolicyValidation = validateRequest([
  strictBody([
    "name",
    "jurisdiction",
    "dataCategory",
    "retentionDays",
    "legalBasisReference",
  ]),
  body("name").isString().trim().isLength({ min: 1, max: 120 }),
  body("jurisdiction").isString().trim().isLength({ min: 1, max: 80 }),
  body("dataCategory").isIn([
    "account_profile",
    "preferences",
    "bookings",
    "sessions",
    "authentication_factors",
    "delegations",
    "billing_records",
    "security_events",
  ]),
  body("retentionDays")
    .optional({ nullable: true, values: "falsy" })
    .isInt({ min: 1, max: 36_500 })
    .toInt(),
  body("legalBasisReference")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 }),
]);

export const retentionPolicyReviewValidation = validateRequest([
  strictBody(["decision", "reviewConfirmed"]),
  body("decision").isIn(["activate", "retire"]),
  body("reviewConfirmed")
    .isBoolean()
    .custom((value) => value === true),
]);

export const delegationDurationValidation = validateRequest([
  strictBody(["duration"]),
  body("duration").isIn(["24h", "7d", "30d", "indefinite"]),
]);

export const delegationRedeemValidation = validateRequest([
  strictBody(["token"]),
  body("token")
    .isString()
    .trim()
    .matches(/^hfd_[A-Za-z0-9_-]{32}$/),
]);

export const resourceTaskStateValidation = validateRequest([
  param("taskId").isString().matches(ID_PATTERN),
  strictBody(["enabled"]),
  body("enabled").isBoolean(),
]);

export const feedbackValidation = validateRequest([
  strictBody(["category", "message", "captchaToken"]),
  body("category").isIn(["suggestion", "problem", "accessibility", "other"]),
  body("message").isString().trim().isLength({ min: 10, max: 2000 }),
  body("captchaToken").optional().isString().isLength({ max: 2048 }),
]);

const FACILITY_LOGO_MAX_BYTES = 512 * 1024;

export const facilityProfileValidation = validateRequest([
  strictBody(["name", "logoDataUrl", "accentColor"], true),
  body("name").optional().isString().trim().isLength({ min: 1, max: 100 }),
  body("accentColor")
    .optional()
    .isString()
    .matches(/^#[0-9a-fA-F]{6}$/)
    .withMessage("Accent color must use the #RRGGBB format"),
  body("logoDataUrl")
    .optional()
    .isString()
    .custom((value: string) => {
      if (value === "") return true;
      const match = value.match(
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
      );
      if (!match) {
        throw new Error("Logo must be a PNG, JPEG or WebP image");
      }
      if (Buffer.byteLength(match[2], "base64") > FACILITY_LOGO_MAX_BYTES) {
        throw new Error("Logo must not exceed 512 KB");
      }

      const bytes = Buffer.from(match[2], "base64");
      const hasExpectedSignature =
        (match[1] === "png" &&
          bytes
            .subarray(0, 8)
            .equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
        (match[1] === "jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
        (match[1] === "webp" &&
          bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
          bytes.subarray(8, 12).toString("ascii") === "WEBP");

      if (!hasExpectedSignature) {
        throw new Error("Logo contents do not match the declared image format");
      }
      return true;
    }),
]);

export const accountProfileValidation = validateRequest([
  strictBody(["avatarDataUrl"], true),
  body("avatarDataUrl")
    .optional()
    .isString()
    .custom((value: string) => {
      if (value === "") return true;
      const match = value.match(
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
      );
      if (!match) {
        throw new Error("Avatar must be a PNG, JPEG or WebP image");
      }
      if (Buffer.byteLength(match[2], "base64") > FACILITY_LOGO_MAX_BYTES) {
        throw new Error("Avatar must not exceed 512 KB");
      }

      const bytes = Buffer.from(match[2], "base64");
      const hasExpectedSignature =
        (match[1] === "png" &&
          bytes
            .subarray(0, 8)
            .equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
        (match[1] === "jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
        (match[1] === "webp" &&
          bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
          bytes.subarray(8, 12).toString("ascii") === "WEBP");

      if (!hasExpectedSignature) {
        throw new Error(
          "Avatar contents do not match the declared image format",
        );
      }
      return true;
    }),
]);

export const accountPhoneValidation = validateRequest([
  strictBody(["phone", "password", "totpCode"]),
  body("phone")
    .isString()
    .trim()
    .custom((value: string) => {
      if (value === "") return true;
      const normalized = value.replace(/[\s().-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
        throw new Error(
          "Phone must include its country code, for example +34612345678",
        );
      }
      return true;
    }),
  body("password").isString().isLength({ min: 1, max: 128 }),
  body("totpCode")
    .optional()
    .isString()
    .trim()
    .matches(/^\d{6}$/),
]);

const billingFields = [
  "userId",
  "customerName",
  "customerEmail",
  "concept",
  "billingCycle",
  "customCycleLabel",
  "amountCents",
  "currency",
  "status",
  "dueAt",
  "paidAt",
  "invoiceNumber",
  "notes",
];

const updateBillingFields = [...billingFields, "archivedAt"];

export const createBillingRecordValidation = validateRequest([
  strictBody(billingFields),
  body("userId").optional({ nullable: true }).isString().matches(ID_PATTERN),
  body("customerName")
    .custom((value, { req }) => {
      if (req.body.userId) return true;
      return (
        typeof value === "string" &&
        value.trim().length >= 1 &&
        value.trim().length <= 120
      );
    })
    .withMessage("Customer name is required when no member is selected")
    .customSanitizer((value) =>
      typeof value === "string" ? value.trim() : value,
    ),
  body("customerEmail")
    .optional({ values: "falsy" })
    .isEmail()
    .normalizeEmail()
    .isLength({ max: 254 }),
  body("concept").isString().trim().isLength({ min: 1, max: 160 }),
  body("billingCycle")
    .isIn([
      "monthly",
      "quarterly",
      "semiannual",
      "annual",
      "trial_day",
      "custom",
    ])
    .custom((value, { req }) => {
      if (
        value === "custom" &&
        (typeof req.body.customCycleLabel !== "string" ||
          req.body.customCycleLabel.trim().length === 0)
      ) {
        throw new Error("Custom billing cycles require a description");
      }
      return true;
    }),
  body("customCycleLabel").optional().isString().trim().isLength({ max: 160 }),
  body("amountCents").isInt({ min: 0, max: 100000000 }).toInt(),
  body("currency").isString().trim().isLength({ min: 3, max: 3 }),
  body("status").isIn(["paid", "unpaid", "pending"]),
  body("dueAt").optional({ nullable: true }).isInt({ min: 0 }).toInt(),
  body("paidAt").optional({ nullable: true }).isInt({ min: 0 }).toInt(),
  body("invoiceNumber")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 80 }),
  body("notes").optional().isString().trim().isLength({ max: 1000 }),
]);

export const updateBillingRecordValidation = validateRequest([
  param("id").isString().matches(ID_PATTERN),
  strictBody(updateBillingFields, true),
  body("userId").optional({ nullable: true }).isString().matches(ID_PATTERN),
  body("customerName")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 120 }),
  body("customerEmail")
    .optional({ values: "falsy" })
    .isEmail()
    .normalizeEmail()
    .isLength({ max: 254 }),
  body("concept").optional().isString().trim().isLength({ min: 1, max: 160 }),
  body("billingCycle")
    .optional()
    .isIn([
      "monthly",
      "quarterly",
      "semiannual",
      "annual",
      "trial_day",
      "custom",
    ]),
  body("customCycleLabel").optional().isString().trim().isLength({ max: 160 }),
  body("amountCents").optional().isInt({ min: 0, max: 100000000 }).toInt(),
  body("currency").optional().isString().trim().isLength({ min: 3, max: 3 }),
  body("status").optional().isIn(["paid", "unpaid", "pending"]),
  body("dueAt").optional({ nullable: true }).isInt({ min: 0 }).toInt(),
  body("paidAt").optional({ nullable: true }).isInt({ min: 0 }).toInt(),
  body("invoiceNumber")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 80 }),
  body("notes").optional().isString().trim().isLength({ max: 1000 }),
  body("archivedAt").optional({ nullable: true }).isInt({ min: 0 }).toInt(),
]);

export const bookingValidation = validateRequest([
  strictBody(["activitySessionId", "userId"]),
  body("activitySessionId").isString().matches(ID_PATTERN),
  body("userId").isString().matches(ID_PATTERN),
]);

export const bookingCancellationValidation = validateRequest([
  param("bookingId").isString().matches(ID_PATTERN),
  strictBody(["userId"]),
  body("userId").isString().matches(ID_PATTERN),
]);

export const bookingIntentionValidation = validateRequest([
  param("bookingId").isString().matches(ID_PATTERN),
  strictBody(["userId", "intention"]),
  body("userId").isString().matches(ID_PATTERN),
  body("intention").isIn(["yes", "no", "uncertain"]),
]);

export const bookingAttendanceValidation = validateRequest([
  param("bookingId").isString().matches(ID_PATTERN),
  strictBody(["status"]),
  body("status").isIn(["attended", "absent", "excused"]),
]);

export const reputationAdjustmentValidation = validateRequest([
  param("userId").isString().matches(ID_PATTERN),
  strictBody(["pointsDelta", "reason", "clearPenalty"]),
  body("pointsDelta").isInt({ min: -100, max: 100 }).toInt(),
  body("reason").isString().trim().isLength({ min: 5, max: 300 }),
  body("clearPenalty").optional().isBoolean(),
]);

const classFields = [
  strictBody([
    "name",
    "description",
    "trainerId",
    "trainerName",
    "maxCapacity",
    "scheduledAt",
  ]),
  body("name").isString().trim().isLength({ min: 1, max: 100 }),
  body("description").optional().isString().trim().isLength({ max: 1000 }),
  body("trainerId").isString().matches(ID_PATTERN),
  body("trainerName").isString().trim().isLength({ max: 100 }),
  body("maxCapacity").isInt({ min: 1, max: 10000 }).toInt(),
  body("scheduledAt").isInt({ min: 1 }).toInt(),
];

export const createClassValidation = validateRequest(classFields);

export const createClassSeriesValidation = validateRequest([
  strictBody([
    "name",
    "description",
    "trainerId",
    "trainerName",
    "maxCapacity",
    "occurrences",
    "bookingOpensMinutesBefore",
  ]),
  body("name").isString().trim().isLength({ min: 1, max: 100 }),
  body("description").optional().isString().trim().isLength({ max: 1000 }),
  body("trainerId").isString().matches(ID_PATTERN),
  body("trainerName").isString().trim().isLength({ min: 1, max: 100 }),
  body("maxCapacity").isInt({ min: 1, max: 10000 }).toInt(),
  body("occurrences").isArray({ min: 1, max: 31 }),
  body("occurrences.*").isInt({ min: 1 }).toInt(),
  body("bookingOpensMinutesBefore")
    .optional({ nullable: true })
    .isInt({ min: 0, max: 525_600 })
    .toInt(),
]);

export const updateClassValidation = validateRequest([
  param("id").isString().matches(ID_PATTERN),
  strictBody(
    [
      "name",
      "description",
      "trainerId",
      "trainerName",
      "maxCapacity",
      "scheduledAt",
    ],
    true,
  ),
  body("name").optional().isString().trim().isLength({ min: 1, max: 100 }),
  body("description").optional().isString().trim().isLength({ max: 1000 }),
  body("trainerId").optional().isString().matches(ID_PATTERN),
  body("trainerName")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 }),
  body("maxCapacity").optional().isInt({ min: 1, max: 10000 }).toInt(),
  body("scheduledAt").optional().isInt({ min: 1 }).toInt(),
]);

export const bookingConfigurationValidation = validateRequest([
  param("id").isString().matches(ID_PATTERN),
  strictBody(["configuration", "lifecycleState", "seriesId"]),
  body("configuration").isObject(),
  body("configuration").custom((value: Record<string, unknown>) => {
    const allowed = new Set([
      "activity",
      "room",
      "durationMinutes",
      "level",
      "visibility",
      "material",
      "bookingOpensAt",
      "bookingClosesAt",
      "waitlistEnabled",
      "confirmationRequired",
      "remindersEnabled",
      "promotionConfirmationMinutes",
      "onTimeCancellationMinutes",
      "lateCancellationMinutes",
      "restrictions",
      "priorities",
      "exceptions",
      "allowedRoles",
      "allowedMemberships",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw new Error("Unknown booking configuration field");
    }
    return true;
  }),
  body("configuration.durationMinutes")
    .optional()
    .isInt({ min: 5, max: 1_440 }),
  body("configuration.visibility")
    .optional()
    .isIn(["public", "members", "staff"]),
  body("configuration.bookingOpensAt")
    .optional({ nullable: true })
    .isInt({ min: 1 }),
  body("configuration.bookingClosesAt")
    .optional({ nullable: true })
    .isInt({ min: 1 }),
  body("configuration.waitlistEnabled").optional().isBoolean(),
  body("configuration.confirmationRequired").optional().isBoolean(),
  body("configuration.remindersEnabled").optional().isBoolean(),
  body("configuration.promotionConfirmationMinutes")
    .optional()
    .isInt({ min: 1, max: 1_440 }),
  body("configuration.onTimeCancellationMinutes")
    .optional()
    .isInt({ min: 0, max: 43_200 }),
  body("configuration.lateCancellationMinutes")
    .optional()
    .isInt({ min: 0, max: 43_200 }),
  body("lifecycleState").optional().isIn(["active", "suspended", "cancelled"]),
  body("seriesId")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 120 }),
]);

const sessionBlockFields = [
  "id",
  "type",
  "title",
  "instructions",
  "exercises",
  "sets",
  "repetitions",
  "duration",
  "rest",
  "percentage",
  "load",
  "material",
  "adaptations",
  "mediaUrls",
  "notes",
];

export const sessionContentValidation = validateRequest([
  param("id").isString().matches(ID_PATTERN),
  strictBody(["terminology", "blocks", "commentsEnabled"]),
  body("terminology").isString().trim().isLength({ min: 1, max: 80 }),
  body("blocks").isArray({ max: 30 }),
  body("blocks").custom((blocks: Array<{ id?: unknown }>) => {
    if (!Array.isArray(blocks)) return true;
    const ids = blocks.map((block) => block?.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Session block identifiers must be unique");
    }
    return true;
  }),
  body("blocks.*").custom((block: Record<string, unknown>) => {
    if (!block || typeof block !== "object")
      throw new Error("Invalid session block");
    if (Object.keys(block).some((key) => !sessionBlockFields.includes(key))) {
      throw new Error("Unknown session block field");
    }
    return true;
  }),
  body("blocks.*.id").isString().matches(ID_PATTERN),
  body("blocks.*.type").isIn([
    "warmup",
    "mobility",
    "strength",
    "technique",
    "conditioning",
    "main",
    "cooldown",
    "custom",
  ]),
  body("blocks.*.title").isString().trim().isLength({ min: 1, max: 120 }),
  body("blocks.*.instructions").isString().trim().isLength({ max: 3000 }),
  body("blocks.*.exercises").isArray({ max: 50 }),
  body("blocks.*.exercises.*").isString().trim().isLength({ max: 160 }),
  body("blocks.*.material").isArray({ max: 30 }),
  body("blocks.*.material.*").isString().trim().isLength({ max: 120 }),
  body("blocks.*.mediaUrls").isArray({ max: 10 }),
  body("blocks.*.mediaUrls.*").isURL({ protocols: ["https"] }),
  body("blocks.*.sets").isString().trim().isLength({ max: 80 }),
  body("blocks.*.repetitions").isString().trim().isLength({ max: 80 }),
  body("blocks.*.duration").isString().trim().isLength({ max: 80 }),
  body("blocks.*.rest").isString().trim().isLength({ max: 80 }),
  body("blocks.*.percentage").isString().trim().isLength({ max: 80 }),
  body("blocks.*.load").isString().trim().isLength({ max: 80 }),
  body("blocks.*.adaptations").isString().trim().isLength({ max: 1000 }),
  body("blocks.*.notes").isString().trim().isLength({ max: 1000 }),
  body("commentsEnabled").isBoolean(),
]);

export const sessionProgressValidation = validateRequest([
  param("id").isString().matches(ID_PATTERN),
  strictBody(["completedBlockIds", "notes"]),
  body("completedBlockIds").isArray({ max: 30 }),
  body("completedBlockIds.*").isString().matches(ID_PATTERN),
  body("notes").isString().trim().isLength({ max: 4000 }),
]);

export const createUserValidation = validateRequest([
  strictBody(["email", "name", "password", "role", "verificationMode"]),
  body("email")
    .isString()
    .trim()
    .isEmail()
    .normalizeEmail()
    .isLength({ max: 254 }),
  body("name").isString().trim().isLength({ min: 1, max: 100 }),
  body("password")
    .isString()
    .isLength({ min: 12, max: 128 })
    .custom(enforcePasswordHashLimit)
    .matches(/[a-z]/)
    .matches(/[A-Z]/)
    .matches(/[0-9]/),
  body("role").optional().isIn(roles),
  body("verificationMode").isIn(["test_bypass"]),
]);

export const createFacilityInvitationValidation = validateRequest([
  strictBody(["email", "name", "role", "locale"]),
  body("email")
    .isString()
    .trim()
    .isEmail()
    .normalizeEmail()
    .isLength({ max: 254 }),
  body("name").isString().trim().isLength({ min: 1, max: 100 }),
  body("role").isIn(["admin", "trainer", "member"]),
  body("locale").isIn(["es", "en", "de", "de-CH"]),
]);

export const acceptNewFacilityInvitationValidation = validateRequest([
  param("token")
    .isString()
    .matches(/^[A-Za-z0-9_-]{40,80}$/),
  strictBody(["password", "locale", "acceptedTerms", "acceptedPrivacy"]),
  body("password")
    .isString()
    .isLength({ min: 12, max: 128 })
    .custom(enforcePasswordHashLimit)
    .matches(/[a-z]/)
    .matches(/[A-Z]/)
    .matches(/[0-9]/),
  body("locale").isIn(["es", "en", "de", "de-CH"]),
  body("acceptedTerms")
    .isBoolean()
    .custom((value) => value === true),
  body("acceptedPrivacy")
    .isBoolean()
    .custom((value) => value === true),
]);

export const facilityInvitationTokenValidation = validateRequest([
  param("token")
    .isString()
    .matches(/^[A-Za-z0-9_-]{40,80}$/),
]);

export const updateUserValidation = validateRequest([
  param("id").isString().matches(ID_PATTERN),
  strictBody(["email", "name"], true),
  body("email")
    .optional()
    .isString()
    .trim()
    .isEmail()
    .normalizeEmail()
    .isLength({ max: 254 }),
  body("name").optional().isString().trim().isLength({ min: 1, max: 100 }),
]);

export const bulkDeleteUsersValidation = validateRequest([
  strictBody(["userIds"]),
  body("userIds")
    .isArray({ min: 1, max: 100 })
    .withMessage("userIds must contain between 1 and 100 identifiers"),
  body("userIds.*").isString().matches(ID_PATTERN),
]);

const crmMemberSegments = [
  "onboarding",
  "engaged",
  "attention",
  "reengagement",
];
const crmFollowUpKinds = ["onboarding", "check_in", "retention", "service"];
const crmFollowUpStatuses = ["open", "completed", "dismissed"];

const optionalCrmAssigneeValidation = () =>
  body("assignedToUserId")
    .optional({ nullable: true })
    .isString()
    .matches(ID_PATTERN);

export const crmMemberProfileValidation = validateRequest([
  param("memberUserId").isString().matches(ID_PATTERN),
  strictBody(["manualSegment", "assignedToUserId", "nextFollowUpAt"], true),
  body("manualSegment").optional({ nullable: true }).isIn(crmMemberSegments),
  optionalCrmAssigneeValidation(),
  body("nextFollowUpAt")
    .optional({ nullable: true })
    .isInt({ min: 0, max: Number.MAX_SAFE_INTEGER })
    .toInt(),
]);

export const crmFollowUpCreateValidation = validateRequest([
  strictBody(["memberUserId", "assignedToUserId", "kind", "dueAt"]),
  body("memberUserId").isString().matches(ID_PATTERN),
  optionalCrmAssigneeValidation(),
  body("kind").isIn(crmFollowUpKinds),
  body("dueAt").isInt({ min: 0, max: Number.MAX_SAFE_INTEGER }).toInt(),
]);

export const crmFollowUpUpdateValidation = validateRequest([
  param("followUpId").isString().matches(ID_PATTERN),
  strictBody(["assignedToUserId", "status", "dueAt"]),
  optionalCrmAssigneeValidation(),
  body("status").isIn(crmFollowUpStatuses),
  body("dueAt").isInt({ min: 0, max: Number.MAX_SAFE_INTEGER }).toInt(),
]);

export const commercialSubscriptionCheckoutValidation = validateRequest([
  strictBody(["plan"]),
  query().custom(emptyObjectOrMissing),
  body("plan").isIn(["monthly", "annual"]),
]);

export const emptyRequestValidation = validateRequest([
  body().custom(emptyObjectOrMissing),
  query().custom(emptyObjectOrMissing),
]);

export const monthValidation = validateRequest([
  query("year").isInt({ min: 2000, max: 2200 }).toInt(),
  query("month").isInt({ min: 1, max: 12 }).toInt(),
]);
