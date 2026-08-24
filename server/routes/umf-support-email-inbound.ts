import express from "express";
import {
  parseSupportInboundEmailPayload,
  verifySupportEmailWebhookSignature,
} from "../lib/support-email-inbound.js";
import { resolveUmfSupportEmailConfiguration } from "../lib/umf-support-email.js";
import { ingestUmfSupportInboundEmail } from "../services/umf-support.js";
import { notifyUmfSupportAdministrators } from "../services/umf-support-notifications.js";
import {
  publicSupportContacts,
  umfSupportOperationalWorkspaceEnabled,
} from "../lib/support-routing.js";

export const umfSupportEmailInboundRouter = express.Router();

umfSupportEmailInboundRouter.post(
  "/",
  express.raw({ type: "application/json", limit: "64kb" }),
  async (req, res, next) => {
    try {
      if (!umfSupportOperationalWorkspaceEnabled()) {
        res.status(503).json({
          error: "UMF Support operations are temporarily frozen",
          code: "UMF_SUPPORT_OPERATIONS_FROZEN",
          contacts: publicSupportContacts(),
        });
        return;
      }
      const configuration = resolveUmfSupportEmailConfiguration();
      if (!configuration) {
        res
          .status(404)
          .json({ error: "Endpoint not found", code: "NOT_FOUND" });
        return;
      }
      if (
        !Buffer.isBuffer(req.body) ||
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
      const result = await ingestUmfSupportInboundEmail(
        parseSupportInboundEmailPayload(req.body),
        configuration,
      );
      if (!result.duplicate) {
        void notifyUmfSupportAdministrators({
          event: "inbound_email",
          title: `Correo recibido en ${result.ticketPublicId}`,
          message:
            "UMF Support ha recibido un correo nuevo o una respuesta autenticada.",
          url: "/umf-support",
        }).catch(() => undefined);
      }
      res
        .status(result.duplicate ? 200 : 202)
        .json({ accepted: true, ...result });
    } catch (error) {
      next(error);
    }
  },
);
