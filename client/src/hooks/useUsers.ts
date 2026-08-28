import { useState, useEffect } from "react";
import { authFetch } from "../lib/api";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  roles: UserRole[];
  facilityRole: "owner" | UserRole;
  memberAffiliation: boolean;
  classPermissions: Record<string, "allow" | "deny">;
  createdAt: number;
}

export const USER_ROLES = ["member", "trainer", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type WorkforceRole = Exclude<UserRole, "member">;

export interface UserUpdate {
  email?: string;
  name?: string;
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

export interface StaffMemberAffiliationPolicy {
  allowAllStaff: boolean;
  staff: Array<{
    userId: string;
    name: string;
    email: string;
    role: "admin" | "trainer";
    specificallyAllowed: boolean;
    memberAffiliation: boolean;
  }>;
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
  const [memberAffiliationPolicy, setMemberAffiliationPolicy] =
    useState<StaffMemberAffiliationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const [response, invitationsResponse, policyResponse] = await Promise.all(
        [
          authFetch("/api/users"),
          authFetch("/api/users/invitations"),
          authFetch("/api/users/member-affiliation-policy"),
        ],
      );

      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }

      const data = await response.json();
      setUsers(data);
      if (!invitationsResponse.ok) {
        throw new Error("Failed to fetch facility invitations");
      }
      setInvitations(await invitationsResponse.json());
      if (!policyResponse.ok) {
        throw new Error("Failed to fetch member affiliation policy");
      }
      setMemberAffiliationPolicy(await policyResponse.json());
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
    role: UserRole;
    locale:
      | "es"
      | "en"
      | "de"
      | "de-CH"
      | "fr"
      | "it"
      | "gl"
      | "ca"
      | "ca-valencia"
      | "eu"
      | "oc-aranes";
  }): Promise<FacilityInvitation> => {
    try {
      const response = await authFetch("/api/users/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw await userActionError(response, "Failed to create invitation");
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

  const updateWorkforceRoles = async (
    id: string,
    roles: WorkforceRole[],
  ): Promise<User> => {
    const response = await authFetch(`/api/users/${id}/workforce-roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles }),
    });
    if (!response.ok) {
      throw await userActionError(response, "Failed to update workforce roles");
    }
    const updatedUser = (await response.json()) as User;
    setUsers((current) =>
      current.map((user) => (user.id === id ? updatedUser : user)),
    );
    return updatedUser;
  };

  const updateClassPermissions = async (
    id: string,
    classPermissions: Record<string, "allow" | "deny">,
  ): Promise<User> => {
    const response = await authFetch(`/api/users/${id}/class-permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classPermissions }),
    });
    if (!response.ok) {
      throw await userActionError(
        response,
        "Failed to update class permissions",
      );
    }
    const updatedUser = (await response.json()) as User;
    setUsers((current) =>
      current.map((user) => (user.id === id ? updatedUser : user)),
    );
    return updatedUser;
  };

  const updateMemberAffiliationPolicy = async (
    allowAllStaff: boolean,
    specificallyAllowedUserIds: string[],
  ): Promise<StaffMemberAffiliationPolicy> => {
    const response = await authFetch("/api/users/member-affiliation-policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowAllStaff, specificallyAllowedUserIds }),
    });
    if (!response.ok) {
      throw await userActionError(
        response,
        "Failed to update member affiliation policy",
      );
    }
    const updated = (await response.json()) as StaffMemberAffiliationPolicy;
    setMemberAffiliationPolicy(updated);
    return updated;
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
    memberAffiliationPolicy,
    loading,
    error,
    inviteUser,
    revokeInvitation,
    updateUser,
    updateWorkforceRoles,
    updateClassPermissions,
    updateMemberAffiliationPolicy,
    deleteUser,
    deleteMultipleUsers,
    refreshUsers,
  };
}
