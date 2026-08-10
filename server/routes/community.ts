import { randomUUID } from "node:crypto";
import {
  protectPrivateText,
  revealPrivateText,
} from "../lib/private-content-crypto.js";
import express from "express";
import { db } from "../db/client.js";
import {
  authenticate,
  getAuthenticatedUser,
} from "../middleware/authorization.js";
import {
  contactStatuses,
  communityStatuses,
  facilityLinkStatuses,
  institutionalPrinciples,
  parentalControlStatuses,
  profileVisibilities,
} from "../lib/community-policy.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";

export const communityRouter = express.Router();
communityRouter.use(authenticate);
communityRouter.use((req, res, next) =>
  req.method === "GET" ? next() : requireRecentFormVerification(req, res, next),
);

const usernamePattern = /^[a-z0-9][a-z0-9_.]{2,31}$/;
const privacyKeys = [
  "avatar",
  "bio",
  "realName",
  "birthDayMonth",
  "birthYear",
  "age",
  "facility",
];

function badRequest(res: express.Response, error: string) {
  res.status(400).json({ error, code: "VALIDATION_ERROR" });
}

function parsePrivacy(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.some(
      ([key, setting]) =>
        !privacyKeys.includes(key) ||
        !profileVisibilities.includes(setting as never),
    )
  )
    return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function isValidPastDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getTime() <= Date.now()
  );
}

function parseParentalSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowedKeys = new Set([
    "unknownMessages",
    "contactRequests",
    "files",
    "groupInvites",
  ]);
  const allowedValues = new Set(["allowed", "blocked", "approval_required"]);
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length > allowedKeys.size ||
    entries.some(
      ([key, setting]) =>
        !allowedKeys.has(key) ||
        typeof setting !== "string" ||
        !allowedValues.has(setting),
    )
  )
    return null;
  return Object.fromEntries(entries);
}

export async function canAccessChannel(
  userId: string,
  role: string,
  channelId: string,
) {
  const channel = await db
    .selectFrom("communityChannels")
    .selectAll()
    .where("id", "=", channelId)
    .executeTakeFirst();
  if (!channel) return null;
  if (channel.scope === "community") {
    const membership = await db
      .selectFrom("communityMembers")
      .select("userId")
      .where("channelId", "=", channel.id)
      .where("userId", "=", userId)
      .executeTakeFirst();
    return membership ? channel : null;
  }
  if (channel.scope !== "class" || role === "admin") return channel;
  if (role === "trainer") {
    const gymClass = await db
      .selectFrom("gymClasses")
      .select("trainerId")
      .where("id", "=", channel.scopeId)
      .executeTakeFirst();
    return gymClass?.trainerId === userId ? channel : null;
  }
  const booking = await db
    .selectFrom("bookings")
    .select("id")
    .where("classId", "=", channel.scopeId)
    .where("userId", "=", userId)
    .where("status", "in", ["confirmed", "waitlist"])
    .executeTakeFirst();
  return booking ? channel : null;
}

async function isCommunicationRestricted(userId: string) {
  const action = await db
    .selectFrom("moderationActions")
    .select(["state", "durationMinutes", "createdAt"])
    .where("subjectUserId", "=", userId)
    .orderBy("createdAt", "desc")
    .executeTakeFirst();
  if (!action || action.state === "unrestricted") return false;
  if (
    ![
      "muted",
      "removed_from_chat",
      "temporarily_blocked",
      "blocked_by_facility",
      "platform_suspended",
    ].includes(action.state)
  )
    return false;
  return (
    action.durationMinutes == null ||
    action.createdAt + action.durationMinutes * 60_000 > Date.now()
  );
}

async function canManageChannel(
  userId: string,
  role: string,
  channel: { id: string; scope: string; scopeId: string },
) {
  if (role === "admin") return true;
  if (channel.scope === "community") {
    const membership = await db
      .selectFrom("communityMembers")
      .select("role")
      .where("channelId", "=", channel.id)
      .where("userId", "=", userId)
      .executeTakeFirst();
    return membership?.role === "owner";
  }
  if (channel.scope === "class" && role === "trainer") {
    const gymClass = await db
      .selectFrom("gymClasses")
      .select("trainerId")
      .where("id", "=", channel.scopeId)
      .executeTakeFirst();
    return gymClass?.trainerId === userId;
  }
  return false;
}

communityRouter.get("/principles", (_req, res) =>
  res.json(institutionalPrinciples),
);

