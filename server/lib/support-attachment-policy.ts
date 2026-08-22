import path from "node:path";

const typesByExtension = new Map<string, readonly string[]>([
  [".pdf", ["application/pdf"]],
  [".doc", ["application/msword"]],
  [
    ".docx",
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ],
  [".xls", ["application/vnd.ms-excel"]],
  [
    ".xlsx",
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ],
  [".ppt", ["application/vnd.ms-powerpoint"]],
  [
    ".pptx",
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  ],
  [".zip", ["application/zip", "application/x-zip-compressed"]],
  [".rar", ["application/vnd.rar", "application/x-rar-compressed"]],
  [".json", ["application/json", "text/json"]],
  [".gzip", ["application/gzip", "application/x-gzip"]],
  [".odt", ["application/vnd.oasis.opendocument.text"]],
  [".txt", ["text/plain"]],
  [".csv", ["text/csv", "application/csv"]],
  [".html", ["text/html"]],
  [".xml", ["application/xml", "text/xml"]],
  [".jpg", ["image/jpeg"]],
  [".jpeg", ["image/jpeg"]],
  [".png", ["image/png"]],
  [".svg", ["image/svg+xml"]],
  [".heic", ["image/heic", "image/heif"]],
  [".webp", ["image/webp"]],
  [".bmp", ["image/bmp", "image/x-ms-bmp"]],
  [".psd", ["image/vnd.adobe.photoshop", "application/x-photoshop"]],
]);

export const supportAttachmentAcceptedMimeTypes = Array.from(
  new Set([
    "application/octet-stream",
    ...Array.from(typesByExtension.values()).flat(),
  ]),
);

export const supportAttachmentAcceptAttribute = Array.from(
  typesByExtension.keys(),
).join(",");

export function resolveSupportAttachmentMimeType(
  fileName: string,
  declaredMimeType: string,
): string | null {
  const extension = path.extname(fileName.trim()).toLowerCase();
  const accepted = typesByExtension.get(extension);
  if (!accepted) return null;
  const declared = declaredMimeType.trim().toLowerCase();
  if (!declared || declared === "application/octet-stream") {
    return accepted[0] ?? null;
  }
  return accepted.includes(declared) ? declared : null;
}
