import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SendMailOptions } from "nodemailer";
import {
  sendDirectEmail,
  type DirectEmailTransportConfiguration,
} from "./email-direct-transport.js";

const temporaryDirectories: string[] = [];
type CreateMailer = NonNullable<
  NonNullable<Parameters<typeof sendDirectEmail>[2]>["createMailer"]
>;

function configuration(): DirectEmailTransportConfiguration {
  const directory = mkdtempSync(path.join(tmpdir(), "umbravia-direct-mail-"));
  temporaryDirectories.push(directory);
  const privateKeyPath = path.join(directory, "mail.private.pem");
  writeFileSync(
    privateKeyPath,
    "-----BEGIN PRIVATE KEY-----\ntest-only-key\n-----END PRIVATE KEY-----\n",
    { mode: 0o600 },
  );
  return {
    mode: "direct_mx",
    from: "Umbravia Forge <no-reply@umbraviaforge.com>",
    heloName: "mail.umbraviaforge.com",
    requireTls: true,
    dkim: {
      domainName: "umbraviaforge.com",
      keySelector: "mail",
      privateKeyPath,
    },
  };
}

describe("direct MX email transport", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses ordered MX fallbacks, mandatory STARTTLS and DKIM", async () => {
    const connectionOptions: Array<Record<string, unknown>> = [];
    const messages: Array<Record<string, unknown>> = [];
    const createMailer: CreateMailer = vi.fn((options) => {
      connectionOptions.push(options);
      return {
        sendMail: vi.fn(async (message: SendMailOptions) => {
          messages.push(message as unknown as Record<string, unknown>);
          if (options.host === "192.0.2.10") {
            throw Object.assign(new Error("temporary failure"), {
              responseCode: 421,
            });
          }
          return { messageId: "direct-message@example.net" };
        }),
      };
    });

    await expect(
      sendDirectEmail(
        configuration(),
        {
          to: "member@example.net",
          subject: "Direct delivery",
          text: "Message body",
          html: "<p>Message body</p>",
        },
        {
          resolveMx: async () => [
            { exchange: "mx2.example.net", priority: 20 },
            { exchange: "mx1.example.net", priority: 10 },
          ],
          resolve4: async (host) =>
            host === "mx1.example.net" ? ["192.0.2.10"] : ["192.0.2.20"],
          createMailer,
        },
      ),
    ).resolves.toEqual({ messageId: "direct-message@example.net" });

    expect(connectionOptions.map((options) => options.host)).toEqual([
      "192.0.2.10",
      "192.0.2.20",
    ]);
    expect(connectionOptions[0]).toMatchObject({
      port: 25,
      name: "mail.umbraviaforge.com",
      requireTLS: true,
      tls: {
        servername: "mx1.example.net",
        rejectUnauthorized: true,
      },
    });
    expect(messages.at(-1)).toMatchObject({
      envelope: {
        from: "no-reply@umbraviaforge.com",
        to: "member@example.net",
      },
      dkim: {
        domainName: "umbraviaforge.com",
        keySelector: "mail",
      },
    });
  });

  it("does not retry a permanent SMTP rejection on another MX", async () => {
    const createMailer: CreateMailer = vi.fn(() => ({
      sendMail: vi.fn(async () => {
        throw Object.assign(new Error("mailbox rejected"), {
          responseCode: 550,
        });
      }),
    }));

    await expect(
      sendDirectEmail(
        configuration(),
        { to: "member@example.net", subject: "Test", text: "Body" },
        {
          resolveMx: async () => [
            { exchange: "mx1.example.net", priority: 10 },
            { exchange: "mx2.example.net", priority: 20 },
          ],
          resolve4: async () => ["192.0.2.10"],
          createMailer,
        },
      ),
    ).rejects.toMatchObject({
      retryable: false,
    });
    expect(createMailer).toHaveBeenCalledTimes(1);
  });

  it("honours a null MX and refuses misaligned sender domains", async () => {
    await expect(
      sendDirectEmail(
        configuration(),
        { to: "member@example.net", subject: "Test", text: "Body" },
        {
          resolveMx: async () => [{ exchange: ".", priority: 0 }],
          resolve4: async () => ["192.0.2.10"],
        },
      ),
    ).rejects.toMatchObject({
      retryable: false,
    });

    const misaligned = configuration();
    misaligned.dkim.domainName = "other.example";
    await expect(
      sendDirectEmail(
        misaligned,
        { to: "member@example.net", subject: "Test", text: "Body" },
        {
          resolveMx: async () => [],
          resolve4: async () => ["192.0.2.10"],
        },
      ),
    ).rejects.toThrow(/must match/i);
  });

  it("uses only IPv4 destination addresses while retaining the MX name for TLS", async () => {
    const createMailer: CreateMailer = vi.fn(() => ({
      sendMail: vi.fn(async () => ({ messageId: "ipv4@example.net" })),
    }));

    await sendDirectEmail(
      configuration(),
      { to: "member@example.net", subject: "Test", text: "Body" },
      {
        resolveMx: async () => [{ exchange: "mx.example.net", priority: 10 }],
        resolve4: async () => ["192.0.2.25"],
        createMailer,
      },
    );

    expect(createMailer).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "192.0.2.25",
        tls: expect.objectContaining({ servername: "mx.example.net" }),
      }),
    );
  });
});
