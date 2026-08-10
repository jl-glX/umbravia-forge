import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("two-step verification", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let auth: typeof import("./auth.js");
  let mfa: typeof import("./mfa.js");
  let userId: string;
  let secret: string;
  let recoveryCodes: string[];

  const currentCodeFor = (configuredSecret: string, email: string) =>
    new OTPAuth.TOTP({
      issuer: "Umbravia Forge",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(configuredSecret),
    }).generate();
  const currentCode = () => currentCodeFor(secret, "mfa-member@example.com");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-mfa-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("./auth.js");
    mfa = await import("./mfa.js");
    await database.initializeDatabase();

    const signup = await auth.signup(
      "mfa-member@example.com",
      "MFA Member",
      "StrongPassword123",
      { userAgent: "Test browser" },
    );
    userId = signup.user.id;
    const setup = await mfa.beginMfaSetup(userId, signup.user.email);
    secret = setup.secret;
    recoveryCodes = await mfa.enableMfa(
      userId,
      signup.user.email,
      currentCode(),
    );
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("encrypts the TOTP secret and creates one-time recovery codes", async () => {
    const stored = await database.db
      .selectFrom("mfaCredentials")
      .selectAll()
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();

    expect(stored.secretEncrypted).not.toContain(secret);
    expect(stored.secretEncrypted).toMatch(/^v2:/);
    expect(
      (JSON.parse(stored.recoveryCodeHashes) as string[]).every((hash) =>
        hash.startsWith("v2:"),
      ),
    ).toBe(true);
    expect(recoveryCodes).toHaveLength(10);

    const firstUse = await mfa.verifyMfaCode(
      userId,
      "mfa-member@example.com",
      recoveryCodes[0],
    );
    const secondUse = await mfa.verifyMfaCode(
      userId,
      "mfa-member@example.com",
      recoveryCodes[0],
    );
    expect(firstUse).toEqual({ valid: true, usedRecoveryCode: true });
    expect(secondUse).toEqual({ valid: false, usedRecoveryCode: false });
  });

  it("allows only one concurrent completion of the same MFA setup", async () => {
    const signup = await auth.signup(
      "mfa-concurrent-setup@example.com",
      "Concurrent MFA Setup",
      "StrongPassword123",
      { userAgent: "Test browser" },
    );
    const setup = await mfa.beginMfaSetup(signup.user.id, signup.user.email);
    const code = currentCodeFor(setup.secret, signup.user.email);

    const results = await Promise.allSettled([
      mfa.enableMfa(signup.user.id, signup.user.email, code),
      mfa.enableMfa(signup.user.id, signup.user.email, code),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(mfa.mfaStatus(signup.user.id)).resolves.toMatchObject({
      enabled: true,
      recoveryCodesRemaining: 10,
    });
  });

  it("keeps legacy v1 secrets readable during the gradual migration", async () => {
    const key = Buffer.from(
      (await readFile(join(directory, "mfa-encryption.key"), "utf8")).trim(),
      "base64",
    );
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const legacyEnvelope = [
      "v1",
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      encrypted.toString("base64"),
    ].join(":");
    const current = await database.db
      .selectFrom("mfaCredentials")
      .select("secretEncrypted")
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();
    await database.db
      .updateTable("mfaCredentials")
      .set({ secretEncrypted: legacyEnvelope })
      .where("userId", "=", userId)
      .execute();

    expect(
      await mfa.verifyMfaCode(userId, "mfa-member@example.com", currentCode()),
    ).toEqual({ valid: true, usedRecoveryCode: false });

    const migrated = await database.db
      .selectFrom("mfaCredentials")
      .select("secretEncrypted")
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();
    expect(migrated.secretEncrypted).toMatch(/^v2:/);

    await database.db
      .updateTable("mfaCredentials")
      .set({ secretEncrypted: current.secretEncrypted })
      .where("userId", "=", userId)
      .execute();
  });

  it("allows only one concurrent use of the same recovery code", async () => {
    const results = await Promise.all([
      mfa.verifyMfaCode(userId, "mfa-member@example.com", recoveryCodes[2]),
      mfa.verifyMfaCode(userId, "mfa-member@example.com", recoveryCodes[2]),
    ]);

    expect(results.filter((result) => result.valid)).toHaveLength(1);
    expect(results.filter((result) => !result.valid)).toHaveLength(1);
  });

  it("accepts one legacy recovery-code hash and consumes it only once", async () => {
    const key = Buffer.from(
      (await readFile(join(directory, "mfa-encryption.key"), "utf8")).trim(),
      "base64",
    );
    const legacyCode = recoveryCodes[1];
    const normalizedCode = legacyCode.replaceAll("-", "").toUpperCase();
    const legacyHash = createHmac("sha256", key)
      .update(normalizedCode)
      .digest("hex");
    await database.db
      .updateTable("mfaCredentials")
      .set({ recoveryCodeHashes: JSON.stringify([legacyHash]) })
      .where("userId", "=", userId)
      .execute();

    expect(
      await mfa.verifyMfaCode(userId, "mfa-member@example.com", legacyCode),
    ).toEqual({ valid: true, usedRecoveryCode: true });
    expect(
      await mfa.verifyMfaCode(userId, "mfa-member@example.com", legacyCode),
    ).toEqual({ valid: false, usedRecoveryCode: false });
  });

  it("binds new MFA ciphertext to the account that owns it", async () => {
    const other = await auth.signup(
      "mfa-other@example.com",
      "Other MFA Member",
      "StrongPassword123",
      { userAgent: "Test browser" },
    );
    await mfa.beginMfaSetup(other.user.id, other.user.email);
    const original = await database.db
      .selectFrom("mfaCredentials")
      .select("secretEncrypted")
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();
    await database.db
      .updateTable("mfaCredentials")
      .set({ secretEncrypted: original.secretEncrypted, enabledAt: Date.now() })
      .where("userId", "=", other.user.id)
      .execute();

    await expect(
      mfa.verifyMfaCode(other.user.id, other.user.email, currentCode()),
    ).rejects.toThrow();
  });

  it("rejects malformed MFA envelopes instead of accepting extra fields", async () => {
    const original = await database.db
      .selectFrom("mfaCredentials")
      .select("secretEncrypted")
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();
    try {
      await database.db
        .updateTable("mfaCredentials")
        .set({ secretEncrypted: `${original.secretEncrypted}:unexpected` })
        .where("userId", "=", userId)
        .execute();

      await expect(
        mfa.verifyMfaCode(userId, "mfa-member@example.com", currentCode()),
      ).rejects.toThrow("Unsupported encrypted MFA secret");
    } finally {
      await database.db
        .updateTable("mfaCredentials")
        .set({ secretEncrypted: original.secretEncrypted })
        .where("userId", "=", userId)
        .execute();
    }
  });

  it("requires the second factor before creating a session", async () => {
    const login = await auth.login(
      "mfa-member@example.com",
      "StrongPassword123",
      "member",
      false,
      { userAgent: "Android test browser" },
    );
    expect(login.mfaRequired).toBe(true);
    if (!login.mfaRequired) throw new Error("Expected an MFA challenge");

    const completed = await auth.completeMfaLogin(
      login.challengeToken,
      currentCode(),
      { userAgent: "Android test browser" },
    );
    expect(completed.user.id).toBe(userId);
    expect(await auth.verifyToken(completed.sessionToken)).toMatchObject({
      userId,
    });

    await expect(
      auth.completeMfaLogin(login.challengeToken, currentCode()),
    ).rejects.toThrow("Invalid or expired verification challenge");
  });

  it("locks a verification challenge after five invalid attempts", async () => {
    const login = await auth.login(
      "mfa-member@example.com",
      "StrongPassword123",
      "member",
      false,
    );
    if (!login.mfaRequired) throw new Error("Expected an MFA challenge");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        auth.completeMfaLogin(login.challengeToken, "000000"),
      ).rejects.toThrow("Invalid verification code");
    }
    await expect(
      auth.completeMfaLogin(login.challengeToken, currentCode()),
    ).rejects.toThrow("Invalid or expired verification challenge");
  });
});
