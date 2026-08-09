import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("email delivery queue security", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let auth: typeof import("./auth.js");
  let emailDelivery: typeof import("./email-delivery.js");
  let userId: string;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-email-queue-security-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "EMAIL_QUEUE_ENCRYPTION_KEY",
      randomBytes(32).toString("base64"),
    );
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("./auth.js");
    emailDelivery = await import("./email-delivery.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      "email-queue-security@example.com",
      "Email Queue Security",
      "EmailQueueSecurityPassword123",
      {},
      undefined,
      { requireEmailVerification: false },
    );
    userId = account.user.id;
  }, 20_000);

  afterAll(async () => {
    emailDelivery.resetEmailTransportForTests();
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function queueRecovery(code: string, expiresAt: number) {
    return emailDelivery.queueAccountRecoveryCode({
      userId,
      email: "email-queue-security@example.com",
      name: "Synthetic Recipient",
      code,
      locale: "es",
      expiresAt,
    });
  }

  it("stores recovery contents only inside an authenticated ciphertext", async () => {
    const code = "654321";
    const deliveryId = await queueRecovery(code, Date.now() + 60_000);
    const stored = await database.db
      .selectFrom("emailDeliveries")
      .select(["recipient", "payloadEncrypted", "status", "attempts"])
      .where("id", "=", deliveryId)
      .executeTakeFirstOrThrow();

    expect(stored).toMatchObject({ status: "queued", attempts: 0 });
    expect(stored.payloadEncrypted).toMatch(/^v1\./);
    expect(stored.payloadEncrypted).not.toContain(code);
    expect(stored.payloadEncrypted).not.toContain("Synthetic Recipient");
    expect(stored.payloadEncrypted).not.toContain(stored.recipient);
  });

  it("rejects a manipulated ciphertext without disclosing its contents", async () => {
    const deliveryId = await queueRecovery("112233", Date.now() + 60_000);
    const stored = await database.db
      .selectFrom("emailDeliveries")
      .select("payloadEncrypted")
      .where("id", "=", deliveryId)
      .executeTakeFirstOrThrow();
    const [version, iv, authenticationTag, ciphertext] =
      stored.payloadEncrypted.split(".");
    const tamperedTag = Buffer.from(authenticationTag, "base64url");
    tamperedTag[0] ^= 0xff;
    await database.db
      .updateTable("emailDeliveries")
      .set({
        payloadEncrypted: [
          version,
          iv,
          tamperedTag.toString("base64url"),
          ciphertext,
        ].join("."),
      })
      .where("id", "=", deliveryId)
      .execute();

    await expect(emailDelivery.deliverQueuedEmail(deliveryId)).resolves.toBe(
      false,
    );
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "attempts", "lastError"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "retry",
      attempts: 1,
      lastError: "delivery_processing_failed",
    });
  });

  it("supersedes older recovery messages and removes their encrypted payload", async () => {
    const first = await queueRecovery("111222", Date.now() + 60_000);
    const second = await queueRecovery("333444", Date.now() + 60_000);

    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "payloadEncrypted"])
        .where("id", "=", first)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "superseded", payloadEncrypted: "" });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select("status")
        .where("id", "=", second)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "queued" });
  });

  it("purges an expired payload before attempting delivery", async () => {
    const deliveryId = await queueRecovery("445566", Date.now() - 1);

    await expect(emailDelivery.deliverQueuedEmail(deliveryId)).resolves.toBe(
      false,
    );
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "payloadEncrypted", "lastError"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "failed",
      payloadEncrypted: "",
      lastError: "expired_before_delivery",
    });
  });

  it("stops retrying and purges the payload after the final SMTP failure", async () => {
    const deliveryId = await queueRecovery("778899", Date.now() + 60_000);
    await database.db
      .updateTable("emailDeliveries")
      .set({ attempts: 4 })
      .where("id", "=", deliveryId)
      .execute();

    await expect(emailDelivery.deliverQueuedEmail(deliveryId)).resolves.toBe(
      false,
    );
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "attempts", "payloadEncrypted", "lastError"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "failed",
      attempts: 5,
      payloadEncrypted: "",
      lastError: "smtp_unavailable",
    });
  });

  it("claims a queued delivery only once when workers race", async () => {
    const deliveryId = await queueRecovery("889900", Date.now() + 60_000);

    await expect(
      Promise.all([
        emailDelivery.deliverQueuedEmail(deliveryId),
        emailDelivery.deliverQueuedEmail(deliveryId),
      ]),
    ).resolves.toEqual([false, false]);

    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "attempts", "lastError"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "retry",
      attempts: 1,
      lastError: "smtp_unavailable",
    });
  });
});
