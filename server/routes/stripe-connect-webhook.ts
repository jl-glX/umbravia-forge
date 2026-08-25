import express from "express";
import { resolveStripeConnectConfiguration } from "../lib/stripe-connect-config.js";
import {
  constructStripeConnectWebhookEvent,
  ingestStripeConnectWebhookEvent,
} from "../services/stripe-connect.js";

export const stripeConnectWebhookRouter = express.Router();

stripeConnectWebhookRouter.post(
  "/",
  express.raw({ type: "application/json", limit: "64kb" }),
  async (req, res, next) => {
    try {
      if (!resolveStripeConnectConfiguration()) {
        res
          .status(404)
          .json({ error: "Endpoint not found", code: "NOT_FOUND" });
        return;
      }
      if (!Buffer.isBuffer(req.body)) {
        res.status(415).json({
          error: "application/json is required",
          code: "UNSUPPORTED_MEDIA_TYPE",
        });
        return;
      }
      const signature = req.get("Stripe-Signature");
      if (!signature) {
        res.status(401).json({
          error: "Stripe webhook authentication failed",
          code: "STRIPE_WEBHOOK_UNAUTHENTICATED",
        });
        return;
      }
      let event;
      try {
        event = constructStripeConnectWebhookEvent(req.body, signature);
      } catch {
        res.status(401).json({
          error: "Stripe webhook authentication failed",
          code: "STRIPE_WEBHOOK_UNAUTHENTICATED",
        });
        return;
      }
      res.json(await ingestStripeConnectWebhookEvent(event));
    } catch (error) {
      next(error);
    }
  },
);
