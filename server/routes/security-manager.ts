import express from "express";
import {
  authenticate,
  requirePlatformOperator,
} from "../middleware/authorization.js";
import { getSecurityManagerOverview } from "../services/security-manager.js";

export const securityManagerRouter = express.Router();
securityManagerRouter.use(authenticate, requirePlatformOperator);

securityManagerRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getSecurityManagerOverview());
  } catch (error) {
    next(error);
  }
});
