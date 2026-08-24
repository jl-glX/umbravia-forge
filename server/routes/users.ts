import express from "express";
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  removeUserFromFacility,
  removeMultipleUsersFromFacility,
  updateUserRole,
  UserDeletionBlockedError,
} from "../services/users.js";
import {
  bulkDeleteUsersValidation,
  createUserValidation,
  createFacilityInvitationValidation,
  updateRoleValidation,
  updateUserValidation,
  validateId,
} from "../middleware/validation.js";
import {
  authenticate,
  getFacilityContext,
  getAuthenticatedUser,
  requireFacility,
  selectFacilityContext,
} from "../middleware/authorization.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";
import {
  createFacilityInvitation,
  listFacilityInvitations,
  publicInvitationTokenForTest,
  revokeFacilityInvitation,
  FacilityInvitationError,
  type InvitationLocale,
} from "../services/facility-invitations.js";
import {
  deliverQueuedEmail,
  queueFacilityInvitationEmail,
} from "../services/email-delivery.js";

export const usersRouter = express.Router();
usersRouter.use(
  authenticate,
  selectFacilityContext,
  requireFacility("owner", "admin"),
);
usersRouter.use(requireRecentFormVerification);

function sendDeletionError(error: unknown, res: express.Response): void {
  if (error instanceof UserDeletionBlockedError) {
    res.status(409).json({
      error:
        "This account has records that require retention or ownership review before deletion",
      code: "USER_DELETION_REQUIRES_REVIEW",
      blockers: error.blockers,
    });
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error("Error deleting users:", error);
  res.status(400).json({ error: message });
}

function sendInvitationError(error: unknown, res: express.Response): void {
  if (error instanceof FacilityInvitationError) {
    res.status(error.httpStatus).json({ error: error.code, code: error.code });
    return;
  }
  console.error("Error managing facility invitation:", error);
  res.status(500).json({
    error: "FACILITY_INVITATION_OPERATION_FAILED",
    code: "FACILITY_INVITATION_OPERATION_FAILED",
  });
}

// Get all users
usersRouter.get("/", async (req: express.Request, res: express.Response) => {
  try {
    const users = await getAllUsers(getFacilityContext(res).id);
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Test-only compatibility path. Production staff onboarding must always use a
// recipient-controlled invitation; an administrator may never choose another
// person's password or mark their mailbox as verified.
usersRouter.post(
  "/",
  createUserValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      if (
        process.env.NODE_ENV !== "test" ||
        req.body.verificationMode !== "test_bypass"
      ) {
        res.status(404).json({
          error: "Use the verified facility invitation workflow",
          code: "FACILITY_INVITATION_REQUIRED",
        });
        return;
      }
      const { email, name, password, role } = req.body;

      const user = await createUser(
        email,
        name,
        password,
        getFacilityContext(res).id,
        role || "member",
      );
      res.status(201).json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error creating user:", error);
      res.status(400).json({ error: message });
    }
  },
);

usersRouter.get(
  "/invitations",
  async (_req: express.Request, res: express.Response) => {
    try {
      res.json(await listFacilityInvitations(getFacilityContext(res).id));
    } catch (error) {
      sendInvitationError(error, res);
    }
  },
);

// Get user by ID. Keep this parameter route after named collection routes so
// that "invitations" cannot be interpreted as a user identifier.
usersRouter.get(
  "/:id",
  validateId("id"),
  async (req: express.Request, res: express.Response) => {
    try {
      const user = await getUserById(req.params.id, getFacilityContext(res).id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  },
);

usersRouter.post(
  "/invitations",
  createFacilityInvitationValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      const auth = getAuthenticatedUser(res);
      const { invitation, token } = await createFacilityInvitation({
        facilityId: getFacilityContext(res).id,
        invitedByUserId: auth.userId,
        email: req.body.email,
        name: req.body.name,
        role: req.body.role,
      });
      let deliveryQueued = false;
      try {
        const deliveryId = await queueFacilityInvitationEmail({
          email: invitation.invitedEmail,
          name: invitation.invitedName,
          facilityName: invitation.facilityName,
          role: invitation.role,
          token,
          locale: req.body.locale as InvitationLocale,
          expiresAt: invitation.expiresAt,
        });
        deliveryQueued = true;
        void deliverQueuedEmail(deliveryId).catch(() => {
          // The encrypted queue keeps the message for the normal retry worker.
        });
      } catch (error) {
        console.error("Facility invitation email could not be queued:", error);
      }
      res.status(201).json({
        ...invitation,
        deliveryQueued,
        testToken: publicInvitationTokenForTest(token),
      });
    } catch (error) {
      sendInvitationError(error, res);
    }
  },
);

usersRouter.post(
  "/invitations/:id/revoke",
  validateId("id"),
  async (req: express.Request, res: express.Response) => {
    try {
      await revokeFacilityInvitation(req.params.id, getFacilityContext(res).id);
      res.status(204).end();
    } catch (error) {
      sendInvitationError(error, res);
    }
  },
);

// Update user
usersRouter.put(
  "/:id",
  updateUserValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      const { email, name, password, role } = req.body;
      const auth = getAuthenticatedUser(res);
      if (req.params.id === auth.userId && role && role !== "admin") {
        res.status(400).json({
          error: "You cannot remove your own administrator role",
          code: "ADMIN_SELF_ROLE_CHANGE",
        });
        return;
      }

      const user = await updateUser(req.params.id, getFacilityContext(res).id, {
        email,
        name,
        password,
        role,
      });
      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error updating user:", error);
      res.status(400).json({ error: message });
    }
  },
);

// Update user role
usersRouter.patch(
  "/:id/role",
  updateRoleValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      const { role } = req.body;
      const auth = getAuthenticatedUser(res);

      if (!role || !["member", "trainer", "admin"].includes(role)) {
        res.status(400).json({ error: "Invalid role" });
        return;
      }
      if (req.params.id === auth.userId && role !== "admin") {
        res.status(400).json({
          error: "You cannot remove your own administrator role",
          code: "ADMIN_SELF_ROLE_CHANGE",
        });
        return;
      }

      const user = await updateUserRole(
        req.params.id,
        getFacilityContext(res).id,
        role,
      );
      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error updating user role:", error);
      res.status(400).json({ error: message });
    }
  },
);

// Delete user
usersRouter.delete(
  "/:id",
  validateId("id"),
  async (req: express.Request, res: express.Response) => {
    try {
      if (req.params.id === getAuthenticatedUser(res).userId) {
        res.status(400).json({
          error: "You cannot delete your active administrator account",
          code: "ADMIN_SELF_DELETE",
        });
        return;
      }
      await removeUserFromFacility(req.params.id, getFacilityContext(res).id);
      res.json({ message: "User removed from the facility successfully" });
    } catch (error) {
      sendDeletionError(error, res);
    }
  },
);

// Delete multiple users
usersRouter.post(
  "/bulk/delete",
  bulkDeleteUsersValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      const { userIds } = req.body;
      const auth = getAuthenticatedUser(res);

      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: "Invalid userIds array" });
        return;
      }
      if (userIds.includes(auth.userId)) {
        res.status(400).json({
          error:
            "Bulk deletion cannot include your active administrator account",
          code: "ADMIN_SELF_DELETE",
        });
        return;
      }

      await removeMultipleUsersFromFacility(
        userIds,
        getFacilityContext(res).id,
      );
      res.json({
        message: `Removed ${userIds.length} users from the facility`,
      });
    } catch (error) {
      sendDeletionError(error, res);
    }
  },
);
