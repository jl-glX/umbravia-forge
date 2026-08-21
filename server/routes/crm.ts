import express from "express";
import type {
  CrmFollowUpKind,
  CrmFollowUpStatus,
  CrmMemberSegment,
} from "../db/types.js";
import {
  authenticate,
  getAuthenticatedUser,
  getFacilityContext,
  requireFacility,
  selectFacilityContext,
} from "../middleware/authorization.js";
import {
  CrmError,
  createCrmFollowUp,
  getCrmWorkspace,
  updateCrmFollowUp,
  updateCrmMemberProfile,
} from "../services/crm.js";
import { requireCommercialCapability } from "../middleware/commercial-capability.js";
import {
  crmFollowUpCreateValidation,
  crmFollowUpUpdateValidation,
  crmMemberProfileValidation,
  emptyRequestValidation,
} from "../middleware/validation.js";

export const crmRouter = express.Router();
crmRouter.use(
  authenticate,
  selectFacilityContext,
  requireFacility("owner", "admin"),
);
crmRouter.use(requireCommercialCapability("crm"));

function handleCrmError(error: unknown, res: express.Response): void {
  if (error instanceof CrmError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  console.error("Error processing CRM request:", error);
  res.status(500).json({
    error: "Failed to process CRM request",
    code: "CRM_REQUEST_FAILED",
  });
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" ? value : Number.NaN;
}

crmRouter.get(
  "/workspace",
  emptyRequestValidation,
  async (_req: express.Request, res: express.Response) => {
    try {
      res.json(await getCrmWorkspace(getFacilityContext(res).id));
    } catch (error) {
      handleCrmError(error, res);
    }
  },
);

crmRouter.patch(
  "/members/:memberUserId",
  crmMemberProfileValidation,
  async (req: express.Request, res: express.Response) => {
    const body = req.body as {
      manualSegment?: CrmMemberSegment | null;
      assignedToUserId?: string | null;
      nextFollowUpAt?: number | null;
    };
    try {
      res.json(
        await updateCrmMemberProfile({
          facilityId: getFacilityContext(res).id,
          memberUserId: req.params.memberUserId,
          updatedByUserId: getAuthenticatedUser(res).userId,
          manualSegment: body.manualSegment ?? null,
          assignedToUserId: optionalString(body.assignedToUserId),
          nextFollowUpAt: optionalTimestamp(body.nextFollowUpAt),
        }),
      );
    } catch (error) {
      handleCrmError(error, res);
    }
  },
);

crmRouter.post(
  "/follow-ups",
  crmFollowUpCreateValidation,
  async (req: express.Request, res: express.Response) => {
    const body = req.body as {
      memberUserId?: string;
      assignedToUserId?: string | null;
      kind?: CrmFollowUpKind;
      dueAt?: number;
    };
    try {
      res.status(201).json(
        await createCrmFollowUp({
          facilityId: getFacilityContext(res).id,
          memberUserId: body.memberUserId ?? "",
          assignedToUserId: optionalString(body.assignedToUserId),
          kind: body.kind as CrmFollowUpKind,
          dueAt: body.dueAt as number,
          createdByUserId: getAuthenticatedUser(res).userId,
        }),
      );
    } catch (error) {
      handleCrmError(error, res);
    }
  },
);

crmRouter.patch(
  "/follow-ups/:followUpId",
  crmFollowUpUpdateValidation,
  async (req: express.Request, res: express.Response) => {
    const body = req.body as {
      assignedToUserId?: string | null;
      status?: CrmFollowUpStatus;
      dueAt?: number;
    };
    try {
      res.json(
        await updateCrmFollowUp({
          facilityId: getFacilityContext(res).id,
          followUpId: req.params.followUpId,
          assignedToUserId: optionalString(body.assignedToUserId),
          status: body.status as CrmFollowUpStatus,
          dueAt: body.dueAt as number,
        }),
      );
    } catch (error) {
      handleCrmError(error, res);
    }
  },
);
