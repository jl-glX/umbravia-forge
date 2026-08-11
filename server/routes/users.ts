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

// Get user by ID
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

// Create user
usersRouter.post(
  "/",
  createUserValidation,
  async (req: express.Request, res: express.Response) => {
    try {
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
