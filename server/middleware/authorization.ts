import { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import { verifyToken } from "../services/auth.js";
import {
  readSessionToken,
  readSupportSessionToken,
} from "../lib/session-cookie.js";
import { hasActiveBookingDelegation } from "../services/delegations.js";
import type { FacilityRole } from "../db/types.js";
import {
  FacilityAccessDeniedError,
  resolveFacilityContext,
} from "../services/facility-context.js";

export type UserRole = "member" | "trainer" | "admin";

export interface AuthenticatedUser {
  sessionId: string;
  createdAt: number;
  userId: string;
  email: string;
  name: string;
  avatarDataUrl: string;
  role: UserRole;
  accountStatus: "pending_verification" | "active" | "security_review";
  identityRealm: "commercial" | "corporate_support";
  facility: {
    id: string;
    slug: string;
    name: string;
    role: FacilityRole;
  } | null;
  platformOperator?: boolean;
}

function unauthorized(res: Response, message = "Authentication required") {
  res.status(401).json({ error: message, code: "UNAUTHENTICATED" });
}

function forbidden(
  res: Response,
  message = "You do not have permission to perform this action",
  code = "FORBIDDEN",
) {
  res.status(403).json({ error: message, code });
}

function facilityMembershipRequired(res: Response) {
  forbidden(
    res,
    "An active facility membership is required",
    "FACILITY_MEMBERSHIP_REQUIRED",
  );
}

export function getAuthenticatedUser(res: Response): AuthenticatedUser {
  return res.locals.auth as AuthenticatedUser;
}

async function authenticateSession(
  req: Request,
  res: Response,
  next: NextFunction,
  allowInactive: boolean,
  identityRealm: "commercial" | "corporate_support",
): Promise<void> {
  const token =
    identityRealm === "corporate_support"
      ? readSupportSessionToken(req)
      : readSessionToken(req);
  if (!token) {
    unauthorized(res);
    return;
  }

  try {
    const session = await verifyToken(token);
    if (!session) {
      unauthorized(res, "Invalid or expired session");
      return;
    }

    if (session.identityRealm !== identityRealm) {
      unauthorized(res, "Session belongs to a different application realm");
      return;
    }

    res.locals.auth = session;
    if (!allowInactive && session.accountStatus !== "active") {
      res.status(403).json({
        error: "Account activation or security review is required",
        code: "ACCOUNT_NOT_ACTIVE",
      });
      return;
    }
    next();
  } catch (error) {
    if (error instanceof FacilityAccessDeniedError) {
      forbidden(res, error.message);
      return;
    }
    next(error);
  }
}

export async function selectFacilityContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getAuthenticatedUser(res);
    const requestedFacilityId = req.get("X-Facility-Id");
    if (requestedFacilityId !== undefined) {
      auth.facility = await resolveFacilityContext(
        auth.userId,
        requestedFacilityId,
      );
    }
    next();
  } catch (error) {
    if (error instanceof FacilityAccessDeniedError) {
      forbidden(res, error.message);
      return;
    }
    next(error);
  }
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return authenticateSession(req, res, next, false, "commercial");
}

export function authenticateAccountSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return authenticateSession(req, res, next, true, "commercial");
}

export function authenticateCorporateSupport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return authenticateSession(req, res, next, false, "corporate_support");
}

export function requireRole(...roles: UserRole[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const auth = getAuthenticatedUser(res);
    if (!roles.includes(auth.role)) {
      forbidden(res);
      return;
    }
    next();
  };
}

export async function requirePlatformOperator(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getAuthenticatedUser(res);
    if (!auth.platformOperator) {
      forbidden(res, "Platform operator access is required");
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function getFacilityContext(res: Response) {
  const facility = getAuthenticatedUser(res).facility;
  if (!facility) throw new FacilityAccessDeniedError();
  return facility;
}

export function requireFacility(...roles: FacilityRole[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const facility = getAuthenticatedUser(res).facility;
    if (!facility) {
      facilityMembershipRequired(res);
      return;
    }
    if (roles.length > 0 && !roles.includes(facility.role)) {
      forbidden(res);
      return;
    }
    next();
  };
}

export function requireSelfParamOrRole(
  paramName: string,
  ...roles: UserRole[]
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = getAuthenticatedUser(res);
    if (req.params[paramName] !== auth.userId && !roles.includes(auth.role)) {
      forbidden(res);
      return;
    }
    next();
  };
}

export function requireSelfParamOrFacilityRole(
  paramName: string,
  ...roles: FacilityRole[]
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = getAuthenticatedUser(res);
    if (
      req.params[paramName] !== auth.userId &&
      (!auth.facility || !roles.includes(auth.facility.role))
    ) {
      forbidden(res);
      return;
    }
    next();
  };
}

