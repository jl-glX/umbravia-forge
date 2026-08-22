import express from "express";
import {
  authenticateCorporateSupportAccountSession,
  authenticateCorporateSupport,
  getAuthenticatedUser,
} from "../middleware/authorization.js";
import { requireCaptcha } from "../middleware/captcha.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  authenticationLimiter,
  accountRecoveryLimiter,
  loginLimiter,
  signupLimiter,
  supportMutationLimiter,
} from "../middleware/security.js";
import {
  clearSupportMfaChallengeCookie,
  clearSupportPasskeyChallengeCookie,
  clearSupportSessionCookie,
  readSupportMfaChallengeToken,
  readSupportPasskeyChallengeToken,
  readSupportSessionToken,
  setSupportMfaChallengeCookie,
  setSupportPasskeyChallengeCookie,
  setSupportSessionCookie,
} from "../lib/session-cookie.js";
import { completeMfaLogin, login, logout } from "../services/auth.js";
import { accountSecurityRouter } from "./account-security.js";
import {
  beginPasskeyAuthentication,
  finishPasskeyAuthentication,
} from "../services/passkeys.js";
import { getWebauthnContext } from "../lib/request-origin.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  AccountRecoveryPasswordReusedError,
  getRecoveryCapabilities,
  requestPasswordRecovery,
  resetPasswordWithRecoveryCode,
} from "../services/account-recovery.js";
import { deliverQueuedEmail } from "../services/email-delivery.js";
import {
  createUmfSupportTicket,
  approveUmfSupportAdministrator,
  createUmfSupportCollaborationSpace,
  cancelUmfSupportScheduledMail,
  getUmfSupportCapabilities,
  getUmfSupportDistribution,
  getUmfSupportRole,
  getUmfSupportTicket,
  listUmfSupportAdministratorAccounts,
  listUmfSupportCollaborationSpaces,
  listUmfSupportMailbox,
  listUmfSupportMailDrafts,
  listUmfSupportStaff,
  listUmfSupportTickets,
  registerUmfSupportAccount,
  replyToUmfSupportTicket,
  saveUmfSupportMailDraft,
  sendUmfSupportMailDraft,
  updateUmfSupportCollaborationSpace,
  updateUmfSupportStaff,
  updateUmfSupportTicket,
  verifyUmfSupportRegistration,
} from "../services/umf-support.js";
import {
  createEmailVerificationChallenge,
  getPendingEmailVerificationProfile,
} from "../services/email-verification.js";
import { queueEmailVerificationCode } from "../services/email-delivery.js";
import {
  getUmfSupportNotificationSettings,
  registerUmfSupportPushSubscription,
  revokeUmfSupportPushSubscription,
  updateUmfSupportNotificationSettings,
} from "../services/umf-support-notifications.js";
import { ensureConfiguredCompanyHead } from "../services/company-head-designation.js";

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

umfSupportRouter.get("/recovery/capabilities", (_req, res) => {
  res.json({
    methods: getRecoveryCapabilities(),
    lookupMethods: ["email"],
  });
});

umfSupportRouter.post(
  "/recovery/request",
  accountRecoveryLimiter,
  requireCaptcha("recovery"),
  async (req, res) => {
    try {
      requireOnlyFields(req.body, ["method", "identifier", "captchaToken"]);
      if (
        req.body.method !== "email" ||
        typeof req.body.identifier !== "string"
      ) {
        throw new Error("Invalid recovery request");
      }
      const result = await requestPasswordRecovery(
        "email",
        req.body.identifier,
        "corporate_support",
      );
      if (result.deliveryId) {
        setImmediate(() => {
          void deliverQueuedEmail(result.deliveryId!).catch(() => undefined);
        });
      }
    } catch {
      // Never disclose whether the corporate identity exists.
    }
    res.status(202).json({ accepted: true });
  },
);

umfSupportRouter.post(
  "/recovery/reset-password",
  accountRecoveryLimiter,
  async (req, res) => {
    try {
      requireOnlyFields(req.body, [
        "method",
        "identifier",
        "code",
        "newPassword",
      ]);
      if (req.body.method !== "email") throw new Error("Invalid method");
      const recovered = await resetPasswordWithRecoveryCode({
        method: "email",
        identifier: req.body.identifier,
        code: req.body.code,
        newPassword: req.body.newPassword,
        identityRealm: "corporate_support",
      });
      if (!recovered) throw new Error("Invalid recovery code");
      clearSupportSessionCookie(res);
      clearSupportMfaChallengeCookie(res);
      clearSupportPasskeyChallengeCookie(res);
      res.json({ recovered: true });
    } catch (error) {
      res
        .status(error instanceof AccountRecoveryPasswordReusedError ? 409 : 400)
        .json({
          code:
            error instanceof AccountRecoveryPasswordReusedError
              ? error.code
              : "ACCOUNT_RECOVERY_INVALID",
          error: "Invalid or expired recovery code",
        });
    }
  },
);

