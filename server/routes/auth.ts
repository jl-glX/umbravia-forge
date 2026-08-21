import express from "express";
import {
  completeMfaLogin,
  login,
  logout,
  logoutAll,
  signup,
} from "../services/auth.js";
import {
  authenticationLimiter,
  accountRecoveryLimiter,
  emailVerificationLimiter,
  loginLimiter,
  signupLimiter,
} from "../middleware/security.js";
import {
  loginValidation,
  mfaCodeValidation,
  passkeyAuthenticationOptionsValidation,
  passkeyResponseValidation,
  signupValidation,
  emailVerificationValidation,
  accountRecoveryRequestValidation,
  accountRecoveryResetValidation,
} from "../middleware/validation.js";
import {
  authenticate,
  authenticateAccountSession,
  getAuthenticatedUser,
  selectFacilityContext,
} from "../middleware/authorization.js";
import {
  clearSessionCookie,
  clearMfaChallengeCookie,
  clearPasskeyChallengeCookie,
  readMfaChallengeToken,
  readPasskeyChallengeToken,
  readSessionToken,
  setMfaChallengeCookie,
  setPasskeyChallengeCookie,
  setSessionCookie,
} from "../lib/session-cookie.js";
import {
  beginPasskeyAuthentication,
  finishPasskeyAuthentication,
} from "../services/passkeys.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getWebauthnContext } from "../lib/request-origin.js";
import {
  createEmailVerificationChallenge,
  discardPendingSignup,
  getPendingEmailVerificationProfile,
  verifyEmailCode,
} from "../services/email-verification.js";
import {
  deliverQueuedEmail,
  queueEmailVerificationCode,
} from "../services/email-delivery.js";
import { requireCaptcha } from "../middleware/captcha.js";
import { captchaIsConfigured } from "../services/captcha.js";
import {
  AccountRecoveryPasswordReusedError,
  getRecoveryCapabilities,
  getRecoveryLookupMethods,
  requestPasswordRecovery,
  resetPasswordWithRecoveryCode,
} from "../services/account-recovery.js";
import { observeSecurityRisk } from "../middleware/security-risk.js";
import {
  getFormVerificationStatus,
  markFormSessionVerified,
} from "../services/form-verification.js";
import { emailVerificationIsEnabled } from "../lib/account-verification-mode.js";
import { ManagerCoordinationConflictError } from "../services/manager-coordinator.js";
import { listFacilityContexts } from "../services/facility-context.js";
import { finalizeAdministratorSignup } from "../services/commercial-trial.js";
import { commercialTrialProvisioningIsEnabled } from "../lib/commercial-trial.js";

export const authRouter = express.Router();

function requireAdministratorProvisioningEnabled(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (
    req.body?.accountType === "administrator" &&
    !commercialTrialProvisioningIsEnabled()
  ) {
    res.status(503).json({
      error: "Commercial trial provisioning is not enabled",
      code: "COMMERCIAL_TRIALS_DISABLED",
    });
    return;
  }
  next();
}

authRouter.get("/captcha-status", (_req, res) => {
  res.json({
    available: captchaIsConfigured(),
    provider: "cloudflare_turnstile",
    execution: "manual",
    browserVerification: true,
    serverValidation: true,
  });
});

authRouter.get(
  "/form-verification",
  authenticateAccountSession,
  async (_req, res, next) => {
    try {
      const { sessionId } = getAuthenticatedUser(res);
      res.json(await getFormVerificationStatus(sessionId));
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/form-verification",
  authenticateAccountSession,
  requireCaptcha("form_access"),
  async (_req, res, next) => {
    try {
      const { sessionId, userId } = getAuthenticatedUser(res);
      res.json(await markFormSessionVerified(sessionId, userId));
    } catch (error) {
      next(error);
    }
  },
);

authRouter.get("/recovery/capabilities", (_req, res) => {
  res.json({
    methods: getRecoveryCapabilities(),
    lookupMethods: getRecoveryLookupMethods(),
  });
});

authRouter.post(
  "/recovery/request",
  accountRecoveryLimiter,
  observeSecurityRisk("account_recovery_request"),
  accountRecoveryRequestValidation,
  requireCaptcha("recovery"),
  async (req: express.Request, res: express.Response) => {
    try {
      const result = await requestPasswordRecovery(
        req.body.method,
        req.body.identifier,
      );
      if (result.deliveryId) {
        setImmediate(() => {
          void deliverQueuedEmail(result.deliveryId!).catch(() => {
            // The transactional queue retains the message for a managed retry.
          });
        });
      }
    } catch {
      // Account existence and delivery state are intentionally not disclosed.
    }
    res.status(202).json({ accepted: true });
  },
);

authRouter.post(
  "/recovery/reset-password",
  accountRecoveryLimiter,
  observeSecurityRisk("account_recovery_reset"),
  accountRecoveryResetValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      const reset = await resetPasswordWithRecoveryCode({
        method: req.body.method,
        identifier: req.body.identifier,
        code: req.body.code,
        newPassword: req.body.newPassword,
      });
      if (!reset) {
        res.status(400).json({
          code: "ACCOUNT_RECOVERY_INVALID",
          error: "Invalid or expired recovery code",
        });
        return;
      }
      clearSessionCookie(res);
      clearMfaChallengeCookie(res);
      clearPasskeyChallengeCookie(res);
      res.json({ recovered: true });
    } catch (error) {
      if (error instanceof AccountRecoveryPasswordReusedError) {
        res.status(409).json({
          code: error.code,
          error: error.message,
        });
        return;
      }
      if (error instanceof ManagerCoordinationConflictError) {
        res.status(409).json({
          code: "ACCOUNT_RECOVERY_BUSY",
          error: "Account recovery is temporarily busy. Try again shortly.",
        });
        return;
      }
      res.status(400).json({
        code: "ACCOUNT_RECOVERY_INVALID",
        error:
          error instanceof Error
            ? error.message
            : "Account recovery could not be completed",
      });
    }
  },
);

