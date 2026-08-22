import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/client.js";
import type { AuthenticatedUser } from "../middleware/authorization.js";
import {
  privateContentNeedsRewrap,
  protectPrivateBytes,
  rewrapPrivateBytes,
  revealPrivateBytes,
} from "../lib/private-content-crypto.js";
import { stageStoredFilesForRemoval } from "../lib/staged-file-removal.js";
import { resolveSupportAttachmentMimeType } from "../lib/support-attachment-policy.js";

const MAX_ATTACHMENTS_PER_DRAFT = 5;
const DEFAULT_ATTACHMENT_LIMIT = 5 * 1024 * 1024;
const DEFAULT_TOTAL_LIMIT = 10 * 1024 * 1024;

class UmfSupportMailAttachmentAccessError extends Error {
  readonly statusCode = 403;
}

class UmfSupportMailAttachmentNotFoundError extends Error {
  readonly statusCode = 404;
}

class UmfSupportMailAttachmentValidationError extends Error {
  readonly statusCode = 400;
}

class UmfSupportMailAttachmentIntegrityError extends Error {
  readonly statusCode = 500;
}

function attachmentRoot(): string {
  return path.resolve(
    process.env.UMF_SUPPORT_MAIL_ATTACHMENT_DIRECTORY ??
      path.join(
        process.env.DATA_DIRECTORY ?? path.join(process.cwd(), "data"),
        "umf-support-mail-attachments",
      ),
  );
}

function configuredLimit(name: string, fallback: number, maximum: number) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isInteger(value)
    ? Math.min(Math.max(value, 1024), maximum)
    : fallback;
}

export function umfSupportMailAttachmentLimitBytes(): number {
  return configuredLimit(
    "UMF_SUPPORT_MAIL_ATTACHMENT_MAX_BYTES",
    DEFAULT_ATTACHMENT_LIMIT,
    10 * 1024 * 1024,
  );
}

function totalAttachmentLimitBytes(): number {
  return configuredLimit(
    "UMF_SUPPORT_MAIL_ATTACHMENT_TOTAL_MAX_BYTES",
    DEFAULT_TOTAL_LIMIT,
    20 * 1024 * 1024,
  );
}

async function requireCorporateStaff(auth: AuthenticatedUser): Promise<void> {
  if (auth.identityRealm !== "corporate_support") {
    throw new UmfSupportMailAttachmentAccessError(
      "UMF Support access is required",
    );
  }
  const staff = await db
    .selectFrom("umfSupportStaff")
    .select("userId")
    .where("userId", "=", auth.userId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!staff) {
    throw new UmfSupportMailAttachmentAccessError(
      "UMF Support access is required",
    );
  }
}

function safeFileName(value: string): string {
  const normalized = Array.from(value.trim())
    .map((character) => {
      const code = character.charCodeAt(0);
      return character === "\\" ||
        character === "/" ||
        code < 32 ||
        code === 127
        ? "_"
        : character;
    })
    .join("");
  if (!normalized || normalized.length > 180) {
    throw new UmfSupportMailAttachmentValidationError(
      "Attachment file name is invalid",
    );
  }
  return normalized;
}

function publicAttachment<T extends { storageKey: string }>(attachment: T) {
  const { storageKey: _storageKey, ...result } = attachment;
  return result;
}

