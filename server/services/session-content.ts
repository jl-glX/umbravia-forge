import { db } from "../db/client.js";
import type { SessionContentBlock } from "../db/types.js";

function parseStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseBlocks(value: string | null | undefined): SessionContentBlock[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as SessionContentBlock[]) : [];
  } catch {
    return [];
  }
}

export async function getSessionContent(activitySessionId: string) {
  const activitySession = await db
    .selectFrom("activitySessions")
    .select(["id", "name", "trainerId"])
    .where("id", "=", activitySessionId)
    .executeTakeFirst();
  if (!activitySession) throw new Error("Class not found");
  const content = await db
    .selectFrom("activitySessionContents")
    .selectAll()
    .where("activitySessionId", "=", activitySessionId)
    .executeTakeFirst();
  return {
    activitySessionId,
    className: activitySession.name,
    trainerId: activitySession.trainerId,
    terminology: content?.terminology ?? "Contenido de la sesión",
    blocks: parseBlocks(content?.blocks),
    commentsEnabled: content?.commentsEnabled === 1,
    updatedAt: content?.updatedAt ?? null,
  };
}

export async function saveSessionContent(
  activitySessionId: string,
  input: {
    terminology: string;
    blocks: SessionContentBlock[];
    commentsEnabled: boolean;
  },
) {
  const uniqueBlockIds = new Set(input.blocks.map((block) => block.id));
  if (uniqueBlockIds.size !== input.blocks.length) {
    throw new Error("Session block identifiers must be unique");
  }
  const exists = await db
    .selectFrom("activitySessions")
    .select("id")
    .where("id", "=", activitySessionId)
    .executeTakeFirst();
  if (!exists) throw new Error("Class not found");
  await db
    .insertInto("activitySessionContents")
    .values({
      activitySessionId,
      terminology: input.terminology,
      blocks: JSON.stringify(input.blocks),
      commentsEnabled: input.commentsEnabled ? 1 : 0,
      updatedAt: Date.now(),
    })
    .onConflict((conflict) =>
      conflict.column("activitySessionId").doUpdateSet({
        terminology: input.terminology,
        blocks: JSON.stringify(input.blocks),
        commentsEnabled: input.commentsEnabled ? 1 : 0,
        updatedAt: Date.now(),
      }),
    )
    .execute();
  return getSessionContent(activitySessionId);
}

export async function getSessionProgress(
  activitySessionId: string,
  userId: string,
) {
  const activitySession = await db
    .selectFrom("activitySessions")
    .select("id")
    .where("id", "=", activitySessionId)
    .executeTakeFirst();
  if (!activitySession) throw new Error("Class not found");
  const progress = await db
    .selectFrom("sessionContentProgress")
    .selectAll()
    .where("activitySessionId", "=", activitySessionId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  return {
    activitySessionId,
    userId,
    completedBlockIds: parseStringArray(progress?.completedBlockIds),
    notes: progress?.notes ?? "",
    updatedAt: progress?.updatedAt ?? null,
  };
}

export async function saveSessionProgress(
  activitySessionId: string,
  userId: string,
  input: { completedBlockIds: string[]; notes: string },
) {
  const content = await getSessionContent(activitySessionId);
  const validIds = new Set(content.blocks.map((block) => block.id));
  const completedBlockIds = [...new Set(input.completedBlockIds)].filter((id) =>
    validIds.has(id),
  );
  const updatedAt = Date.now();
  await db
    .insertInto("sessionContentProgress")
    .values({
      activitySessionId,
      userId,
      completedBlockIds: JSON.stringify(completedBlockIds),
      notes: input.notes,
      updatedAt,
    })
    .onConflict((conflict) =>
      conflict.columns(["activitySessionId", "userId"]).doUpdateSet({
        completedBlockIds: JSON.stringify(completedBlockIds),
        notes: input.notes,
        updatedAt,
      }),
    )
    .execute();
  return getSessionProgress(activitySessionId, userId);
}
