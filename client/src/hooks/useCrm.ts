import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../lib/api";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "";

export type CrmMemberSegment =
  "onboarding" | "engaged" | "attention" | "reengagement";
export type CrmFollowUpKind =
  "onboarding" | "check_in" | "retention" | "service";
export type CrmFollowUpStatus = "open" | "completed" | "dismissed";

export interface CrmMember {
  userId: string;
  name: string;
  email: string;
  joinedAt: number;
  suggestedSegment: CrmMemberSegment;
  effectiveSegment: CrmMemberSegment;
  manualSegment: CrmMemberSegment | null;
  assignedToUserId: string | null;
  nextFollowUpAt: number | null;
  lastActivityAt: number | null;
  bookingsLast30Days: number;
  attendedLast30Days: number;
  absentLast30Days: number;
  openFollowUps: number;
}

export interface CrmFollowUp {
  id: string;
  memberUserId: string;
  assignedToUserId: string | null;
  kind: CrmFollowUpKind;
  status: CrmFollowUpStatus;
  dueAt: number;
  completedAt: number | null;
  createdAt: number;
}

export interface CrmWorkspace {
  generatedAt: number;
  summary: {
    totalMembers: number;
    onboarding: number;
    engaged: number;
    attention: number;
    reengagement: number;
    overdueFollowUps: number;
  };
  members: CrmMember[];
  assignees: Array<{
    userId: string;
    name: string;
    role: "owner" | "admin" | "trainer";
  }>;
  followUps: CrmFollowUp[];
}

async function expectSuccess(response: Response, fallbackCode: string) {
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as {
    code?: string;
  } | null;
  throw new Error(body?.code ?? fallbackCode);
}

export function useCrmWorkspace() {
  const [data, setData] = useState<CrmWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}/api/crm/workspace`);
      await expectSuccess(response, "CRM_WORKSPACE_FAILED");
      setData((await response.json()) as CrmWorkspace);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "CRM_WORKSPACE_FAILED",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (request: () => Promise<Response>, fallbackCode: string) => {
      setSaving(true);
      setError(null);
      try {
        const response = await request();
        await expectSuccess(response, fallbackCode);
        await refresh();
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : fallbackCode,
        );
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const updateMember = useCallback(
    (
      memberUserId: string,
      profile: {
        manualSegment: CrmMemberSegment | null;
        assignedToUserId: string | null;
        nextFollowUpAt: number | null;
      },
    ) =>
      mutate(
        () =>
          authFetch(`${API_BASE}/api/crm/members/${memberUserId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(profile),
          }),
        "CRM_MEMBER_UPDATE_FAILED",
      ),
    [mutate],
  );

  const createFollowUp = useCallback(
    (input: {
      memberUserId: string;
      assignedToUserId: string | null;
      kind: CrmFollowUpKind;
      dueAt: number;
    }) =>
      mutate(
        () =>
          authFetch(`${API_BASE}/api/crm/follow-ups`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }),
        "CRM_FOLLOW_UP_CREATE_FAILED",
      ),
    [mutate],
  );

  const updateFollowUp = useCallback(
    (
      followUpId: string,
      input: {
        assignedToUserId: string | null;
        status: CrmFollowUpStatus;
        dueAt: number;
      },
    ) =>
      mutate(
        () =>
          authFetch(`${API_BASE}/api/crm/follow-ups/${followUpId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }),
        "CRM_FOLLOW_UP_UPDATE_FAILED",
      ),
    [mutate],
  );

  return {
    data,
    loading,
    saving,
    error,
    refresh,
    updateMember,
    createFollowUp,
    updateFollowUp,
  };
}
