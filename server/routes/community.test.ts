import { mkdtemp, rm } from "node:fs/promises";
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
    await request(app)
      .patch(`/api/community/parental-controls/${parental.body.id}`)
      .set("Cookie", secondMemberCookie)
      .send({ status: "parental_control_under_review" })
      .expect(403);
  });
});