communityRouter.get("/profile", async (_req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    const profile = await db
      .selectFrom("socialProfiles")
      .selectAll()
      .where("userId", "=", userId)
      .executeTakeFirst();
    res.json(
      profile ? { ...profile, privacy: JSON.parse(profile.privacy) } : null,
    );
  } catch (error) {
    next(error);
  }
});

communityRouter.patch("/profile", async (req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    const username = String(req.body.username ?? "")
      .trim()
      .toLowerCase();
    const bio = String(req.body.bio ?? "").trim();
    const birthDate =
      req.body.birthDate == null || req.body.birthDate === ""
        ? null
        : String(req.body.birthDate);
    const privacy = parsePrivacy(req.body.privacy ?? {});
    if (!usernamePattern.test(username))
      return badRequest(
        res,
        "Username must contain 3-32 lowercase letters, numbers, dots or underscores",
      );
    if (bio.length > 300) return badRequest(res, "Biography is too long");
    if (birthDate && !isValidPastDate(birthDate))
      return badRequest(res, "Birth date is invalid");
    if (!privacy) return badRequest(res, "Privacy settings are invalid");
    const now = Date.now();
    await db
      .insertInto("socialProfiles")
      .values({
        userId,
        username,
        bio,
        displayRealName: req.body.displayRealName === true ? 1 : 0,
        birthDate,
        privacy: JSON.stringify(privacy),
        createdAt: now,
        updatedAt: now,
      })
      .onConflict((oc) =>
        oc.column("userId").doUpdateSet({
          username,
          bio,
          displayRealName: req.body.displayRealName === true ? 1 : 0,
          birthDate,
          privacy: JSON.stringify(privacy),
          updatedAt: now,
        }),
      )
      .execute();
    const saved = await db
      .selectFrom("socialProfiles")
      .selectAll()
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();
    res.json({ ...saved, privacy: JSON.parse(saved.privacy) });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      res
        .status(409)
        .json({ error: "Username is already in use", code: "USERNAME_TAKEN" });
      return;
    }
    next(error);
  }
});

communityRouter.get("/people", async (req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    const query = String(req.query.query ?? "")
      .trim()
      .toLowerCase()
      .replace(/[%_]/g, "");
    if (query.length < 2 || query.length > 64)
      return badRequest(res, "Search query must contain 2-64 characters");
    const contactRows = await db
      .selectFrom("internalContacts")
      .select(["requesterUserId", "recipientUserId"])
      .where("status", "=", "contact_accepted")
      .where((eb) =>
        eb.or([
          eb("requesterUserId", "=", userId),
          eb("recipientUserId", "=", userId),
        ]),
      )
      .execute();
    const acceptedContacts = new Set(
      contactRows.map((contact) =>
        contact.requesterUserId === userId
          ? contact.recipientUserId
          : contact.requesterUserId,
      ),
    );
    const rows = await db
      .selectFrom("socialProfiles")
      .innerJoin("users", "users.id", "socialProfiles.userId")
      .select([
        "socialProfiles.userId",
        "socialProfiles.username",
        "socialProfiles.bio",
        "socialProfiles.displayRealName",
        "socialProfiles.privacy",
        "users.name",
        "users.role",
        "users.avatarDataUrl",
      ])
      .where("socialProfiles.username", "like", `%${query}%`)
      .where("socialProfiles.userId", "!=", userId)
      .limit(20)
      .execute();
    res.json(
      rows.map((row) => {
        const privacy = JSON.parse(row.privacy) as Record<string, string>;
        const visibleInFacility = (value: string | undefined) =>
          value === "public" ||
          value === "facility" ||
          (value === "contacts" && acceptedContacts.has(row.userId));
        return {
          userId: row.userId,
          username: row.username,
          bio: visibleInFacility(privacy.bio) ? row.bio : "",
          name:
            row.displayRealName === 1 && visibleInFacility(privacy.realName)
              ? row.name
              : null,
          role: row.role,
          avatarDataUrl: visibleInFacility(privacy.avatar)
            ? row.avatarDataUrl
            : "",
        };
      }),
    );
  } catch (error) {
    next(error);
  }
});

communityRouter.get("/contacts", async (_req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    const rows = await db
      .selectFrom("internalContacts")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb("requesterUserId", "=", userId),
          eb("recipientUserId", "=", userId),
        ]),
      )
      .orderBy("updatedAt", "desc")
      .execute();
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