umfSupportRouter.post(
  "/register",
  signupLimiter,
  requireCaptcha("signup"),
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "email",
        "name",
        "lastName",
        "password",
        "countryCode",
        "locale",
        "acceptedTerms",
        "acceptedPrivacy",
        "captchaToken",
      ]);
      const result = await registerUmfSupportAccount(req.body, {
        userAgent: req.get("User-Agent"),
      });
      setSupportSessionCookie(res, result.sessionToken);
      res.status(201).json({
        user: result.user,
        verificationRequired: true,
        verificationEmailSent: result.verificationEmailSent,
        demoVerificationCode: result.demoVerificationCode,
      });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/verify-email",
  authenticateCorporateSupportAccountSession,
  authenticationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["code"]);
      if (typeof req.body.code !== "string" || !/^\d{6}$/.test(req.body.code)) {
        throw new Error("Invalid verification code");
      }
      res.json(
        await verifyUmfSupportRegistration(
          getAuthenticatedUser(res).userId,
          req.body.code,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/resend-verification",
  authenticateCorporateSupportAccountSession,
  authenticationLimiter,
  async (_req, res, next) => {
    try {
      const { userId } = getAuthenticatedUser(res);
      const profile = await getPendingEmailVerificationProfile(userId);
      if (!profile) {
        res.status(204).end();
        return;
      }
      const challenge = await createEmailVerificationChallenge(userId);
      const deliveryId = await queueEmailVerificationCode({
        userId,
        platformScope: "support",
        ...profile,
        code: challenge.code,
        expiresAt: challenge.expiresAt,
      });
      const delivered = await deliverQueuedEmail(deliveryId).catch(() => false);
      res.status(202).json({
        sent: delivered,
        queued: !delivered,
        demoVerificationCode:
          process.env.NODE_ENV === "test" ? challenge.code : undefined,
      });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/login",
  loginLimiter,
  requireCaptcha("login"),
  async (req, res) => {
    try {
      requireOnlyFields(req.body, [
        "email",
        "password",
        "rememberDevice",
        "captchaToken",
      ]);
      const email = normalizedSupportLoginEmail(req.body.email);
      if (typeof req.body.password !== "string") {
        throw new Error("Invalid credentials");
      }
      const result = await login(
        email,
        req.body.password,
        "support",
        req.body.rememberDevice === true,
        { userAgent: req.get("User-Agent") },
      );
      if ("challengeToken" in result) {
        setSupportMfaChallengeCookie(res, result.challengeToken);
        res.json({ mfaRequired: true });
        return;
      }
      setSupportSessionCookie(res, result.sessionToken, result.rememberDevice);
      res.json({ user: result.user, mfaRequired: false });
    } catch {
      res.status(401).json({
        code: "INVALID_CREDENTIALS",
        error: "Invalid email or password",
      });
    }
  },
);

umfSupportRouter.post(
  "/mfa/verify",
  authenticationLimiter,
  async (req, res) => {
    const challengeToken = readSupportMfaChallengeToken(req);
    if (
      !challengeToken ||
      typeof req.body?.code !== "string" ||
      !/^(?:\d{6}|[A-Fa-f0-9]{6}-?[A-Fa-f0-9]{6})$/.test(req.body.code)
    ) {
      res.status(401).json({ error: "Invalid verification code" });
      return;
    }
    try {
      const result = await completeMfaLogin(
        challengeToken,
        req.body.code,
        {
          userAgent: req.get("User-Agent"),
        },
        "corporate_support",
      );
      clearSupportMfaChallengeCookie(res);
      setSupportSessionCookie(res, result.sessionToken, result.rememberDevice);
      res.json({ user: result.user });
    } catch {
      res.status(401).json({ error: "Invalid verification code" });
    }
  },
);

umfSupportRouter.post(
  "/passkeys/options",
  authenticationLimiter,
  async (req, res) => {
    try {
      requireOnlyFields(req.body, ["email", "rememberDevice"]);
      const { rpID } = getWebauthnContext(req);
      const result = await beginPasskeyAuthentication(
        normalizedSupportLoginEmail(req.body.email),
        "support",
        req.body.rememberDevice === true,
        rpID,
      );
      setSupportPasskeyChallengeCookie(res, result.token);
      res.json(result.options);
    } catch {
      res.status(401).json({ error: "Passkey access is not available" });
    }
  },
);

umfSupportRouter.post(
  "/passkeys/verify",
  authenticationLimiter,
  async (req, res) => {
    const token = readSupportPasskeyChallengeToken(req);
    if (!token || !req.body?.response) {
      res.status(401).json({ error: "Invalid or expired passkey challenge" });
      return;
    }
    try {
      const { origin, rpID } = getWebauthnContext(req);
      const result = await finishPasskeyAuthentication(
        token,
        req.body.response as AuthenticationResponseJSON,
        origin,
        rpID,
        "support",
        { userAgent: req.get("User-Agent") },
      );
      if (result.user.identityRealm !== "corporate_support") {
        throw new Error("Invalid identity realm");
      }
      clearSupportPasskeyChallengeCookie(res);
      setSupportSessionCookie(res, result.sessionToken, result.rememberDevice);
      res.json({ user: result.user });
    } catch {
      clearSupportPasskeyChallengeCookie(res);
      res.status(401).json({ error: "Passkey verification failed" });
    }
  },
);

umfSupportRouter.use(authenticateCorporateSupport);

umfSupportRouter.get("/session", async (_req, res) => {
  const session = getAuthenticatedUser(res);
  await ensureConfiguredCompanyHead(session.userId);
  const accessApproved = (await getUmfSupportRole(session.userId)) !== null;
  res.json({
    user: {
      id: session.userId,
      email: session.email,
      name: session.name,
      avatarDataUrl: session.avatarDataUrl,
      role: session.role,
      accountStatus: session.accountStatus,
      identityRealm: session.identityRealm,
      accessApproved,
    },
  });
});

umfSupportRouter.post("/logout", async (req, res) => {
  const token = readSupportSessionToken(req);
  if (token) await logout(token);
  clearSupportSessionCookie(res);
  clearSupportMfaChallengeCookie(res);
  res.json({ message: "Logged out successfully" });
});

umfSupportRouter.use("/account/security", accountSecurityRouter);

function normalizedSupportLoginEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid email");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email");
  }
  return email;
}

