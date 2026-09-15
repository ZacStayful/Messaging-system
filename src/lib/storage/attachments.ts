import type { Attachment, Json } from "@/lib/database.types";

export const BUCKET = "attachments";
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // matches the bucket limit (spec 3.2)

/** MIME types the bucket accepts (kept in step with supabase/migrations/0004_storage.sql). */
export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "video/mp4",
  "video/quicktime",
]);

export const ACCEPT_ATTR = Array.from(ALLOWED_MIME).join(",");

export interface AttachmentMeta {
  width?: number;
  height?: number;
  duration_ms?: number;
  voice?: boolean;
}

export function attachmentMeta(a: Pick<Attachment, "meta">): AttachmentMeta {
  return (a.meta ?? {}) as AttachmentMeta;
}

export function isVoiceNote(a: Pick<Attachment, "meta" | "mime" | "category">): boolean {
  return a.category === "voice" || attachmentMeta(a).voice === true;
}

export function isImage(a: Pick<Attachment, "mime">): boolean {
  return a.mime.startsWith("image/");
}

export function isVideo(a: Pick<Attachment, "mime">): boolean {
  return a.mime.startsWith("video/");
}

export function isAudio(a: Pick<Attachment, "mime">): boolean {
  return a.mime.startsWith("audio/");
}

/** A plain MIME type without codec parameters ("audio/webm;codecs=opus" -> "audio/webm"). */
export function baseMime(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

/** Category stored on the row; the Files tab groups by it. */
export function categoryFor(mime: string, voice = false): string {
  if (voice) return "voice";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

/** Rejects files the bucket would refuse, with a human message. */
export function validateFile(file: File): string | null {
  const mime = baseMime(file.type || "application/octet-stream");
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 50 MB.`;
  if (!ALLOWED_MIME.has(mime))
    return `${file.name}: this type of file isn't supported. Photos, PDFs, Office documents, audio and video are.`;
  return null;
}

/** Object key: <org_id>/<conversation_id>/<message_id>/<random>-<safe file name>. */
export function storagePath(orgId: string, conversationId: string, messageId: string, fileName: string): string {
  const safe = fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-120);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${orgId}/${conversationId}/${messageId}/${rand}-${safe || "file"}`;
}

/** Reads image dimensions in the browser so the message can reserve the right space. */
export function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/") || typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function toJson(meta: AttachmentMeta): Json {
  return JSON.parse(JSON.stringify(meta)) as Json;
}
