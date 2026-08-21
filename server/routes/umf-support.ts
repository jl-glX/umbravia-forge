import express from "express";
import {
  authenticate,
  getAuthenticatedUser,
} from "../middleware/authorization.js";
import { requireCaptcha } from "../middleware/captcha.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  signupLimiter,
  supportMutationLimiter,
} from "../middleware/security.js";
import { setSessionCookie } from "../lib/session-cookie.js";
import {
  activateUmfSupportAccount,
  approveUmfSupportAccess,
  createUmfSupportTicket,
  delegateCompanyRole,
  getUmfSupportCapabilities,
  getUmfSupportDistribution,
  getUmfSupportTicket,
  listCompanyStaff,
  listCompanyRoleDelegations,
  listUmfSupportAccessRequests,
  listUmfSupportMailbox,
  listUmfSupportStaff,
  listUmfSupportTickets,
  rejectUmfSupportAccess,
  renounceCompanyRole,
  replyToUmfSupportTicket,
  requestUmfSupportAccess,
  respondToCompanyRoleDelegation,
  selfEnableCompanyRole,
  updateCompanyStaff,
  updateUmfSupportStaff,
  updateUmfSupportTicket,
} from "../services/umf-support.js";

export const umfSupportRouter = express.Router();

function requireOnlyFields(body: unknown, allowed: readonly string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("A JSON object is required"), {
      statusCode: 400,
    });
  }
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw Object.assign(new Error(`Unknown field(s): ${unknown.join(", ")}`), {
      statusCode: 400,
    });
  }
}

umfSupportRouter.get("/distribution", (_req, res) => {
  res.json({ distribution: getUmfSupportDistribution() });
});

umfSupportRouter.post(
  "/access-requests",
  signupLimiter,
  requireCaptcha("signup"),
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "email",
        "name",
        "lastName",
        "locale",
        "captchaToken",
      ]);
      res.status(202).json(await requestUmfSupportAccess(req.body));
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/activate",
  signupLimiter,
  requireCaptcha("signup"),
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "email",
        "code",
        "password",
        "countryCode",
        "acceptedTerms",
        "acceptedPrivacy",
        "captchaToken",
      ]);
      const result = await activateUmfSupportAccount(req.body, {
        userAgent: req.get("User-Agent"),
      });
      setSessionCookie(res, result.sessionToken);
      res.status(201).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.use(authenticate);

umfSupportRouter.get("/capabilities", async (_req, res, next) => {
  try {
    res.json({
      capabilities: await getUmfSupportCapabilities(getAuthenticatedUser(res)),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.get("/access-requests", async (_req, res, next) => {
  try {
    res.json({
      requests: await listUmfSupportAccessRequests(getAuthenticatedUser(res)),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.post(
  "/access-requests/:requestId/approve",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      res.json(
        await approveUmfSupportAccess(
          getAuthenticatedUser(res),
          req.params.requestId,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/access-requests/:requestId/reject",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      await rejectUmfSupportAccess(
        getAuthenticatedUser(res),
        req.params.requestId,
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.get("/staff", async (_req, res, next) => {
  try {
    res.json({ staff: await listUmfSupportStaff(getAuthenticatedUser(res)) });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.get("/company-staff", async (_req, res, next) => {
  try {
    res.json({ staff: await listCompanyStaff(getAuthenticatedUser(res)) });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.patch(
  "/company-staff/:userId",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["position", "reportsToUserId", "status"]);
      await updateCompanyStaff(
        getAuthenticatedUser(res),
        req.params.userId,
        req.body,
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.get("/company-delegations", async (_req, res, next) => {
  try {
    res.json({
      delegations: await listCompanyRoleDelegations(getAuthenticatedUser(res)),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.post(
  "/company-delegations",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["profileId", "recipientUserId"]);
      res
        .status(201)
        .json(await delegateCompanyRole(getAuthenticatedUser(res), req.body));
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/company-delegations/:delegationId/respond",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["decision"]);
      res.json(
        await respondToCompanyRoleDelegation(
          getAuthenticatedUser(res),
          req.params.delegationId,
          req.body.decision,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/company-roles/:profileId/renounce",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, []);
      await renounceCompanyRole(
        getAuthenticatedUser(res),
        req.params.profileId,
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/company-roles/:profileId/self-enable",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, []);
      await selfEnableCompanyRole(
        getAuthenticatedUser(res),
        req.params.profileId,
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.patch(
  "/staff/:userId",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["role", "status"]);
      await updateUmfSupportStaff(
        getAuthenticatedUser(res),
        req.params.userId,
        req.body,
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.get("/tickets", async (req, res, next) => {
  try {
    res.json({
      tickets: await listUmfSupportTickets(getAuthenticatedUser(res), {
        status:
          typeof req.query.status === "string" ? req.query.status : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
      }),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.post(
  "/tickets",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "requesterEmail",
        "requesterName",
        "organizationName",
        "subject",
        "message",
        "category",
        "priority",
      ]);
      res.status(201).json({
        ticket: await createUmfSupportTicket(
          getAuthenticatedUser(res),
          req.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.get("/tickets/:ticketId", async (req, res, next) => {
  try {
    res.json({
      ticket: await getUmfSupportTicket(
        getAuthenticatedUser(res),
        req.params.ticketId,
      ),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.patch(
  "/tickets/:ticketId",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "status",
        "priority",
        "category",
        "assigneeUserId",
      ]);
      res.json({
        ticket: await updateUmfSupportTicket(
          getAuthenticatedUser(res),
          req.params.ticketId,
          req.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/tickets/:ticketId/messages",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["body", "internal", "sendEmail"]);
      res.status(201).json({
        ticket: await replyToUmfSupportTicket(
          getAuthenticatedUser(res),
          req.params.ticketId,
          req.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.get("/mailbox/:direction", async (req, res, next) => {
  try {
    if (
      req.params.direction !== "inbound" &&
      req.params.direction !== "outbound"
    ) {
      res.status(400).json({ error: "Mailbox direction is invalid" });
      return;
    }
    res.json({
      messages: await listUmfSupportMailbox(
        getAuthenticatedUser(res),
        req.params.direction,
      ),
    });
  } catch (error) {
    next(error);
  }
});
