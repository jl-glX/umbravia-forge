import { db } from "../db/client.js";
import { hashPassword, isStrongPassword, logoutAll } from "./auth.js";
import { randomBytes } from "crypto";
import { ensureSupportIdentifier } from "./support-identifiers.js";
import type { Transaction } from "kysely";
import type { Database } from "../db/types.js";

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
  | "moderation_appeals";

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

export async function getAllUsers(): Promise<UserWithoutPassword[]> {
  const users = await db
    .selectFrom("users")
    .select(["id", "email", "name", "role", "createdAt"])
    .orderBy("createdAt", "desc")
    .execute();

  return users;
}

export async function getUserById(
  id: string,
): Promise<UserWithoutPassword | null> {
  const user = await db
    .selectFrom("users")
    .select(["id", "email", "name", "role", "createdAt"])
    .where("id", "=", id)
    .executeTakeFirst();

  return user || null;
}

export async function createUser(
  email: string,
  name: string,
  password: string,
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

  await db
    .insertInto("users")
    .values({
      id: userId,
      email,
      phone: null,
      name,
      avatarDataUrl: "",
      password: hashedPassword,
      role,
      sessionIdleTimeoutMinutes: 7 * 24 * 60,
      createdAt: Date.now(),
    })
    .execute();

  await ensureSupportIdentifier(userId);
  return {
    id: userId,
    email,
    name,
    role,
    createdAt: Date.now(),
  };
}

export async function updateUser(
  id: string,
  updates: {
    email?: string;
    name?: string;
    password?: string;
    role?: "member" | "trainer" | "admin";
  },
): Promise<UserWithoutPassword> {
  const user = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!user) {
    throw new Error("User not found");
  }

  // Validate email uniqueness if changing email
  if (updates.email && updates.email !== user.email) {
    const existingUser = await db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", updates.email)
      .executeTakeFirst();

    if (existingUser) {
      throw new Error("Email already in use");
    }
  }

  const updateValues: Record<string, unknown> = {};

  if (updates.email) updateValues.email = updates.email;
  if (updates.name) updateValues.name = updates.name;
  if (updates.role) updateValues.role = updates.role;

  if (updates.password) {
    if (!isStrongPassword(updates.password)) {
      throw new Error("Password does not meet the security requirements");
    }
    updateValues.password = await hashPassword(updates.password);
  }

  await db
    .updateTable("users")
    .set(updateValues)
    .where("id", "=", id)
    .execute();

  if (updates.password) {
    await logoutAll(id);
  }
  if (updates.role && updates.role !== user.role) {
    // A role change alters the authorization boundary. Existing sessions must
    // authenticate again through the portal appropriate for the new role.
    await logoutAll(id);
  }

  const updatedUser = await db
    .selectFrom("users")
    .select(["id", "email", "name", "role", "createdAt"])
    .where("id", "=", id)
    .executeTakeFirst();

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

async function deleteUserInTransaction(
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

export async function deleteMultipleUsers(userIds: string[]): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    for (const id of userIds) {
      await deleteUserInTransaction(transaction, id);
    }
  });
}

export async function updateUserRole(
  id: string,
  role: "member" | "trainer" | "admin",
): Promise<UserWithoutPassword> {
  return updateUser(id, { role });
}
