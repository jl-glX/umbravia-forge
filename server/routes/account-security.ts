import express from "express";
import {
  authenticate,
  getAuthenticatedUser,
} from "../middleware/authorization.js";
import { authenticationLimiter } from "../middleware/security.js";
import {
  accountMfaConfirmationValidation,
  accountCompromiseValidation,
  emailChangeConfirmValidation,
  emailChangeRequestValidation,
  mfaCodeValidation,
  passkeyResponseValidation,
  passwordConfirmationValidation,
  sessionIdValidation,
  sessionSettingsValidation,
} from "../middleware/validation.js";
import {
  clearPasskeyChallengeCookie,
  clearSessionCookie,
  readPasskeyChallengeToken,
  setPasskeyChallengeCookie,
} from "../lib/session-cookie.js";
import {
  getSecurityOverview,
  revokeOtherSessions,
  revokeSession,
  SESSION_IDLE_TIMEOUT_OPTIONS,
  updateSessionIdleTimeout,
  secureReportedCompromise,
} from "../services/account-security.js";
import {
  beginMfaSetup,
  disableMfa,
  enableMfa,
  regenerateRecoveryCodes,
  verifyMfaCode,
  mfaStatus,
} from "../services/mfa.js";
import { verifyUserPassword } from "../services/auth.js";
import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  removePasskeys,
} from "../services/passkeys.js";
import {
  cancelEmailChange,
  confirmEmailChange,
  requestEmailChange,
} from "../services/email-change.js";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getWebauthnContext } from "../lib/request-origin.js";

export const accountSecurityRouter = express.Router();
accountSecurityRouter.use(authenticate);

accountSecurityRouter.get("/", async (_req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    res.json(await getSecurityOverview(auth.userId, auth.sessionId));
  } catch (error) {
    next(error);
  }
});

accountSecurityRouter.post(
  "/email-change/request",
  authenticationLimiter,
  emailChangeRequestValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      if (!(await verifyUserPassword(auth.userId, req.body.password))) {
        res.status(401).json({
          error: "Invalid security confirmation",
          code: "INVALID_SECURITY_CONFIRMATION",
        });
        return;
      }
      res
        .status(202)
        .json(await requestEmailChange(auth.userId, req.body.email));
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.post(
  "/email-change/confirm",
  authenticationLimiter,
  emailChangeConfirmValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      res.json(
        await confirmEmailChange(auth.userId, auth.sessionId, req.body.code),
      );
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.delete(
  "/email-change",
  authenticationLimiter,
  async (_req, res, next) => {
    try {
      const auth = getAuthenticatedUser(res);
      const cancelled = await cancelEmailChange(auth.userId);
      res.status(cancelled ? 200 : 204);
      if (cancelled) {
        res.json({ cancelled: true });
      } else {
        res.end();
      }
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.post(
  "/compromise",
  authenticationLimiter,
  accountCompromiseValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      const passwordValid = await verifyUserPassword(
        auth.userId,
        req.body.password,
      );
      const mfa = await mfaStatus(auth.userId);
      const mfaValid =
        !mfa.enabled ||
        (typeof req.body.code === "string" &&
          (await verifyMfaCode(auth.userId, auth.email, req.body.code)).valid);
      if (!passwordValid || !mfaValid) {
        res.status(401).json({ error: "Invalid security confirmation" });
        return;
      }
      res.json(await secureReportedCompromise(auth.userId, auth.sessionId));
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.post(
  "/passkeys/options",
  authenticationLimiter,
  passwordConfirmationValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      if (!(await verifyUserPassword(auth.userId, req.body.password))) {
        res.status(401).json({ error: "Invalid security confirmation" });
        return;
      }
      const { rpID } = getWebauthnContext(req);
      const result = await beginPasskeyRegistration(
        { id: auth.userId, email: auth.email, name: auth.name },
        rpID,
      );
      setPasskeyChallengeCookie(res, result.token);
      res.json(result.options);
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.post(
  "/passkeys/verify",
  authenticationLimiter,
  passkeyResponseValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const token = readPasskeyChallengeToken(req);
    if (!token) {
      res.status(401).json({ error: "Invalid or expired passkey challenge" });
      return;
    }
    try {
      const auth = getAuthenticatedUser(res);
      const { origin, rpID } = getWebauthnContext(req);
      await finishPasskeyRegistration(
        auth.userId,
        token,
        req.body.response as RegistrationResponseJSON,
        origin,
        rpID,
      );
      clearPasskeyChallengeCookie(res);
      res.status(201).json({ enabled: true });
    } catch (error) {
      clearPasskeyChallengeCookie(res);
      next(error);
    }
  },
);

accountSecurityRouter.delete(
  "/passkeys",
  authenticationLimiter,
  passwordConfirmationValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      if (!(await verifyUserPassword(auth.userId, req.body.password))) {
        res.status(401).json({ error: "Invalid security confirmation" });
        return;
      }
      await removePasskeys(auth.userId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.post(
  "/mfa/setup",
  authenticationLimiter,
  passwordConfirmationValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      if (!(await verifyUserPassword(auth.userId, req.body.password))) {
        res.status(401).json({ error: "Invalid security confirmation" });
        return;
      }
      res.json(await beginMfaSetup(auth.userId, auth.email));
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.post(
  "/mfa/enable",
  authenticationLimiter,
  mfaCodeValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      res.json({
        recoveryCodes: await enableMfa(auth.userId, auth.email, req.body.code),
      });
    } catch (error) {
      next(error);
    }
  },
);

async function confirmSensitiveAction(
  req: express.Request,
  res: express.Response,
) {
  const auth = getAuthenticatedUser(res);
  return (
    (await verifyUserPassword(auth.userId, req.body.password)) &&
    (await verifyMfaCode(auth.userId, auth.email, req.body.code)).valid
  );
}

accountSecurityRouter.post(
  "/mfa/recovery-codes",
  authenticationLimiter,
  accountMfaConfirmationValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      if (!(await confirmSensitiveAction(req, res))) {
        res.status(401).json({ error: "Invalid security confirmation" });
        return;
      }
      res.json({ recoveryCodes: await regenerateRecoveryCodes(auth.userId) });
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.delete(
  "/mfa",
  authenticationLimiter,
  accountMfaConfirmationValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      if (!(await confirmSensitiveAction(req, res))) {
        res.status(401).json({ error: "Invalid security confirmation" });
        return;
      }
      await disableMfa(auth.userId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.delete(
  "/sessions/:sessionId",
  sessionIdValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      if (!(await revokeSession(auth.userId, req.params.sessionId))) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if (req.params.sessionId === auth.sessionId) clearSessionCookie(res);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.post(
  "/sessions/revoke-others",
  async (_req, res, next) => {
    try {
      const auth = getAuthenticatedUser(res);
      await revokeOtherSessions(auth.userId, auth.sessionId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

accountSecurityRouter.patch(
  "/sessions/settings",
  sessionSettingsValidation,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const auth = getAuthenticatedUser(res);
      const timeoutMinutes = Number(req.body?.timeoutMinutes);
      if (
        !SESSION_IDLE_TIMEOUT_OPTIONS.includes(
          timeoutMinutes as (typeof SESSION_IDLE_TIMEOUT_OPTIONS)[number],
        )
      ) {
        res.status(400).json({ error: "Invalid session inactivity timeout" });
        return;
      }
      await updateSessionIdleTimeout(auth.userId, timeoutMinutes);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