communityRouter.post("/contacts", async (req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    const recipientUserId = String(req.body.recipientUserId ?? "");
    if (!recipientUserId || recipientUserId === userId)
      return badRequest(res, "A different recipient is required");
    const recipient = await db
      .selectFrom("users")
      .select("id")
      .where("id", "=", recipientUserId)
      .executeTakeFirst();
    if (!recipient) return badRequest(res, "Recipient does not exist");
    const now = Date.now();
    const contact = {
      id: randomUUID(),
      requesterUserId: userId,
      recipientUserId,
      status: "contact_requested" as const,
      createdAt: now,
      updatedAt: now,
    };
    await db.insertInto("internalContacts").values(contact).execute();
    res.status(201).json(contact);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      res.status(409).json({ error: "A contact relationship already exists" });
      return;
    }
    next(error);
  }
});

communityRouter.patch("/contacts/:id", async (req, res, next) => {
  try {
    const { userId } = getAuthenticatedUser(res);
    const status = String(
      req.body.status ?? "",
    ) as (typeof contactStatuses)[number];
    if (!contactStatuses.includes(status))
      return badRequest(res, "Contact status is invalid");
    const contact = await db
      .selectFrom("internalContacts")
      .selectAll()
      .where("id", "=", req.params.id)
      .executeTakeFirst();
    if (
      !contact ||
      (contact.requesterUserId !== userId && contact.recipientUserId !== userId)
    )
      return res.status(404).json({ error: "Contact not found" });
    if (status === "contact_accepted" && contact.recipientUserId !== userId)
      return res
        .status(403)
        .json({ error: "Only the recipient can accept a request" });
    const isRequester = contact.requesterUserId === userId;
    const allowedTransitions: Record<string, string[]> = {
      contact_requested: [
        ...(isRequester ? ["contact_removed", "contact_blocked"] : []),
        ...(!isRequester
          ? ["contact_accepted", "contact_rejected", "contact_blocked"]
          : []),
      ],
      contact_accepted: ["contact_removed", "contact_blocked"],
      contact_rejected: isRequester ? ["contact_requested"] : [],
      contact_removed: isRequester ? ["contact_requested"] : [],
      contact_blocked: [],
    };
    if (!(allowedTransitions[contact.status] ?? []).includes(status))
      return res.status(409).json({
        error: "Contact status transition is not allowed",
        code: "INVALID_CONTACT_TRANSITION",
      });
    await db
      .updateTable("internalContacts")
      .set({ status, updatedAt: Date.now() })
      .where("id", "=", contact.id)
      .execute();
    res.json({ ...contact, status });
  } catch (error) {
    next(error);
  }
});

communityRouter.get("/channels", async (_req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const channels = await db
      .selectFrom("communityChannels")
      .selectAll()
      .orderBy("updatedAt", "desc")
      .execute();
    const allowed = [];
    for (const channel of channels)
      if (await canAccessChannel(auth.userId, auth.role, channel.id))
        allowed.push(channel);
    res.json(allowed);
  } catch (error) {
    next(error);
  }
});

communityRouter.post("/channels", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const scope = String(req.body.scope ?? "");
    const requestedScopeId = String(req.body.scopeId ?? "").trim();
    const name = String(req.body.name ?? "").trim();
    if (
      !(["facility", "class", "community"] as string[]).includes(scope) ||
      (scope !== "community" && !requestedScopeId) ||
      name.length < 2 ||
      name.length > 80
    )
      return badRequest(res, "Channel data is invalid");
    if (
      scope !== "community" &&
      !(["admin", "trainer"] as string[]).includes(auth.role)
    )
      return res.status(403).json({ error: "Staff access required" });
    const scopeId = scope === "community" ? auth.userId : requestedScopeId;
    if (scope === "facility" && scopeId !== "primary")
      return badRequest(res, "Facility channel scope is invalid");
    if (scope === "class") {
      const gymClass = await db
        .selectFrom("gymClasses")
        .select("trainerId")
        .where("id", "=", scopeId)
        .executeTakeFirst();
      if (!gymClass) return badRequest(res, "Class does not exist");
      if (auth.role === "trainer" && gymClass.trainerId !== auth.userId)
        return res
          .status(403)
          .json({ error: "This class is not assigned to you" });
    }
    const now = Date.now();
    const channel = {
      id: randomUUID(),
      scope: scope as "facility" | "class" | "community",
      scopeId,
      name,
      status: "community_active" as const,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    };
    await db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("communityChannels")
        .values(channel)
        .execute();
      if (channel.scope === "community") {
        await transaction
          .insertInto("communityMembers")
          .values({
            channelId: channel.id,
            userId: auth.userId,
            role: "owner",
            createdAt: now,
          })
          .execute();
      }
    });
    res.status(201).json(channel);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      res
        .status(409)
        .json({ error: "A channel with this name already exists" });
      return;
    }
    next(error);
  }
});

