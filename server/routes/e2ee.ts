import { randomUUID } from "node:crypto";
import express from "express";
import { db } from "../db/client.js";
import {
  authenticate,
  getAuthenticatedUser,
} from "../middleware/authorization.js";

export const e2eeRouter = express.Router();
e2eeRouter.use(authenticate);
e2eeRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const opaquePattern = /^[A-Za-z0-9_-]+={0,2}$/;
const deviceIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const capabilityPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_PREKEYS_PER_REQUEST = 100;
const MAX_ENVELOPE_BYTES = 24_576;
const forbiddenSecretFields = new Set([
  "body",
  "plaintext",
  "privateKey",
  "identityPrivateKey",
  "sessionState",
  "password",
]);

type OpaqueKey = { keyId: number; publicKey: string };

function badRequest(res: express.Response, error: string) {
  res.status(400).json({ error, code: "VALIDATION_ERROR" });
}

function isOpaque(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value, "utf8") > 0 &&
    Buffer.byteLength(value, "utf8") <= maxLength &&
    opaquePattern.test(value)
  );
}

function containsForbiddenSecretFields(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 3) return false;
  if (Array.isArray(value)) {
    return value.some((entry) =>
      containsForbiddenSecretFields(entry, depth + 1),
    );
  }
  return Object.entries(value).some(
    ([key, entry]) =>
      forbiddenSecretFields.has(key) ||
      containsForbiddenSecretFields(entry, depth + 1),
  );
}

function isKeyId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parsePrekeys(value: unknown): OpaqueKey[] | null {
  if (!Array.isArray(value) || value.length > MAX_PREKEYS_PER_REQUEST)
    return null;
  const seen = new Set<number>();
  const result: OpaqueKey[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return null;
    const { keyId, publicKey } = candidate as Record<string, unknown>;
    if (!isKeyId(keyId) || !isOpaque(publicKey, 2048) || seen.has(keyId))
      return null;
    seen.add(keyId);
    result.push({ keyId, publicKey });
  }
  return result;
}

function normalizedParticipants(first: string, second: string) {
  return first < second
    ? ([first, second] as const)
    : ([second, first] as const);
}

async function hasAcceptedContact(first: string, second: string) {
  return Boolean(
    await db
      .selectFrom("internalContacts")
      .select("id")
      .where("status", "=", "contact_accepted")
      .where((eb) =>
        eb.or([
          eb.and([
            eb("requesterUserId", "=", first),
            eb("recipientUserId", "=", second),
          ]),
          eb.and([
            eb("requesterUserId", "=", second),
            eb("recipientUserId", "=", first),
          ]),
        ]),
      )
      .executeTakeFirst(),
  );
}

async function requireOwnedActiveDevice(userId: string, deviceId: string) {
  return db
    .selectFrom("e2eeDevices")
    .selectAll()
    .where("id", "=", deviceId)
    .where("userId", "=", userId)
    .where("revokedAt", "is", null)
    .executeTakeFirst();
}

async function requireConversationMember(
  userId: string,
  conversationId: string,
) {
  return db
    .selectFrom("e2eeConversations")
    .selectAll()
    .where("id", "=", conversationId)
    .where((eb) =>
      eb.or([
        eb("participantAUserId", "=", userId),
        eb("participantBUserId", "=", userId),
      ]),
    )
    .executeTakeFirst();
}

e2eeRouter.get("/status", (_req, res) => {
  res.json({
    version: "e2ee-relay-v1",
    mode: "one_to_one_opaque_relay",
    serverCanDecrypt: false,
    signalProvider: "client_adapter_required",
    capabilities: [
      "multi_device",
      "one_time_prekeys",
      "opaque_envelopes",
      "delivery_receipts",
      "device_revocation",
    ],
  });
});

