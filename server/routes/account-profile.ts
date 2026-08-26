import express from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "../db/client.js";
import {
  authenticate,
  getAuthenticatedUser,
} from "../middleware/authorization.js";
import {
  accountPhoneValidation,
  accountProfileValidation,
} from "../middleware/validation.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import { authenticationLimiter } from "../middleware/security.js";
import { verifyUserPassword } from "../services/auth.js";
import { mfaStatus, verifyTotpCode } from "../services/mfa.js";
import { recordSecurityEvent } from "../services/security-events.js";

export const accountProfileRouter = express.Router();
accountProfileRouter.use(authenticate);
accountProfileRouter.use(express.json({ limit: "768kb" }));

accountProfileRouter.get("/", async (_req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    const user = await db
      .selectFrom("users")
      .select(["id", "email", "phone", "name", "avatarDataUrl", "role"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

const updateProfile: RequestHandler = async (req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    await db
      .updateTable("users")
      .set({ avatarDataUrl: req.body.avatarDataUrl })
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();

    const user = await db
      .selectFrom("users")
      .select(["id", "email", "phone", "name", "avatarDataUrl", "role"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

accountProfileRouter.patch("/", accountProfileValidation, updateProfile);

accountProfileRouter.put(
  "/phone",
  authenticationLimiter,
  requireRecentFormVerification,
  accountPhoneValidation,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = getAuthenticatedUser(res);
      if (!auth.facility || auth.facility.role !== "owner") {
        res.status(403).json({
          error: "Only the facility owner can change the login phone",
          code: "FACILITY_OWNER_REQUIRED",
        });
        return;
      }
      const facilityId = auth.facility.id;
      if (!(await verifyUserPassword(auth.userId, req.body.password))) {
        res.status(401).json({
          error: "Invalid security confirmation",
          code: "SECURITY_CONFIRMATION_FAILED",
        });
        return;
      }
      const mfa = await mfaStatus(auth.userId);
      if (
        mfa.enabled &&
        (typeof req.body.totpCode !== "string" ||
          !(await verifyTotpCode(auth.userId, auth.email, req.body.totpCode)))
      ) {
        res.status(401).json({
          error: "A valid authenticator code is required",
          code: "MFA_CONFIRMATION_FAILED",
        });
        return;
      }
      const phone =
        req.body.phone.trim() === ""
          ? null
          : req.body.phone.replace(/[\s().-]/g, "");
      await db.transaction().execute(async (transaction) => {
        await transaction
          .updateTable("users")
          .set({ phone })
          .where("id", "=", auth.userId)
          .executeTakeFirstOrThrow();
        if (phone === null) {
          await transaction
            .updateTable("commercialTrials")
            .set({ showPhonePublicly: 0, updatedAt: Date.now() })
            .where("facilityId", "=", facilityId)
            .execute();
        }
      });
      await recordSecurityEvent("account_login_phone_updated", auth.userId, {
        facilityId,
        removed: phone === null,
      });
      res.json({ phone, mfaRequired: mfa.enabled });
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown };
      if (
        candidate.code === "23505" ||
        /unique constraint failed:\s*users\.phone/i.test(
          String(candidate.message ?? ""),
        )
      ) {
        next(
          Object.assign(new Error("Phone is already used by another account"), {
            statusCode: 409,
            code: "ACCOUNT_PHONE_ALREADY_IN_USE",
          }),
        );
        return;
      }
      next(error);
    }
  },
);
