import express from "express";
import {
  getResourceManagerStatus,
  runManagedTask,
  setManagedTaskEnabled,
} from "../services/resource-manager.js";
import {
  authenticate,
  requirePlatformOperator,
} from "../middleware/authorization.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  resourceTaskStateValidation,
  validateId,
} from "../middleware/validation.js";

export const resourceManagerRouter = express.Router();
resourceManagerRouter.use(authenticate, requirePlatformOperator);

resourceManagerRouter.get("/", (_req, res) => {
  res.json(getResourceManagerStatus());
});

function taskExists(taskId: string): boolean {
  return getResourceManagerStatus().tasks.some((task) => task.id === taskId);
}

resourceManagerRouter.patch(
  "/tasks/:taskId",
  requireRecentFormVerification,
  resourceTaskStateValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      if (!taskExists(req.params.taskId)) {
        res.status(404).json({
          error: "Managed task not found",
          code: "RESOURCE_TASK_NOT_FOUND",
        });
        return;
      }
      if (typeof req.body?.enabled !== "boolean") {
        res.status(400).json({
          error: "enabled must be a boolean",
          code: "INVALID_RESOURCE_TASK_STATE",
        });
        return;
      }
      try {
        res.json(setManagedTaskEnabled(req.params.taskId, req.body.enabled));
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Critical managed tasks cannot be paused"
        ) {
          res.status(409).json({
            error: error.message,
            code: "CRITICAL_TASK_REQUIRED",
          });
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  },
);

resourceManagerRouter.post(
  "/tasks/:taskId/run",
  requireRecentFormVerification,
  validateId("taskId"),
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      if (!taskExists(req.params.taskId)) {
        res.status(404).json({
          error: "Managed task not found",
          code: "RESOURCE_TASK_NOT_FOUND",
        });
        return;
      }
      try {
        res.json(await runManagedTask(req.params.taskId));
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Managed task is already running"
        ) {
          res.status(409).json({
            error: error.message,
            code: "RESOURCE_TASK_ALREADY_RUNNING",
          });
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  },
);
