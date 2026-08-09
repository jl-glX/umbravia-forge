import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Vitest process supervisor", () => {
  it("uses a shell-independent owned child and bounded shutdown", async () => {
    const source = await readFile(
      path.resolve("scripts", "testing", "run-vitest.mjs"),
      "utf8",
    );

    expect(source).toContain("shell: false");
    expect(source).toContain("windowsHide: true");
    expect(source).toContain('child.kill("SIGKILL")');
    expect(source).toContain("10_000");
    expect(source).not.toMatch(/taskkill|Stop-Process|pkill|killall/);
  });
});
