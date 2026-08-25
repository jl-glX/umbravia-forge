import express from "express";
import type { NextFunction, Request, Response } from "express";
import {
  authenticate,
  getAuthenticatedUser,
  getFacilityContext,
  requireFacility,
  selectFacilityContext,
} from "../middleware/authorization.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  createStripeConnectedAccount,
  createStripeOnboardingLink,
  getStripeConnectOverview,
  reconcileStripeConnectedAccount,
} from "../services/stripe-connect.js";

export const stripeConnectRouter = express.Router();

stripeConnectRouter.use(authenticate, selectFacilityContext);

stripeConnectRouter.get(
  "/",
  requireFacility("owner", "admin"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const facility = getFacilityContext(res);
      res.json({
        ...(await getStripeConnectOverview(facility.id)),
        canManage: facility.role === "owner",
      });
    } catch (error) {
      next(error);
    }
  },
);

stripeConnectRouter.post(
  "/account",
  requireFacility("owner"),
  requireRecentFormVerification,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(
        await createStripeConnectedAccount({
          facilityId: getFacilityContext(res).id,
          ownerUserId: getAuthenticatedUser(res).userId,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

stripeConnectRouter.post(
  "/onboarding",
  requireFacility("owner"),
  requireRecentFormVerification,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res
        .status(201)
        .json(await createStripeOnboardingLink(getFacilityContext(res).id));
    } catch (error) {
      next(error);
    }
  },
);

stripeConnectRouter.post(
  "/reconcile",
  requireFacility("owner"),
  requireRecentFormVerification,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await reconcileStripeConnectedAccount(getFacilityContext(res).id),
      );
    } catch (error) {
      next(error);
    }
  },
);
