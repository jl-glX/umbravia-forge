import express from "express";
import {
  authenticate,
  getAuthenticatedUser,
} from "../middleware/authorization.js";
import {
  cancelScheduledAccountDeletion,
  answerInactivityReview,
  getDataDeletionReview,
  getAccountLifecycle,
  INACTIVITY_DELETION_OPTIONS,
  scheduleAccountDeletion,
  saveDataDeletionReview,
  type InactivityDeletionMonths,
  updateInactivityDeletionPreference,
} from "../services/account-lifecycle.js";
import {
  ACCOUNT_DATA_CATEGORIES,
  type AccountDataCategory,
} from "../services/data-retention.js";
import {
  deletionReviewValidation,
  accountDeletionCodeRequestValidation,
  emptyAccountDeletionRequestValidation,
  inactivityPreferenceValidation,
  inactivityReviewAnswerValidation,
  scheduleAccountDeletionValidation,
} from "../middleware/validation.js";
import { authenticationLimiter } from "../middleware/security.js";
import { verifyUserPassword } from "../services/auth.js";
import { verifyTotpCode } from "../services/mfa.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  getAccountDeletionConfirmation,
  requestAccountDeletionEmailCode,
  verifyAccountDeletionEmailCode,
} from "../services/account-deletion-confirmation.js";

export const accountLifecycleRouter = express.Router();
accountLifecycleRouter.use(authenticate);
accountLifecycleRouter.use(requireRecentFormVerification);

accountLifecycleRouter.get("/", async (_req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    res.json(await getAccountLifecycle(userId));
  } catch (error) {
    next(error);
  }
});

accountLifecycleRouter.put(
  "/inactivity",
  inactivityPreferenceValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const { userId } = getAuthenticatedUser(res);
      const value = req.body?.inactivityMonths;
      const inactivityMonths =
        value === null || value === "disabled" ? null : Number(value);
      if (
        inactivityMonths !== null &&
        !INACTIVITY_DELETION_OPTIONS.includes(
          inactivityMonths as (typeof INACTIVITY_DELETION_OPTIONS)[number],
        )
      ) {
        res.status(400).json({
          error: "Invalid inactivity period",
          code: "INVALID_INACTIVITY_PERIOD",
        });
        return;
      }
      res.json(
        await updateInactivityDeletionPreference(
          userId,
          inactivityMonths as InactivityDeletionMonths | null,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

accountLifecycleRouter.post(
  "/inactivity-review",
  authenticationLimiter,
  inactivityReviewAnswerValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const { userId, sessionId } = getAuthenticatedUser(res);
      res.json(
        await answerInactivityReview(userId, {
          stage: req.body.stage,
          answer: req.body.answer,
          keepSessionId: sessionId,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

accountLifecycleRouter.post(
  "/deletion/verification-code",
  authenticationLimiter,
  accountDeletionCodeRequestValidation,
  async (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const { userId, sessionId } = getAuthenticatedUser(res);
      res
        .status(202)
        .json(await requestAccountDeletionEmailCode(userId, sessionId));
    } catch (error) {
      next(error);
    }
  },
);

accountLifecycleRouter.post(
  "/deletion",
  authenticationLimiter,
  scheduleAccountDeletionValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const { userId, email, sessionId } = getAuthenticatedUser(res);
      const confirmation = await getAccountDeletionConfirmation(userId);
      if (
        confirmation.passwordAvailable &&
        (typeof req.body.password !== "string" ||
          !(await verifyUserPassword(userId, req.body.password)))
      ) {
        res.status(401).json({
          error: "Invalid security confirmation",
          code: "SECURITY_CONFIRMATION_FAILED",
        });
        return;
      }
      if (confirmation.mfaRequired) {
        if (
          typeof req.body.totpCode !== "string" ||
          !(await verifyTotpCode(userId, email, req.body.totpCode))
        ) {
          res.status(401).json({
            error: "A valid authenticator code is required",
            code: "MFA_CONFIRMATION_FAILED",
          });
          return;
        }
      }
      if (
        confirmation.emailCodeRequired &&
        (typeof req.body.emailCode !== "string" ||
          !(await verifyAccountDeletionEmailCode(
            userId,
            sessionId,
            req.body.emailCode,
          )))
      ) {
        res.status(401).json({
          error: "A valid account email code is required",
          code: "EMAIL_CONFIRMATION_FAILED",
        });
        return;
      }
      const lifecycle = await scheduleAccountDeletion(
        userId,
        "manual",
        Date.now(),
        {
          keepSessionId: sessionId,
        },
      );
      res.status(202).json(lifecycle);
    } catch (error) {
      next(error);
    }
  },
);

accountLifecycleRouter.delete(
  "/deletion",
  emptyAccountDeletionRequestValidation,
  async (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const { userId } = getAuthenticatedUser(res);
      res.json(await cancelScheduledAccountDeletion(userId));
    } catch (error) {
      next(error);
    }
  },
);

accountLifecycleRouter.get("/deletion-review", async (_req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    res.json(await getDataDeletionReview(userId));
  } catch (error) {
    next(error);
  }
});

accountLifecycleRouter.put(
  "/deletion-review",
  deletionReviewValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const { userId } = getAuthenticatedUser(res);
      const categories = req.body?.selectedCategories;
      const intent = req.body?.intent;
      if (
        !Array.isArray(categories) ||
        !categories.every(
          (category): category is AccountDataCategory =>
            typeof category === "string" &&
            ACCOUNT_DATA_CATEGORIES.includes(category as AccountDataCategory),
        ) ||
        (intent !== "selected_data" && intent !== "account_closure")
      ) {
        res.status(400).json({
          error: "Invalid deletion review",
          code: "INVALID_DELETION_REVIEW",
        });
        return;
      }
      res.json(await saveDataDeletionReview(userId, categories, intent));
    } catch (error) {
      next(error);
    }
  },
);
