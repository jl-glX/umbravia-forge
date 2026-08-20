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
  createCommercialCheckout,
  createCommercialPortal,
  getCommercialSubscriptionOverview,
} from "../services/commercial-subscription.js";

export const commercialSubscriptionRouter = express.Router();

commercialSubscriptionRouter.use(
  authenticate,
  selectFacilityContext,
  requireFacility("owner", "admin"),
);

commercialSubscriptionRouter.get(
  "/",
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.body?.plan !== "monthly" && req.body?.plan !== "annual") {
        res.status(400).json({
          error: "Plan must be monthly or annual",
          code: "INVALID_SUBSCRIPTION_PLAN",
        });
        return;
      }
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
  "/portal",
  requireRecentFormVerification,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await createCommercialPortal(getFacilityContext(res).id));
    } catch (error) {
      next(error);
    }
  },
);
