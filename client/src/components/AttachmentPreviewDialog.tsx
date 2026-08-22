import { useEffect, useMemo, useState } from "react";
import { Download, FileWarning, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import {
  previewableAttachmentImageTypes,
  type AttachmentPreviewSource,
} from "../lib/attachment-preview";

export function AttachmentPreviewDialog({
  source,
  onClose,
}: {
  source: AttachmentPreviewSource | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [objectUrl, setObjectUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!source) return;
    let active = true;
    let generatedUrl = "";
    setFailed(false);
    setLoading(true);
    const load = async () => {
      try {
        const body = source.file
          ? source.file
          : await fetch(source.url!, { credentials: "include" }).then(
              (response) => {
                if (!response.ok) throw new Error("Attachment unavailable");
                return response.blob();
              },
            );
        if (!active) return;
        generatedUrl = URL.createObjectURL(body);
        setObjectUrl(generatedUrl);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
      setObjectUrl("");
    };
  }, [source]);

  const previewKind = useMemo(
    () =>
      source?.mimeType === "application/pdf"
        ? "pdf"
        : source && previewableAttachmentImageTypes.has(source.mimeType)
          ? "image"
          : "unsupported",
    [source],
  );

  if (!source) return null;
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attachment-preview-title"
    >
      <section className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="attachment-preview-title" className="truncate font-bold">
              {source.fileName}
            </h2>
            <p className="text-xs text-slate-500">
              {t("attachmentPreview.protectedNotice")}
            </p>
          </div>
          <a
            href={source.file ? objectUrl : source.url}
            download={source.fileName}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100"
          >
            <Download size={16} /> {t("attachmentPreview.download")}
          </a>
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </Button>
        </header>
        <div className="grid min-h-[28rem] flex-1 place-items-center overflow-auto bg-slate-100 p-4">
          {loading && (
            <p className="text-sm text-slate-500">{t("common.loading")}</p>
          )}
          {!loading && (failed || previewKind === "unsupported") && (
            <div className="max-w-md text-center text-slate-600">
              <FileWarning className="mx-auto" size={34} />
              <p className="mt-3 font-semibold">
                {t("attachmentPreview.unavailable")}
              </p>
              <p className="mt-1 text-sm">
                {t("attachmentPreview.unavailableHint")}
              </p>
            </div>
          )}
          {!loading && !failed && objectUrl && previewKind === "image" && (
            <img
              src={objectUrl}
              alt={source.fileName}
              className="max-h-[72vh] max-w-full object-contain"
              onError={() => setFailed(true)}
            />
          )}
          {!loading && !failed && objectUrl && previewKind === "pdf" && (
            <iframe
              src={objectUrl}
              title={source.fileName}
              sandbox=""
              className="h-[72vh] w-full rounded-lg border border-slate-300 bg-white"
            />
          )}
        </div>
      </section>
    </div>
  );
}
