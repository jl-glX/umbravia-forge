import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import type {
  CrmFollowUpKind,
  CrmFollowUpStatus,
  CrmMemberSegment,
} from "../db/types.js";

const DAY = 24 * 60 * 60 * 1_000;
const SEGMENTS: CrmMemberSegment[] = [
  "onboarding",
  "engaged",
  "attention",
  "reengagement",
];
const FOLLOW_UP_KINDS: CrmFollowUpKind[] = [
  "onboarding",
  "check_in",
  "retention",
  "service",
];
const FOLLOW_UP_STATUSES: CrmFollowUpStatus[] = [
  "open",
  "completed",
  "dismissed",
];

export class CrmError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CrmError(code, status, message);
}

function isSafeTimestamp(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

async function requireActiveMember(facilityId: string, userId: string) {
  const member = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select(["users.id", "users.accountStatus"])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.userId", "=", userId)
    .where("facilityMemberships.role", "=", "member")
    .where("facilityMemberships.status", "=", "active")
    .executeTakeFirst();
  if (!member || member.accountStatus !== "active") {
    fail("CRM_MEMBER_NOT_FOUND", 404, "The active member was not found");
  }
  return member;
}

async function requireAssignableUser(
  facilityId: string,
  userId: string | null,
) {
  if (userId === null) return;
  const assignee = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select(["users.id", "users.accountStatus", "facilityMemberships.role"])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.userId", "=", userId)
    .where("facilityMemberships.status", "=", "active")
    .where("facilityMemberships.role", "in", ["owner", "admin", "trainer"])
    .executeTakeFirst();
  if (!assignee || assignee.accountStatus !== "active") {
    fail(
      "CRM_ASSIGNEE_INVALID",
      400,
      "The assignee must be an active administrator or trainer in this facility",
    );
  }
}

function suggestedSegment(input: {
  joinedAt: number;
  lastActivityAt: number | null;
  absentLast30Days: number;
  now: number;
}): CrmMemberSegment {
  const membershipAge = input.now - input.joinedAt;
  if (input.lastActivityAt === null) {
    return membershipAge <= 30 * DAY ? "onboarding" : "reengagement";
  }
  const inactivity = input.now - input.lastActivityAt;
  if (inactivity >= 60 * DAY) return "reengagement";
  if (inactivity >= 30 * DAY || input.absentLast30Days >= 2) return "attention";
  return "engaged";
}

export async function getCrmWorkspace(facilityId: string, now = Date.now()) {
  const [membershipRows, profileRows, activityRows, followUps, assignees] =
    await Promise.all([
      db
        .selectFrom("facilityMemberships")
        .innerJoin("users", "users.id", "facilityMemberships.userId")
        .select([
          "facilityMemberships.userId",
          "facilityMemberships.createdAt as joinedAt",
          "users.name",
          "users.lastName",
          "users.email",
        ])
        .where("facilityMemberships.facilityId", "=", facilityId)
        .where("facilityMemberships.role", "=", "member")
        .where("facilityMemberships.status", "=", "active")
        .where("users.accountStatus", "=", "active")
        .orderBy("users.name", "asc")
        .execute(),
      db
        .selectFrom("crmMemberProfiles")
        .selectAll()
        .where("facilityId", "=", facilityId)
        .execute(),
      db
        .selectFrom("bookings")
        .innerJoin(
          "activitySessions",
          "activitySessions.id",
          "bookings.activitySessionId",
        )
        .leftJoin(
          "bookingLifecycles",
          "bookingLifecycles.bookingId",
          "bookings.id",
        )
        .select([
          "bookings.userId",
          "bookings.status",
          "activitySessions.scheduledAt",
          "bookingLifecycles.lifecycleStatus",
        ])
        .where("activitySessions.facilityId", "=", facilityId)
        .where("activitySessions.scheduledAt", "<=", now)
        .execute(),
      db
        .selectFrom("crmFollowUps")
        .selectAll()
        .where("facilityId", "=", facilityId)
        .orderBy("dueAt", "asc")
        .execute(),
      db
        .selectFrom("facilityMemberships")
        .innerJoin("users", "users.id", "facilityMemberships.userId")
        .select([
          "facilityMemberships.userId",
          "facilityMemberships.role",
          "users.name",
          "users.lastName",
        ])
        .where("facilityMemberships.facilityId", "=", facilityId)
        .where("facilityMemberships.status", "=", "active")
        .where("facilityMemberships.role", "in", ["owner", "admin", "trainer"])
        .where("users.accountStatus", "=", "active")
        .orderBy("users.name", "asc")
        .execute(),
    ]);

  const profiles = new Map(profileRows.map((row) => [row.memberUserId, row]));
  const members = membershipRows.map((membership) => {
    const activity = activityRows.filter(
      (row) => row.userId === membership.userId,
    );
    const recentThreshold = now - 30 * DAY;
    const attendedLast30Days = activity.filter(
      (row) =>
        row.scheduledAt >= recentThreshold &&
        row.lifecycleStatus === "attended",
    ).length;
    const absentLast30Days = activity.filter(
      (row) =>
        row.scheduledAt >= recentThreshold && row.lifecycleStatus === "absent",
    ).length;
    const bookingsLast30Days = activity.filter(
      (row) => row.scheduledAt >= recentThreshold && row.status === "confirmed",
    ).length;
    const relevantActivity = activity.filter(
      (row) =>
        row.status === "confirmed" ||
        ["attended", "absent", "excused"].includes(row.lifecycleStatus ?? ""),
    );
    const lastActivityAt = relevantActivity.reduce<number | null>(
      (latest, row) =>
        latest === null || row.scheduledAt > latest ? row.scheduledAt : latest,
      null,
    );
    const profile = profiles.get(membership.userId);
    const suggested = suggestedSegment({
      joinedAt: membership.joinedAt,
      lastActivityAt,
      absentLast30Days,
      now,
    });
    return {
      userId: membership.userId,
      name: [membership.name, membership.lastName].filter(Boolean).join(" "),
      email: membership.email,
      joinedAt: membership.joinedAt,
      suggestedSegment: suggested,
      effectiveSegment: profile?.manualSegment ?? suggested,
      manualSegment: profile?.manualSegment ?? null,
      assignedToUserId: profile?.assignedToUserId ?? null,
      nextFollowUpAt: profile?.nextFollowUpAt ?? null,
      lastActivityAt,
      bookingsLast30Days,
      attendedLast30Days,
      absentLast30Days,
      openFollowUps: followUps.filter(
        (row) =>
          row.memberUserId === membership.userId && row.status === "open",
      ).length,
    };
  });

  return {
    generatedAt: now,
    summary: {
      totalMembers: members.length,
      onboarding: members.filter((row) => row.effectiveSegment === "onboarding")
        .length,
      engaged: members.filter((row) => row.effectiveSegment === "engaged")
        .length,
      attention: members.filter((row) => row.effectiveSegment === "attention")
        .length,
      reengagement: members.filter(
        (row) => row.effectiveSegment === "reengagement",
      ).length,
      overdueFollowUps: followUps.filter(
        (row) => row.status === "open" && row.dueAt < now,
      ).length,
    },
    members,
    assignees: assignees.map((row) => ({
      userId: row.userId,
      name: [row.name, row.lastName].filter(Boolean).join(" "),
      role: row.role,
    })),
    followUps,
  };
}

export async function updateCrmMemberProfile(input: {
  facilityId: string;
  memberUserId: string;
  updatedByUserId: string;
  manualSegment: CrmMemberSegment | null;
  assignedToUserId: string | null;
  nextFollowUpAt: number | null;
  now?: number;
}) {
  if (input.manualSegment !== null && !SEGMENTS.includes(input.manualSegment)) {
    fail("CRM_SEGMENT_INVALID", 400, "The CRM segment is invalid");
  }
  if (!isSafeTimestamp(input.nextFollowUpAt)) {
    fail("CRM_FOLLOW_UP_DATE_INVALID", 400, "The follow-up date is invalid");
  }
  await requireActiveMember(input.facilityId, input.memberUserId);
  await requireAssignableUser(input.facilityId, input.assignedToUserId);
  const now = input.now ?? Date.now();
  const existing = await db
    .selectFrom("crmMemberProfiles")
    .select("id")
    .where("facilityId", "=", input.facilityId)
    .where("memberUserId", "=", input.memberUserId)
    .executeTakeFirst();
  if (existing) {
    await db
      .updateTable("crmMemberProfiles")
      .set({
        manualSegment: input.manualSegment,
        assignedToUserId: input.assignedToUserId,
        nextFollowUpAt: input.nextFollowUpAt,
        updatedByUserId: input.updatedByUserId,
        updatedAt: now,
      })
      .where("id", "=", existing.id)
      .execute();
    return { id: existing.id };
  }
  const id = `crm-profile-${randomUUID()}`;
  await db
    .insertInto("crmMemberProfiles")
    .values({
      id,
      facilityId: input.facilityId,
      memberUserId: input.memberUserId,
      manualSegment: input.manualSegment,
      assignedToUserId: input.assignedToUserId,
      nextFollowUpAt: input.nextFollowUpAt,
      updatedByUserId: input.updatedByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return { id };
}

export async function createCrmFollowUp(input: {
  facilityId: string;
  memberUserId: string;
  assignedToUserId: string | null;
  kind: CrmFollowUpKind;
  dueAt: number;
  createdByUserId: string;
  now?: number;
}) {
  if (!FOLLOW_UP_KINDS.includes(input.kind)) {
    fail("CRM_FOLLOW_UP_KIND_INVALID", 400, "The follow-up kind is invalid");
  }
  if (!Number.isSafeInteger(input.dueAt) || input.dueAt < 0) {
    fail("CRM_FOLLOW_UP_DATE_INVALID", 400, "The follow-up date is invalid");
  }
  await requireActiveMember(input.facilityId, input.memberUserId);
  await requireAssignableUser(input.facilityId, input.assignedToUserId);
  const now = input.now ?? Date.now();
  const id = `crm-follow-up-${randomUUID()}`;
  await db
    .insertInto("crmFollowUps")
    .values({
      id,
      facilityId: input.facilityId,
      memberUserId: input.memberUserId,
      assignedToUserId: input.assignedToUserId,
      kind: input.kind,
      status: "open",
      dueAt: input.dueAt,
      completedAt: null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return { id };
}

export async function updateCrmFollowUp(input: {
  facilityId: string;
  followUpId: string;
  status: CrmFollowUpStatus;
  assignedToUserId: string | null;
  dueAt: number;
  now?: number;
}) {
  if (!FOLLOW_UP_STATUSES.includes(input.status)) {
    fail(
      "CRM_FOLLOW_UP_STATUS_INVALID",
      400,
      "The follow-up status is invalid",
    );
  }
  if (!Number.isSafeInteger(input.dueAt) || input.dueAt < 0) {
    fail("CRM_FOLLOW_UP_DATE_INVALID", 400, "The follow-up date is invalid");
  }
  await requireAssignableUser(input.facilityId, input.assignedToUserId);
  const existing = await db
    .selectFrom("crmFollowUps")
    .select("id")
    .where("id", "=", input.followUpId)
    .where("facilityId", "=", input.facilityId)
    .executeTakeFirst();
  if (!existing)
    fail("CRM_FOLLOW_UP_NOT_FOUND", 404, "The follow-up was not found");
  const now = input.now ?? Date.now();
  await db
    .updateTable("crmFollowUps")
    .set({
      status: input.status,
      assignedToUserId: input.assignedToUserId,
      dueAt: input.dueAt,
      completedAt: input.status === "completed" ? now : null,
      updatedAt: now,
    })
    .where("id", "=", input.followUpId)
    .where("facilityId", "=", input.facilityId)
    .execute();
  return { id: input.followUpId };
}
