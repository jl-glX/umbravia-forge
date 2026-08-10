import express from "express";
import { authenticate, requireRole } from "../middleware/authorization.js";
import {
  getEncryptionManagerOverview,
  runEncryptionManagerAudit,
} from "../services/encryption-manager.js";

export const encryptionManagerRouter = express.Router();
encryptionManagerRouter.use(authenticate, requireRole("admin"));

encryptionManagerRouter.get("/", (_req, res) => {
  res.json(getEncryptionManagerOverview());
});

encryptionManagerRouter.post("/audit", async (_req, res, next) => {
  try {
    res.json(await runEncryptionManagerAudit());
  } catch (error) {
    next(error);
  }
});
