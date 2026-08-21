import { db } from "../db/client.js";
import { hashPassword, isStrongPassword, logoutAll } from "./auth.js";
import { randomBytes } from "crypto";
import { ensureSupportIdentifier } from "./support-identifiers.js";
import type { Transaction } from "kysely";
import type { Database, FacilityRole } from "../db/types.js";

export interface UserWithoutPassword {
  id: string;
  email: string;
  name: string;
  role: "member" | "trainer" | "admin";
  createdAt: number;
}

export type UserDeletionBlockerCode =
  | "support_tickets"
  | "support_attachments"
  | "support_knowledge"
  | "community_channels"
  | "facility_links"
  | "moderation_cases"
  | "moderation_actions"
  | "moderation_appeals"
  | "commercial_requests";

export interface UserDeletionBlocker {
  code: UserDeletionBlockerCode;
  count: number;
}

export class UserDeletionBlockedError extends Error {
  readonly blockers: UserDeletionBlocker[];

  constructor(blockers: UserDeletionBlocker[]) {
    super("User deletion requires retention or ownership review");
    this.name = "UserDeletionBlockedError";
    this.blockers = blockers;
  }
}

export async function inspectUserDeletionBlockers(
  transaction: Transaction<Database>,
  id: string,
): Promise<UserDeletionBlocker[]> {
  const blockers: UserDeletionBlocker[] = [];
  const addBlocker = async (
    code: UserDeletionBlockerCode,
    query: Promise<{ count: number | string | bigint }>,
  ) => {
    const result = await query;
    const count = Number(result.count);
    if (count > 0) blockers.push({ code, count });
  };

  await addBlocker(
    "support_tickets",
    transaction
      .selectFrom("supportTickets")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("requesterUserId", "=", id)
      .executeTakeFirstOrThrow(),
  );
  await addBlocker(
    "support_attachments",
    transaction
      .selectFrom("supportAttachments")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("uploadedByUserId", "=", id)
      .executeTakeFirstOrThrow(),
  );
  await addBlocker(
    "support_knowledge",
    transaction
      .selectFrom("supportKnowledgeArticles")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("authorUserId", "=", id)
      .executeTakeFirstOrThrow(),
  );
  await addBlocker(
    "community_channels",
    transaction
      .selectFrom("communityChannels")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("createdBy", "=", id)
      .executeTakeFirstOrThrow(),
  );
  await addBlocker(
    "facility_links",
    transaction
      .selectFrom("facilityLinks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("createdBy", "=", id)
      .executeTakeFirstOrThrow(),
  );
  await addBlocker(
    "moderation_cases",
    transaction
      .selectFrom("moderationCases")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("reporterUserId", "=", id)
      .executeTakeFirstOrThrow(),
  );
  await addBlocker(
    "moderation_actions",
    transaction
      .selectFrom("moderationActions")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("actorUserId", "=", id)
      .executeTakeFirstOrThrow(),
  );
  await addBlocker(
    "moderation_appeals",
    transaction
      .selectFrom("moderationAppeals")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("appellantUserId", "=", id)
      .executeTakeFirstOrThrow(),
  );
  await addBlocker(
    "commercial_requests",
    transaction
      .selectFrom("commercialRequests")
      .innerJoin(
        "commercialTrials",
        "commercialTrials.id",
        "commercialRequests.trialId",
      )
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("commercialRequests.requesterUserId", "=", id)
      .where("commercialTrials.ownerUserId", "!=", id)
      .executeTakeFirstOrThrow(),
  );
  return blockers;
}

function publicRole(role: FacilityRole): UserWithoutPassword["role"] {
  return role === "owner" ? "admin" : role;
}

async function recomputeLegacyRole(
  transaction: Transaction<Database>,
  userId: string,
) {
  const memberships = await transaction
    .selectFrom("facilityMemberships")
    .select("role")
    .where("userId", "=", userId)
    .where("status", "in", ["active", "invited", "suspended"])
    .execute();
  const role: UserWithoutPassword["role"] = memberships.some((membership) =>
    ["owner", "admin"].includes(membership.role),
  )
    ? "admin"
    : memberships.some((membership) => membership.role === "trainer")
      ? "trainer"
      : "member";
  await transaction
    .updateTable("users")
    .set({ role })
    .where("id", "=", userId)
    .execute();
  return role;
}

export async function getAllUsers(
  facilityId: string,
): Promise<UserWithoutPassword[]> {
  const users = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select([
      "users.id",
      "users.email",
      "users.name",
      "facilityMemberships.role",
      "facilityMemberships.createdAt",
    ])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.status", "=", "active")
    .where("users.accountStatus", "=", "active")
    .orderBy("facilityMemberships.createdAt", "desc")
    .execute();

  return users.map((user) => ({ ...user, role: publicRole(user.role) }));
}

export async function getUserById(
  id: string,
  facilityId: string,
): Promise<UserWithoutPassword | null> {
  const user = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select([
      "users.id",
      "users.email",
      "users.name",
      "facilityMemberships.role",
      "facilityMemberships.createdAt",
    ])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.userId", "=", id)
    .where("facilityMemberships.status", "=", "active")
    .where("users.accountStatus", "=", "active")
    .executeTakeFirst();

  return user ? { ...user, role: publicRole(user.role) } : null;
}

export async function createUser(
  email: string,
  name: string,
  password: string,
  facilityId: string,
  role: "member" | "trainer" | "admin" = "member",
): Promise<UserWithoutPassword> {
  // Validate input
  if (!email || !name || !password) {
    throw new Error("Email, name, and password are required");
  }

  if (!isStrongPassword(password)) {
    throw new Error("Password does not meet the security requirements");
  }

  if (!email.includes("@")) {
    throw new Error("Invalid email format");
  }

  // Check if user exists
  const existingUser = await db
    .selectFrom("users")
    .selectAll()
    .where("email", "=", email)
    .executeTakeFirst();

  if (existingUser) {
    throw new Error("Email already registered");
  }

  const hashedPassword = await hashPassword(password);
  const userId = `user-${randomBytes(8).toString("hex")}`;

  const createdAt = Date.now();
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("users")
      .values({
        id: userId,
        email,
        phone: null,
        name,
        accountStatus: "active",
        emailVerifiedAt: createdAt,
        avatarDataUrl: "",
        password: hashedPassword,
        role,
        sessionIdleTimeoutMinutes: 7 * 24 * 60,
        createdAt,
      })
      .execute();
    await transaction
      .insertInto("facilityMemberships")
      .values({
        id: `${facilityId}:${userId}`,
        facilityId,
        userId,
        role,
        status: "active",
        createdAt,
        updatedAt: createdAt,
      })
      .execute();
  });
  await ensureSupportIdentifier(userId);
  return {
    id: userId,
    email,
    name,
    role,
    createdAt,
  };
}

