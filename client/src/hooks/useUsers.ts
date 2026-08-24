import { useState, useEffect } from "react";
import { authFetch } from "../lib/api";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: number;
}

export const USER_ROLES = ["member", "trainer", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserUpdate {
  email?: string;
  name?: string;
  password?: string;
  role?: UserRole;
}

export interface FacilityInvitation {
  id: string;
  facilityName: string;
  invitedEmail: string;
  invitedName: string;
  role: UserRole;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  expiresAt: number;
  existingAccount: boolean;
  deliveryQueued?: boolean;
  createdAt: number;
  updatedAt: number;
}

export class UserActionError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly blockers?: Array<{ code: string; count: number }>,
  ) {
    super(message);
    this.name = "UserActionError";
  }
}

async function userActionError(
  response: Response,
  fallback: string,
): Promise<UserActionError> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    blockers?: Array<{ code: string; count: number }>;
  };
  return new UserActionError(
    payload.error || fallback,
    payload.code,
    payload.blockers,
  );
}

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.some((role) => role === value);
}

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<FacilityInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const [response, invitationsResponse] = await Promise.all([
        authFetch("/api/users"),
        authFetch("/api/users/invitations"),
      ]);

      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }

      const data = await response.json();
      setUsers(data);
      if (!invitationsResponse.ok) {
        throw new Error("Failed to fetch facility invitations");
      }
      setInvitations(await invitationsResponse.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("Error fetching users:", err);
    } finally {
      setLoading(false);
    }
  };

  const inviteUser = async (data: {
    email: string;
    name: string;
    role: Exclude<UserRole, "member">;
    locale: "es" | "en" | "de" | "de-CH";
  }): Promise<FacilityInvitation> => {
    try {
      const response = await authFetch("/api/users/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create invitation");
      }

      const invitation = (await response.json()) as FacilityInvitation;
      setInvitations((current) => [
        invitation,
        ...current.filter((item) => item.id !== invitation.id),
      ]);
      return invitation;
    } catch (err) {
      console.error("Error creating facility invitation:", err);
      throw err;
    }
  };

  const revokeInvitation = async (id: string): Promise<void> => {
    const response = await authFetch(`/api/users/invitations/${id}/revoke`, {
      method: "POST",
    });
    if (!response.ok) {
      throw await userActionError(response, "Failed to revoke invitation");
    }
    setInvitations((current) =>
      current.map((invitation) =>
        invitation.id === id
          ? { ...invitation, status: "revoked", updatedAt: Date.now() }
          : invitation,
      ),
    );
  };

  const updateUser = async (id: string, updates: UserUpdate): Promise<User> => {
    try {
      const response = await authFetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update user");
      }

      const updatedUser = await response.json();
      setUsers(users.map((u) => (u.id === id ? updatedUser : u)));
      return updatedUser;
    } catch (err) {
      console.error("Error updating user:", err);
      throw err;
    }
  };

  const updateUserRole = async (id: string, role: UserRole): Promise<User> => {
    try {
      const response = await authFetch(`/api/users/${id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update user role");
      }

      const updatedUser = await response.json();
      setUsers(users.map((u) => (u.id === id ? updatedUser : u)));
      return updatedUser;
    } catch (err) {
      console.error("Error updating user role:", err);
      throw err;
    }
  };

  const deleteUser = async (id: string): Promise<void> => {
    try {
      const response = await authFetch(`/api/users/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw await userActionError(response, "Failed to delete user");
      }

      setUsers(users.filter((u) => u.id !== id));
    } catch (err) {
      console.error("Error deleting user:", err);
      throw err;
    }
  };

  const deleteMultipleUsers = async (userIds: string[]): Promise<void> => {
    try {
      const response = await authFetch("/api/users/bulk/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });

      if (!response.ok) {
        throw await userActionError(response, "Failed to delete users");
      }

      setUsers(users.filter((u) => !userIds.includes(u.id)));
    } catch (err) {
      console.error("Error deleting users:", err);
      throw err;
    }
  };

  const refreshUsers = async () => {
    await fetchUsers();
  };

  return {
    users,
    invitations,
    loading,
    error,
    inviteUser,
    revokeInvitation,
    updateUser,
    updateUserRole,
    deleteUser,
    deleteMultipleUsers,
    refreshUsers,
  };
}
