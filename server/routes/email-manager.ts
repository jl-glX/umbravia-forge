import express from "express";
import { authenticate, requireRole } from "../middleware/authorization.js";
import {
  getEmailManagerOverview,
  runEmailManagerAudit,
  runEmailManagerMaintenance,
} from "../services/email-manager.js";

export const emailManagerRouter = express.Router();
emailManagerRouter.use(authenticate, requireRole("admin"));

emailManagerRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getEmailManagerOverview());
  } catch (error) {
    next(error);
  }
});

emailManagerRouter.post("/audit", async (_req, res, next) => {
  try {
    res.json(await runEmailManagerAudit());
  } catch (error) {
    next(error);
  }
});

emailManagerRouter.post("/maintenance", async (_req, res, next) => {
  try {
    res.json(await runEmailManagerMaintenance());
  } catch (error) {
    next(error);
  }
});
