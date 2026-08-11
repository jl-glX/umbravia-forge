import express from "express";
import {
  authenticate,
  requirePlatformOperator,
} from "../middleware/authorization.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  getEmailManagerOverview,
  runEmailManagerAudit,
  runEmailManagerMaintenance,
} from "../services/email-manager.js";

export const emailManagerRouter = express.Router();
emailManagerRouter.use(authenticate, requirePlatformOperator);

emailManagerRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getEmailManagerOverview());
  } catch (error) {
    next(error);
  }
});

emailManagerRouter.post(
  "/audit",
  requireRecentFormVerification,
  async (_req, res, next) => {
    try {
      res.json(await runEmailManagerAudit());
    } catch (error) {
      next(error);
    }
  },
);

emailManagerRouter.post(
  "/maintenance",
  requireRecentFormVerification,
  async (_req, res, next) => {
    try {
      res.json(await runEmailManagerMaintenance());
    } catch (error) {
      next(error);
    }
  },
);
