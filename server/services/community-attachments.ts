import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/client.js";
import {
  privateContentNeedsRewrap,
  protectPrivateBytes,
  revealPrivateBytes,
  rewrapPrivateBytes,
} from "../lib/private-content-crypto.js";
import type { AuthenticatedUser } from "../middleware/authorization.js";
import { recordSecurityEvent } from "./security-events.js";

export class CommunityAttachmentError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const allowedAttachmentTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

function attachmentRoot(): string {
  return path.resolve(
    process.env.COMMUNITY_ATTACHMENT_DIRECTORY ??
      path.join(
        process.env.DATA_DIRECTORY ?? path.join(process.cwd(), "data"),
        "private",
        "community-attachments",
      ),
  );
}

export function communityAttachmentLimitBytes(): number {
  const configured = Number.parseInt(
    process.env.COMMUNITY_ATTACHMENT_MAX_BYTES ?? "5242880",
    10,
  );
  return Number.isInteger(configured)
    ? Math.min(Math.max(configured, 1024), 10 * 1024 * 1024)
    : 5 * 1024 * 1024;
}

function sanitizedFileName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 180) {
    throw new CommunityAttachmentError(
      "Attachment file name is invalid",
      400,
      "ATTACHMENT_INVALID",
    );
  }
  return Array.from(normalized)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return character === "\\" ||
        character === "/" ||
        codePoint === undefined ||
        codePoint <= 31 ||
        codePoint === 127
        ? "_"
        : character;
    })
    .join("");
}

async function requireManagedCommunityAccess(
  auth: AuthenticatedUser,
  channelId: string,
) {
  const channel = await db
    .selectFrom("communityChannels")
    .select(["id", "scope"])
    .where("id", "=", channelId)
    .executeTakeFirst();
  if (!channel || channel.scope !== "community") {
    throw new CommunityAttachmentError(
      "Managed community not found",
      404,
      "NOT_FOUND",
    );
  }
  const membership = await db
    .selectFrom("communityMembers")
    .select("role")
    .where("channelId", "=", channelId)
    .where("userId", "=", auth.userId)
    .executeTakeFirst();
  if (!membership) {
    throw new CommunityAttachmentError(
      "Managed community not found",
      404,
      "NOT_FOUND",
    );
  }
  return membership;
}

function publicAttachment<T extends { storageKey: string }>(attachment: T) {
  const { storageKey: _storageKey, ...result } = attachment;
  return result;
}

export async function listCommunityAttachments(
  auth: AuthenticatedUser,
  channelId: string,
) {
  await requireManagedCommunityAccess(auth, channelId);
  const attachments = await db
    .selectFrom("communityAttachments")
    .selectAll()
    .where("channelId", "=", channelId)
    .orderBy("createdAt", "desc")
    .limit(100)
    .execute();
  return attachments.map(publicAttachment);
}

