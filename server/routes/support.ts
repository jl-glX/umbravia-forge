import express from "express";
import {
  authenticate,
  getAuthenticatedUser,
  requireFacility,
  selectFacilityContext,
} from "../middleware/authorization.js";
import { supportMutationLimiter } from "../middleware/security.js";
import {
  addSupportMessage,
  createSupportTicket,
  deleteSupportAttachment,
  getSupportCapabilities,
  getSupportTicket,
  listKnowledgeArticles,
  listSupportAgents,
  listSupportTickets,
  readSupportAttachment,
  saveKnowledgeArticle,
  saveSupportAgent,
  storeSupportAttachment,
  supportAttachmentLimitBytes,
  updateSupportTicket,
} from "../services/support.js";
import { supportAttachmentAcceptedMimeTypes } from "../lib/support-attachment-policy.js";
import {
  internalSupportTicketsEnabled,
  publicSupportContacts,
} from "../lib/support-routing.js";

export const supportRouter = express.Router();

supportRouter.get("/contact", (_req, res) => {
  res.json({
    contacts: publicSupportContacts(),
    internalTicketingEnabled: internalSupportTicketsEnabled(),
  });
});

supportRouter.use(authenticate, selectFacilityContext, requireFacility());

supportRouter.use("/tickets", (_req, res, next) => {
  if (internalSupportTicketsEnabled()) {
    next();
    return;
  }
  res.status(503).json({
    error: "Internal support tickets are temporarily routed externally",
    code: "SUPPORT_TICKETS_EXTERNALLY_ROUTED",
    contacts: publicSupportContacts(),
  });
});

supportRouter.get("/capabilities", async (_req, res, next) => {
  try {
    const capabilities = await getSupportCapabilities(
      getAuthenticatedUser(res),
    );
    res.json({ capabilities });
  } catch (error) {
    next(error);
  }
});

function requireOnlyFields(
  body: unknown,
  allowed: readonly string[],
): asserts body is Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("A JSON object is required") as Error & {
      statusCode: number;
    };
    error.statusCode = 400;
    throw error;
  }
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    const error = new Error(
      `Unknown support field(s): ${unknown.join(", ")}`,
    ) as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }
}

supportRouter.get("/tickets", async (req, res, next) => {
  try {
    const tickets = await listSupportTickets(getAuthenticatedUser(res), {
      status:
        typeof req.query.status === "string" ? req.query.status : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    });
    res.json({ tickets });
  } catch (error) {
    next(error);
  }
});

supportRouter.post(
  "/tickets",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "subject",
        "message",
        "category",
        "priority",
        "source",
        "relatedType",
        "relatedId",
        "context",
      ]);
      const ticket = await createSupportTicket(
        getAuthenticatedUser(res),
        req.body,
      );
      res.status(201).json({ ticket });
    } catch (error) {
      next(error);
    }
  },
);

supportRouter.get("/tickets/:ticketId", async (req, res, next) => {
  try {
    const ticket = await getSupportTicket(
      getAuthenticatedUser(res),
      req.params.ticketId,
    );
    res.json({ ticket });
  } catch (error) {
    next(error);
  }
});

supportRouter.post(
  "/tickets/:ticketId/messages",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["body", "visibility"]);
      const message = await addSupportMessage(
        getAuthenticatedUser(res),
        req.params.ticketId,
        req.body,
      );
      res.status(201).json({ message });
    } catch (error) {
      next(error);
    }
  },
);

supportRouter.patch(
  "/tickets/:ticketId",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["status", "priority", "assigneeUserId"]);
      const ticket = await updateSupportTicket(
        getAuthenticatedUser(res),
        req.params.ticketId,
        req.body,
      );
      res.json({ ticket });
    } catch (error) {
      next(error);
    }
  },
);

supportRouter.post(
  "/tickets/:ticketId/attachments",
  supportMutationLimiter,
  express.raw({
    type: supportAttachmentAcceptedMimeTypes,
    limit: supportAttachmentLimitBytes(),
  }),
  async (req, res, next) => {
    try {
      const fileName = req.get("X-File-Name");
      if (!fileName) {
        const error = new Error("X-File-Name is required") as Error & {
          statusCode: number;
        };
        error.statusCode = 400;
        throw error;
      }
      const attachment = await storeSupportAttachment(
        getAuthenticatedUser(res),
        req.params.ticketId,
        {
          body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          fileName,
          mimeType: req.get("Content-Type")?.split(";")[0] ?? "",
          messageId: req.get("X-Message-Id") ?? null,
        },
      );
      res.status(201).json({ attachment });
    } catch (error) {
      next(error);
    }
  },
);

supportRouter.get(
  "/tickets/:ticketId/attachments/:attachmentId",
  async (req, res, next) => {
    try {
      const result = await readSupportAttachment(
        getAuthenticatedUser(res),
        req.params.ticketId,
        req.params.attachmentId,
      );
      res.setHeader("Content-Type", result.attachment.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(result.attachment.fileName)}`,
      );
      res.setHeader("Content-Length", String(result.body.length));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(result.body);
    } catch (error) {
      next(error);
    }
  },
);

supportRouter.delete(
  "/tickets/:ticketId/attachments/:attachmentId",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      await deleteSupportAttachment(
        getAuthenticatedUser(res),
        req.params.ticketId,
        req.params.attachmentId,
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

supportRouter.get("/knowledge", async (req, res, next) => {
  try {
    const articles = await listKnowledgeArticles(
      getAuthenticatedUser(res),
      typeof req.query.q === "string" ? req.query.q : "",
    );
    res.json({ articles });
  } catch (error) {
    next(error);
  }
});

supportRouter.post(
  "/knowledge",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "title",
        "summary",
        "body",
        "category",
        "status",
        "slug",
      ]);
      const article = await saveKnowledgeArticle(
        getAuthenticatedUser(res),
        req.body,
      );
      res.status(201).json({ article });
    } catch (error) {
      next(error);
    }
  },
);

supportRouter.put(
  "/knowledge/:articleId",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "title",
        "summary",
        "body",
        "category",
        "status",
        "slug",
      ]);
      const article = await saveKnowledgeArticle(
        getAuthenticatedUser(res),
        req.body,
        req.params.articleId,
      );
      res.json({ article });
    } catch (error) {
      next(error);
    }
  },
);

supportRouter.get("/agents", async (_req, res, next) => {
  try {
    const agents = await listSupportAgents(getAuthenticatedUser(res));
    res.json({ agents });
  } catch (error) {
    next(error);
  }
});

supportRouter.put("/agents", supportMutationLimiter, async (req, res, next) => {
  try {
    requireOnlyFields(req.body, ["userId", "role", "active"]);
    const agentId = await saveSupportAgent(getAuthenticatedUser(res), req.body);
    res.json({ agentId });
  } catch (error) {
    next(error);
  }
});

supportRouter.get("/search", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const auth = getAuthenticatedUser(res);
    const [tickets, articles] = await Promise.all([
      listSupportTickets(auth, { q }),
      listKnowledgeArticles(auth, q),
    ]);
    res.json({ query: q.slice(0, 120), tickets, articles });
  } catch (error) {
    next(error);
  }
});
