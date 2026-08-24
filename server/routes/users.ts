import express from "express";
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  removeUserFromFacility,
  removeMultipleUsersFromFacility,
  updateUserWorkforceRoles,
  UserDeletionBlockedError,
} from "../services/users.js";
import {
  bulkDeleteUsersValidation,
  createUserValidation,
  createFacilityInvitationValidation,
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
import {
  facilityClassPermissions,
  updateFacilityClassPermissions,
  type FacilityPermissionEffect,
} from "../services/facility-class-permissions.js";
import {
  FacilityMemberAffiliationPolicyError,
  getFacilityMemberAffiliationPolicy,
  updateFacilityMemberAffiliationPolicy,
} from "../services/facility-member-affiliations.js";
import { recordSecurityEvent } from "../services/security-events.js";

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

usersRouter.get(
  "/member-affiliation-policy",
  async (_req: express.Request, res: express.Response) => {
    try {
      res.json(
        await getFacilityMemberAffiliationPolicy(getFacilityContext(res).id),
      );
    } catch (error) {
      console.error("Error fetching member affiliation policy:", error);
      res.status(500).json({
        error: "Failed to fetch member affiliation policy",
        code: "MEMBER_AFFILIATION_POLICY_LOAD_FAILED",
      });
    }
  },
);

usersRouter.put(
  "/member-affiliation-policy",
  async (req: express.Request, res: express.Response) => {
    const facility = getFacilityContext(res);
    if (facility.role !== "owner") {
      res.status(403).json({
        error: "Only the facility owner can manage staff member affiliations",
        code: "FACILITY_OWNER_REQUIRED",
      });
      return;
    }
    const keys = Object.keys(req.body ?? {});
    const specificallyAllowedUserIds = req.body?.specificallyAllowedUserIds;
    if (
      keys.some(
        (key) =>
          key !== "allowAllStaff" && key !== "specificallyAllowedUserIds",
      ) ||
      typeof req.body?.allowAllStaff !== "boolean" ||
      !Array.isArray(specificallyAllowedUserIds) ||
      specificallyAllowedUserIds.length > 200 ||
      specificallyAllowedUserIds.some(
        (userId: unknown) =>
          typeof userId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(userId),
      )
    ) {
      res.status(400).json({
        error: "Member affiliation policy is invalid",
        code: "MEMBER_AFFILIATION_POLICY_INVALID",
      });
      return;
    }
    try {
      const policy = await updateFacilityMemberAffiliationPolicy(
        facility.id,
        req.body.allowAllStaff,
        specificallyAllowedUserIds,
      );
      await recordSecurityEvent(
        "facility_member_affiliation_policy_updated",
        getAuthenticatedUser(res).userId,
        {
          facilityId: facility.id,
          allowAllStaff: req.body.allowAllStaff,
          specificallyAllowedCount: specificallyAllowedUserIds.length,
        },
      );
      res.json(policy);
    } catch (error) {
      const code =
        error instanceof FacilityMemberAffiliationPolicyError
          ? error.code
          : "MEMBER_AFFILIATION_POLICY_UPDATE_FAILED";
      res
        .status(
          error instanceof FacilityMemberAffiliationPolicyError ? 400 : 500,
        )
        .json({ error: code, code });
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
      const facility = getFacilityContext(res);
      if (req.body.role === "admin" && facility.role !== "owner") {
        res.status(403).json({
          error: "Only the facility owner can delegate administration",
          code: "FACILITY_OWNER_REQUIRED",
        });
        return;
      }
      const auth = getAuthenticatedUser(res);
      const { invitation, token } = await createFacilityInvitation({
        facilityId: facility.id,
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

usersRouter.put(
  "/:id/class-permissions",
  validateId("id"),
  async (req: express.Request, res: express.Response) => {
    const facility = getFacilityContext(res);
    if (facility.role !== "owner") {
      res.status(403).json({
        error: "Only the facility owner can manage delegated permissions",
        code: "FACILITY_OWNER_REQUIRED",
      });
      return;
    }
    const raw = req.body?.classPermissions;
    if (
      Object.keys(req.body ?? {}).some((key) => key !== "classPermissions") ||
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      res.status(400).json({ code: "FACILITY_CLASS_PERMISSIONS_INVALID" });
      return;
    }
    const entries = Object.entries(raw);
    if (
      entries.some(
        ([permission, effect]) =>
          !facilityClassPermissions.includes(
            permission as (typeof facilityClassPermissions)[number],
          ) ||
          (effect !== "allow" && effect !== "deny"),
      )
    ) {
      res.status(400).json({ code: "FACILITY_CLASS_PERMISSIONS_INVALID" });
      return;
    }
    try {
      await updateFacilityClassPermissions(
        facility.id,
        req.params.id,
        Object.fromEntries(entries) as Record<
          (typeof facilityClassPermissions)[number],
          FacilityPermissionEffect
        >,
      );
      await recordSecurityEvent(
        "facility_class_permissions_updated",
        getAuthenticatedUser(res).userId,
        {
          facilityId: facility.id,
          recipientUserId: req.params.id,
          permissionCount: entries.length,
        },
      );
      res.json(await getUserById(req.params.id, facility.id));
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      res.status(400).json({ error: code, code });
    }
  },
);

// Update user
usersRouter.put(
  "/:id",
  updateUserValidation,
  async (req: express.Request, res: express.Response) => {
    try {
      const { email, name } = req.body;
      const facility = getFacilityContext(res);

      const user = await updateUser(req.params.id, facility.id, {
        email,
        name,
      });
      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error updating user:", error);
      res.status(400).json({ error: message });
    }
  },
);

usersRouter.put(
  "/:id/workforce-roles",
  validateId("id"),
  async (req: express.Request, res: express.Response) => {
    const facility = getFacilityContext(res);
    if (facility.role !== "owner") {
      res.status(403).json({
        error: "Only the facility owner can delegate workforce roles",
        code: "FACILITY_OWNER_REQUIRED",
      });
      return;
    }
    const roles = req.body?.roles;
    if (
      Object.keys(req.body ?? {}).some((key) => key !== "roles") ||
      !Array.isArray(roles) ||
      roles.length === 0 ||
      roles.length > 2 ||
      roles.some((role) => role !== "trainer" && role !== "admin") ||
      new Set(roles).size !== roles.length
    ) {
      res.status(400).json({
        error: "Workforce roles are invalid",
        code: "WORKFORCE_ROLES_INVALID",
      });
      return;
    }
    try {
      const user = await updateUserWorkforceRoles(
        req.params.id,
        facility.id,
        roles,
      );
      await recordSecurityEvent(
        "facility_workforce_roles_updated",
        getAuthenticatedUser(res).userId,
        {
          facilityId: facility.id,
          recipientUserId: req.params.id,
          roles: roles.join(","),
        },
      );
      res.json(user);
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      res.status(400).json({ error: code, code });
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
