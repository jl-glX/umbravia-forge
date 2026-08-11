import { randomUUID } from "node:crypto";
import {
  privateContentNeedsRewrap,
  protectPrivateText,
  revealPrivateText,
  rewrapPrivateText,
} from "../lib/private-content-crypto.js";
import express from "express";
import { db } from "../db/client.js";
import {
  authenticate,
  getAuthenticatedUser,
  getFacilityContext,
  requireFacility,
  selectFacilityContext,
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
import {
  CommunityAttachmentError,
  communityAttachmentLimitBytes,
  deleteCommunityAttachment,
  listCommunityAttachments,
  readCommunityAttachment,
  storeCommunityAttachment,
} from "../services/community-attachments.js";
import { recordSecurityEvent } from "../services/security-events.js";

export const communityRouter = express.Router();
communityRouter.use(authenticate, selectFacilityContext, requireFacility());
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

function canAdministerFacility(res: express.Response): boolean {
  const role = getFacilityContext(res).role;
  return role === "owner" || role === "admin";
}

function handleCommunityAttachmentError(
  error: unknown,
  res: express.Response,
  next: express.NextFunction,
) {
  if (error instanceof CommunityAttachmentError) {
    res
      .status(error.statusCode)
      .json({ error: error.message, code: error.code });
    return;
  }
  next(error);
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
  facilityId: string,
  facilityRole: string,
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
  if (channel.scope === "facility") {
    return channel.scopeId === facilityId ? channel : null;
  }
  const gymClass = await db
    .selectFrom("gymClasses")
    .select(["trainerId", "facilityId"])
    .where("id", "=", channel.scopeId)
    .executeTakeFirst();
  if (!gymClass || gymClass.facilityId !== facilityId) return null;
  if (facilityRole === "owner" || facilityRole === "admin") return channel;
  if (facilityRole === "trainer") {
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

async function isCommunicationRestricted(
  userId: string,
  facilityId: string | null,
) {
  const action = await db
    .selectFrom("moderationActions")
    .innerJoin(
      "moderationCases",
      "moderationCases.id",
      "moderationActions.caseId",
    )
    .select([
      "moderationActions.state as state",
      "moderationActions.durationMinutes as durationMinutes",
      "moderationActions.createdAt as createdAt",
    ])
    .where("moderationActions.subjectUserId", "=", userId)
    .where((expression) =>
      expression.or([
        expression("moderationActions.state", "=", "platform_suspended"),
        ...(facilityId
          ? [expression("moderationCases.facilityId", "=", facilityId)]
          : []),
      ]),
    )
    .orderBy("moderationActions.createdAt", "desc")
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
  facilityId: string,
  facilityRole: string,
  channel: { id: string; scope: string; scopeId: string },
) {
  if (channel.scope === "community") {
    const membership = await db
      .selectFrom("communityMembers")
      .select("role")
      .where("channelId", "=", channel.id)
      .where("userId", "=", userId)
      .executeTakeFirst();
    return membership?.role === "owner";
  }
  if (channel.scope === "facility") {
    return (
      channel.scopeId === facilityId &&
      (facilityRole === "owner" || facilityRole === "admin")
    );
  }
  if (channel.scope === "class") {
    const gymClass = await db
      .selectFrom("gymClasses")
      .select(["trainerId", "facilityId"])
      .where("id", "=", channel.scopeId)
      .executeTakeFirst();
    if (!gymClass || gymClass.facilityId !== facilityId) return false;
    return (
      facilityRole === "owner" ||
      facilityRole === "admin" ||
      (facilityRole === "trainer" && gymClass.trainerId === userId)
    );
  }
  return false;
}

communityRouter.get("/principles", (_req, res) =>
  res.json(institutionalPrinciples),
);

communityRouter.get("/search/messages", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const facility = getFacilityContext(res);
    const search = String(req.query.q ?? "").trim();
    if (search.length < 2 || search.length > 120) {
      return badRequest(res, "Search must contain 2-120 characters");
    }
    const normalized = search.toLocaleLowerCase();
    const candidates = await db
      .selectFrom("communityMessages")
      .innerJoin(
        "communityChannels",
        "communityChannels.id",
        "communityMessages.channelId",
      )
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
        "communityMessages.body",
        "communityMessages.createdAt",
        "communityChannels.name as channelName",
        "communityChannels.scope as channelScope",
        "users.name as accountName",
        "socialProfiles.username as authorUsername",
      ])
      .where("communityMessages.status", "=", "active")
      .where("communityMessages.kind", "=", "public")
      .where("communityMessages.protectedBody", "is", null)
      .where("communityChannels.scope", "in", ["facility", "class"])
      .orderBy("communityMessages.createdAt", "desc")
      .limit(500)
      .execute();

    const results: Array<{
      id: string;
      channelId: string;
      channelName: string;
      channelScope: string;
      authorUserId: string;
      authorName: string;
      body: string;
      createdAt: number;
    }> = [];
    for (const candidate of candidates) {
      if (!candidate.body.toLocaleLowerCase().includes(normalized)) continue;
      const channel = await canAccessChannel(
        auth.userId,
        facility.id,
        facility.role,
        candidate.channelId,
      );
      if (!channel) continue;
      results.push({
        id: candidate.id,
        channelId: candidate.channelId,
        channelName: candidate.channelName,
        channelScope: candidate.channelScope,
        authorUserId: candidate.authorUserId,
        authorName: candidate.authorUsername
          ? `@${candidate.authorUsername}`
          : candidate.accountName,
        body: candidate.body,
        createdAt: candidate.createdAt,
      });
      if (results.length === 50) break;
    }
    res.json({ query: search, results });
  } catch (error) {
    next(error);
  }
});

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
    const facilityId = getFacilityContext(res).id;
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
      .innerJoin(
        "facilityMemberships",
        "facilityMemberships.userId",
        "socialProfiles.userId",
      )
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
      .where("facilityMemberships.facilityId", "=", facilityId)
      .where("facilityMemberships.status", "=", "active")
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
    const facilityId = getFacilityContext(res).id;
    const recipientUserId = String(req.body.recipientUserId ?? "");
    if (!recipientUserId || recipientUserId === userId)
      return badRequest(res, "A different recipient is required");
    const recipient = await db
      .selectFrom("facilityMemberships")
      .select("id")
      .where("facilityId", "=", facilityId)
      .where("userId", "=", recipientUserId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!recipient)
      return badRequest(res, "Recipient is not an active facility member");
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
    const facility = getFacilityContext(res);
    const channels = await db
      .selectFrom("communityChannels")
      .selectAll()
      .orderBy("updatedAt", "desc")
      .execute();
    const allowed = [];
    for (const channel of channels)
      if (
        await canAccessChannel(
          auth.userId,
          facility.id,
          facility.role,
          channel.id,
        )
      )
        allowed.push(channel);
    res.json(allowed);
  } catch (error) {
    next(error);
  }
});

