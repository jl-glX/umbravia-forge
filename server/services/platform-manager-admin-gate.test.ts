import { describe, expect, it, vi } from "vitest";
import { authorizePlatformManagerAdminBeforeDatabase } from "../../scripts/platform-manager-admin-gate.js";

describe("platform manager local database gate", () => {
  it.each(["commercial", "support"] as const)(
    "does not initialize the database when the %s local barrier rejects",
    async (platformScope) => {
      const rejectedRuntimes = [
        {
          operatingSystem: "win32" as const,
          effectiveUserId: null,
          linuxUser: "operator",
          allowedLinuxUsers: "operator",
          platformScope,
        },
        {
          operatingSystem: "linux" as const,
          effectiveUserId: 0,
          linuxUser: "root",
          allowedLinuxUsers: "root",
          platformScope,
        },
        {
          operatingSystem: "linux" as const,
          effectiveUserId: 1000,
          linuxUser: "unlisted",
          allowedLinuxUsers: "operator",
          platformScope,
        },
      ];

      for (const runtime of rejectedRuntimes) {
        const initializeDatabase = vi.fn(async () => undefined);
        await expect(
          authorizePlatformManagerAdminBeforeDatabase(
            runtime,
            initializeDatabase,
          ),
        ).rejects.toThrow();
        expect(initializeDatabase).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["commercial", "support"] as const)(
    "initializes the database once after the %s local barrier admits",
    async (platformScope) => {
      const initializeDatabase = vi.fn(async () => undefined);
      await expect(
        authorizePlatformManagerAdminBeforeDatabase(
          {
            operatingSystem: "linux",
            effectiveUserId: 1000,
            linuxUser: "operator",
            allowedLinuxUsers: "operator",
            platformScope,
          },
          initializeDatabase,
        ),
      ).resolves.toMatchObject({
        channel: "local-linux-terminal",
        linuxUser: "operator",
        platformScope,
      });
      expect(initializeDatabase).toHaveBeenCalledTimes(1);
    },
  );
});
