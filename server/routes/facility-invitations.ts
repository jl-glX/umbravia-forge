import express from "express";
import {
  acceptNewFacilityInvitationValidation,
  facilityInvitationTokenValidation,
} from "../middleware/validation.js";
import {
  authenticateAccountSession,
  getAuthenticatedUser,
} from "../middleware/authorization.js";
import {
  acceptExistingFacilityInvitation,
  acceptNewFacilityInvitation,
  declineFacilityInvitation,
  inspectFacilityInvitation,
  FacilityInvitationError,
  type InvitationLocale,
} from "../services/facility-invitations.js";

export const facilityInvitationsRouter = express.Router();

function sendInvitationError(error: unknown, res: express.Response): void {
  if (error instanceof FacilityInvitationError) {
    res.status(error.httpStatus).json({ error: error.code, code: error.code });
    return;
  }
  console.error("Error processing facility invitation:", error);
  res.status(500).json({
    error: "FACILITY_INVITATION_OPERATION_FAILED",
    code: "FACILITY_INVITATION_OPERATION_FAILED",
  });
}

facilityInvitationsRouter.get(
  "/:token",
  facilityInvitationTokenValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(await inspectFacilityInvitation(req.params.token));
    } catch (error) {
      sendInvitationError(error, res);
    }
  },
);

facilityInvitationsRouter.post(
  "/:token/accept-new",
  acceptNewFacilityInvitationValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      res.status(201).json(
        await acceptNewFacilityInvitation(req.params.token, {
          password: req.body.password,
          locale: req.body.locale as InvitationLocale,
          acceptedTerms: req.body.acceptedTerms,
          acceptedPrivacy: req.body.acceptedPrivacy,
        }),
      );
    } catch (error) {
      sendInvitationError(error, res);
    }
  },
);

facilityInvitationsRouter.post(
  "/:token/accept-existing",
  facilityInvitationTokenValidation,
  authenticateAccountSession,
  async (req: express.Request, res: express.Response) => {
    try {
      const auth = getAuthenticatedUser(res);
      await acceptExistingFacilityInvitation(
        req.params.token,
        auth.userId,
        auth.email,
      );
      res.status(204).end();
    } catch (error) {
      sendInvitationError(error, res);
    }
  },
);

facilityInvitationsRouter.post(
  "/:token/decline",
  facilityInvitationTokenValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      await declineFacilityInvitation(req.params.token);
      res.status(204).end();
    } catch (error) {
      sendInvitationError(error, res);
    }
  },
);
