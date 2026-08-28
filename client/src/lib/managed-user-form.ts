import type { TFunction } from "i18next";
import { UserActionError, type User, type UserUpdate } from "../hooks/useUsers";
import { buildInvitationCreationPayload } from "./invitationLocalization";

export interface ManagedUserFormDraft {
  email: string;
  name: string;
  role: "member" | "trainer" | "admin";
}

export async function submitManagedUserForm(input: {
  user?: User | null;
  draft: ManagedUserFormDraft;
  interfaceLocale?: string;
  inviteUser: (
    payload: ReturnType<typeof buildInvitationCreationPayload>,
  ) => Promise<{ deliveryQueued?: boolean }>;
  updateUser: (id: string, updates: UserUpdate) => Promise<unknown>;
}): Promise<"success" | "invitation-email-not-queued"> {
  if (input.user) {
    await input.updateUser(input.user.id, {
      email: input.draft.email,
      name: input.draft.name,
    });
    return "success";
  }

  const invitation = await input.inviteUser(
    buildInvitationCreationPayload({
      email: input.draft.email,
      name: input.draft.name,
      role: input.draft.role,
      interfaceLocale: input.interfaceLocale,
    }),
  );
  return invitation.deliveryQueued ? "success" : "invitation-email-not-queued";
}

export function formatManagedUserFormError(
  cause: unknown,
  t: TFunction,
  mode: "edit" | "invite",
): string {
  if (mode === "invite" && cause instanceof UserActionError) {
    if (cause.code === "FACILITY_OWNER_REQUIRED") {
      return t("admin.invitationOwnerRequired");
    }
    if (cause.code === "FACILITY_INVITATION_ROLE_INVALID") {
      return t("admin.workerRoleRequired");
    }
    if (
      cause.code?.startsWith("FACILITY_INVITATION_") ||
      [
        "FACILITY_MEMBER_ALREADY_ACTIVE",
        "FACILITY_MEMBERSHIP_SUSPENDED",
        "INVITED_ACCOUNT_REQUIRES_REVIEW",
        "FACILITY_NOT_ACTIVE",
        "STAFF_MEMBER_AFFILIATION_NOT_ALLOWED",
      ].includes(cause.code ?? "")
    ) {
      return t("admin.invitationRequestFailed");
    }
  }
  return mode === "invite"
    ? t("admin.invitationRequestFailed")
    : t("common.unknownError");
}
