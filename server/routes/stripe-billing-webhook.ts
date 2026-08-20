import express from "express";
import { resolveStripeBillingConfiguration } from "../lib/stripe-billing-config.js";
import {
  constructStripeWebhookEvent,
  ingestStripeWebhookEvent,
} from "../services/commercial-subscription.js";

export const stripeBillingWebhookRouter = express.Router();

stripeBillingWebhookRouter.post(
  "/",
  express.raw({ type: "application/json", limit: "64kb" }),
  async (req, res, next) => {
    try {
      if (!resolveStripeBillingConfiguration()) {
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
        event = constructStripeWebhookEvent(req.body, signature);
      } catch {
        res.status(401).json({
          error: "Stripe webhook authentication failed",
          code: "STRIPE_WEBHOOK_UNAUTHENTICATED",
        });
        return;
      }
      res.json(await ingestStripeWebhookEvent(event));
    } catch (error) {
      next(error);
    }
  },
);
