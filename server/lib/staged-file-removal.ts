import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

export interface StagedFileRemoval {
  staged: number;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function stageStoredFilesForRemoval(
  rootInput: string,
  storageKeys: string[],
): Promise<StagedFileRemoval> {
  const root = path.resolve(rootInput);
  const staged: Array<{ target: string; tombstone: string }> = [];
  try {
    for (const storageKey of new Set(storageKeys)) {
      if (!storageKey || path.basename(storageKey) !== storageKey) {
        throw new Error("Stored file cleanup key is outside the managed root");
      }
      const target = path.resolve(root, storageKey);
      const tombstone = path.resolve(root, `.cleanup-${randomUUID()}`);
      if (path.dirname(target) !== root || path.dirname(tombstone) !== root) {
        throw new Error("Stored file cleanup path escapes the managed root");
      }
      try {
        await rename(target, tombstone);
        staged.push({ target, tombstone });
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
  } catch (error) {
    for (const item of staged.reverse()) {
      await rename(item.tombstone, item.target).catch(() => undefined);
    }
    throw error;
  }

  return {
    staged: staged.length,
    commit: async () => {
      for (const item of staged) {
        await rm(item.tombstone, { force: true });
      }
    },
    rollback: async () => {
      for (const item of [...staged].reverse()) {
        await rename(item.tombstone, item.target).catch((error: unknown) => {
          if (!isMissingFile(error)) throw error;
        });
      }
    },
  };
}
