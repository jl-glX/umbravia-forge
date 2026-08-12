import { useState, useEffect } from "react";
import { authFetch } from "../lib/api";

export interface AdminClass {
  id: string;
  name: string;
  description: string;
  trainerId: string;
  trainerName: string;
  maxCapacity: number;
  scheduledAt: number;
  bookedCount: number;
  availablePlaces: number;
  waitlistCount: number;
}

export interface ClassBatchDeleteResult {
  deletedIds: string[];
  failed: Array<{
    id: string;
    code: string;
    message: string;
  }>;
}

export function useAdminClasses() {
  const [classes, setClasses] = useState<AdminClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClasses();
  }, []);

  const fetchClasses = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authFetch("/api/admin/classes");

      if (!response.ok) {
        throw new Error("Failed to fetch classes");
      }

      const data = await response.json();
      setClasses(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("Error fetching admin classes:", err);
    } finally {
      setLoading(false);
    }
  };

  const createClass = async (data: {
    name: string;
    description: string;
    trainerId: string;
    trainerName: string;
    maxCapacity: number;
    scheduledAt: number;
  }): Promise<AdminClass> => {
    try {
      const response = await authFetch("/api/admin/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create class");
      }

      const newClass = await response.json();
      setClasses((current) => [...current, newClass]);
      return newClass;
    } catch (err) {
      console.error("Error creating class:", err);
      throw err;
    }
  };

  const updateClass = async (
    id: string,
    updates: {
      name?: string;
      description?: string;
      trainerId?: string;
      trainerName?: string;
      maxCapacity?: number;
      scheduledAt?: number;
    },
  ): Promise<AdminClass> => {
    try {
      const response = await authFetch(`/api/admin/classes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update class");
      }

      const updatedClass = await response.json();
      setClasses((current) =>
        current.map((c) => (c.id === id ? updatedClass : c)),
      );
      return updatedClass;
    } catch (err) {
      console.error("Error updating class:", err);
      throw err;
    }
  };

  const deleteClass = async (id: string): Promise<void> => {
    try {
      const response = await authFetch(`/api/admin/classes/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete class");
      }

      setClasses((current) => current.filter((c) => c.id !== id));
    } catch (err) {
      console.error("Error deleting class:", err);
      throw err;
    }
  };

  const deleteMultipleClasses = async (
    classIds: string[],
  ): Promise<ClassBatchDeleteResult> => {
    const response = await authFetch("/api/admin/classes/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classIds }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error || "Failed to delete classes");
    }
    const result = body as ClassBatchDeleteResult;
    setClasses((current) =>
      current.filter((gymClass) => !result.deletedIds.includes(gymClass.id)),
    );
    return result;
  };

  const refreshClasses = async () => {
    await fetchClasses();
  };

  return {
    classes,
    loading,
    error,
    createClass,
    updateClass,
    deleteClass,
    deleteMultipleClasses,
    refreshClasses,
  };
}
