import express from "express";
import {
  authenticate,
  requirePlatformOperator,
} from "../middleware/authorization.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  createManagedEnvironment,
  getEnvironmentManagerOverview,
  prepareEnvironmentMigration,
} from "../services/environment-manager.js";

export const environmentManagerRouter = express.Router();
environmentManagerRouter.use(authenticate, requirePlatformOperator);

environmentManagerRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getEnvironmentManagerOverview());
  } catch (error) {
    next(error);
  }
});

environmentManagerRouter.post(
  "/environments",
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      const { name, slug, kind, locale, templateKey } = req.body ?? {};
      if (
        typeof name !== "string" ||
        typeof slug !== "string" ||
        (kind !== "commercial_mvp" && kind !== "customer_sandbox") ||
        (locale !== undefined &&
          !["es", "en", "de", "de-CH"].includes(locale)) ||
        (templateKey !== undefined && typeof templateKey !== "string")
      ) {
        res.status(400).json({
          error: "Invalid managed environment configuration",
          code: "INVALID_ENVIRONMENT_CONFIGURATION",
        });
        return;
      }
      res.status(201).json(
        await createManagedEnvironment({
          name,
          slug,
          kind,
          locale,
          templateKey,
        }),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("already exists") ||
          error.message.includes("EEXIST"))
      ) {
        res.status(409).json({
          error: "The managed environment already exists",
          code: "ENVIRONMENT_ALREADY_EXISTS",
        });
        return;
      }
      if (
        error instanceof Error &&
        (error.message.includes("must contain") ||
          error.message.includes("template key") ||
          error.message.includes("escapes the managed root") ||
          error.message === "Managed environment creation is disabled")
      ) {
        res.status(400).json({
          error: error.message,
          code: "INVALID_ENVIRONMENT_CONFIGURATION",
        });
        return;
      }
      next(error);
    }
  },
);

environmentManagerRouter.post(
  "/environments/:environmentId/migration-plan",
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      res.json(await prepareEnvironmentMigration(req.params.environmentId));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Managed environment not found"
      ) {
        res.status(404).json({
          error: error.message,
          code: "ENVIRONMENT_NOT_FOUND",
        });
        return;
      }
      next(error);
    }
  },
);
