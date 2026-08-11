import express from "express";
import {
  authenticate,
  requirePlatformOperator,
} from "../middleware/authorization.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  getEncryptionManagerOverview,
  runEncryptionManagerAudit,
} from "../services/encryption-manager.js";

export const encryptionManagerRouter = express.Router();
encryptionManagerRouter.use(authenticate, requirePlatformOperator);

encryptionManagerRouter.get("/", (_req, res) => {
  res.json(getEncryptionManagerOverview());
});

encryptionManagerRouter.post(
  "/audit",
  requireRecentFormVerification,
  async (_req, res, next) => {
    try {
      res.json(await runEncryptionManagerAudit());
    } catch (error) {
      next(error);
    }
  },
);