export function requireClassFacility(classParamName: string) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const facility = getAuthenticatedUser(res).facility;
      if (!facility) {
        facilityMembershipRequired(res);
        return;
      }
      const activitySession = await db
        .selectFrom("activitySessions")
        .select("id")
        .where("id", "=", req.params[classParamName])
        .where("facilityId", "=", facility.id)
        .executeTakeFirst();
      if (!activitySession) {
        forbidden(res);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireSelfBodyOrRole(bodyName: string, ...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = getAuthenticatedUser(res);
    if (req.body?.[bodyName] !== auth.userId && !roles.includes(auth.role)) {
      forbidden(res);
      return;
    }
    next();
  };
}

export function requireSelfBodyOrFacilityRole(
  bodyName: string,
  ...roles: FacilityRole[]
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = getAuthenticatedUser(res);
    if (
      req.body?.[bodyName] !== auth.userId &&
      (!auth.facility || !roles.includes(auth.facility.role))
    ) {
      forbidden(res);
      return;
    }
    next();
  };
}

export function requireBookingFacility(bookingParamName: string) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const facility = getAuthenticatedUser(res).facility;
      if (!facility) {
        facilityMembershipRequired(res);
        return;
      }
      const booking = await db
        .selectFrom("bookings")
        .innerJoin(
          "activitySessions",
          "bookings.activitySessionId",
          "activitySessions.id",
        )
        .select("bookings.id")
        .where("bookings.id", "=", req.params[bookingParamName])
        .where("activitySessions.facilityId", "=", facility.id)
        .executeTakeFirst();
      if (!booking) {
        forbidden(res);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireSelfRoleOrBookingDelegation(
  bodyName: string,
  ...roles: UserRole[]
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const auth = getAuthenticatedUser(res);
      const ownerUserId = req.body?.[bodyName];
      if (
        ownerUserId === auth.userId ||
        roles.includes(auth.role) ||
        (typeof ownerUserId === "string" &&
          (await hasActiveBookingDelegation(auth.userId, ownerUserId)))
      ) {
        next();
        return;
      }
      forbidden(res);
    } catch (error) {
      next(error);
    }
  };
}

export function requireSelfFacilityRoleOrBookingDelegation(
  bodyName: string,
  ...roles: FacilityRole[]
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const auth = getAuthenticatedUser(res);
      const ownerUserId = req.body?.[bodyName];
      if (
        ownerUserId === auth.userId ||
        (auth.facility && roles.includes(auth.facility.role)) ||
        (typeof ownerUserId === "string" &&
          (await hasActiveBookingDelegation(auth.userId, ownerUserId)))
      ) {
        next();
        return;
      }
      forbidden(res);
    } catch (error) {
      next(error);
    }
  };
}

export function requireTrainerClassOrRole(
  classParamName: string,
  ...roles: UserRole[]
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const auth = getAuthenticatedUser(res);
      const facility = auth.facility;
      if (!facility) {
        facilityMembershipRequired(res);
        return;
      }
      if (
        roles.includes("admin") &&
        (facility.role === "owner" || facility.role === "admin")
      ) {
        next();
        return;
      }

      if (facility.role !== "trainer") {
        forbidden(res);
        return;
      }

      const activitySession = await db
        .selectFrom("activitySessions")
        .select("trainerId")
        .where("id", "=", req.params[classParamName])
        .where("facilityId", "=", facility.id)
        .executeTakeFirst();

      if (!activitySession || activitySession.trainerId !== auth.userId) {
        forbidden(res);
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireTrainerBookingOrRole(
  bookingParamName: string,
  ...roles: UserRole[]
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const auth = getAuthenticatedUser(res);
      const facility = auth.facility;
      if (!facility) {
        facilityMembershipRequired(res);
        return;
      }
      if (
        roles.includes("admin") &&
        (facility.role === "owner" || facility.role === "admin")
      ) {
        next();
        return;
      }
      if (facility.role !== "trainer") {
        forbidden(res);
        return;
      }
      const booking = await db
        .selectFrom("bookings")
        .innerJoin(
          "activitySessions",
          "bookings.activitySessionId",
          "activitySessions.id",
        )
        .select("activitySessions.trainerId")
        .where("bookings.id", "=", req.params[bookingParamName])
        .where("activitySessions.facilityId", "=", facility.id)
        .executeTakeFirst();
      if (!booking || booking.trainerId !== auth.userId) {
        forbidden(res);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
