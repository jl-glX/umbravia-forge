import { describe, expect, it } from "vitest";
import { IndexedDbE2eeKeyVault } from "./key-vault";

describe("E2EE key vault boundary", () => {
  it("rejects unwrapped private state before attempting persistence", async () => {
    const vault = new IndexedDbE2eeKeyVault();

    await expect(
      vault.put("browser-device", "raw-private-key-material"),
    ).rejects.toThrow("Only wrapped E2EE device state can be persisted");
  });
});