export async function storeCommunityAttachment(
  auth: AuthenticatedUser,
  channelId: string,
  input: {
    body: Buffer;
    fileName: string;
    mimeType: string;
    messageId?: string | null;
  },
) {
  await requireManagedCommunityAccess(auth, channelId);
  if (
    !Buffer.isBuffer(input.body) ||
    input.body.length === 0 ||
    input.body.length > communityAttachmentLimitBytes()
  ) {
    throw new CommunityAttachmentError(
      "Attachment size is invalid",
      400,
      "ATTACHMENT_INVALID",
    );
  }
  if (!allowedAttachmentTypes.has(input.mimeType)) {
    throw new CommunityAttachmentError(
      "Attachment type is not allowed",
      415,
      "ATTACHMENT_TYPE_NOT_ALLOWED",
    );
  }
  const messageId = input.messageId ?? null;
  if (messageId) {
    const message = await db
      .selectFrom("communityMessages")
      .select("id")
      .where("id", "=", messageId)
      .where("channelId", "=", channelId)
      .executeTakeFirst();
    if (!message) {
      throw new CommunityAttachmentError(
        "Attachment message does not belong to the community",
        400,
        "ATTACHMENT_INVALID",
      );
    }
  }

  const id = `community-attachment-${randomUUID()}`;
  const storageKey = `${randomUUID()}.bin`;
  const root = attachmentRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, storageKey);
  const protectedBody = protectPrivateBytes(
    input.body,
    `community-attachment:${id}`,
  );
  await writeFile(target, protectedBody, { flag: "wx", mode: 0o600 });
  try {
    const attachment = {
      id,
      channelId,
      messageId,
      uploadedByUserId: auth.userId,
      fileName: sanitizedFileName(input.fileName),
      mimeType: input.mimeType,
      sizeBytes: input.body.length,
      storageKey,
      checksumSha256: createHash("sha256").update(input.body).digest("hex"),
      createdAt: Date.now(),
    };
    await db.insertInto("communityAttachments").values(attachment).execute();
    await recordSecurityEvent("private_attachment_uploaded", auth.userId, {
      attachmentId: id,
      channelId,
      sizeBytes: input.body.length,
    });
    return publicAttachment(attachment);
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function readCommunityAttachment(
  auth: AuthenticatedUser,
  channelId: string,
  attachmentId: string,
) {
  await requireManagedCommunityAccess(auth, channelId);
  const attachment = await db
    .selectFrom("communityAttachments")
    .selectAll()
    .where("id", "=", attachmentId)
    .where("channelId", "=", channelId)
    .executeTakeFirst();
  if (!attachment) {
    throw new CommunityAttachmentError(
      "Attachment not found",
      404,
      "NOT_FOUND",
    );
  }
  const target = path.join(attachmentRoot(), attachment.storageKey);
  const storedBody = await readFile(target);
  const context = `community-attachment:${attachment.id}`;
  const body = revealPrivateBytes(storedBody, context);
  const checksum = createHash("sha256").update(body).digest("hex");
  if (checksum !== attachment.checksumSha256) {
    throw new CommunityAttachmentError(
      "Attachment integrity verification failed",
      500,
      "ATTACHMENT_INTEGRITY_FAILED",
    );
  }

  let rewrapped = false;
  if (privateContentNeedsRewrap(storedBody)) {
    const temporary = `${target}.rewrap-${randomUUID()}`;
    try {
      await writeFile(temporary, rewrapPrivateBytes(storedBody, context), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, target);
      rewrapped = true;
    } catch {
      await unlink(temporary).catch(() => undefined);
    }
  }
  await recordSecurityEvent("private_attachment_downloaded", auth.userId, {
    attachmentId,
    channelId,
  });
  if (rewrapped) {
    await recordSecurityEvent("private_content_rewrapped", auth.userId, {
      resourceType: "community_attachment",
      resourceId: attachmentId,
    });
  }
  return { attachment: publicAttachment(attachment), body };
}

export async function deleteCommunityAttachment(
  auth: AuthenticatedUser,
  channelId: string,
  attachmentId: string,
): Promise<void> {
  const membership = await requireManagedCommunityAccess(auth, channelId);
  const attachment = await db
    .selectFrom("communityAttachments")
    .selectAll()
    .where("id", "=", attachmentId)
    .where("channelId", "=", channelId)
    .executeTakeFirst();
  if (!attachment) {
    throw new CommunityAttachmentError(
      "Attachment not found",
      404,
      "NOT_FOUND",
    );
  }
  if (
    attachment.uploadedByUserId !== auth.userId &&
    membership.role !== "owner"
  ) {
    throw new CommunityAttachmentError(
      "Attachment deletion is not allowed",
      403,
      "FORBIDDEN",
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
      .deleteFrom("communityAttachments")
      .where("id", "=", attachment.id)
      .execute();
  } catch (error) {
    await rename(tombstone, target).catch(() => undefined);
    throw error;
  }
  await unlink(tombstone).catch(() => undefined);
  await recordSecurityEvent("private_attachment_deleted", auth.userId, {
    attachmentId,
    channelId,
  });
}
