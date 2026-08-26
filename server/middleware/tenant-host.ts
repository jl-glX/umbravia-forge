import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import {
  isConfiguredClientHostname,
  isTenantHostnameCandidate,
  tenantSlugFromRequest,
} from "../lib/tenant-host.js";

export interface TenantHostContext {
  facilityId: string;
  slug: string;
  name: string;
  logoDataUrl: string;
  accentColor: string;
}

export function getTenantHostContext(res: Response): TenantHostContext | null {
  return (res.locals.tenantHost as TenantHostContext | undefined) ?? null;
}

export async function resolveTenantHost(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const slug = tenantSlugFromRequest(req);
    if (!slug) {
      if (
        isTenantHostnameCandidate(req.hostname) &&
        !isConfiguredClientHostname(req.hostname)
      ) {
        if (req.path.startsWith("/api/")) {
          res.status(404).json({
            error: "The requested facility hostname is not available",
            code: "FACILITY_HOST_NOT_FOUND",
          });
          return;
        }
        res.locals.tenantHostNotFound = true;
      }
      next();
      return;
    }

    const facility = await db
      .selectFrom("facilityProfiles")
      .select(["id", "slug", "name", "logoDataUrl", "accentColor"])
      .where("slug", "=", slug)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!facility) {
      if (req.path.startsWith("/api/")) {
        res.status(404).json({
          error: "The requested facility hostname is not available",
          code: "FACILITY_HOST_NOT_FOUND",
        });
        return;
      }
      res.locals.tenantHostNotFound = true;
      next();
      return;
    }

    res.locals.tenantHost = {
      facilityId: facility.id,
      slug: facility.slug,
      name: facility.name,
      logoDataUrl: facility.logoDataUrl,
      accentColor: facility.accentColor,
    } satisfies TenantHostContext;
    next();
  } catch (error) {
    next(error);
  }
}

export function tenantHostContextEndpoint(_req: Request, res: Response): void {
  if (res.locals.tenantHostNotFound === true) {
    res.status(404).json({
      error: "The requested facility hostname is not available",
      code: "FACILITY_HOST_NOT_FOUND",
    });
    return;
  }
  const context = getTenantHostContext(res);
  if (!context) {
    res.status(204).end();
    return;
  }
  res.json({
    facility: {
      slug: context.slug,
      name: context.name,
      logoDataUrl: context.logoDataUrl,
      accentColor: context.accentColor,
    },
  });
}
