import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("UMF Support notification preferences", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let notify: typeof import("./umf-support-notifications.js").notifyUmfSupportAdministrators;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-support-alerts-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_ORIGIN", "https://www.umbraviaforge.com");
    vi.stubEnv(
      "EMAIL_QUEUE_ENCRYPTION_KEY",
      Buffer.alloc(32, 47).toString("base64"),
    );
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
    notify = (await import("./umf-support-notifications.js"))
      .notifyUmfSupportAdministrators;

    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "subscribed-director",
          email: "director-alerts@example.com",
          identityRealm: "corporate_support",
          phone: null,
          name: "Subscribed",
          avatarDataUrl: "",
          password: "unused",
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
        {
          id: "unsubscribed-agent",
          email: "agent-alerts@example.com",
          identityRealm: "corporate_support",
          phone: null,
          name: "Unsubscribed",
          avatarDataUrl: "",
          password: "unused",
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
        {
          id: "crossed-commercial-user",
          email: "commercial-alerts@example.com",
          identityRealm: "commercial",
          phone: null,
          name: "Commercial",
          avatarDataUrl: "",
          password: "unused",
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("umfSupportStaff")
      .values([
        {
          userId: "subscribed-director",
          role: "director",
          status: "active",
          approvedByUserId: "subscribed-director",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
        {
          userId: "unsubscribed-agent",
          role: "agent",
          status: "active",
          approvedByUserId: "subscribed-director",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
        {
          userId: "crossed-commercial-user",
          role: "agent",
          status: "active",
          approvedByUserId: "subscribed-director",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
      ])
      .execute();
    const preferences = {
      ticket_created: { email: true, push: false },
      conversation_received: { email: false, push: false },
      inbound_email: { email: false, push: false },
      feedback_received: { email: false, push: false },
      problem_reported: { email: false, push: false },
    };
    await database.db
      .insertInto("umfSupportNotificationPreferences")
      .values([
        {
          userId: "subscribed-director",
          enabled: 1,
          eventPreferences: JSON.stringify(preferences),
          updatedAt: now,
        },
        {
          userId: "crossed-commercial-user",
          enabled: 1,
          eventPreferences: JSON.stringify(preferences),
          updatedAt: now,
        },
      ])
      .execute();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("emails only subscribed, verified corporate support staff", async () => {
    await notify({
      event: "ticket_created",
      title: "Nuevo ticket de prueba",
      message: "Hay una incidencia pendiente de revisión.",
      url: "/umf-support",
    });

    const deliveries = await database.db
      .selectFrom("emailDeliveries")
      .select(["recipient", "platformScope", "kind", "payloadEncrypted"])
      .where("kind", "=", "support_update")
      .execute();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      recipient: "director-alerts@example.com",
      platformScope: "support",
      kind: "support_update",
    });
    expect(deliveries[0]?.payloadEncrypted).not.toContain(
      "www.umbraviaforge.com",
    );
  });

  it("keeps other events disabled unless the account opts in", async () => {
    await notify({
      event: "feedback_received",
      title: "Nueva aportación",
      message: "Se ha recibido retroalimentación.",
      url: "/umf-support",
    });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select("id")
        .where("kind", "=", "support_update")
        .execute(),
    ).resolves.toHaveLength(1);
  });
});
