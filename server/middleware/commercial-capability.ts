import type { NextFunction, Request, Response } from "express";
import { getFacilityContext } from "./authorization.js";
import {
  getCommercialEntitlements,
  type CommercialCapability,
} from "../services/commercial-entitlements.js";

export function requireCommercialCapability(capability: CommercialCapability) {
  return async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const entitlements = await getCommercialEntitlements(
        getFacilityContext(response).id,
      );
      if (
        !entitlements.enforcementEnabled ||
        entitlements.capabilities[capability]
      ) {
        next();
        return;
      }
      response.status(402).json({
        error: "The centre subscription does not include this capability",
        code: "COMMERCIAL_CAPABILITY_REQUIRED",
        capability,
      });
    } catch (error) {
      next(error);
    }
  };
}