communityRouter.post("/channels", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const facility = getFacilityContext(res);
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
      !(["owner", "admin", "trainer"] as string[]).includes(facility.role)
    )
      return res.status(403).json({ error: "Staff access required" });
    const scopeId = scope === "community" ? auth.userId : requestedScopeId;
    if (scope === "facility" && scopeId !== facility.id)
      return badRequest(res, "Facility channel scope is invalid");
    if (scope === "class") {
      const gymClass = await db
        .selectFrom("gymClasses")
        .select(["trainerId", "facilityId"])
        .where("id", "=", scopeId)
        .executeTakeFirst();
      if (!gymClass || gymClass.facilityId !== facility.id)
        return badRequest(res, "Class does not exist in the selected facility");
      if (facility.role === "trainer" && gymClass.trainerId !== auth.userId)
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
    const facility = getFacilityContext(res);
    const channel = await db
      .selectFrom("communityChannels")
      .selectAll()
      .where("id", "=", req.params.id)
      .executeTakeFirst();
    if (
      !channel ||
      !(await canManageChannel(
        auth.userId,
        facility.id,
        facility.role,
        channel,
      ))
    )
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
    const facility = getFacilityContext(res);
    const channel = await canAccessChannel(
      auth.userId,
      facility.id,
      facility.role,
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
    if (facility.role === "member")
      messages = messages.filter(
        (message) =>
          message.kind === "public" || message.authorUserId === auth.userId,
      );
    let accessedPrivateMessages = 0;
    let rewrappedPrivateMessages = 0;
    const response = await Promise.all(
      messages.map(
        async ({ accountName, authorUsername, protectedBody, ...message }) => {
          let body = message.body;
          if (protectedBody) {
            accessedPrivateMessages += 1;
            const context = `community-message:${message.id}`;
            body = revealPrivateText(protectedBody, context);
            if (privateContentNeedsRewrap(protectedBody)) {
              const rewrapped = rewrapPrivateText(protectedBody, context);
              await db
                .updateTable("communityMessages")
                .set({ protectedBody: rewrapped })
                .where("id", "=", message.id)
                .where("protectedBody", "=", protectedBody)
                .execute();
              rewrappedPrivateMessages += 1;
            }
          }
          return {
            ...message,
            body,
            authorName: authorUsername ? `@${authorUsername}` : accountName,
          };
        },
      ),
    );
    if (accessedPrivateMessages > 0) {
      await recordSecurityEvent("private_content_accessed", auth.userId, {
        resourceType: "community_messages",
        channelId: channel.id,
        count: accessedPrivateMessages,
      });
    }
    if (rewrappedPrivateMessages > 0) {
      await recordSecurityEvent("private_content_rewrapped", auth.userId, {
        resourceType: "community_messages",
        channelId: channel.id,
        count: rewrappedPrivateMessages,
      });
    }
    res.json(response);
  } catch (error) {
    next(error);
  }
});

