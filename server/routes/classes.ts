import express from "express";
import { db } from "../db/client.js";
import { getClassWithAvailability } from "../services/booking.js";
import {
  sessionContentValidation,
  sessionProgressValidation,
  validateId,
} from "../middleware/validation.js";
import {
  authenticate,
  getFacilityContext,
  getAuthenticatedUser,
  requireClassFacility,
  requireFacility,
  requireSelfParamOrFacilityRole,
  requireTrainerClassOrRole,
  selectFacilityContext,
} from "../middleware/authorization.js";
import {
  getSessionContent,
  getSessionProgress,
  saveSessionContent,
  saveSessionProgress,
} from "../services/session-content.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";

export const classesRouter = express.Router();
classesRouter.use(authenticate);
classesRouter.use(selectFacilityContext);
classesRouter.use(requireFacility());

// Get all classes
classesRouter.get("/", async (req: express.Request, res: express.Response) => {
  try {
    const facility = getFacilityContext(res);
    const classes = await db
      .selectFrom("activitySessions")
      .selectAll()
      .where("facilityId", "=", facility.id)
      .orderBy("scheduledAt", "asc")
      .execute();

    const classesWithAvailability = await Promise.all(
      classes.map(async (activitySession) => {
        const withAvailability = await getClassWithAvailability(
          activitySession.id,
          facility.id,
        );
        return withAvailability;
      }),
    );

    res.json(classesWithAvailability);
  } catch (error) {
    console.error("Error fetching classes:", error);
    res.status(500).json({ error: "Failed to fetch classes" });
  }
});

// Get trainer's classes
classesRouter.get(
  "/trainer/:trainerId",
  validateId("trainerId"),
  requireFacility("trainer", "admin", "owner"),
  requireSelfParamOrFacilityRole("trainerId", "admin", "owner"),
  async (req: express.Request, res: express.Response) => {
    try {
      const facility = getFacilityContext(res);
      const classes = await db
        .selectFrom("activitySessions")
        .selectAll()
        .where("trainerId", "=", req.params.trainerId)
        .where("facilityId", "=", facility.id)
        .orderBy("scheduledAt", "asc")
        .execute();

      const classesWithAvailability = await Promise.all(
        classes.map(async (activitySession) => {
          const withAvailability = await getClassWithAvailability(
            activitySession.id,
            facility.id,
          );
          return withAvailability;
        }),
      );

      res.json(classesWithAvailability);
    } catch (error) {
      console.error("Error fetching trainer classes:", error);
      res.status(500).json({ error: "Failed to fetch trainer classes" });
    }
  },
);

classesRouter.get(
  "/:id/session-content",
  validateId("id"),
  requireClassFacility("id"),
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(await getSessionContent(req.params.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res
        .status(message === "Class not found" ? 404 : 400)
        .json({ error: message });
    }
  },
);

classesRouter.put(
  "/:id/session-content",
  sessionContentValidation,
  requireTrainerClassOrRole("id", "admin"),
  requireRecentFormVerification,
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(
        await saveSessionContent(req.params.id, {
          terminology: req.body.terminology,
          blocks: req.body.blocks,
          commentsEnabled: req.body.commentsEnabled,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res
        .status(message === "Class not found" ? 404 : 400)
        .json({ error: message });
    }
  },
);

classesRouter.get(
  "/:id/session-progress",
  validateId("id"),
  requireClassFacility("id"),
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(
        await getSessionProgress(
          req.params.id,
          getAuthenticatedUser(res).userId,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res
        .status(message === "Class not found" ? 404 : 400)
        .json({ error: message });
    }
  },
);

classesRouter.put(
  "/:id/session-progress",
  sessionProgressValidation,
  requireClassFacility("id"),
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(
        await saveSessionProgress(
          req.params.id,
          getAuthenticatedUser(res).userId,
          {
            completedBlockIds: req.body.completedBlockIds,
            notes: req.body.notes,
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res
        .status(message === "Class not found" ? 404 : 400)
        .json({ error: message });
    }
  },
);

// Get single class with availability
classesRouter.get(
  "/:id",
  validateId("id"),
  requireClassFacility("id"),
  async (req: express.Request, res: express.Response) => {
    try {
      const activitySession = await getClassWithAvailability(
        req.params.id,
        getFacilityContext(res).id,
      );

      if (!activitySession) {
        res.status(404).json({ error: "Class not found" });
        return;
      }

      res.json(activitySession);
    } catch (error) {
      console.error("Error fetching class:", error);
      res.status(500).json({ error: "Failed to fetch class" });
    }
  },
);
