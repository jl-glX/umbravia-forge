import express from "express";
import {
  getAllClasses,
  getClassWithAvailability,
  createClass,
  updateClass,
  deleteClass,
  ClassDeletionBlockedError,
  saveActivitySessionBookingConfiguration,
} from "../services/classes.js";
import {
  createClassValidation,
  bookingConfigurationValidation,
  updateClassValidation,
  validateId,
} from "../middleware/validation.js";
import {
  authenticate,
  getFacilityContext,
  requireFacility,
  selectFacilityContext,
} from "../middleware/authorization.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";

export const adminClassesRouter = express.Router();
adminClassesRouter.use(authenticate, selectFacilityContext);
adminClassesRouter.use(requireFacility("owner", "admin"));
adminClassesRouter.use(requireRecentFormVerification);

// Get all classes
adminClassesRouter.get(
  "/",
  async (req: express.Request, res: express.Response) => {
    try {
      const classes = await getAllClasses(getFacilityContext(res).id);
      res.json(classes);
    } catch (error) {
      console.error("Error fetching classes:", error);
      res.status(500).json({ error: "Failed to fetch classes" });
    }
  },
);

// Get single class
adminClassesRouter.get(
  "/:id",
  validateId("id"),
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

// Create class
adminClassesRouter.post(
  "/",
  createClassValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      const {
        name,
        description,
        trainerId,
        trainerName,
        maxCapacity,
        scheduledAt,
      } = req.body;

      if (!name || !trainerId || !maxCapacity || !scheduledAt) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const newClass = await createClass(
        {
          name,
          description: description || "",
          trainerId,
          trainerName,
          maxCapacity,
          scheduledAt,
        },
        getFacilityContext(res).id,
      );

      res.status(201).json(newClass);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error creating class:", error);
      res.status(400).json({ error: message });
    }
  },
);

// Update class
adminClassesRouter.put(
  "/:id",
  updateClassValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      const {
        name,
        description,
        trainerId,
        trainerName,
        maxCapacity,
        scheduledAt,
      } = req.body;

      const updatedClass = await updateClass(
        req.params.id,
        {
          name,
          description,
          trainerId,
          trainerName,
          maxCapacity,
          scheduledAt,
        },
        getFacilityContext(res).id,
      );

      res.json(updatedClass);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error updating class:", error);
      res.status(400).json({ error: message });
    }
  },
);

adminClassesRouter.post(
  "/batch-delete",
  async (req: express.Request, res: express.Response) => {
    const requestedIds: unknown[] = Array.isArray(req.body.activitySessionIds)
      ? req.body.activitySessionIds
      : [];
    const activitySessionIds = [
      ...new Set(
        requestedIds.filter((id): id is string => typeof id === "string"),
      ),
    ];
    if (activitySessionIds.length < 1 || activitySessionIds.length > 100) {
      res
        .status(400)
        .json({ error: "Between 1 and 100 class IDs are required" });
      return;
    }

    const deletedIds: string[] = [];
    const failed: Array<{
      id: string;
      code: string;
      message: string;
      blockers?: ClassDeletionBlockedError["blockers"];
    }> = [];
    for (const id of activitySessionIds) {
      try {
        await deleteClass(id, getFacilityContext(res).id);
        deletedIds.push(id);
      } catch (error) {
        const blocked = error instanceof ClassDeletionBlockedError;
        failed.push({
          id,
          code: blocked
            ? error.code
            : error instanceof Error && error.message === "Class not found"
              ? "CLASS_NOT_FOUND"
              : "CLASS_DELETION_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
          ...(blocked ? { blockers: error.blockers } : {}),
        });
      }
    }
    res.json({ deletedIds, failed });
  },
);

adminClassesRouter.put(
  "/:id/booking-configuration",
  bookingConfigurationValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(
        await saveActivitySessionBookingConfiguration(
          req.params.id,
          {
            configuration: req.body.configuration,
            lifecycleState: req.body.lifecycleState,
            seriesId: req.body.seriesId,
          },
          getFacilityContext(res).id,
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

// Delete class
adminClassesRouter.delete(
  "/:id",
  validateId("id"),
  async (req: express.Request, res: express.Response) => {
    try {
      await deleteClass(req.params.id, getFacilityContext(res).id);
      res.json({ message: "Class deleted successfully" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error deleting class:", error);
      if (error instanceof ClassDeletionBlockedError) {
        res.status(409).json({
          error: message,
          code: error.code,
          blockers: error.blockers,
        });
        return;
      }
      res
        .status(message === "Class not found" ? 404 : 400)
        .json({ error: message });
    }
  },
);
