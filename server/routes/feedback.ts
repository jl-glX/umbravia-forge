import { randomUUID } from "node:crypto";
import express from "express";
import { feedbackValidation } from "../middleware/validation.js";
import { db } from "../db/client.js";
import { feedbackLimiter } from "../middleware/security.js";
import { readSessionToken } from "../lib/session-cookie.js";
import { verifyToken } from "../services/auth.js";
import { requireCaptcha } from "../middleware/captcha.js";
import { notifyUmfSupportAdministrators } from "../services/umf-support-notifications.js";

export const feedbackRouter = express.Router();

feedbackRouter.post(
  "/",
  feedbackLimiter,
  requireCaptcha("feedback"),
  feedbackValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const token = readSessionToken(req);
      const session = token ? await verifyToken(token) : null;
      await db
        .insertInto("feedback")
        .values({
          id: randomUUID(),
          userId: session?.userId ?? null,
          category: req.body.category,
          message: req.body.message,
          status: "new",
          createdAt: Date.now(),
        })
        .execute();
      void notifyUmfSupportAdministrators({
        event: "feedback_received",
        title: "Nueva retroalimentación para Umbravia Forge",
        message: `Se ha recibido una aportación en la categoría ${req.body.category}.`,
        url: "/umf-support",
      }).catch(() => undefined);
      res.status(201).json({ submitted: true });
    } catch (error) {
      next(error);
    }
  },
);