communityRouter.post("/channels/:id/messages", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const facility = getFacilityContext(res);
    const channel = await canAccessChannel(
      auth.userId,
      facility.id,
      facility.role,
      req.params.id,
    );
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    if (
      await isCommunicationRestricted(
        auth.userId,
        channel.scope === "community" ? null : facility.id,
      )
    )
      return res.status(403).json({
        error: "Your current moderation state does not allow messages",
        code: "COMMUNICATION_RESTRICTED",
      });
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
      body: protectedBody ? "[protected]" : body,
      protectedBody,
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

communityRouter.get("/channels/:id/attachments", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    res.json(await listCommunityAttachments(auth, req.params.id));
  } catch (error) {
    handleCommunityAttachmentError(error, res, next);
  }
});

communityRouter.post(
  "/channels/:id/attachments",
  express.raw({
    type: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "text/plain",
    ],
    limit: `${communityAttachmentLimitBytes()}b`,
  }),
  async (req, res, next) => {
    try {
      const auth = getAuthenticatedUser(res);
      const attachment = await storeCommunityAttachment(auth, req.params.id, {
        body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        fileName: req.get("x-file-name") ?? "",
        mimeType: (req.get("content-type") ?? "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase(),
        messageId: req.get("x-message-id") ?? null,
      });
      res.status(201).json(attachment);
    } catch (error) {
      handleCommunityAttachmentError(error, res, next);
    }
  },
);

communityRouter.get(
  "/channels/:id/attachments/:attachmentId",
  async (req, res, next) => {
    try {
      const auth = getAuthenticatedUser(res);
      const { attachment, body } = await readCommunityAttachment(
        auth,
        req.params.id,
        req.params.attachmentId,
      );
      res.type(attachment.mimeType);
      res.attachment(attachment.fileName);
      res.send(body);
    } catch (error) {
      handleCommunityAttachmentError(error, res, next);
    }
  },
);

communityRouter.delete(
  "/channels/:id/attachments/:attachmentId",
  async (req, res, next) => {
    try {
      const auth = getAuthenticatedUser(res);
      await deleteCommunityAttachment(
        auth,
        req.params.id,
        req.params.attachmentId,
      );
      res.status(204).end();
    } catch (error) {
      handleCommunityAttachmentError(error, res, next);
    }
  },
);

communityRouter.post("/channels/:id/members", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const facility = getFacilityContext(res);
    const channel = await canAccessChannel(
      auth.userId,
      facility.id,
      facility.role,
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
    const facilityId = getFacilityContext(res).id;
    if (!canAdministerFacility(res))
      return res.status(403).json({ error: "Admin access required" });
    res.json(
      await db
        .selectFrom("facilityLinks")
        .selectAll()
        .where("sourceFacilityId", "=", facilityId)
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
    const facilityId = getFacilityContext(res).id;
    if (!canAdministerFacility(res))
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
      sourceFacilityId: facilityId,
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
    const facilityId = getFacilityContext(res).id;
    if (!canAdministerFacility(res))
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
      .where("sourceFacilityId", "=", facilityId)
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
    const facilityId = getFacilityContext(res).id;
    const query = db
      .selectFrom("parentalControls")
      .selectAll()
      .where("facilityId", "=", facilityId);
    res.json(
      await (
        canAdministerFacility(res)
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
    const facilityId = getFacilityContext(res).id;
    if (!canAdministerFacility(res))
      return res.status(403).json({ error: "Admin review is required" });
    const childUserId = String(req.body.childUserId ?? "");
    const guardianUserId = String(req.body.guardianUserId ?? "");
    const settings = parseParentalSettings(req.body.settings ?? {});
    if (!childUserId || !guardianUserId || childUserId === guardianUserId)
      return badRequest(res, "Child and guardian are required");
    if (!settings) return badRequest(res, "Parental settings are invalid");
    const accounts = await db
      .selectFrom("facilityMemberships")
      .select("userId")
      .where("facilityId", "=", facilityId)
      .where("userId", "in", [childUserId, guardianUserId])
      .where("status", "=", "active")
      .execute();
    if (accounts.length !== 2)
      return badRequest(res, "Child or guardian account does not exist");
    const now = Date.now();
    const control = {
      id: randomUUID(),
      facilityId,
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
    const facilityId = getFacilityContext(res).id;
    const control = await db
      .selectFrom("parentalControls")
      .selectAll()
      .where("id", "=", req.params.id)
      .where("facilityId", "=", facilityId)
      .executeTakeFirst();
    if (
      !control ||
      (!canAdministerFacility(res) && control.guardianUserId !== auth.userId)
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
      !canAdministerFacility(res) &&
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