authRouter.post(
  "/signup",
  signupLimiter,
  observeSecurityRisk("signup"),
  signupValidation,
  requireAdministratorProvisioningEnabled,
  requireCaptcha("signup"),
  async (req: express.Request, res: express.Response) => {
    let createdUserId: string | null = null;
    try {
      const requireEmailVerification = emailVerificationIsEnabled();
      const {
        email,
        name,
        lastName,
        password,
        countryCode,
        locale,
        acceptedTerms,
        acceptedPrivacy,
        accountType,
        facilityName,
        facilityType,
      } = req.body;
      const { sessionToken, user } = await signup(
        email,
        name,
        password,
        { userAgent: req.get("User-Agent") },
        {
          lastName,
          countryCode,
          locale,
          acceptedTerms,
          acceptedPrivacy,
          accountType,
          facilityName,
          facilityType,
        },
        { requireEmailVerification },
      );
      createdUserId = user.id;
      if (!requireEmailVerification && accountType === "administrator") {
        await finalizeAdministratorSignup(user.id);
      }
      let verificationCode: string | undefined;
      let verificationEmailSent = false;
      if (requireEmailVerification) {
        const challenge = await createEmailVerificationChallenge(user.id);
        verificationCode = challenge.code;
        const deliveryId = await queueEmailVerificationCode({
          userId: user.id,
          email: user.email,
          name: user.name,
          code: challenge.code,
          locale,
          expiresAt: challenge.expiresAt,
        });
        verificationEmailSent = await deliverQueuedEmail(deliveryId);
      }
      setSessionCookie(res, sessionToken);
      res.status(201).json({
        user,
        verificationRequired: requireEmailVerification,
        verificationEmailSent,
        activationMethod: requireEmailVerification ? "email" : "development",
        demoVerificationCode:
          requireEmailVerification && process.env.NODE_ENV !== "production"
            ? verificationCode
            : undefined,
      });
    } catch (error) {
      if (createdUserId) {
        try {
          await discardPendingSignup(createdUserId);
        } catch {
          console.error("[Auth] Incomplete signup cleanup failed");
        }
      }
      console.error("[Auth] Signup failed");
      res.status(400).json({
        error: error instanceof Error ? error.message : "Signup failed",
      });
    }
  },
);

authRouter.post(
  "/resend-verification",
  authenticateAccountSession,
  emailVerificationLimiter,
  async (_req: express.Request, res: express.Response) => {
    if (!emailVerificationIsEnabled()) {
      res.status(410).json({
        code: "EMAIL_VERIFICATION_DISABLED",
        error: "Email verification is temporarily disabled",
      });
      return;
    }
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
        ...profile,
        code: challenge.code,
        expiresAt: challenge.expiresAt,
      });
      const delivered = await deliverQueuedEmail(deliveryId);
      res.status(202).json({
        sent: delivered,
        queued: !delivered,
        demoVerificationCode:
          process.env.NODE_ENV === "production" ? undefined : challenge.code,
      });
    } catch (_error) {
      res.status(500).json({
        code: "EMAIL_VERIFICATION_FAILED",
        error: "Verification email could not be prepared.",
      });
    }
  },
);

authRouter.post(
  "/verify-email",
  authenticateAccountSession,
  authenticationLimiter,
  emailVerificationValidation,
  async (req: express.Request, res: express.Response) => {
    if (!emailVerificationIsEnabled()) {
      res.status(410).json({
        code: "EMAIL_VERIFICATION_DISABLED",
        error: "Email verification is temporarily disabled",
      });
      return;
    }
    const auth = getAuthenticatedUser(res);
    if (!(await verifyEmailCode(auth.userId, req.body.code))) {
      res.status(400).json({ error: "Invalid or expired verification code" });
      return;
    }
    res.json({ verified: true });
  },
);

