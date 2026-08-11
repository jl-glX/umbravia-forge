import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySupportEmailWebhookSignature } from "../../../server/lib/support-email-inbound.js";
import { supportEmailWorker } from "./index.js";

const webhookSecret = Buffer.alloc(32, 37).toString("base64");

function message(raw: string, to = "support@example.com") {
  const bytes = new TextEncoder().encode(raw);
  const rejected = vi.fn();
  const email = {
    from: "member@example.com",
    to,
    raw: new Blob([bytes]).stream(),
    headers: new Headers(),
    rawSize: bytes.byteLength,
    setReject: rejected,
  } as unknown as ForwardableEmailMessage;
  return { email, rejected };
}

describe("Cloudflare support email Worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses plain text and signs the exact webhook body", async () => {
    let requestBody = "";
    let timestamp = "";
    let signature = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init?: RequestInit) => {
        requestBody = String(init?.body ?? "");
        const headers = new Headers(init?.headers);
        timestamp = headers.get("X-Umbravia-Timestamp") ?? "";
        signature = headers.get("X-Umbravia-Signature") ?? "";
        return new Response(null, { status: 202 });
      }),
    );
    const { email, rejected } = message(
      [
        "From: Member <member@example.com>",
        "To: support@example.com",
        "Subject: Ayuda con mi cuenta",
        "Message-ID: <worker-test@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Necesito ayuda con mi cuenta.",
      ].join("\r\n"),
    );

    await supportEmailWorker.email(email, {
      SUPPORT_INBOUND_ENDPOINT:
        "https://app.example.com/api/internal/support-email",
      SUPPORT_INBOUND_WEBHOOK_SECRET: webhookSecret,
    });

    expect(rejected).not.toHaveBeenCalled();
    expect(JSON.parse(requestBody)).toMatchObject({
      version: 1,
      from: "member@example.com",
      envelopeTo: "support@example.com",
      attachmentCount: 0,
    });
    expect(
      verifySupportEmailWebhookSignature({
        body: Buffer.from(requestBody),
        timestamp,
        signature,
        secret: Buffer.from(webhookSecret, "base64"),
      }),
    ).toBe(true);
  });

  it("rejects attachments before contacting the application", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { email, rejected } = message(
      [
        "From: Member <member@example.com>",
        "To: support@example.com",
        "Subject: Archivo",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="test-boundary"',
        "",
        "--test-boundary",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Adjunto una prueba.",
        "--test-boundary",
        "Content-Type: text/plain",
        'Content-Disposition: attachment; filename="test.txt"',
        "",
        "contenido",
        "--test-boundary--",
      ].join("\r\n"),
    );

    await supportEmailWorker.email(email, {
      SUPPORT_INBOUND_ENDPOINT:
        "https://app.example.com/api/internal/support-email",
      SUPPORT_INBOUND_WEBHOOK_SECRET: webhookSecret,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledOnce();
  });

  it("rejects a visible sender that does not match the SMTP envelope", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { email, rejected } = message(
      [
        "From: Impostor <other@example.com>",
        "To: support@example.com",
        "Subject: Identidad contradictoria",
        "Message-ID: <spoof-test@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Necesito ayuda con esta cuenta.",
      ].join("\r\n"),
    );

    await supportEmailWorker.email(email, {
      SUPPORT_INBOUND_ENDPOINT:
        "https://app.example.com/api/internal/support-email",
      SUPPORT_INBOUND_WEBHOOK_SECRET: webhookSecret,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledWith(
      "The support message could not be accepted.",
    );
  });
});
