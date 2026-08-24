import express from "express";
import {
  parseSupportInboundEmailPayload,
  resolveSupportEmailInboundConfiguration,
  verifySupportEmailWebhookSignature,
} from "../lib/support-email-inbound.js";
import {
  internalSupportTicketsEnabled,
  publicSupportContacts,
} from "../lib/support-routing.js";
import { ingestSupportInboundEmail } from "../services/support.js";

export const supportEmailInboundRouter = express.Router();

supportEmailInboundRouter.post(
  "/",
  express.raw({ type: "application/json", limit: "64kb" }),
  async (req, res, next) => {
    try {
      if (!internalSupportTicketsEnabled()) {
        res.status(503).json({
          error: "Internal support tickets are temporarily routed externally",
          code: "SUPPORT_TICKETS_EXTERNALLY_ROUTED",
          contacts: publicSupportContacts(),
        });
        return;
      }
      const configuration = resolveSupportEmailInboundConfiguration();
      if (!configuration) {
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
      if (
        !verifySupportEmailWebhookSignature({
          body: req.body,
          timestamp: req.get("X-Umbravia-Timestamp"),
          signature: req.get("X-Umbravia-Signature"),
          secret: configuration.webhookSecret,
        })
      ) {
        res.status(401).json({
          error: "Inbound email authentication failed",
          code: "INBOUND_EMAIL_UNAUTHENTICATED",
        });
        return;
      }

      const payload = parseSupportInboundEmailPayload(req.body);
      const result = await ingestSupportInboundEmail(payload, configuration);
      res.status(result.duplicate ? 200 : 202).json({
        accepted: true,
        duplicate: result.duplicate,
        ticketPublicId: result.ticketPublicId,
      });
    } catch (error) {
      next(error);
    }
  },
);
