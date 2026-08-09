import bcryptjs from "bcryptjs";
import { describe, expect, it } from "vitest";
import {
  ARGON2ID_OPTIONS,
  hashPasswordWithArgon2id,
  passwordHashNeedsUpgrade,
  verifyPasswordHash,
} from "./password-hashing.js";

describe("Argon2id password hashing", () => {
  it("creates an Argon2id PHC string with the selected cost profile", async () => {
    const encoded = await hashPasswordWithArgon2id("StrongPassword123");

    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(await verifyPasswordHash("StrongPassword123", encoded)).toBe(true);
    expect(await verifyPasswordHash("WrongPassword123", encoded)).toBe(false);
    expect(passwordHashNeedsUpgrade(encoded)).toBe(false);
    expect(ARGON2ID_OPTIONS).toMatchObject({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
  });

  it("keeps legacy bcrypt hashes readable only for gradual migration", async () => {
    const legacy = await bcryptjs.hash("LegacyPassword123", 12);

    expect(await verifyPasswordHash("LegacyPassword123", legacy)).toBe(true);
    expect(passwordHashNeedsUpgrade(legacy)).toBe(true);
    expect(await verifyPasswordHash("LegacyPassword123", "invalid")).toBe(
      false,
    );
  });
});