e2eeRouter.post("/devices", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    if (containsForbiddenSecretFields(req.body)) {
      badRequest(res, "Private key material must never be sent to the server");
      return;
    }
    const {
      clientDeviceId,
      registrationId,
      identityKey,
      signedPrekeyId,
      signedPrekey,
      signedPrekeySignature,
      capabilityVersion,
      oneTimePrekeys,
    } = req.body ?? {};
    const parsedPrekeys = parsePrekeys(oneTimePrekeys ?? []);
    if (
      typeof clientDeviceId !== "string" ||
      !deviceIdPattern.test(clientDeviceId) ||
      !Number.isInteger(registrationId) ||
      registrationId < 1 ||
      registrationId > 16_380 ||
      !isOpaque(identityKey, 2048) ||
      !isKeyId(signedPrekeyId) ||
      !isOpaque(signedPrekey, 2048) ||
      !isOpaque(signedPrekeySignature, 2048) ||
      typeof capabilityVersion !== "string" ||
      !capabilityPattern.test(capabilityVersion) ||
      !parsedPrekeys
    ) {
      badRequest(res, "Invalid E2EE device bundle");
      return;
    }

    const now = Date.now();
    const result = await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("e2eeDevices")
        .select("id")
        .where("userId", "=", auth.userId)
        .where("clientDeviceId", "=", clientDeviceId)
        .executeTakeFirst();
      const id = existing?.id ?? randomUUID();
      if (existing) {
        await trx
          .updateTable("e2eeDevices")
          .set({
            registrationId,
            identityKey,
            signedPrekeyId,
            signedPrekey,
            signedPrekeySignature,
            capabilityVersion,
            updatedAt: now,
            lastSeenAt: now,
            revokedAt: null,
          })
          .where("id", "=", id)
          .execute();
      } else {
        await trx
          .insertInto("e2eeDevices")
          .values({
            id,
            userId: auth.userId,
            clientDeviceId,
            registrationId,
            identityKey,
            signedPrekeyId,
            signedPrekey,
            signedPrekeySignature,
            capabilityVersion,
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
            revokedAt: null,
          })
          .execute();
      }
      if (parsedPrekeys.length) {
        await trx
          .insertInto("e2eeOneTimePrekeys")
          .values(
            parsedPrekeys.map((prekey) => ({
              deviceId: id,
              keyId: prekey.keyId,
              publicKey: prekey.publicKey,
              createdAt: now,
              consumedAt: null,
              consumedByDeviceId: null,
            })),
          )
          .onConflict((conflict) =>
            conflict.columns(["deviceId", "keyId"]).doNothing(),
          )
          .execute();
      }
      return { id, created: !existing };
    });
    res.status(result.created ? 201 : 200).json({
      id: result.id,
      clientDeviceId,
      capabilityVersion,
      uploadedPrekeys: parsedPrekeys.length,
    });
  } catch (error) {
    next(error);
  }
});

e2eeRouter.get("/devices", async (_req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const devices = await db
      .selectFrom("e2eeDevices")
      .leftJoin("e2eeOneTimePrekeys", (join) =>
        join
          .onRef("e2eeOneTimePrekeys.deviceId", "=", "e2eeDevices.id")
          .on("e2eeOneTimePrekeys.consumedAt", "is", null),
      )
      .select([
        "e2eeDevices.id",
        "e2eeDevices.clientDeviceId",
        "e2eeDevices.capabilityVersion",
        "e2eeDevices.createdAt",
        "e2eeDevices.updatedAt",
        "e2eeDevices.lastSeenAt",
        "e2eeDevices.revokedAt",
        (eb) => eb.fn.count("e2eeOneTimePrekeys.keyId").as("availablePrekeys"),
      ])
      .where("e2eeDevices.userId", "=", auth.userId)
      .groupBy("e2eeDevices.id")
      .orderBy("e2eeDevices.createdAt", "asc")
      .execute();
    res.json(devices);
  } catch (error) {
    next(error);
  }
});

