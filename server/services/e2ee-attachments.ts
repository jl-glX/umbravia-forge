import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/client.js";
import { recordSecurityEvent } from "./security-events.js";

export class E2eeAttachmentError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function attachmentRoot(): string {
  return path.resolve(
    process.env.E2EE_ATTACHMENT_DIRECTORY ??
      path.join(
        process.env.DATA_DIRECTORY ?? path.join(process.cwd(), "data"),
        "private",
        "e2ee-attachments",
      ),
  );
}

export function e2eeAttachmentLimitBytes(): number {
  const configured = Number.parseInt(
    process.env.E2EE_ATTACHMENT_MAX_BYTES ?? "5242880",
    10,
  );
  return Number.isInteger(configured)
    ? Math.min(Math.max(configured, 1024), 10 * 1024 * 1024)
    : 5 * 1024 * 1024;
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function publicAttachment<T extends { storageKey: string }>(attachment: T) {
  const { storageKey: _storageKey, ...result } = attachment;
  return result;
}

export async function storeOpaqueE2eeAttachment(input: {
  body: Buffer;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  clientAttachmentId: string;
  checksumSha256: string;
  associatedData: string;
  expiresAt: number | null;
}) {
  if (
    !Buffer.isBuffer(input.body) ||
    input.body.length === 0 ||
    input.body.length > e2eeAttachmentLimitBytes()
  ) {
    throw new E2eeAttachmentError(
      "Encrypted attachment size is invalid",
      400,
      "E2EE_ATTACHMENT_INVALID",
    );
  }
  const calculatedChecksum = sha256(input.body);
  if (calculatedChecksum !== input.checksumSha256) {
    throw new E2eeAttachmentError(
      "Encrypted attachment integrity verification failed",
      400,
      "E2EE_ATTACHMENT_CHECKSUM_MISMATCH",
    );
  }

  const existing = await db
    .selectFrom("e2eeAttachments")
    .selectAll()
    .where("senderDeviceId", "=", input.senderDeviceId)
    .where("clientAttachmentId", "=", input.clientAttachmentId)
    .where("recipientDeviceId", "=", input.recipientDeviceId)
    .executeTakeFirst();
  if (existing) {
    if (
      existing.checksumSha256 !== calculatedChecksum ||
      existing.sizeBytes !== input.body.length ||
      existing.conversationId !== input.conversationId ||
      existing.senderUserId !== input.senderUserId ||
      existing.recipientUserId !== input.recipientUserId ||
      existing.associatedData !== input.associatedData ||
      existing.expiresAt !== input.expiresAt
    ) {
      throw new E2eeAttachmentError(
        "Encrypted attachment identifier is already in use",
        409,
        "E2EE_ATTACHMENT_ID_CONFLICT",
      );
    }
    return { attachment: publicAttachment(existing), created: false };
  }

  const id = `e2ee-attachment-${randomUUID()}`;
  const storageKey = `${randomUUID()}.bin`;
  const root = attachmentRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, storageKey);
  await writeFile(target, input.body, { flag: "wx", mode: 0o600 });
  try {
    const attachment = {
      id,
      conversationId: input.conversationId,
      senderUserId: input.senderUserId,
      senderDeviceId: input.senderDeviceId,
      recipientUserId: input.recipientUserId,
      recipientDeviceId: input.recipientDeviceId,
      clientAttachmentId: input.clientAttachmentId,
      storageKey,
      sizeBytes: input.body.length,
      checksumSha256: calculatedChecksum,
      associatedData: input.associatedData,
      createdAt: Date.now(),
      downloadedAt: null,
      expiresAt: input.expiresAt,
    };
    await db.insertInto("e2eeAttachments").values(attachment).execute();
    await recordSecurityEvent("e2ee_attachment_uploaded", input.senderUserId, {
      attachmentId: id,
      conversationId: input.conversationId,
      recipientDeviceId: input.recipientDeviceId,
      sizeBytes: input.body.length,
    });
    return { attachment: publicAttachment(attachment), created: true };
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function listOpaqueE2eeAttachments(
  recipientUserId: string,
  recipientDeviceId: string,
  after: number,
  limit: number,
) {
  const attachments = await db
    .selectFrom("e2eeAttachments")
    .selectAll()
    .where("recipientUserId", "=", recipientUserId)
    .where("recipientDeviceId", "=", recipientDeviceId)
    .where("createdAt", ">", after)
    .where((eb) =>
      eb.or([eb("expiresAt", "is", null), eb("expiresAt", ">", Date.now())]),
    )
    .orderBy("createdAt", "asc")
    .orderBy("id", "asc")
    .limit(limit)
    .execute();
  return attachments.map(publicAttachment);
}

export async function readOpaqueE2eeAttachment(
  recipientUserId: string,
  recipientDeviceId: string,
  attachmentId: string,
) {
  const attachment = await db
    .selectFrom("e2eeAttachments")
    .selectAll()
    .where("id", "=", attachmentId)
    .where("recipientUserId", "=", recipientUserId)
    .where("recipientDeviceId", "=", recipientDeviceId)
    .where((eb) =>
      eb.or([eb("expiresAt", "is", null), eb("expiresAt", ">", Date.now())]),
    )
    .executeTakeFirst();
  if (!attachment) {
    throw new E2eeAttachmentError(
      "Encrypted attachment not found",
      404,
      "NOT_FOUND",
    );
  }
  const body = await readFile(
    path.join(attachmentRoot(), attachment.storageKey),
  );
  if (
    body.length !== attachment.sizeBytes ||
    sha256(body) !== attachment.checksumSha256
  ) {
    throw new E2eeAttachmentError(
      "Encrypted attachment integrity verification failed",
      500,
      "E2EE_ATTACHMENT_INTEGRITY_FAILED",
    );
  }
  await db
    .updateTable("e2eeAttachments")
    .set({ downloadedAt: Date.now() })
    .where("id", "=", attachment.id)
    .execute();
  await recordSecurityEvent("e2ee_attachment_downloaded", recipientUserId, {
    attachmentId,
    conversationId: attachment.conversationId,
    recipientDeviceId,
  });
  return { attachment: publicAttachment(attachment), body };
}

export async function deleteOpaqueE2eeAttachment(
  recipientUserId: string,
  recipientDeviceId: string,
  attachmentId: string,
): Promise<void> {
  const attachment = await db
    .selectFrom("e2eeAttachments")
    .selectAll()
    .where("id", "=", attachmentId)
    .where("recipientUserId", "=", recipientUserId)
    .where("recipientDeviceId", "=", recipientDeviceId)
    .executeTakeFirst();
  if (!attachment) {
    throw new E2eeAttachmentError(
      "Encrypted attachment not found",
      404,
      "NOT_FOUND",
    );
  }
  const target = path.join(attachmentRoot(), attachment.storageKey);
  const tombstone = `${target}.delete-${randomUUID()}`;
  await rename(target, tombstone).catch((error: unknown) => {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  });
  try {
    await db
      .deleteFrom("e2eeAttachments")
      .where("id", "=", attachment.id)
      .execute();
  } catch (error) {
    await rename(tombstone, target).catch(() => undefined);
    throw error;
  }
  await unlink(tombstone).catch(() => undefined);
  await recordSecurityEvent("e2ee_attachment_deleted", recipientUserId, {
    attachmentId,
    conversationId: attachment.conversationId,
    recipientDeviceId,
  });
}

export async function purgeExpiredOpaqueE2eeAttachments(
  now = Date.now(),
  requestedLimit = 500,
): Promise<number> {
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 1_000);
  const expired = await db
    .selectFrom("e2eeAttachments")
    .selectAll()
    .where("expiresAt", "is not", null)
    .where("expiresAt", "<=", now)
    .orderBy("expiresAt", "asc")
    .orderBy("id", "asc")
    .limit(limit)
    .execute();

  let removed = 0;
  for (const attachment of expired) {
    const target = path.join(attachmentRoot(), attachment.storageKey);
    const tombstone = `${target}.expire-${randomUUID()}`;
    let payloadMoved = false;
    await rename(target, tombstone)
      .then(() => {
        payloadMoved = true;
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      });

    try {
      const result = await db
        .deleteFrom("e2eeAttachments")
        .where("id", "=", attachment.id)
        .where("expiresAt", "is not", null)
        .where("expiresAt", "<=", now)
        .executeTakeFirst();
      const deleted = Number(result.numDeletedRows);
      if (deleted === 0 && payloadMoved) {
        await rename(tombstone, target).catch(() => undefined);
      } else if (deleted > 0) {
        removed += deleted;
        if (payloadMoved) await unlink(tombstone).catch(() => undefined);
      }
    } catch (error) {
      if (payloadMoved) {
        await rename(tombstone, target).catch(() => undefined);
      }
      throw error;
    }
  }

  return removed;
}
