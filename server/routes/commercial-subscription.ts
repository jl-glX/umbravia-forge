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
  commercialSubscriptionCheckoutValidation,
  emptyRequestValidation,
} from "../middleware/validation.js";
import {
  createCommercialCheckout,
  createCommercialPortal,
  getCommercialSubscriptionOverview,
  reconcileCommercialSubscription,
} from "../services/commercial-subscription.js";

export const commercialSubscriptionRouter = express.Router();

commercialSubscriptionRouter.use(
  authenticate,
  selectFacilityContext,
  requireFacility("owner", "admin"),
);

commercialSubscriptionRouter.get(
  "/",
  emptyRequestValidation,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await getCommercialSubscriptionOverview(getFacilityContext(res).id),
      );
    } catch (error) {
      next(error);
    }
  },
);

commercialSubscriptionRouter.post(
  "/checkout",
  requireRecentFormVerification,
  commercialSubscriptionCheckoutValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(
        await createCommercialCheckout({
          facilityId: getFacilityContext(res).id,
          email: getAuthenticatedUser(res).email,
          plan: req.body.plan,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

commercialSubscriptionRouter.post(
  "/reconcile",
  requireRecentFormVerification,
  emptyRequestValidation,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await reconcileCommercialSubscription(getFacilityContext(res).id),
      );
    } catch (error) {
      next(error);
    }
  },
);

commercialSubscriptionRouter.post(
  "/portal",
  requireRecentFormVerification,
  emptyRequestValidation,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await createCommercialPortal(getFacilityContext(res).id));
    } catch (error) {
      next(error);
    }
  },
);