export async function updateUser(
  id: string,
  facilityId: string,
  updates: {
    email?: string;
    name?: string;
    password?: string;
    role?: "member" | "trainer" | "admin";
  },
): Promise<UserWithoutPassword> {
  const user = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select([
      "users.id",
      "users.email",
      "users.role as legacyRole",
      "facilityMemberships.role as facilityRole",
    ])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.userId", "=", id)
    .where("facilityMemberships.status", "=", "active")
    .executeTakeFirst();

  if (!user) {
    throw new Error("User not found");
  }

  if (updates.email && updates.email !== user.email) {
    throw new Error("ACCOUNT_EMAIL_CHANGE_REQUIRES_VERIFICATION");
  }

  if (updates.email || updates.name || updates.password) {
    const otherMembership = await db
      .selectFrom("facilityMemberships")
      .select("id")
      .where("userId", "=", id)
      .where("facilityId", "!=", facilityId)
      .where("status", "in", ["active", "invited", "suspended"])
      .executeTakeFirst();
    if (otherMembership) {
      throw new Error("SHARED_ACCOUNT_IDENTITY_MANAGED_BY_USER");
    }
  }
  if (user.facilityRole === "owner" && updates.role) {
    throw new Error("FACILITY_OWNER_ROLE_REQUIRES_TRANSFER");
  }

  const updateValues: Record<string, unknown> = {};

  if (updates.name) updateValues.name = updates.name;

  if (updates.password) {
    if (!isStrongPassword(updates.password)) {
      throw new Error("Password does not meet the security requirements");
    }
    updateValues.password = await hashPassword(updates.password);
  }

  await db.transaction().execute(async (transaction) => {
    if (Object.keys(updateValues).length > 0) {
      await transaction
        .updateTable("users")
        .set(updateValues)
        .where("id", "=", id)
        .execute();
    }
    if (updates.role) {
      await transaction
        .updateTable("facilityMemberships")
        .set({ role: updates.role, updatedAt: Date.now() })
        .where("facilityId", "=", facilityId)
        .where("userId", "=", id)
        .execute();
      await recomputeLegacyRole(transaction, id);
    }
  });

  if (updates.password) {
    await logoutAll(id);
  }
  if (updates.role && updates.role !== publicRole(user.facilityRole)) {
    // A role change alters the authorization boundary. Existing sessions must
    // authenticate again through the portal appropriate for the new role.
    await logoutAll(id);
  }

  const updatedUser = await getUserById(id, facilityId);

  if (!updatedUser) {
    throw new Error("Failed to retrieve updated user");
  }

  return updatedUser;
}