e2eeRouter.post("/devices/:deviceId/prekeys", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const device = await requireOwnedActiveDevice(
      auth.userId,
      req.params.deviceId,
    );
    const prekeys = parsePrekeys(req.body?.oneTimePrekeys);
    if (!device) {
      res.status(404).json({ error: "Device not found", code: "NOT_FOUND" });
      return;
    }
    if (!prekeys || prekeys.length === 0) {
      badRequest(res, "At least one valid prekey is required");
      return;
    }
    const now = Date.now();
    await db
      .insertInto("e2eeOneTimePrekeys")
      .values(
        prekeys.map((prekey) => ({
          deviceId: device.id,
          keyId: prekey.keyId,
          publicKey: prekey.publicKey,
          createdAt: now,
          consumedAt: null,
          consumedByDeviceId: null,
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(["deviceId", "keyId"]).doNothing(),
      )
      .execute();
    await db
      .updateTable("e2eeDevices")
      .set({ lastSeenAt: now })
      .where("id", "=", device.id)
      .execute();
    res.json({ uploadedPrekeys: prekeys.length });
  } catch (error) {
    next(error);
  }
});

e2eeRouter.delete("/devices/:deviceId", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const device = await requireOwnedActiveDevice(
      auth.userId,
      req.params.deviceId,
    );
    if (!device) {
      res.status(404).json({ error: "Device not found", code: "NOT_FOUND" });
      return;
    }
    await db
      .updateTable("e2eeDevices")
      .set({ revokedAt: Date.now(), updatedAt: Date.now() })
      .where("id", "=", device.id)
      .execute();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

e2eeRouter.get("/users/:userId/prekey-bundles", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const targetUserId = req.params.userId;
    if (
      targetUserId !== auth.userId &&
      !(await hasAcceptedContact(auth.userId, targetUserId))
    ) {
      res
        .status(403)
        .json({ error: "Accepted contact required", code: "FORBIDDEN" });
      return;
    }
    const requesterDeviceId = String(req.query.requesterDeviceId ?? "");
    const requesterDevice = await requireOwnedActiveDevice(
      auth.userId,
      requesterDeviceId,
    );
    if (!requesterDevice) {
      badRequest(res, "A valid requester device is required");
      return;
    }

    const bundles = await db.transaction().execute(async (trx) => {
      const devices = await trx
        .selectFrom("e2eeDevices")
        .selectAll()
        .where("userId", "=", targetUserId)
        .where("id", "!=", requesterDevice.id)
        .where("revokedAt", "is", null)
        .orderBy("createdAt", "asc")
        .execute();
      const result = [];
      for (const device of devices) {
        let claimed: OpaqueKey | null = null;
        const candidates = await trx
          .selectFrom("e2eeOneTimePrekeys")
          .select(["keyId", "publicKey"])
          .where("deviceId", "=", device.id)
          .where("consumedAt", "is", null)
          .orderBy("keyId", "asc")
          .limit(5)
          .execute();
        for (const candidate of candidates) {
          const updated = await trx
            .updateTable("e2eeOneTimePrekeys")
            .set({
              consumedAt: Date.now(),
              consumedByDeviceId: requesterDevice.id,
            })
            .where("deviceId", "=", device.id)
            .where("keyId", "=", candidate.keyId)
            .where("consumedAt", "is", null)
            .executeTakeFirst();
          if (Number(updated.numUpdatedRows) === 1) {
            claimed = candidate;
            break;
          }
        }
        result.push({
          deviceId: device.id,
          clientDeviceId: device.clientDeviceId,
          registrationId: device.registrationId,
          identityKey: device.identityKey,
          signedPrekey: {
            keyId: device.signedPrekeyId,
            publicKey: device.signedPrekey,
            signature: device.signedPrekeySignature,
          },
          oneTimePrekey: claimed,
          capabilityVersion: device.capabilityVersion,
        });
      }
      return result;
    });
    res.json({ userId: targetUserId, bundles });
  } catch (error) {
    next(error);
  }
});

e2eeRouter.post("/conversations", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const targetUserId = req.body?.targetUserId;
    if (typeof targetUserId !== "string" || targetUserId === auth.userId) {
      badRequest(res, "A different target user is required");
      return;
    }
    if (!(await hasAcceptedContact(auth.userId, targetUserId))) {
      res
        .status(403)
        .json({ error: "Accepted contact required", code: "FORBIDDEN" });
      return;
    }
    const [participantAUserId, participantBUserId] = normalizedParticipants(
      auth.userId,
      targetUserId,
    );
    const now = Date.now();
    const conversation = {
      id: randomUUID(),
      participantAUserId,
      participantBUserId,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .insertInto("e2eeConversations")
      .values(conversation)
      .onConflict((conflict) =>
        conflict
          .columns(["participantAUserId", "participantBUserId"])
          .doNothing(),
      )
      .execute();
    const stored = await db
      .selectFrom("e2eeConversations")
      .selectAll()
      .where("participantAUserId", "=", participantAUserId)
      .where("participantBUserId", "=", participantBUserId)
      .executeTakeFirstOrThrow();
    res.status(stored.id === conversation.id ? 201 : 200).json(stored);
  } catch (error) {
    next(error);
  }
});

e2eeRouter.get("/conversations", async (_req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const conversations = await db
      .selectFrom("e2eeConversations")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb("participantAUserId", "=", auth.userId),
          eb("participantBUserId", "=", auth.userId),
        ]),
      )
      .orderBy("updatedAt", "desc")
      .execute();
    res.json(conversations);
  } catch (error) {
    next(error);
  }
});

