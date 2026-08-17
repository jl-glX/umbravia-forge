import express from "express";
import type { NextFunction, Request, Response } from "express";
import {
  commercialFacilityTypes,
  commercialFoundation,
  commercialTemplates,
  COMMERCIAL_TRIAL_DAYS,
} from "../lib/commercial-trial.js";
import {
  authenticate,
  getFacilityContext,
  getAuthenticatedUser,
  requireFacility,
  selectFacilityContext,
} from "../middleware/authorization.js";
import {
  commercialConversionDraftValidation,
  commercialRequestValidation,
  commercialTrialDataDeclarationValidation,
  createCommercialTrialValidation,
  emptyCommercialTrialActionValidation,
  updateCommercialTrialValidation,
} from "../middleware/validation.js";
import {
  closeCommercialTrial,
  createCommercialTrial,
  declareCommercialTrialData,
  getCommercialConversionDraft,
  getCommercialTrialOverview,
  restoreCommercialTrialConfiguration,
  requestCommercialContact,
  updateCommercialTrial,
  updateCommercialConversionDraft,
} from "../services/commercial-trial.js";

export const commercialRouter = express.Router();

function requireCommercialProvisioningEnabled(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.COMMERCIAL_TRIALS_ENABLED !== "true"
  ) {
    res.status(503).json({
      error: "Commercial trial provisioning is not enabled",
      code: "COMMERCIAL_TRIALS_DISABLED",
    });
    return;
  }

  next();
}

commercialRouter.get("/", (_req, res) => {
  res.json({
    ...commercialFoundation,
    trialDays: COMMERCIAL_TRIAL_DAYS,
    facilityTypes: commercialFacilityTypes,
    templates: commercialTemplates,
    contactPolicy: {
      automaticContact: false,
      unsolicitedCalls: false,
      userInitiatedOnly: true,
    },
  });
});

commercialRouter.use(
  "/trial",
  authenticate,
  selectFacilityContext,
  requireFacility("owner", "admin"),
);

commercialRouter.get("/trial", async (_req, res, next) => {
  try {
    res.json(await getCommercialTrialOverview(getFacilityContext(res).id));
  } catch (error) {
    next(error);
  }
});

commercialRouter.post(
  "/trial/contact",
  commercialRequestValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res
        .status(201)
        .json(
          await requestCommercialContact(
            getAuthenticatedUser(res).userId,
            getFacilityContext(res).id,
            req.body,
          ),
        );
    } catch (error) {
      next(error);
    }
  },
);

commercialRouter.post(
  "/trial",
  requireCommercialProvisioningEnabled,
  createCommercialTrialValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res
        .status(201)
        .json(
          await createCommercialTrial(
            getAuthenticatedUser(res).userId,
            getFacilityContext(res).id,
            req.body,
          ),
        );
    } catch (error) {
      next(error);
    }
  },
);

commercialRouter.get(
  "/trial/conversion-draft",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getCommercialConversionDraft(getFacilityContext(res).id));
    } catch (error) {
      next(error);
    }
  },
);

commercialRouter.patch(
  "/trial/conversion-draft",
  commercialConversionDraftValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await updateCommercialConversionDraft(
          getAuthenticatedUser(res).userId,
          getFacilityContext(res).id,
          req.body.category,
          req.body.origin,
          req.body.decision,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

commercialRouter.post(
  "/trial/restore-configuration",
  emptyCommercialTrialActionValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await restoreCommercialTrialConfiguration(
          getAuthenticatedUser(res).userId,
          getFacilityContext(res).id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

commercialRouter.patch(
  "/trial",
  updateCommercialTrialValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await updateCommercialTrial(
          getAuthenticatedUser(res).userId,
          getFacilityContext(res).id,
          req.body,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

commercialRouter.post(
  "/trial/real-data-declaration",
  commercialTrialDataDeclarationValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await declareCommercialTrialData(
          getAuthenticatedUser(res).userId,
          getFacilityContext(res).id,
          req.body.decision,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

commercialRouter.post(
  "/trial/close",
  emptyCommercialTrialActionValidation,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await closeCommercialTrial(
          getAuthenticatedUser(res).userId,
          getFacilityContext(res).id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