communityRouter.patch("/channels/:id", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const channel = await db
      .selectFrom("communityChannels")
      .selectAll()
      .where("id", "=", req.params.id)
      .executeTakeFirst();
    if (!channel || !(await canManageChannel(auth.userId, auth.role, channel)))
      return res.status(404).json({ error: "Manageable channel not found" });
    const status =
      req.body.status == null
        ? channel.status
        : (String(req.body.status) as (typeof communityStatuses)[number]);
    const name =
      req.body.name == null ? channel.name : String(req.body.name).trim();
    if (!communityStatuses.includes(status))
      return badRequest(res, "Channel status is invalid");
    if (name.length < 2 || name.length > 80)
      return badRequest(res, "Channel name is invalid");
    const transitions: Record<string, string[]> = {
      community_active: [
        "community_active",
        "community_read_only",
        "community_suspended",
        "community_closed",
      ],
      community_read_only: [
        "community_active",
        "community_read_only",
        "community_suspended",
        "community_closed",
      ],
      community_suspended: [
        "community_active",
        "community_suspended",
        "community_closed",
      ],
      community_closed: ["community_closed"],
    };
    if (!(transitions[channel.status] ?? []).includes(status))
      return res
        .status(409)
        .json({ error: "Channel cannot change to that state" });
    const updatedAt = Date.now();
    await db
      .updateTable("communityChannels")
      .set({ name, status, updatedAt })
      .where("id", "=", channel.id)
      .execute();
    res.json({ ...channel, name, status, updatedAt });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      res
        .status(409)
        .json({ error: "A channel with this name already exists" });
      return;
    }
    next(error);
  }
});

communityRouter.get("/channels/:id/messages", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const channel = await canAccessChannel(
      auth.userId,
      auth.role,
      req.params.id,
    );
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    let messages = await db
      .selectFrom("communityMessages")
      .innerJoin("users", "users.id", "communityMessages.authorUserId")
      .leftJoin(
        "socialProfiles",
        "socialProfiles.userId",
        "communityMessages.authorUserId",
      )
      .select([
        "communityMessages.id",
        "communityMessages.channelId",
        "communityMessages.authorUserId",
        "communityMessages.parentId",
        "communityMessages.body",
        "communityMessages.protectedBody",
        "communityMessages.kind",
        "communityMessages.pinned",
        "communityMessages.status",
        "communityMessages.createdAt",
        "communityMessages.updatedAt",
        "users.name as accountName",
        "users.role as authorRole",
        "socialProfiles.username as authorUsername",
      ])
      .where("channelId", "=", channel.id)
      .orderBy("communityMessages.createdAt")
      .limit(200)
      .execute();
    if (auth.role === "member")
      messages = messages.filter(
        (message) =>
          message.kind === "public" || message.authorUserId === auth.userId,
      );
    res.json(
      messages.map(
        ({ accountName, authorUsername, protectedBody, ...message }) => ({
          ...message,
          body: protectedBody
            ? revealPrivateText(
                protectedBody,
                `community-message:${message.id}`,
              )
            : message.body,
          authorName: authorUsername ? `@${authorUsername}` : accountName,
        }),
      ),
    );
  } catch (error) {
    next(error);
  }
});

