import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Loader,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import {
  createSessionBlock,
  splitLines,
  type SessionContent,
  type SessionContentBlock,
  type SessionProgress,
} from "../lib/session-content";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { getAccessRole } from "../context/auth-context";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function SessionContentPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [content, setContent] = useState<SessionContent | null>(null);
  const [progress, setProgress] = useState<SessionProgress | null>(null);
  const [persistedProgress, setPersistedProgress] =
    useState<SessionProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progressSaving, setProgressSaving] = useState(false);
  const [error, setError] = useState("");
  const accessRole = getAccessRole(user);

  const canEdit =
    accessRole === "admin" ||
    (accessRole === "trainer" && content?.trainerId === user?.id);

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await authFetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error ?? t("sessionContent.requestFailed"));
    return body as T;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextContent, nextProgress] = await Promise.all([
        request<SessionContent>(`/api/classes/${id}/session-content`),
        request<SessionProgress>(`/api/classes/${id}/session-progress`),
      ]);
      setContent(nextContent);
      setProgress(nextProgress);
      setPersistedProgress(nextProgress);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
    // Translation errors change with the selected locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateBlock = (index: number, patch: Partial<SessionContentBlock>) => {
    setContent((current) =>
      current
        ? {
            ...current,
            blocks: current.blocks.map((block, blockIndex) =>
              blockIndex === index ? { ...block, ...patch } : block,
            ),
          }
        : current,
    );
  };

  const saveContent = async () => {
    if (!content) return;
    setSaving(true);
    try {
      setContent(
        await request<SessionContent>(`/api/classes/${id}/session-content`, {
          method: "PUT",
          body: JSON.stringify({
            terminology: content.terminology,
            blocks: content.blocks,
            commentsEnabled: content.commentsEnabled,
          }),
        }),
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveProgress = async (patch?: Partial<SessionProgress>) => {
    if (!progress || progressSaving) return;
    const previous = persistedProgress ?? progress;
    const next = { ...progress, ...patch };
    setProgress(next);
    setProgressSaving(true);
    try {
      const saved = await request<SessionProgress>(
        `/api/classes/${id}/session-progress`,
        {
          method: "PUT",
          body: JSON.stringify({
            completedBlockIds: next.completedBlockIds,
            notes: next.notes,
          }),
        },
      );
      setProgress(saved);
      setPersistedProgress(saved);
      setError("");
    } catch (cause) {
      setProgress(previous);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProgressSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-slate-600">
        <Loader className="animate-spin" /> {t("common.loading")}
      </div>
    );
  }

  if (!content || !progress) {
    return <div className="mx-auto max-w-4xl p-6 text-red-700">{error}</div>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link
          to="/classes"
          className="inline-flex items-center gap-2 text-sm text-blue-700"
        >
          <ArrowLeft size={16} /> {t("sessionContent.back")}
        </Link>
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-700">
            {content.terminology}
          </p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">
            {content.className}
          </h1>
          <p className="mt-2 text-slate-600">
            {t("sessionContent.description")}
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            {error}
          </div>
        )}

        {canEdit && (
          <Card className="space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <Label htmlFor="terminology">
                  {t("sessionContent.terminology")}
                </Label>
                <Input
                  id="terminology"
                  className="mt-2"
                  value={content.terminology}
                  maxLength={80}
                  onChange={(event) =>
                    setContent({ ...content, terminology: event.target.value })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={content.commentsEnabled}
                  onChange={(event) =>
                    setContent({
                      ...content,
                      commentsEnabled: event.target.checked,
                    })
                  }
                />
                {t("sessionContent.commentsEnabled")}
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setContent({
                    ...content,
                    blocks: [...content.blocks, createSessionBlock()],
                  })
                }
              >
                <Plus /> {t("sessionContent.addBlock")}
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void saveContent()}
              >
                {saving ? <Loader className="animate-spin" /> : <Save />}
                {t("common.save")}
              </Button>
            </div>
          </Card>
        )}

        {content.blocks.length === 0 ? (
          <Card className="p-8 text-center text-slate-600">
            {t("sessionContent.empty")}
          </Card>
        ) : (
          <div className="space-y-4">
            {content.blocks.map((block, index) => {
              const completed = progress.completedBlockIds.includes(block.id);
              return (
                <Card key={block.id} className="space-y-4 p-5">
                  {canEdit ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
                        <select
                          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                          value={block.type}
                          onChange={(event) =>
                            updateBlock(index, {
                              type: event.target
                                .value as SessionContentBlock["type"],
                            })
                          }
                        >
                          {[
                            "warmup",
                            "mobility",
                            "strength",
                            "technique",
                            "conditioning",
                            "main",
                            "cooldown",
                            "custom",
                          ].map((type) => (
                            <option key={type} value={type}>
                              {t(`sessionContent.types.${type}`)}
                            </option>
                          ))}
                        </select>
                        <Input
                          value={block.title}
                          maxLength={120}
                          placeholder={t("sessionContent.blockTitle")}
                          onChange={(event) =>
                            updateBlock(index, { title: event.target.value })
                          }
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t("common.delete")}
                          onClick={() =>
                            setContent({
                              ...content,
                              blocks: content.blocks.filter(
                                (_, blockIndex) => blockIndex !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <textarea
                        className="min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm"
                        value={block.instructions}
                        maxLength={3000}
                        placeholder={t("sessionContent.instructions")}
                        onChange={(event) =>
                          updateBlock(index, {
                            instructions: event.target.value,
                          })
                        }
                      />
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {(
                          [
                            "sets",
                            "repetitions",
                            "duration",
                            "rest",
                            "percentage",
                            "load",
                          ] as const
                        ).map((field) => (
                          <Input
                            key={field}
                            value={block[field]}
                            maxLength={80}
                            placeholder={t(`sessionContent.${field}`)}
                            onChange={(event) =>
                              updateBlock(index, {
                                [field]: event.target.value,
                              })
                            }
                          />
                        ))}
                      </div>
                      {(["exercises", "material", "mediaUrls"] as const).map(
                        (field) => (
                          <textarea
                            key={field}
                            className="min-h-20 w-full rounded-md border border-slate-200 p-3 text-sm"
                            value={block[field].join("\n")}
                            placeholder={t(`sessionContent.${field}`)}
                            onChange={(event) =>
                              updateBlock(index, {
                                [field]: splitLines(event.target.value),
                              })
                            }
                          />
                        ),
                      )}
                      {(["adaptations", "notes"] as const).map((field) => (
                        <textarea
                          key={field}
                          className="min-h-20 w-full rounded-md border border-slate-200 p-3 text-sm"
                          value={block[field]}
                          placeholder={t(`sessionContent.${field}`)}
                          onChange={(event) =>
                            updateBlock(index, { [field]: event.target.value })
                          }
                        />
                      ))}
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          disabled={progressSaving}
                          className={`mt-0.5 rounded-full ${completed ? "text-emerald-600" : "text-slate-300"}`}
                          aria-label={t("sessionContent.toggleComplete")}
                          onClick={() =>
                            void saveProgress({
                              completedBlockIds: completed
                                ? progress.completedBlockIds.filter(
                                    (blockId) => blockId !== block.id,
                                  )
                                : [...progress.completedBlockIds, block.id],
                            })
                          }
                        >
                          <CheckCircle2 size={24} />
                        </button>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                            {t(`sessionContent.types.${block.type}`)}
                          </p>
                          <h2 className="text-xl font-bold text-slate-950">
                            {block.title}
                          </h2>
                        </div>
                      </div>
                      {block.instructions && (
                        <p className="whitespace-pre-wrap text-slate-700">
                          {block.instructions}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 text-sm text-slate-700">
                        {(
                          [
                            "sets",
                            "repetitions",
                            "duration",
                            "rest",
                            "percentage",
                            "load",
                          ] as const
                        ).map(
                          (field) =>
                            block[field] && (
                              <span
                                key={field}
                                className="rounded-full bg-slate-100 px-3 py-1"
                              >
                                {t(`sessionContent.${field}`)}: {block[field]}
                              </span>
                            ),
                        )}
                      </div>
                      {block.exercises.length > 0 && (
                        <ul className="list-inside list-disc text-slate-700">
                          {block.exercises.map((exercise) => (
                            <li key={exercise}>{exercise}</li>
                          ))}
                        </ul>
                      )}
                      {block.material.length > 0 && (
                        <div className="text-sm text-slate-700">
                          <p className="font-semibold">
                            {t("sessionContent.material")}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {block.material.map((item) => (
                              <span
                                key={item}
                                className="rounded-full bg-blue-50 px-3 py-1 text-blue-800"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {block.adaptations && (
                        <p className="text-sm text-slate-600">
                          {block.adaptations}
                        </p>
                      )}
                      {block.notes && (
                        <p className="whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                          <span className="font-semibold">
                            {t("sessionContent.notes")}:
                          </span>{" "}
                          {block.notes}
                        </p>
                      )}
                      {block.mediaUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="mr-3 text-sm text-blue-700 underline"
                        >
                          {t("sessionContent.openResource")}
                        </a>
                      ))}
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {!canEdit && (
          <Card className="space-y-3 p-5">
            <Label htmlFor="session-notes">
              {t("sessionContent.personalNotes")}
            </Label>
            <textarea
              id="session-notes"
              className="min-h-28 w-full rounded-md border border-slate-200 p-3 text-sm"
              maxLength={4000}
              value={progress.notes}
              onChange={(event) =>
                setProgress({ ...progress, notes: event.target.value })
              }
            />
            <Button
              type="button"
              disabled={progressSaving}
              onClick={() => void saveProgress()}
            >
              {progressSaving ? <Loader className="animate-spin" /> : <Save />}
              {t("common.save")}
            </Button>
          </Card>
        )}
      </div>
    </main>
  );
}