authRouter.post(
  "/login",
  loginLimiter,
  observeSecurityRisk("password_login"),
  loginValidation,
  requireCaptcha("login"),
  async (req: express.Request, res: express.Response) => {
    try {
      const { identifier, password, accessPortal, rememberDevice } = req.body;
      const result = await login(
        identifier,
        password,
        accessPortal,
        Boolean(rememberDevice),
        { userAgent: req.get("User-Agent") },
      );
      if ("challengeToken" in result) {
        setMfaChallengeCookie(res, result.challengeToken);
        res.status(200).json({ mfaRequired: true });
        return;
      }

      setSessionCookie(res, result.sessionToken, result.rememberDevice);
      res.status(200).json({ user: result.user, mfaRequired: false });
    } catch {
      res.status(401).json({
        code: "INVALID_CREDENTIALS",
        error: "Invalid email or password",
      });
    }
  },
);

authRouter.post(
  "/passkey/options",
  authenticationLimiter,
  observeSecurityRisk("passkey_options"),
  passkeyAuthenticationOptionsValidation,
  requireCaptcha("login"),
  async (req: express.Request, res: express.Response) => {
    try {
      const { identifier, accessPortal, rememberDevice } = req.body;
      const { rpID } = getWebauthnContext(req);
      const result = await beginPasskeyAuthentication(
        identifier,
        accessPortal,
        Boolean(rememberDevice),
        rpID,
      );
      setPasskeyChallengeCookie(res, result.token);
      res.json(result.options);
    } catch {
      res.status(401).json({
        code: "PASSKEY_NOT_CONFIGURED",
        error: "Passkey access is not available",
      });
    }
  },
);

authRouter.post(
  "/passkey/verify",
  authenticationLimiter,
  passkeyResponseValidation,
  async (req: express.Request, res: express.Response) => {
    const challengeToken = readPasskeyChallengeToken(req);
    if (!challengeToken) {
      res.status(401).json({
        code: "PASSKEY_CHALLENGE_INVALID",
        error: "Invalid or expired passkey challenge",
      });
      return;
    }
    try {
      const { origin, rpID } = getWebauthnContext(req);
      const result = await finishPasskeyAuthentication(
        challengeToken,
        req.body.response as AuthenticationResponseJSON,
        origin,
        rpID,
        "member",
        { userAgent: req.get("User-Agent") },
      );
      clearPasskeyChallengeCookie(res);
      setSessionCookie(res, result.sessionToken, result.rememberDevice);
      res.json({ user: result.user });
    } catch {
      clearPasskeyChallengeCookie(res);
      res.status(401).json({
        code: "PASSKEY_VERIFICATION_FAILED",
        error: "Passkey verification failed",
      });
    }
  },
);

authRouter.post(
  "/mfa/verify",
  authenticationLimiter,
  mfaCodeValidation,
  async (req: express.Request, res: express.Response) => {
    const challengeToken = readMfaChallengeToken(req);
    if (!challengeToken) {
      res
        .status(401)
        .json({ error: "Invalid or expired verification challenge" });
      return;
    }

    try {
      const { sessionToken, user, rememberDevice } = await completeMfaLogin(
        challengeToken,
        req.body.code,
        { userAgent: req.get("User-Agent") },
      );
      clearMfaChallengeCookie(res);
      setSessionCookie(res, sessionToken, rememberDevice);
      res.status(200).json({ user });
    } catch {
      res.status(401).json({ error: "Invalid verification code" });
    }
  },
);

authRouter.get(
  "/session",
  authenticateAccountSession,
  selectFacilityContext,
  (_req: express.Request, res: express.Response) => {
    const session = getAuthenticatedUser(res);
    res.json({
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
        avatarDataUrl: session.avatarDataUrl,
        role: session.role,
        accountStatus: session.accountStatus,
        identityRealm: session.identityRealm,
        facility: session.facility,
        platformOperator: session.platformOperator,
      },
    });
  },
);

authRouter.get(
  "/facilities",
  authenticateAccountSession,
  async (_req: express.Request, res: express.Response, next) => {
    try {
      res.json({
        facilities: await listFacilityContexts(
          getAuthenticatedUser(res).userId,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/logout",
  authenticateAccountSession,
  async (req: express.Request, res: express.Response) => {
    const token = readSessionToken(req);
    if (token) {
      await logout(token);
    }
    clearSessionCookie(res);
    res.json({ message: "Logged out successfully" });
  },
);

authRouter.post(
  "/logout-all",
  authenticate,
  async (_req: express.Request, res: express.Response) => {
    await logoutAll(getAuthenticatedUser(res).userId);
    clearSessionCookie(res);
    res.json({ message: "All sessions revoked" });
  },
);
