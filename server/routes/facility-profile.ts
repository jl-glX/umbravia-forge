import express from "express";
import type { RequestHandler } from "express";
import { db } from "../db/client.js";
import {
  authenticate,
  getFacilityContext,
  requireFacility,
  selectFacilityContext,
} from "../middleware/authorization.js";
import { facilityProfileValidation } from "../middleware/validation.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";

export const facilityProfileRouter = express.Router();
facilityProfileRouter.use(authenticate);
facilityProfileRouter.use(selectFacilityContext);
facilityProfileRouter.use(express.json({ limit: "768kb" }));
facilityProfileRouter.use(requireRecentFormVerification);

facilityProfileRouter.get("/", requireFacility(), async (_req, res, next) => {
  try {
    const facility = getFacilityContext(res);
    res.json(
      await db
        .selectFrom("facilityProfiles")
        .selectAll()
        .where("id", "=", facility.id)
        .executeTakeFirstOrThrow(),
    );
  } catch (error) {
    next(error);
  }
});

const updateFacilityProfile: RequestHandler = async (req, res, next) => {
  try {
    const facility = getFacilityContext(res);
    await db
      .updateTable("facilityProfiles")
      .set({ ...req.body, updatedAt: Date.now() })
      .where("id", "=", facility.id)
      .executeTakeFirstOrThrow();

    res.json(
      await db
        .selectFrom("facilityProfiles")
        .selectAll()
        .where("id", "=", facility.id)
        .executeTakeFirstOrThrow(),
    );
  } catch (error) {
    next(error);
  }
};

facilityProfileRouter.patch(
  "/",
  requireFacility("owner", "admin"),
  facilityProfileValidation,
  updateFacilityProfile,
);