umfSupportRouter.get("/capabilities", async (_req, res, next) => {
  try {
    res.json({
      capabilities: await getUmfSupportCapabilities(getAuthenticatedUser(res)),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.get("/notification-settings", async (_req, res, next) => {
  try {
    res.json({
      settings: await getUmfSupportNotificationSettings(
        getAuthenticatedUser(res),
      ),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.put(
  "/notification-settings",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["enabled", "preferences"]);
      res.json(
        await updateUmfSupportNotificationSettings(
          getAuthenticatedUser(res),
          req.body,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/push-subscriptions",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, [
        "subscription",
        "deviceName",
        "browserFamily",
      ]);
      res
        .status(201)
        .json(
          await registerUmfSupportPushSubscription(
            getAuthenticatedUser(res),
            req.body,
          ),
        );
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.delete(
  "/push-subscriptions/:subscriptionId",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      res.json(
        await revokeUmfSupportPushSubscription(
          getAuthenticatedUser(res),
          req.params.subscriptionId,
        ),
      );
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

umfSupportRouter.get("/administrator-accounts", async (_req, res, next) => {
  try {
    res.json({
      accounts: await listUmfSupportAdministratorAccounts(
        getAuthenticatedUser(res),
      ),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.post(
  "/administrator-accounts/:userId/approve",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, []);
      await approveUmfSupportAdministrator(
        getAuthenticatedUser(res),
        req.params.userId,
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.get("/collaboration-spaces", async (_req, res, next) => {
  try {
    res.json({
      spaces: await listUmfSupportCollaborationSpaces(
        getAuthenticatedUser(res),
      ),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.post(
  "/collaboration-spaces",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["name", "description"]);
      res.status(201).json({
        space: await createUmfSupportCollaborationSpace(
          getAuthenticatedUser(res),
          req.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.patch(
  "/collaboration-spaces/:spaceId",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["visibility", "status"]);
      await updateUmfSupportCollaborationSpace(
        getAuthenticatedUser(res),
        req.params.spaceId,
        req.body,
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

umfSupportRouter.get("/mail/drafts", async (_req, res, next) => {
  try {
    res.json({
      drafts: await listUmfSupportMailDrafts(getAuthenticatedUser(res)),
    });
  } catch (error) {
    next(error);
  }
});

umfSupportRouter.post(
  "/mail/drafts",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["to", "cc", "bcc", "subject", "body"]);
      res.status(201).json({
        draft: await saveUmfSupportMailDraft(
          getAuthenticatedUser(res),
          req.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.put(
  "/mail/drafts/:draftId",
  supportMutationLimiter,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["to", "cc", "bcc", "subject", "body"]);
      res.json({
        draft: await saveUmfSupportMailDraft(
          getAuthenticatedUser(res),
          req.body,
          req.params.draftId,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/mail/drafts/:draftId/send",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, ["scheduledAt"]);
      const scheduledAt =
        req.body.scheduledAt === undefined ? undefined : req.body.scheduledAt;
      res
        .status(202)
        .json(
          await sendUmfSupportMailDraft(
            getAuthenticatedUser(res),
            req.params.draftId,
            scheduledAt,
          ),
        );
    } catch (error) {
      next(error);
    }
  },
);

umfSupportRouter.post(
  "/mail/drafts/:draftId/cancel",
  supportMutationLimiter,
  requireRecentFormVerification,
  async (req, res, next) => {
    try {
      requireOnlyFields(req.body, []);
      res.json(
        await cancelUmfSupportScheduledMail(
          getAuthenticatedUser(res),
          req.params.draftId,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