communityRouter.post("/channels/:id/messages", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    if (await isCommunicationRestricted(auth.userId))
      return res.status(403).json({
        error: "Your current moderation state does not allow messages",
        code: "COMMUNICATION_RESTRICTED",
      });
    const channel = await canAccessChannel(
      auth.userId,
      auth.role,
      req.params.id,
    );
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    if (channel.status !== "community_active")
      return res
        .status(409)
        .json({ error: "Channel does not accept new messages" });
    const body = String(req.body.body ?? "").trim();
    const kind = (
      req.body.kind === "private_justification"
        ? "private_justification"
        : "public"
    ) as "private_justification" | "public";
    if (!body || body.length > 4000)
      return badRequest(res, "Message must contain 1-4000 characters");
    if (kind === "private_justification" && channel.scope !== "class")
      return badRequest(
        res,
        "Private justifications belong to a class channel",
      );
    const parentId = req.body.parentId ? String(req.body.parentId) : null;
    if (parentId) {
      const parent = await db
        .selectFrom("communityMessages")
        .select("channelId")
        .where("id", "=", parentId)
        .executeTakeFirst();
      if (parent?.channelId !== channel.id)
        return badRequest(res, "Reply target is invalid");
    }
    const now = Date.now();
    const messageId = randomUUID();
    const serverManagedPrivateMessage = channel.scope === "community";
    const protectedBody =
      kind === "private_justification" || serverManagedPrivateMessage
        ? protectPrivateText(body, `community-message:${messageId}`)
        : null;
    const message = {
      id: messageId,
      channelId: channel.id,
      authorUserId: auth.userId,
      parentId,
      body: protectedBody === body ? body : "[protected]",
      protectedBody: protectedBody === body ? null : protectedBody,
      kind,
      pinned: 0 as const,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };
    await db.insertInto("communityMessages").values(message).execute();
    const { protectedBody: _protectedBody, ...response } = message;
    res.status(201).json({ ...response, body });
  } catch (error) {
    next(error);
  }
});

communityRouter.post("/channels/:id/members", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const channel = await canAccessChannel(
      auth.userId,
      auth.role,
      req.params.id,
    );
    if (!channel || channel.scope !== "community")
      return res.status(404).json({ error: "Community not found" });
    const owner = await db
      .selectFrom("communityMembers")
      .select("role")
      .where("channelId", "=", channel.id)
      .where("userId", "=", auth.userId)
      .executeTakeFirst();
    if (owner?.role !== "owner")
      return res.status(403).json({ error: "Community owner access required" });
    const userId = String(req.body.userId ?? "");
    const contact = await db
      .selectFrom("internalContacts")
      .select("id")
      .where("status", "=", "contact_accepted")
      .where((eb) =>
        eb.or([
          eb.and([
            eb("requesterUserId", "=", auth.userId),
            eb("recipientUserId", "=", userId),
          ]),
          eb.and([
            eb("requesterUserId", "=", userId),
            eb("recipientUserId", "=", auth.userId),
          ]),
        ]),
      )
      .executeTakeFirst();
    if (!contact)
      return res.status(400).json({
        error: "Only accepted contacts can join a personal community",
      });
    await db
      .insertInto("communityMembers")
      .values({
        channelId: channel.id,
        userId,
        role: "member",
        createdAt: Date.now(),
      })
      .onConflict((oc) => oc.columns(["channelId", "userId"]).doNothing())
      .execute();
    res.status(201).json({ channelId: channel.id, userId, role: "member" });
  } catch (error) {
    next(error);
  }
});

communityRouter.get("/facility-links", async (_req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    if (auth.role !== "admin")
      return res.status(403).json({ error: "Admin access required" });
    res.json(
      await db
        .selectFrom("facilityLinks")
        .selectAll()
        .orderBy("updatedAt", "desc")
        .execute(),
    );
  } catch (error) {
    next(error);
  }
});
communityRouter.post("/facility-links", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    if (auth.role !== "admin")
      return res.status(403).json({ error: "Admin access required" });
    const targetFacilityName = String(req.body.targetFacilityName ?? "").trim();
    const reason = String(req.body.reason ?? "").trim();
    const mode = String(req.body.mode ?? "temporary") as
      "permanent" | "temporary";
    const sharedSpaces = Array.isArray(req.body.sharedSpaces)
      ? req.body.sharedSpaces
      : [];
    const allowedSharedSpaces = new Set([
      "announcements",
      "events",
      "class_channels",
      "communities",
    ]);
    const expiresAt =
      req.body.expiresAt == null ? null : Number(req.body.expiresAt);
    if (targetFacilityName.length < 2 || targetFacilityName.length > 120)
      return badRequest(res, "Target facility is invalid");
    if (!(mode === "temporary" || mode === "permanent"))
      return badRequest(res, "Facility link mode is invalid");
    if (reason.length > 500)
      return badRequest(res, "Facility link reason is too long");
    if (
      sharedSpaces.length > allowedSharedSpaces.size ||
      sharedSpaces.some(
        (space: unknown) =>
          typeof space !== "string" || !allowedSharedSpaces.has(space),
      )
    )
      return badRequest(res, "Shared spaces are invalid");
    if (
      expiresAt != null &&
      (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
    )
      return badRequest(res, "Expiration date is invalid");
    const now = Date.now();
    const link = {
      id: randomUUID(),
      sourceFacilityId: "primary",
      targetFacilityName,
      reason,
      mode,
      sharedSpaces: JSON.stringify(sharedSpaces),
      status: "facility_link_requested" as const,
      expiresAt,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    };
    await db.insertInto("facilityLinks").values(link).execute();
    res.status(201).json(link);
  } catch (error) {
    next(error);
  }
});
communityRouter.patch("/facility-links/:id", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    if (auth.role !== "admin")
      return res.status(403).json({ error: "Admin access required" });
    const status = String(
      req.body.status ?? "",
    ) as (typeof facilityLinkStatuses)[number];
    if (!facilityLinkStatuses.includes(status))
      return badRequest(res, "Facility link status is invalid");
    const result = await db
      .updateTable("facilityLinks")
      .set({ status, updatedAt: Date.now() })
      .where("id", "=", req.params.id)
      .executeTakeFirst();
    if (!Number(result.numUpdatedRows))
      return res.status(404).json({ error: "Facility link not found" });
    res.json({ id: req.params.id, status });
  } catch (error) {
    next(error);
  }
});

