import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("community, identity and moderation APIs", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;
  let secondMemberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-community-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEY",
      "Y29tbXVuaXR5LXRlc3Qta2V5LTMyaXNoLWJ5dGVzISE",
    );
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "community-admin",
          email: "community-admin@example.com",
          phone: null,
          name: "Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("CommunityAdmin123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
        {
          id: "community-member",
          email: "community-member@example.com",
          phone: null,
          name: "Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("CommunityMember123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
        {
          id: "community-peer",
          email: "community-peer@example.com",
          phone: null,
          name: "Peer",
          avatarDataUrl: "",
          password: await auth.hashPassword("CommunityPeer123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
      ])
      .execute();
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "secondary",
        slug: "secondary",
        name: "Secondary",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "secondary:community-admin",
          facilityId: "secondary",
          userId: "community-admin",
          role: "admin",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:community-member",
          facilityId: "secondary",
          userId: "community-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:community-peer",
          facilityId: "secondary",
          userId: "community-peer",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    app = (await import("../index.js")).app;
    const login = async (
      identifier: string,
      password: string,
      accessPortal: "member" | "staff",
    ) =>
      (
        await request(app)
          .post("/api/auth/login")
          .send({ identifier, password, accessPortal, rememberDevice: false })
      ).headers["set-cookie"][0];
    adminCookie = await login(
      "community-admin@example.com",
      "CommunityAdmin123",
      "staff",
    );
    memberCookie = await login(
      "community-member@example.com",
      "CommunityMember123",
      "member",
    );
    secondMemberCookie = await login(
      "community-peer@example.com",
      "CommunityPeer123",
      "member",
    );
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores a unique social identity and granular privacy", async () => {
    const response = await request(app)
      .patch("/api/community/profile")
      .set("Cookie", memberCookie)
      .send({
        username: "member.training",
        bio: "Entreno por salud.",
        displayRealName: false,
        birthDate: "2000-05-20",
        privacy: {
          bio: "contacts",
          realName: "private",
          birthYear: "authorized_staff",
        },
      })
      .expect(200);
    expect(response.body.username).toBe("member.training");
    expect(response.body.privacy.realName).toBe("private");
    await request(app)
      .patch("/api/community/profile")
      .set("Cookie", memberCookie)
      .send({
        username: "member.training",
        birthDate: "2000-02-31",
        privacy: {},
      })
      .expect(400);
    await request(app)
      .patch("/api/community/profile")
      .set("Cookie", secondMemberCookie)
      .send({ username: "member.training", privacy: {} })
      .expect(409);
    await request(app)
      .patch("/api/community/profile")
      .set("Cookie", secondMemberCookie)
      .send({
        username: "peer.training",
        bio: "Visible only to accepted contacts.",
        privacy: { bio: "contacts", avatar: "private" },
      })
      .expect(200);
    const privateSearch = await request(app)
      .get("/api/community/people?query=peer")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(privateSearch.body[0].bio).toBe("");
    await request(app)
      .get("/api/community/people?query=%25_")
      .set("Cookie", memberCookie)
      .expect(400);
  });

  it("requires bilateral contact acceptance", async () => {
    const created = await request(app)
      .post("/api/community/contacts")
      .set("Cookie", memberCookie)
      .send({ recipientUserId: "community-peer" })
      .expect(201);
    await request(app)
      .patch(`/api/community/contacts/${created.body.id}`)
      .set("Cookie", memberCookie)
      .send({ status: "contact_accepted" })
      .expect(403);
    await request(app)
      .patch(`/api/community/contacts/${created.body.id}`)
      .set("Cookie", secondMemberCookie)
      .send({ status: "contact_accepted" })
      .expect(200);
    await request(app)
      .patch(`/api/community/contacts/${created.body.id}`)
      .set("Cookie", secondMemberCookie)
      .send({ status: "contact_requested" })
      .expect(409);
    const contactSearch = await request(app)
      .get("/api/community/people?query=peer")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(contactSearch.body[0].bio).toBe(
      "Visible only to accepted contacts.",
    );
  });

  it("supports facility channels, replies and visible messages", async () => {
    const channel = await request(app)
      .post("/api/community/channels")
      .set("Cookie", adminCookie)
      .send({ scope: "facility", scopeId: "primary", name: "General" })
      .expect(201);
    const root = await request(app)
      .post(`/api/community/channels/${channel.body.id}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "¿Quién entrena mañana?" })
      .expect(201);
    await request(app)
      .post(`/api/community/channels/${channel.body.id}/messages`)
      .set("Cookie", secondMemberCookie)
      .send({ body: "Yo me apunto.", parentId: root.body.id })
      .expect(201);
    const messages = await request(app)
      .get(`/api/community/channels/${channel.body.id}/messages`)
      .set("Cookie", memberCookie)
      .expect(200);
    expect(messages.body).toHaveLength(2);
  });

  it("encrypts private class justifications at rest and decrypts authorized responses", async () => {
    const channelId = "community-private-class";
    await database.db
      .insertInto("gymClasses")
      .values({
        id: "synthetic-class",
        facilityId: "primary",
        name: "Synthetic class",
        description: "",
        trainerId: "community-admin",
        trainerName: "Admin",
        maxCapacity: 10,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
    await database.db
      .insertInto("communityChannels")
      .values({
        id: channelId,
        scope: "class",
        scopeId: "synthetic-class",
        name: "Private class context",
        status: "community_active",
        createdBy: "community-admin",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .execute();

    const created = await request(app)
      .post(`/api/community/channels/${channelId}/messages`)
      .set("Cookie", adminCookie)
      .send({
        body: "Justificación privada cifrada",
        kind: "private_justification",
      })
      .expect(201);
    expect(created.body.body).toBe("Justificación privada cifrada");
    expect(created.body.protectedBody).toBeUndefined();

    const stored = await database.db
      .selectFrom("communityMessages")
      .select(["body", "protectedBody"])
      .where("id", "=", created.body.id)
      .executeTakeFirstOrThrow();
    expect(stored.body).toBe("[protected]");
    expect(stored.protectedBody).toMatch(/^xcp1\./);
    expect(stored.protectedBody).not.toContain("Justificación");

    const messages = await request(app)
      .get(`/api/community/channels/${channelId}/messages`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(messages.body[0].body).toBe("Justificación privada cifrada");
    expect(messages.body[0].protectedBody).toBeUndefined();
  });

  it("keeps personal communities private and admits accepted contacts", async () => {
    const community = await request(app)
      .post("/api/community/channels")
      .set("Cookie", memberCookie)
      .send({
        scope: "community",
        scopeId: "personal",
        name: "Training friends",
      })
      .expect(201);
    const before = await request(app)
      .get("/api/community/channels")
      .set("Cookie", secondMemberCookie)
      .expect(200);
    expect(before.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: community.body.id }),
      ]),
    );
    const peerCommunity = await request(app)
      .post("/api/community/channels")
      .set("Cookie", secondMemberCookie)
      .send({ scope: "community", name: "Training friends" })
      .expect(201);
    expect(peerCommunity.body.scopeId).toBe("community-peer");
    await request(app)
      .patch(`/api/community/channels/${community.body.id}`)
      .set("Cookie", secondMemberCookie)
      .send({ status: "community_read_only" })
      .expect(404);
    await request(app)
      .patch(`/api/community/channels/${community.body.id}`)
      .set("Cookie", memberCookie)
      .send({ status: "community_read_only" })
      .expect(200);
    await request(app)
      .post(`/api/community/channels/${community.body.id}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "Read-only communities must reject new messages." })
      .expect(409);
    await request(app)
      .patch(`/api/community/channels/${community.body.id}`)
      .set("Cookie", memberCookie)
      .send({ status: "community_active" })
      .expect(200);
    await request(app)
      .post(`/api/community/channels/${community.body.id}/members`)
      .set("Cookie", memberCookie)
      .send({ userId: "community-peer" })
      .expect(201);
    const after = await request(app)
      .get("/api/community/channels")
      .set("Cookie", secondMemberCookie)
      .expect(200);
    expect(after.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: community.body.id }),
      ]),
    );

    const privateMessage = await request(app)
      .post(`/api/community/channels/${community.body.id}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "Mensaje personal administrado y cifrado" })
      .expect(201);
    const stored = await database.db
      .selectFrom("communityMessages")
      .select(["body", "protectedBody", "kind"])
      .where("id", "=", privateMessage.body.id)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({ body: "[protected]", kind: "public" });
    expect(stored.protectedBody).toMatch(/^xcp1\./);
    expect(stored.protectedBody).not.toContain("Mensaje personal");

    const visible = await request(app)
      .get(`/api/community/channels/${community.body.id}/messages`)
      .set("Cookie", secondMemberCookie)
      .expect(200);
    expect(visible.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: privateMessage.body.id,
          body: "Mensaje personal administrado y cifrado",
        }),
      ]),
    );

    const privateSearch = await request(app)
      .get("/api/community/search/messages")
      .query({ q: "Mensaje personal" })
      .set("Cookie", secondMemberCookie)
      .expect(200);
    expect(privateSearch.body.results).toEqual([]);
    const publicSearch = await request(app)
      .get("/api/community/search/messages")
      .query({ q: "entrena mañana" })
      .set("Cookie", memberCookie)
      .expect(200);
    expect(publicSearch.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: "¿Quién entrena mañana?" }),
      ]),
    );

    const attachmentBody = Buffer.from(
      "Documento privado de la comunidad",
      "utf8",
    );
    const uploaded = await request(app)
      .post(`/api/community/channels/${community.body.id}/attachments`)
      .set("Cookie", memberCookie)
      .set("Content-Type", "text/plain")
      .set("X-File-Name", "plan/privado.txt")
      .set("X-Message-Id", privateMessage.body.id)
      .send(attachmentBody)
      .expect(201);
    expect(uploaded.body).toMatchObject({
      channelId: community.body.id,
      fileName: "plan_privado.txt",
      mimeType: "text/plain",
      sizeBytes: attachmentBody.length,
    });
    expect(uploaded.body).not.toHaveProperty("storageKey");

    const storedAttachment = await database.db
      .selectFrom("communityAttachments")
      .selectAll()
      .where("id", "=", uploaded.body.id)
      .executeTakeFirstOrThrow();
    const encryptedAttachment = await readFile(
      join(
        directory,
        "private",
        "community-attachments",
        storedAttachment.storageKey,
      ),
      "utf8",
    );
    expect(encryptedAttachment).toMatch(/^xcp1\./);
    expect(encryptedAttachment).not.toContain("Documento privado");

    await request(app)
      .get(`/api/community/channels/${community.body.id}/attachments`)
      .set("Cookie", adminCookie)
      .expect(404);
    const listed = await request(app)
      .get(`/api/community/channels/${community.body.id}/attachments`)
      .set("Cookie", secondMemberCookie)
      .expect(200);
    expect(listed.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: uploaded.body.id }),
      ]),
    );
    expect(listed.body[0]).not.toHaveProperty("storageKey");

    const downloaded = await request(app)
      .get(
        `/api/community/channels/${community.body.id}/attachments/${uploaded.body.id}`,
      )
      .set("Cookie", secondMemberCookie)
      .expect(200);
    expect(downloaded.text).toBe(attachmentBody.toString("utf8"));
    await request(app)
      .delete(
        `/api/community/channels/${community.body.id}/attachments/${uploaded.body.id}`,
      )
      .set("Cookie", secondMemberCookie)
      .expect(403);
    await request(app)
      .delete(
        `/api/community/channels/${community.body.id}/attachments/${uploaded.body.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(204);
    expect(
      await database.db
        .selectFrom("communityAttachments")
        .select("id")
        .where("id", "=", uploaded.body.id)
        .executeTakeFirst(),
    ).toBeUndefined();
    const attachmentEvents = await database.db
      .selectFrom("securityEvents")
      .select("type")
      .where("type", "in", [
        "private_attachment_uploaded",
        "private_attachment_downloaded",
        "private_attachment_deleted",
      ])
      .execute();
    expect(attachmentEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "private_attachment_uploaded",
        "private_attachment_downloaded",
        "private_attachment_deleted",
      ]),
    );
  });

  it("isolates facility channels, messages and search results", async () => {
    const secondaryChannel = await request(app)
      .post("/api/community/channels")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .send({
        scope: "facility",
        scopeId: "secondary",
        name: "Secondary general",
      })
      .expect(201);
    await request(app)
      .post(`/api/community/channels/${secondaryChannel.body.id}/messages`)
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .send({ body: "Secondary-only community message" })
      .expect(201);

    await request(app)
      .get(`/api/community/channels/${secondaryChannel.body.id}/messages`)
      .set("Cookie", memberCookie)
      .expect(404);
    const primaryChannels = await request(app)
      .get("/api/community/channels")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(
      primaryChannels.body.map((channel: { id: string }) => channel.id),
    ).not.toContain(secondaryChannel.body.id);

    const primarySearch = await request(app)
      .get("/api/community/search/messages")
      .query({ q: "Secondary-only" })
      .set("Cookie", memberCookie)
      .expect(200);
    const secondarySearch = await request(app)
      .get("/api/community/search/messages")
      .query({ q: "Secondary-only" })
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(primarySearch.body.results).toEqual([]);
    expect(secondarySearch.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: "Secondary-only community message" }),
      ]),
    );
  });

  it("creates auditable reports, actions and appeals", async () => {
    const reportableMessage = await database.db
      .selectFrom("communityMessages")
      .innerJoin(
        "communityChannels",
        "communityChannels.id",
        "communityMessages.channelId",
      )
      .select("communityMessages.id")
      .where("communityMessages.authorUserId", "=", "community-member")
      .where("communityChannels.scope", "=", "facility")
      .executeTakeFirstOrThrow();
    await request(app)
      .post("/api/moderation/cases")
      .set("Cookie", adminCookie)
      .send({
        subjectUserId: "community-peer",
        messageId: reportableMessage.id,
        category: "conduct",
        description: "The account must match the reported message author.",
      })
      .expect(400);
    await request(app)
      .post("/api/moderation/cases")
      .set("Cookie", adminCookie)
      .send({
        subjectUserId: "community-peer",
        category: "conduct",
        description: "Evidence must use bounded textual references only.",
        evidence: [{ arbitrary: "object" }],
      })
      .expect(400);
    const moderationCase = await request(app)
      .post("/api/moderation/cases")
      .set("Cookie", adminCookie)
      .send({
        subjectUserId: "community-member",
        category: "harassment",
        description: "Repeated conduct requiring documented review.",
        urgency: "high",
      })
      .expect(201);
    await request(app)
      .post(`/api/moderation/cases/${moderationCase.body.id}/actions`)
      .set("Cookie", adminCookie)
      .send({
        subjectUserId: "community-peer",
        state: "muted",
        reason: "Must not affect a different account",
        durationMinutes: 60,
      })
      .expect(409);
    await request(app)
      .post(`/api/moderation/cases/${moderationCase.body.id}/actions`)
      .set("Cookie", adminCookie)
      .send({
        subjectUserId: "community-member",
        state: "muted",
        reason: "Invalid duration must be rejected",
        durationMinutes: "not-a-number",
      })
      .expect(400);
    await request(app)
      .post(`/api/moderation/cases/${moderationCase.body.id}/actions`)
      .set("Cookie", adminCookie)
      .send({
        subjectUserId: "community-member",
        state: "muted",
        reason: "Temporary proportionate measure",
        durationMinutes: 60,
      })
      .expect(201);
    const general = await database.db
      .selectFrom("communityChannels")
      .select("id")
      .where("scope", "=", "facility")
      .executeTakeFirstOrThrow();
    await request(app)
      .post(`/api/community/channels/${general.id}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "This message must be blocked." })
      .expect(403);
    const appeal = await request(app)
      .post(`/api/moderation/cases/${moderationCase.body.id}/appeals`)
      .set("Cookie", memberCookie)
      .send({ context: "I request a review and provide additional context." })
      .expect(201);
    await request(app)
      .post(`/api/moderation/cases/${moderationCase.body.id}/appeals`)
      .set("Cookie", memberCookie)
      .send({ context: "A duplicate open appeal must not be created." })
      .expect(409);
    const cases = await request(app)
      .get("/api/moderation/cases")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(cases.body[0].status).toBe("appeal_open");
    const appeals = await request(app)
      .get(`/api/moderation/cases/${moderationCase.body.id}/appeals`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(appeals.body).toHaveLength(1);
    await request(app)
      .patch(`/api/moderation/appeals/${appeal.body.id}`)
      .set("Cookie", adminCookie)
      .send({
        status: "accepted",
        resolution: "The case requires a new proportional review.",
      })
      .expect(200);
    await request(app)
      .patch(`/api/moderation/appeals/${appeal.body.id}`)
      .set("Cookie", adminCookie)
      .send({ status: "rejected", resolution: "Must not close twice." })
      .expect(409);
  });

  it("isolates moderation cases and facility sanctions by facility", async () => {
    const secondaryCase = await request(app)
      .post("/api/moderation/cases")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .send({
        subjectUserId: "community-peer",
        category: "conduct",
        description: "This case belongs only to the secondary facility.",
      })
      .expect(201);

    const primaryCases = await request(app)
      .get("/api/moderation/cases")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(
      primaryCases.body.map((item: { id: string }) => item.id),
    ).not.toContain(secondaryCase.body.id);

    const secondaryCases = await request(app)
      .get("/api/moderation/cases")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(
      secondaryCases.body.map((item: { id: string }) => item.id),
    ).toContain(secondaryCase.body.id);

    await request(app)
      .patch(`/api/moderation/cases/${secondaryCase.body.id}`)
      .set("Cookie", adminCookie)
      .send({ status: "in_review" })
      .expect(404);
    await request(app)
      .patch(`/api/moderation/cases/${secondaryCase.body.id}`)
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .send({ status: "in_review" })
      .expect(200);

    await request(app)
      .post(`/api/moderation/cases/${secondaryCase.body.id}/actions`)
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .send({
        subjectUserId: "community-peer",
        state: "platform_suspended",
        reason: "A facility cannot apply a platform-wide sanction.",
      })
      .expect(403);
  });

  it("keeps facility links and parental controls under administrator review", async () => {
    await request(app)
      .post("/api/community/facility-links")
      .set("Cookie", memberCookie)
      .send({ targetFacilityName: "Centro Norte" })
      .expect(403);
    await request(app)
      .post("/api/community/facility-links")
      .set("Cookie", adminCookie)
      .send({
        targetFacilityName: "Centro Norte",
        mode: "temporary",
        sharedSpaces: ["announcements", "events"],
      })
      .expect(201);
    await request(app)
      .post("/api/community/facility-links")
      .set("Cookie", adminCookie)
      .send({
        targetFacilityName: "Centro no válido",
        sharedSpaces: ["all_private_data"],
      })
      .expect(400);
    const parental = await request(app)
      .post("/api/community/parental-controls")
      .set("Cookie", adminCookie)
      .send({
        childUserId: "community-member",
        guardianUserId: "community-peer",
        settings: { unknownMessages: "blocked", files: "approval_required" },
      })
      .expect(201);
    expect(parental.body.status).toBe("parental_control_pending");
    const secondaryParental = await request(app)
      .post("/api/community/parental-controls")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .send({
        childUserId: "community-member",
        guardianUserId: "community-peer",
        settings: { unknownMessages: "blocked" },
      })
      .expect(201);
    await request(app)
      .patch(`/api/community/parental-controls/${secondaryParental.body.id}`)
      .set("Cookie", adminCookie)
      .send({ status: "parental_control_active" })
      .expect(404);
    await request(app)
      .patch(`/api/community/parental-controls/${parental.body.id}`)
      .set("Cookie", secondMemberCookie)
      .send({ status: "parental_control_under_review" })
      .expect(403);
  });
});
