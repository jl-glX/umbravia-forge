import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcryptjs from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("persistent authentication sessions", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let auth: typeof import("./auth.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-auth-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("./auth.js");
    await database.initializeDatabase();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores only a token hash, reads the current role and revokes the session", async () => {
    const result = await auth.signup(
      "secure-member@example.com",
      "Secure Member",
      "StrongPassword123",
    );

    const stored = await database.db
      .selectFrom("sessions")
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(stored.id).not.toBe(result.sessionToken);
    expect(stored.id).toMatch(/^[a-f0-9]{64}$/);
    expect(await auth.verifyToken(result.sessionToken)).toMatchObject({
      userId: result.user.id,
      role: "member",
      facility: {
        id: "primary",
        role: "member",
      },
    });

    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select(["facilityId", "role", "status"])
        .where("userId", "=", result.user.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      facilityId: "primary",
      role: "member",
      status: "active",
    });

    await database.db
      .updateTable("users")
      .set({ role: "trainer" })
      .where("id", "=", result.user.id)
      .execute();
    expect(await auth.verifyToken(result.sessionToken)).toMatchObject({
      role: "trainer",
    });

    await auth.logout(result.sessionToken);
    expect(await auth.verifyToken(result.sessionToken)).toBeNull();
  });

  it("separates member and staff portals and accepts a centre phone number", async () => {
    const password = "StrongStaffPassword123";
    await database.db
      .insertInto("users")
      .values({
        id: "secure-admin",
        email: "secure-admin@umbravia-forge.test",
        phone: "+34953000123",
        name: "Secure Admin",
        avatarDataUrl: "",
        password: await auth.hashPassword(password),
        role: "admin",
        sessionIdleTimeoutMinutes: 7 * 24 * 60,
        createdAt: Date.now(),
      })
      .execute();

    await expect(
      auth.login("secure-admin@umbravia-forge.test", password, "member"),
    ).rejects.toThrow("Invalid email or password");

    const staffLogin = await auth.login("+34 953 000 123", password, "staff");
    expect(staffLogin.mfaRequired).toBe(false);
    if (!("user" in staffLogin)) throw new Error("Unexpected MFA challenge");
    expect(staffLogin.user.role).toBe("admin");

    const member = await auth.signup(
      "portal-member@example.com",
      "Portal Member",
      "StrongPassword123",
    );
    await expect(
      auth.login(member.user.email, "StrongPassword123", "staff"),
    ).rejects.toThrow("Invalid email or password");
  });

  it("keeps an explicitly remembered device signed in for 30 days", async () => {
    const password = "RememberedPassword123";
    const member = await auth.signup(
      "remembered-member@example.com",
      "Remembered Member",
      password,
    );

    const result = await auth.login(
      member.user.email,
      password,
      "member",
      true,
      { userAgent: "Remembered test device" },
    );
    if (!("sessionToken" in result))
      throw new Error("Unexpected MFA challenge");

    const stored = await database.db
      .selectFrom("sessions")
      .select(["createdAt", "expiresAt", "remembered", "userAgent"])
      .where("userId", "=", member.user.id)
      .where("userAgent", "=", "Remembered test device")
      .executeTakeFirstOrThrow();

    expect(stored.remembered).toBe(1);
    expect(stored.userAgent).toBe("Remembered test device");
    expect(stored.expiresAt - stored.createdAt).toBe(
      auth.REMEMBERED_SESSION_DURATION,
    );
  });

  it("revokes a session after the user-selected inactivity period", async () => {
    const result = await auth.signup(
      "idle-member@example.com",
      "Idle Member",
      "IdlePassword123",
    );
    const now = Date.now();

    await database.db
      .updateTable("users")
      .set({ sessionIdleTimeoutMinutes: 15 })
      .where("id", "=", result.user.id)
      .execute();
    await database.db
      .updateTable("sessions")
      .set({ lastSeenAt: now - 16 * 60 * 1000 })
      .where("userId", "=", result.user.id)
      .execute();

    expect(await auth.verifyToken(result.sessionToken)).toBeNull();

    const stored = await database.db
      .selectFrom("sessions")
      .select("revokedAt")
      .where("userId", "=", result.user.id)
      .executeTakeFirstOrThrow();
    expect(stored.revokedAt).not.toBeNull();
  });

  it("rejects abusive oversized passwords before Argon2id", async () => {
    const oversizedPassword = `Aa1${"x".repeat(1_022)}`;

    expect(Buffer.byteLength(oversizedPassword, "utf8")).toBeGreaterThan(1_024);
    expect(auth.isStrongPassword(oversizedPassword)).toBe(false);
    await expect(auth.hashPassword(oversizedPassword)).rejects.toThrow(
      "Password exceeds the supported byte length",
    );
  });

  it("upgrades a valid legacy bcrypt hash after login", async () => {
    const password = "LegacyMigrationPassword123";
    const legacyHash = await bcryptjs.hash(password, 12);
    await database.db
      .updateTable("users")
      .set({ password: legacyHash })
      .where("id", "=", "secure-admin")
      .execute();

    const result = await auth.login(
      "secure-admin@umbravia-forge.test",
      password,
      "staff",
    );
    expect(result.mfaRequired).toBe(false);
    const migrated = await database.db
      .selectFrom("users")
      .select("password")
      .where("id", "=", "secure-admin")
      .executeTakeFirstOrThrow();
    expect(migrated.password).toMatch(/^\$argon2id\$/);
  });

  it("stores progressive signup identity and versioned acknowledgements", async () => {
    const result = await auth.signup(
      "progressive-signup@example.com",
      "Javier",
      "ProgressivePassword123",
      {},
      {
        lastName: "López",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    );
    const stored = await database.db
      .selectFrom("users")
      .select([
        "lastName",
        "countryCode",
        "locale",
        "accountStatus",
        "emailVerifiedAt",
        "termsVersion",
        "termsAcceptedAt",
        "privacyVersion",
        "privacyAcceptedAt",
      ])
      .where("id", "=", result.user.id)
      .executeTakeFirstOrThrow();

    expect(stored).toMatchObject({
      lastName: "López",
      countryCode: "ES",
      locale: "es",
      accountStatus: "pending_verification",
      emailVerifiedAt: null,
      termsVersion: "draft-2026-08-03",
      privacyVersion: "draft-2026-08-03",
      termsAcceptedAt: expect.any(Number),
      privacyAcceptedAt: expect.any(Number),
    });
  });

  it("stores administrator provisioning without creating an active tenant", async () => {
    const result = await auth.signup(
      "pending-administrator@example.com",
      "Pending Administrator",
      "ProgressivePassword123",
      {},
      {
        lastName: "Account",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
        accountType: "administrator",
        facilityName: "Pending Facility",
        facilityType: "traditional_gym",
      },
    );
    expect(result.user).toMatchObject({
      role: "admin",
      accountStatus: "pending_verification",
    });
    await expect(
      database.db
        .selectFrom("administratorSignupProvisioning")
        .select(["facilityName", "facilityType"])
        .where("userId", "=", result.user.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      facilityName: "Pending Facility",
      facilityType: "traditional_gym",
    });
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("id")
        .where("userId", "=", result.user.id)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });
});
