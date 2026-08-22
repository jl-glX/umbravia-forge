export type AttachmentPreviewSource = {
  fileName: string;
  mimeType: string;
  url?: string;
  file?: File;
};

export const previewableAttachmentImageTypes = new Set([
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function attachmentCanBePreviewed(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    previewableAttachmentImageTypes.has(mimeType)
  );
}
