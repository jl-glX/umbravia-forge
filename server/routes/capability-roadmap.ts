import express from "express";
import {
  authenticate,
  requirePlatformOperator,
} from "../middleware/authorization.js";
import { getCapabilityRoadmap } from "../services/capability-roadmap.js";

export const capabilityRoadmapRouter = express.Router();
capabilityRoadmapRouter.use(authenticate, requirePlatformOperator);
capabilityRoadmapRouter.get("/", (_req, res) => {
  res.json(getCapabilityRoadmap());
});
