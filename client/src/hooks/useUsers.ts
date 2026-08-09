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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authFetch("/api/users");

      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }

      const data = await response.json();
      setUsers(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("Error fetching users:", err);
    } finally {
      setLoading(false);
    }
  };

  const createUser = async (data: {
    email: string;
    name: string;
    password: string;
    role?: UserRole;
  }): Promise<User> => {
    try {
      const response = await authFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create user");
      }

      const newUser = await response.json();
      setUsers([...users, newUser]);
      return newUser;
    } catch (err) {
      console.error("Error creating user:", err);
      throw err;
    }
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
    loading,
    error,
    createUser,
    updateUser,
    updateUserRole,
    deleteUser,
    deleteMultipleUsers,
    refreshUsers,
  };
}