e2eeRouter.post("/conversations/:id/envelopes", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    if (containsForbiddenSecretFields(req.body)) {
      badRequest(res, "Plaintext and private key material are not accepted");
      return;
    }
    const conversation = await requireConversationMember(
      auth.userId,
      req.params.id,
    );
    if (!conversation) {
      res
        .status(404)
        .json({ error: "Conversation not found", code: "NOT_FOUND" });
      return;
    }
    const {
      senderDeviceId,
      recipientDeviceId,
      clientMessageId,
      envelopeType,
      ciphertext,
      associatedData = "",
      expiresAt = null,
    } = req.body ?? {};
    const senderDevice =
      typeof senderDeviceId === "string"
        ? await requireOwnedActiveDevice(auth.userId, senderDeviceId)
        : null;
    const recipientUserId =
      conversation.participantAUserId === auth.userId
        ? conversation.participantBUserId
        : conversation.participantAUserId;
    if (!(await hasAcceptedContact(auth.userId, recipientUserId))) {
      res.status(403).json({
        error: "Accepted contact required",
        code: "FORBIDDEN",
      });
      return;
    }
    const recipientDevice =
      typeof recipientDeviceId === "string"
        ? await db
            .selectFrom("e2eeDevices")
            .selectAll()
            .where("id", "=", recipientDeviceId)
            .where("userId", "=", recipientUserId)
            .where("revokedAt", "is", null)
            .executeTakeFirst()
        : null;
    if (
      !senderDevice ||
      !recipientDevice ||
      typeof clientMessageId !== "string" ||
      !deviceIdPattern.test(clientMessageId) ||
      !["prekey", "signal"].includes(envelopeType) ||
      !isOpaque(ciphertext, MAX_ENVELOPE_BYTES) ||
      (associatedData !== "" && !isOpaque(associatedData, 4096)) ||
      (expiresAt !== null &&
        (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()))
    ) {
      badRequest(res, "Invalid encrypted envelope");
      return;
    }
    const now = Date.now();
    const envelope = {
      id: randomUUID(),
      conversationId: conversation.id,
      senderUserId: auth.userId,
      senderDeviceId: senderDevice.id,
      recipientUserId,
      recipientDeviceId: recipientDevice.id,
      clientMessageId,
      envelopeType: envelopeType as "prekey" | "signal",
      ciphertext,
      associatedData,
      createdAt: now,
      deliveredAt: null,
      readAt: null,
      expiresAt,
    };
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("e2eeEnvelopes")
        .values(envelope)
        .onConflict((conflict) =>
          conflict
            .columns(["senderDeviceId", "clientMessageId", "recipientDeviceId"])
            .doNothing(),
        )
        .execute();
      await trx
        .updateTable("e2eeConversations")
        .set({ updatedAt: now })
        .where("id", "=", conversation.id)
        .execute();
    });
    const stored = await db
      .selectFrom("e2eeEnvelopes")
      .selectAll()
      .where("senderDeviceId", "=", senderDevice.id)
      .where("clientMessageId", "=", clientMessageId)
      .where("recipientDeviceId", "=", recipientDevice.id)
      .executeTakeFirstOrThrow();
    res.status(stored.id === envelope.id ? 201 : 200).json(stored);
  } catch (error) {
    next(error);
  }
});

e2eeRouter.get("/devices/:deviceId/envelopes", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const device = await requireOwnedActiveDevice(
      auth.userId,
      req.params.deviceId,
    );
    if (!device) {
      res.status(404).json({ error: "Device not found", code: "NOT_FOUND" });
      return;
    }
    const after = Number(req.query.after ?? 0);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
    if (!Number.isSafeInteger(after) || !Number.isSafeInteger(limit)) {
      badRequest(res, "Invalid envelope cursor");
      return;
    }
    const envelopes = await db
      .selectFrom("e2eeEnvelopes")
      .selectAll()
      .where("recipientDeviceId", "=", device.id)
      .where("createdAt", ">", after)
      .where((eb) =>
        eb.or([eb("expiresAt", "is", null), eb("expiresAt", ">", Date.now())]),
      )
      .orderBy("createdAt", "asc")
      .orderBy("id", "asc")
      .limit(limit)
      .execute();
    await db
      .updateTable("e2eeDevices")
      .set({ lastSeenAt: Date.now() })
      .where("id", "=", device.id)
      .execute();
    res.json(envelopes);
  } catch (error) {
    next(error);
  }
});

e2eeRouter.post("/devices/:deviceId/receipts", async (req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    const device = await requireOwnedActiveDevice(
      auth.userId,
      req.params.deviceId,
    );
    const envelopeIds = req.body?.envelopeIds;
    const state = req.body?.state;
    if (!device) {
      res.status(404).json({ error: "Device not found", code: "NOT_FOUND" });
      return;
    }
    if (
      !Array.isArray(envelopeIds) ||
      envelopeIds.length < 1 ||
      envelopeIds.length > 100 ||
      envelopeIds.some(
        (id) => typeof id !== "string" || !deviceIdPattern.test(id),
      ) ||
      !["delivered", "read"].includes(state)
    ) {
      badRequest(res, "Invalid receipt batch");
      return;
    }
    const now = Date.now();
    const update =
      state === "read"
        ? { deliveredAt: now, readAt: now }
        : { deliveredAt: now };
    const result = await db
      .updateTable("e2eeEnvelopes")
      .set(update)
      .where("recipientUserId", "=", auth.userId)
      .where("recipientDeviceId", "=", device.id)
      .where("id", "in", envelopeIds)
      .executeTakeFirst();
    res.json({ updated: Number(result.numUpdatedRows), state });
  } catch (error) {
    next(error);
  }
});