communityRouter.get("/parental-controls", async (_req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const query = db.selectFrom("parentalControls").selectAll();
    res.json(
      await (
        auth.role === "admin"
          ? query
          : query.where((eb) =>
              eb.or([
                eb("childUserId", "=", auth.userId),
                eb("guardianUserId", "=", auth.userId),
              ]),
            )
      ).execute(),
    );
  } catch (error) {
    next(error);
  }
});
communityRouter.post("/parental-controls", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    if (auth.role !== "admin")
      return res.status(403).json({ error: "Admin review is required" });
    const childUserId = String(req.body.childUserId ?? "");
    const guardianUserId = String(req.body.guardianUserId ?? "");
    const settings = parseParentalSettings(req.body.settings ?? {});
    if (!childUserId || !guardianUserId || childUserId === guardianUserId)
      return badRequest(res, "Child and guardian are required");
    if (!settings) return badRequest(res, "Parental settings are invalid");
    const accounts = await db
      .selectFrom("users")
      .select("id")
      .where("id", "in", [childUserId, guardianUserId])
      .execute();
    if (accounts.length !== 2)
      return badRequest(res, "Child or guardian account does not exist");
    const now = Date.now();
    const control = {
      id: randomUUID(),
      childUserId,
      guardianUserId,
      settings: JSON.stringify(settings),
      status: "parental_control_pending" as const,
      createdAt: now,
      updatedAt: now,
    };
    await db.insertInto("parentalControls").values(control).execute();
    res.status(201).json(control);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      res.status(409).json({ error: "Parental control already exists" });
      return;
    }
    next(error);
  }
});
communityRouter.patch("/parental-controls/:id", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const control = await db
      .selectFrom("parentalControls")
      .selectAll()
      .where("id", "=", req.params.id)
      .executeTakeFirst();
    if (
      !control ||
      (auth.role !== "admin" && control.guardianUserId !== auth.userId)
    )
      return res.status(404).json({ error: "Parental control not found" });
    const status =
      req.body.status == null
        ? control.status
        : (String(req.body.status) as (typeof parentalControlStatuses)[number]);
    if (!parentalControlStatuses.includes(status))
      return badRequest(res, "Parental control status is invalid");
    const settings =
      req.body.settings == null
        ? JSON.parse(control.settings)
        : parseParentalSettings(req.body.settings);
    if (!settings) return badRequest(res, "Parental settings are invalid");
    if (
      auth.role !== "admin" &&
      ![
        "parental_control_active",
        "parental_control_inactive",
        "parental_control_ended",
      ].includes(status)
    )
      return res.status(403).json({ error: "Admin review is required" });
    await db
      .updateTable("parentalControls")
      .set({
        status,
        settings: JSON.stringify(settings),
        updatedAt: Date.now(),
      })
      .where("id", "=", control.id)
      .execute();
    res.json({
      ...control,
      status,
      settings,
    });
  } catch (error) {
    next(error);
  }
});
