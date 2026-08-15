import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve4, resolveMx } from "node:dns/promises";
import { domainToASCII } from "node:url";
import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";

export type DirectEmailTransportConfiguration = {
  mode: "direct_mx";
  from: string;
  heloName: string;
  localAddress?: string;
  requireTls: true;
  dkim: {
    domainName: string;
    keySelector: string;
    privateKeyPath: string;
  };
};

type MxRecord = { exchange: string; priority: number };

type DirectTransportDependencies = {
  resolveMx?: (domain: string) => Promise<MxRecord[]>;
  resolve4?: (domain: string) => Promise<string[]>;
  createMailer?: (options: {
    host: string;
    port: number;
    name: string;
    localAddress?: string;
    requireTLS: true;
    tls: { servername: string; rejectUnauthorized: true };
  }) => {
    sendMail: (message: SendMailOptions) => Promise<{ messageId?: string }>;
  };
};

export class DirectEmailTransportError extends Error {
  readonly retryable: boolean;
  readonly cause?: Error;

  constructor(message: string, retryable: boolean, cause?: Error) {
    super(message);
    this.name = "DirectEmailTransportError";
    this.retryable = retryable;
    this.cause = cause;
  }
}

function smtpResponseCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("responseCode" in error)) {
    return undefined;
  }
  const value = (error as { responseCode?: unknown }).responseCode;
  return typeof value === "number" ? value : undefined;
}

function normalizeDomain(value: string, label: string): string {
  const normalized = domainToASCII(
    value.trim().toLowerCase().replace(/\.$/, ""),
  );
  if (
    !normalized ||
    normalized.length > 253 ||
    normalized
      .split(".")
      .some(
        (part) =>
          !part ||
          part.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part),
      )
  ) {
    throw new DirectEmailTransportError(`${label} is invalid`, false);
  }
  return normalized;
}

function mailbox(value: string, label: string): string {
  const trimmed = value.trim();
  const angleAddress = trimmed.match(/<([^<>]+)>$/)?.[1]?.trim();
  const address = angleAddress ?? trimmed;
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) {
    throw new DirectEmailTransportError(`${label} is invalid`, false);
  }
  return address;
}

function mailboxDomain(value: string, label: string): string {
  const address = mailbox(value, label);
  return normalizeDomain(address.slice(address.lastIndexOf("@") + 1), label);
}

function readDkimPrivateKey(
  configuration: DirectEmailTransportConfiguration,
): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      configuration.dkim.privateKeyPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size < 1 || stats.size > 128 * 1024) {
      throw new Error("DKIM key path must reference a small regular file");
    }
    if (
      process.platform !== "win32" &&
      process.env.NODE_ENV === "production" &&
      ((stats.mode & 0o007) !== 0 || (stats.mode & 0o020) !== 0)
    ) {
      throw new Error(
        "DKIM key file must not be accessible by other users or writable by its group",
      );
    }
    const privateKey = readFileSync(descriptor, "utf8");
    if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(privateKey)) {
      throw new Error("DKIM key file is not a supported PEM private key");
    }
    return privateKey;
  } catch (cause) {
    throw new DirectEmailTransportError(
      "DKIM signing key is unavailable",
      true,
      cause instanceof Error ? cause : undefined,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function destinationMxRecords(
  domain: string,
  resolver: (domain: string) => Promise<MxRecord[]>,
): Promise<MxRecord[]> {
  try {
    const records = await resolver(domain);
    if (
      records.length === 1 &&
      (!records[0]?.exchange || records[0].exchange === ".")
    ) {
      throw new DirectEmailTransportError(
        "Recipient domain explicitly rejects email delivery",
        false,
      );
    }
    if (records.length > 0) {
      return records
        .map((record) => ({
          exchange: normalizeDomain(record.exchange, "MX exchange"),
          priority: record.priority,
        }))
        .sort((left, right) => left.priority - right.priority);
    }
  } catch (cause) {
    if (cause instanceof DirectEmailTransportError) throw cause;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code?: unknown }).code)
        : "";
    if (!new Set(["ENODATA", "ENOTFOUND"]).has(code)) {
      throw new DirectEmailTransportError(
        "MX lookup failed",
        true,
        cause instanceof Error ? cause : undefined,
      );
    }
  }

  // RFC 5321 treats a host with no MX record as an implicit MX target.
  return [{ exchange: domain, priority: 0 }];
}

export async function sendDirectEmail(
  configuration: DirectEmailTransportConfiguration,
  message: SendMailOptions & { to: string },
  dependencies: DirectTransportDependencies = {},
): Promise<{ messageId?: string }> {
  const recipient = mailbox(message.to, "Recipient address");
  const recipientDomain = mailboxDomain(recipient, "Recipient domain");
  const sender = mailbox(configuration.from, "Sender address");
  const senderDomain = mailboxDomain(sender, "Sender domain");
  const dkimDomain = normalizeDomain(
    configuration.dkim.domainName,
    "DKIM domain",
  );
  if (senderDomain !== dkimDomain) {
    throw new DirectEmailTransportError(
      "Sender and DKIM domains must match for direct delivery",
      false,
    );
  }

  const heloName = normalizeDomain(configuration.heloName, "EHLO hostname");
  const keySelector = normalizeDomain(
    configuration.dkim.keySelector,
    "DKIM selector",
  );
  const privateKey = readDkimPrivateKey(configuration);
  const records = await destinationMxRecords(
    recipientDomain,
    dependencies.resolveMx ?? resolveMx,
  );
  const resolveIpv4 = dependencies.resolve4 ?? resolve4;
  const createMailer =
    dependencies.createMailer ??
    ((options) =>
      nodemailer.createTransport({
        ...options,
        secure: false,
        ignoreTLS: false,
        opportunisticTLS: false,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        dnsTimeout: 15_000,
      }));

  let lastError: Error | undefined;
  for (const record of records) {
    let ipv4Addresses: string[];
    try {
      ipv4Addresses = await resolveIpv4(record.exchange);
    } catch (cause) {
      lastError =
        cause instanceof Error ? cause : new Error("IPv4 lookup failed");
      continue;
    }

    for (const address of ipv4Addresses) {
      try {
        return await createMailer({
          host: address,
          port: 25,
          name: heloName,
          localAddress: configuration.localAddress,
          requireTLS: true,
          tls: {
            servername: record.exchange,
            rejectUnauthorized: true,
          },
        }).sendMail({
          ...message,
          from: configuration.from,
          to: recipient,
          envelope: { from: sender, to: recipient },
          dkim: {
            domainName: dkimDomain,
            keySelector,
            privateKey,
          },
        });
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error("SMTP failed");
        const responseCode = smtpResponseCode(cause);
        if (responseCode !== undefined && responseCode >= 500) {
          throw new DirectEmailTransportError(
            "Recipient server permanently rejected the message",
            false,
            error,
          );
        }
        lastError = error;
      }
    }
  }

  throw new DirectEmailTransportError(
    "All destination mail exchangers failed temporarily",
    true,
    lastError,
  );
}
