import { describe, expect, it } from "vitest";
import {
  resolveSupportAttachmentMimeType,
  supportAttachmentAcceptAttribute,
} from "./support-attachment-policy.js";

describe("support attachment policy", () => {
  it("accepts the documented business and preview formats", () => {
    expect(
      resolveSupportAttachmentMimeType("report.pdf", "application/pdf"),
    ).toBe("application/pdf");
    expect(resolveSupportAttachmentMimeType("photo.heic", "image/heic")).toBe(
      "image/heic",
    );
    expect(
      resolveSupportAttachmentMimeType(
        "archive.rar",
        "application/octet-stream",
      ),
    ).toBe("application/vnd.rar");
    expect(supportAttachmentAcceptAttribute).toContain(".docx");
    expect(supportAttachmentAcceptAttribute).toContain(".psd");
  });

  it("rejects GIF and files outside the explicit allowlist", () => {
    expect(
      resolveSupportAttachmentMimeType("animation.gif", "image/gif"),
    ).toBeNull();
    expect(
      resolveSupportAttachmentMimeType(
        "program.exe",
        "application/octet-stream",
      ),
    ).toBeNull();
    expect(supportAttachmentAcceptAttribute).not.toContain(".gif");
  });
});