export async function deleteUser(id: string): Promise<void> {
  await db
    .transaction()
    .execute((transaction) => deleteUserInTransaction(transaction, id));
}

async function removeUserFromFacilityInTransaction(
  transaction: Transaction<Database>,
  id: string,
  facilityId: string,
): Promise<boolean> {
  const membership = await transaction
    .selectFrom("facilityMemberships")
    .select(["id", "role"])
    .where("facilityId", "=", facilityId)
    .where("userId", "=", id)
    .where("status", "in", ["active", "invited", "suspended"])
    .executeTakeFirst();
  if (!membership) throw new Error("User not found");
  if (membership.role === "owner") {
    throw new Error("FACILITY_OWNER_REMOVAL_REQUIRES_TRANSFER");
  }

  const otherMembership = await transaction
    .selectFrom("facilityMemberships")
    .select("id")
    .where("userId", "=", id)
    .where("facilityId", "!=", facilityId)
    .where("status", "in", ["active", "invited", "suspended"])
    .executeTakeFirst();
  if (!otherMembership) {
    await deleteUserInTransaction(transaction, id);
    return false;
  }

  const classRows = await transaction
    .selectFrom("activitySessions")
    .select("id")
    .where("facilityId", "=", facilityId)
    .execute();
  const activitySessionIds = classRows.map(
    (activitySession) => activitySession.id,
  );
  if (activitySessionIds.length > 0) {
    await transaction
      .deleteFrom("bookings")
      .where("userId", "=", id)
      .where("activitySessionId", "in", activitySessionIds)
      .execute();
    await transaction
      .deleteFrom("waitlistEntries")
      .where("userId", "=", id)
      .where("activitySessionId", "in", activitySessionIds)
      .execute();
  }
  await transaction
    .updateTable("bookingAnalyticsEvents")
    .set({ memberUserId: null })
    .where("facilityId", "=", facilityId)
    .where("memberUserId", "=", id)
    .execute();
  await transaction
    .updateTable("bookingAnalyticsEvents")
    .set({ trainerUserId: null })
    .where("facilityId", "=", facilityId)
    .where("trainerUserId", "=", id)
    .execute();
  await transaction
    .deleteFrom("facilityMemberships")
    .where("id", "=", membership.id)
    .execute();
  await recomputeLegacyRole(transaction, id);
  return true;
}

export async function removeUserFromFacility(
  id: string,
  facilityId: string,
): Promise<void> {
  const sessionsMustBeRevoked = await db
    .transaction()
    .execute((transaction) =>
      removeUserFromFacilityInTransaction(transaction, id, facilityId),
    );
  if (sessionsMustBeRevoked) await logoutAll(id);
}

export async function deleteUserInTransaction(
  transaction: Transaction<Database>,
  id: string,
): Promise<void> {
  const user = await transaction
    .selectFrom("users")
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst();

  if (!user) {
    throw new Error("User not found");
  }

  const blockers = await inspectUserDeletionBlockers(transaction, id);

  if (blockers.length > 0) {
    throw new UserDeletionBlockedError(blockers);
  }

  await transaction.deleteFrom("bookings").where("userId", "=", id).execute();

  await transaction
    .deleteFrom("waitlistEntries")
    .where("userId", "=", id)
    .execute();

  await transaction
    .deleteFrom("commercialTrialEvents")
    .where("actorUserId", "=", id)
    .execute();

  await transaction
    .deleteFrom("commercialTrials")
    .where("ownerUserId", "=", id)
    .execute();

  await transaction.deleteFrom("users").where("id", "=", id).execute();
}

export async function removeMultipleUsersFromFacility(
  userIds: string[],
  facilityId: string,
): Promise<void> {
  const sessionsToRevoke = await db
    .transaction()
    .execute(async (transaction) => {
      const revoke: string[] = [];
      for (const id of userIds) {
        if (
          await removeUserFromFacilityInTransaction(transaction, id, facilityId)
        ) {
          revoke.push(id);
        }
      }
      return revoke;
    });
  await Promise.all(sessionsToRevoke.map((id) => logoutAll(id)));
}

export async function deleteMultipleUsers(userIds: string[]): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    for (const id of userIds) {
      await deleteUserInTransaction(transaction, id);
    }
  });
}

export async function updateUserRole(
  id: string,
  facilityId: string,
  role: "member" | "trainer" | "admin",
): Promise<UserWithoutPassword> {
  return updateUser(id, facilityId, { role });
}