async function readStoredAttachment(attachment: {
  id: string;
  storageKey: string;
  checksumSha256: string;
}) {
  const filePath = path.join(attachmentRoot(), attachment.storageKey);
  const protectedBody = await readFile(filePath);
  const body = revealPrivateBytes(
    protectedBody,
    `umf-support-mail-attachment:${attachment.id}`,
  );
  if (
    createHash("sha256").update(body).digest("hex") !==
    attachment.checksumSha256
  ) {
    throw new UmfSupportMailAttachmentIntegrityError(
      "UMF Support mail attachment integrity verification failed",
    );
  }
  if (privateContentNeedsRewrap(protectedBody)) {
    const temporary = `${filePath}.rewrap-${randomUUID()}`;
    await writeFile(
      temporary,
      rewrapPrivateBytes(
        protectedBody,
        `umf-support-mail-attachment:${attachment.id}`,
      ),
      { flag: "wx", mode: 0o600 },
    );
    try {
      await rename(temporary, filePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  return body;
}

export async function listUmfSupportMailAttachments(
  auth: AuthenticatedUser,
  draftId: string,
) {
  await requireCorporateStaff(auth);
  const draft = await db
    .selectFrom("umfSupportMailDrafts")
    .select("id")
    .where("id", "=", draftId)
    .executeTakeFirst();
  if (!draft) {
    throw new UmfSupportMailAttachmentNotFoundError("Mail draft not found");
  }
  const attachments = await db
    .selectFrom("umfSupportMailAttachments")
    .selectAll()
    .where("draftId", "=", draftId)
    .orderBy("createdAt", "asc")
    .execute();
  return attachments.map(publicAttachment);
}

export async function storeUmfSupportMailAttachment(
  auth: AuthenticatedUser,
  draftId: string,
  input: { body: Buffer; fileName: string; mimeType: string },
) {
  await requireCorporateStaff(auth);
  if (
    !Buffer.isBuffer(input.body) ||
    input.body.length === 0 ||
    input.body.length > umfSupportMailAttachmentLimitBytes()
  ) {
    throw new UmfSupportMailAttachmentValidationError(
      "Attachment size is invalid",
    );
  }
  const mimeType = resolveSupportAttachmentMimeType(
    input.fileName,
    input.mimeType,
  );
  if (!mimeType) {
    throw new UmfSupportMailAttachmentValidationError(
      "Attachment type is not allowed",
    );
  }
  const draft = await db
    .selectFrom("umfSupportMailDrafts")
    .select("status")
    .where("id", "=", draftId)
    .executeTakeFirst();
  if (!draft) {
    throw new UmfSupportMailAttachmentNotFoundError("Mail draft not found");
  }
  if (draft.status !== "draft") {
    throw new UmfSupportMailAttachmentValidationError(
      "Only unsent drafts accept attachments",
    );
  }
  const existing = await db
    .selectFrom("umfSupportMailAttachments")
    .select(({ fn }) => [
      fn.countAll<number>().as("count"),
      fn.sum<number>("sizeBytes").as("totalBytes"),
    ])
    .where("draftId", "=", draftId)
    .executeTakeFirstOrThrow();
  if (
    Number(existing.count) >= MAX_ATTACHMENTS_PER_DRAFT ||
    Number(existing.totalBytes ?? 0) + input.body.length >
      totalAttachmentLimitBytes()
  ) {
    throw new UmfSupportMailAttachmentValidationError(
      "Mail draft attachment limit exceeded",
    );
  }

  const id = `umf-support-mail-attachment-${randomUUID()}`;
  const storageKey = `${randomUUID()}.bin`;
  const root = attachmentRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, storageKey);
  await writeFile(
    target,
    protectPrivateBytes(input.body, `umf-support-mail-attachment:${id}`),
    { flag: "wx", mode: 0o600 },
  );
  try {
    const attachment = {
      id,
      draftId,
      uploadedByUserId: auth.userId,
      fileName: safeFileName(input.fileName),
      mimeType,
      sizeBytes: input.body.length,
      storageKey,
      checksumSha256: createHash("sha256").update(input.body).digest("hex"),
      createdAt: Date.now(),
    };
    await db
      .insertInto("umfSupportMailAttachments")
      .values(attachment)
      .execute();
    return publicAttachment(attachment);
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function readUmfSupportMailAttachment(
  auth: AuthenticatedUser,
  draftId: string,
  attachmentId: string,
) {
  await requireCorporateStaff(auth);
  const attachment = await db
    .selectFrom("umfSupportMailAttachments")
    .selectAll()
    .where("id", "=", attachmentId)
    .where("draftId", "=", draftId)
    .executeTakeFirst();
  if (!attachment) {
    throw new UmfSupportMailAttachmentNotFoundError(
      "Mail attachment not found",
    );
  }
  return { attachment, body: await readStoredAttachment(attachment) };
}

export async function deleteUmfSupportMailAttachment(
  auth: AuthenticatedUser,
  draftId: string,
  attachmentId: string,
): Promise<void> {
  await requireCorporateStaff(auth);
  const attachment = await db
    .selectFrom("umfSupportMailAttachments")
    .innerJoin(
      "umfSupportMailDrafts",
      "umfSupportMailDrafts.id",
      "umfSupportMailAttachments.draftId",
    )
    .select([
      "umfSupportMailAttachments.id",
      "umfSupportMailAttachments.storageKey",
      "umfSupportMailDrafts.status as draftStatus",
    ])
    .where("umfSupportMailAttachments.id", "=", attachmentId)
    .where("umfSupportMailAttachments.draftId", "=", draftId)
    .executeTakeFirst();
  if (!attachment) {
    throw new UmfSupportMailAttachmentNotFoundError(
      "Mail attachment not found",
    );
  }
  if (attachment.draftStatus !== "draft") {
    throw new UmfSupportMailAttachmentValidationError(
      "Submitted mail attachments cannot be removed",
    );
  }
  const staged = await stageStoredFilesForRemoval(attachmentRoot(), [
    attachment.storageKey,
  ]);
  try {
    await db
      .deleteFrom("umfSupportMailAttachments")
      .where("id", "=", attachment.id)
      .execute();
    await staged.commit();
  } catch (error) {
    await staged.rollback();
    throw error;
  }
}

export async function readUmfSupportMailDeliveryAttachments(
  attachmentIds: string[],
) {
  if (attachmentIds.length === 0) return [];
  const attachments = await db
    .selectFrom("umfSupportMailAttachments")
    .selectAll()
    .where("id", "in", attachmentIds)
    .execute();
  const byId = new Map(
    attachments.map((attachment) => [attachment.id, attachment]),
  );
  if (byId.size !== new Set(attachmentIds).size) {
    throw new UmfSupportMailAttachmentNotFoundError(
      "Mail delivery attachment is unavailable",
    );
  }
  return Promise.all(
    attachmentIds.map(async (attachmentId) => {
      const attachment = byId.get(attachmentId)!;
      return {
        filename: attachment.fileName,
        content: await readStoredAttachment(attachment),
        contentType: attachment.mimeType,
        contentDisposition: "attachment" as const,
      };
    }),
  );
}
