import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("one-to-one E2EE relay API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let memberCookie: string;
  let peerCookie: string;
  let outsiderCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-e2ee-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "e2ee-member",
          email: "e2ee-member@example.com",
          phone: null,
          name: "E2EE Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("E2eeMember123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
        {
          id: "e2ee-peer",
          email: "e2ee-peer@example.com",
          phone: null,
          name: "E2EE Peer",
          avatarDataUrl: "",
          password: await auth.hashPassword("E2eePeer123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
        {
          id: "e2ee-outsider",
          email: "e2ee-outsider@example.com",
          phone: null,
          name: "E2EE Outsider",
          avatarDataUrl: "",
          password: await auth.hashPassword("E2eeOutsider123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
      ])
      .execute();
    await database.db
      .insertInto("internalContacts")
      .values({
        id: "e2ee-contact",
        requesterUserId: "e2ee-member",
        recipientUserId: "e2ee-peer",
        status: "contact_accepted",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .execute();
    app = (await import("../index.js")).app;
    const login = async (identifier: string, password: string) =>
      (
        await request(app).post("/api/auth/login").send({
          identifier,
          password,
          accessPortal: "member",
          rememberDevice: false,
        })
      ).headers["set-cookie"][0];
    memberCookie = await login("e2ee-member@example.com", "E2eeMember123");
    peerCookie = await login("e2ee-peer@example.com", "E2eePeer123");
    outsiderCookie = await login(
      "e2ee-outsider@example.com",
      "E2eeOutsider123",
    );
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function publishDevice(
    cookie: string,
    clientDeviceId: string,
    registrationId: number,
    prekeyIds: number[],
  ) {
    return request(app)
      .post("/api/e2ee/devices")
      .set("Cookie", cookie)
      .send({
        clientDeviceId,
        registrationId,
        identityKey: `identity_${clientDeviceId}`,
        signedPrekeyId: 1,
        signedPrekey: `signed_${clientDeviceId}`,
        signedPrekeySignature: `signature_${clientDeviceId}`,
        capabilityVersion: "signal-ready-v1",
        oneTimePrekeys: prekeyIds.map((keyId) => ({
          keyId,
          publicKey: `one_time_${clientDeviceId}_${keyId}`,
        })),
      })
      .expect(201);
  }

  it("fails closed without authentication or when clients submit secrets", async () => {
    await request(app).get("/api/e2ee/status").expect(401);
    await request(app)
      .post("/api/e2ee/devices")
      .set("Cookie", memberCookie)
      .send({
        clientDeviceId: "leaking-device",
        privateKey: "must_never_leave_the_client",
      })
      .expect(400);
    expect(
      await database.db
        .selectFrom("e2eeDevices")
        .select("id")
        .where("clientDeviceId", "=", "leaking-device")
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it("pins device identities and rejects silent replacement or revoked identifier reuse", async () => {
    const bundle = {
      clientDeviceId: "pinned-device",
      registrationId: 404,
      identityKey: "identity_pinned_device_original",
      signedPrekeyId: 1,
      signedPrekey: "signed_pinned_device",
      signedPrekeySignature: "signature_pinned_device",
      capabilityVersion: "signal-ready-v1",
      oneTimePrekeys: [{ keyId: 41, publicKey: "one_time_pinned_device_41" }],
    };
    const created = await request(app)
      .post("/api/e2ee/devices")
      .set("Cookie", memberCookie)
      .send(bundle)
      .expect(201);
    await request(app)
      .post("/api/e2ee/devices")
      .set("Cookie", memberCookie)
      .send({ ...bundle, oneTimePrekeys: [] })
      .expect(200);
    await request(app)
      .post("/api/e2ee/devices")
      .set("Cookie", memberCookie)
      .send({ ...bundle, identityKey: "identity_pinned_device_replaced" })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("E2EE_IDENTITY_CHANGE_REJECTED");
      });

    await request(app)
      .delete(`/api/e2ee/devices/${created.body.id}`)
      .set("Cookie", memberCookie)
      .expect(204);
    await request(app)
      .post("/api/e2ee/devices")
      .set("Cookie", memberCookie)
      .send(bundle)
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("E2EE_IDENTITY_CHANGE_REJECTED");
      });

    const events = await database.db
      .selectFrom("securityEvents")
      .select(["type", "metadata"])
      .where("userId", "=", "e2ee-member")
      .where("type", "=", "e2ee_identity_change_rejected")
      .execute();
    expect(events).toHaveLength(2);
    expect(events.map((event) => JSON.parse(event.metadata).reason)).toEqual(
      expect.arrayContaining([
        "identity_key_changed",
        "revoked_device_id_reuse",
      ]),
    );
  });

  it("isolates contacts and consumes one-time prekeys exactly once", async () => {
    const member = await publishDevice(memberCookie, "member-device", 101, [1]);
    const peer = await publishDevice(peerCookie, "peer-device", 202, [11, 12]);
    await publishDevice(outsiderCookie, "outsider-device", 303, [21]);

    await request(app)
      .get(
        `/api/e2ee/users/e2ee-peer/prekey-bundles?requesterDeviceId=${member.body.id}`,
      )
      .set("Cookie", outsiderCookie)
      .expect(403);

    const first = await request(app)
      .get(
        `/api/e2ee/users/e2ee-peer/prekey-bundles?requesterDeviceId=${member.body.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(200);
    const second = await request(app)
      .get(
        `/api/e2ee/users/e2ee-peer/prekey-bundles?requesterDeviceId=${member.body.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(200);
    const exhausted = await request(app)
      .get(
        `/api/e2ee/users/e2ee-peer/prekey-bundles?requesterDeviceId=${member.body.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(200);

    expect(first.body.bundles[0].deviceId).toBe(peer.body.id);
    expect(first.body.bundles[0].oneTimePrekey.keyId).toBe(11);
    expect(second.body.bundles[0].oneTimePrekey.keyId).toBe(12);
    expect(exhausted.body.bundles[0].oneTimePrekey).toBeNull();
    const consumed = await database.db
      .selectFrom("e2eeOneTimePrekeys")
      .select(["keyId", "consumedByDeviceId"])
      .where("deviceId", "=", peer.body.id)
      .orderBy("keyId", "asc")
      .execute();
    expect(consumed).toEqual([
      { keyId: 11, consumedByDeviceId: member.body.id },
      { keyId: 12, consumedByDeviceId: member.body.id },
    ]);
  });

  it("stores only opaque idempotent envelopes and enforces device ownership", async () => {
    const memberDevice = await database.db
      .selectFrom("e2eeDevices")
      .select("id")
      .where("clientDeviceId", "=", "member-device")
      .executeTakeFirstOrThrow();
    const peerDevice = await database.db
      .selectFrom("e2eeDevices")
      .select("id")
      .where("clientDeviceId", "=", "peer-device")
      .executeTakeFirstOrThrow();
    const created = await request(app)
      .post("/api/e2ee/conversations")
      .set("Cookie", memberCookie)
      .send({ targetUserId: "e2ee-peer" })
      .expect(201);
    const repeatedConversation = await request(app)
      .post("/api/e2ee/conversations")
      .set("Cookie", peerCookie)
      .send({ targetUserId: "e2ee-member" })
      .expect(200);
    expect(repeatedConversation.body.id).toBe(created.body.id);

    await request(app)
      .post(`/api/e2ee/conversations/${created.body.id}/envelopes`)
      .set("Cookie", memberCookie)
      .send({
        senderDeviceId: memberDevice.id,
        recipientDeviceId: peerDevice.id,
        clientMessageId: "message-with-plaintext",
        envelopeType: "signal",
        ciphertext: "Y2lwaGVydGV4dA",
        plaintext: "the server must reject this",
      })
      .expect(400);

    const payload = {
      senderDeviceId: memberDevice.id,
      recipientDeviceId: peerDevice.id,
      clientMessageId: "opaque-message-1",
      envelopeType: "prekey",
      ciphertext: "b3BhcXVlX2NpcGhlcnRleHQ",
      associatedData: "Y29udmVyc2F0aW9uX2NvbnRleHQ",
    };
    const sent = await request(app)
      .post(`/api/e2ee/conversations/${created.body.id}/envelopes`)
      .set("Cookie", memberCookie)
      .send(payload)
      .expect(201);
    const duplicate = await request(app)
      .post(`/api/e2ee/conversations/${created.body.id}/envelopes`)
      .set("Cookie", memberCookie)
      .send(payload)
      .expect(200);
    expect(duplicate.body.id).toBe(sent.body.id);
    expect(
      await database.db
        .selectFrom("e2eeEnvelopes")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    ).toEqual({ count: 1 });

    await request(app)
      .get(`/api/e2ee/devices/${peerDevice.id}/envelopes`)
      .set("Cookie", memberCookie)
      .expect(404);
    const inbox = await request(app)
      .get(`/api/e2ee/devices/${peerDevice.id}/envelopes`)
      .set("Cookie", peerCookie)
      .expect(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].ciphertext).toBe(payload.ciphertext);
    expect(inbox.body[0]).not.toHaveProperty("plaintext");

    await request(app)
      .post(`/api/e2ee/devices/${peerDevice.id}/receipts`)
      .set("Cookie", memberCookie)
      .send({ envelopeIds: [sent.body.id], state: "read" })
      .expect(404);
    const receipt = await request(app)
      .post(`/api/e2ee/devices/${peerDevice.id}/receipts`)
      .set("Cookie", peerCookie)
      .send({ envelopeIds: [sent.body.id], state: "read" })
      .expect(200);
    expect(receipt.body.updated).toBe(1);

    await database.db
      .updateTable("internalContacts")
      .set({ status: "contact_removed", updatedAt: Date.now() })
      .where("id", "=", "e2ee-contact")
      .execute();
    await request(app)
      .post(`/api/e2ee/conversations/${created.body.id}/envelopes`)
      .set("Cookie", memberCookie)
      .send({ ...payload, clientMessageId: "removed-contact" })
      .expect(403);
    await database.db
      .updateTable("internalContacts")
      .set({ status: "contact_accepted", updatedAt: Date.now() })
      .where("id", "=", "e2ee-contact")
      .execute();

    await request(app)
      .delete(`/api/e2ee/devices/${peerDevice.id}`)
      .set("Cookie", peerCookie)
      .expect(204);
    await request(app)
      .post(`/api/e2ee/conversations/${created.body.id}/envelopes`)
      .set("Cookie", memberCookie)
      .send({ ...payload, clientMessageId: "revoked-recipient" })
      .expect(400);
  });

  it("relays opaque encrypted attachments without exposing them to other devices", async () => {
    const member = await publishDevice(
      memberCookie,
      "member-attachment-device",
      505,
      [],
    );
    const peer = await publishDevice(
      peerCookie,
      "peer-attachment-device",
      606,
      [],
    );
    const conversation = await request(app)
      .post("/api/e2ee/conversations")
      .set("Cookie", memberCookie)
      .send({ targetUserId: "e2ee-peer" })
      .expect(200);
    const ciphertext = Buffer.from("opaque-client-encrypted-attachment");
    const checksum = createHash("sha256").update(ciphertext).digest("hex");
    const attachmentPath = `/api/e2ee/conversations/${conversation.body.id}/attachments`;
    const upload = (
      clientAttachmentId = "opaque-attachment-1",
      associatedData = "YXR0YWNobWVudF9jb250ZXh0",
    ) =>
      request(app)
        .post(attachmentPath)
        .set("Cookie", memberCookie)
        .set("Content-Type", "application/octet-stream")
        .set("X-Sender-Device-Id", member.body.id)
        .set("X-Recipient-Device-Id", peer.body.id)
        .set("X-Client-Attachment-Id", clientAttachmentId)
        .set("X-Ciphertext-Sha256", checksum)
        .set("X-Associated-Data", associatedData)
        .send(ciphertext);

    await request(app)
      .post(attachmentPath)
      .set("Cookie", memberCookie)
      .set("Content-Type", "application/octet-stream")
      .set("X-Sender-Device-Id", member.body.id)
      .set("X-Recipient-Device-Id", peer.body.id)
      .set("X-Client-Attachment-Id", "opaque-attachment-bad-checksum")
      .set("X-Ciphertext-Sha256", "0".repeat(64))
      .send(ciphertext)
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("E2EE_ATTACHMENT_CHECKSUM_MISMATCH");
      });

    const created = await upload().expect(201);
    const repeated = await upload().expect(200);
    expect(repeated.body.id).toBe(created.body.id);
    expect(created.body).not.toHaveProperty("storageKey");
    expect(created.body.checksumSha256).toBe(checksum);
    await upload("opaque-attachment-1", "YWx0ZXJlZF9jb250ZXh0")
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("E2EE_ATTACHMENT_ID_CONFLICT");
      });

    await request(app)
      .get(`/api/e2ee/devices/${peer.body.id}/attachments`)
      .set("Cookie", memberCookie)
      .expect(404);
    await request(app)
      .get(`/api/e2ee/devices/${peer.body.id}/attachments`)
      .set("Cookie", outsiderCookie)
      .expect(404);
    const inbox = await request(app)
      .get(`/api/e2ee/devices/${peer.body.id}/attachments`)
      .set("Cookie", peerCookie)
      .expect(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].id).toBe(created.body.id);

    const downloaded = await request(app)
      .get(
        `/api/e2ee/devices/${peer.body.id}/attachments/${created.body.id}/content`,
      )
      .set("Cookie", peerCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .expect("X-Ciphertext-Sha256", checksum);
    expect(downloaded.body).toEqual(ciphertext);

    expect(
      await database.db
        .selectFrom("e2eeAttachments")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    ).toEqual({ count: 1 });
    await request(app)
      .delete(
        `/api/e2ee/devices/${peer.body.id}/attachments/${created.body.id}`,
      )
      .set("Cookie", peerCookie)
      .expect(204);
    expect(
      await database.db
        .selectFrom("e2eeAttachments")
        .select("id")
        .executeTakeFirst(),
    ).toBeUndefined();

    const expiring = await upload("opaque-attachment-expiring").expect(201);
    await database.db
      .updateTable("e2eeAttachments")
      .set({ expiresAt: Date.now() - 1 })
      .where("id", "=", expiring.body.id)
      .execute();
    const { purgeExpiredOpaqueE2eeAttachments } =
      await import("../services/e2ee-attachments.js");
    expect(await purgeExpiredOpaqueE2eeAttachments()).toBe(1);
    expect(
      await database.db
        .selectFrom("e2eeAttachments")
        .select("id")
        .where("id", "=", expiring.body.id)
        .executeTakeFirst(),
    ).toBeUndefined();
  });
});
