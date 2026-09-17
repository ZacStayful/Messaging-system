import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET, categoryFor, storagePath, toJson } from "@/lib/storage/attachments";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * Puts a file we fetched from somewhere else into a conversation, as an attachment.
 *
 * The first server-side write to storage in this codebase — everything else uploads from the
 * browser under the user's own session. A webhook has no session, so this runs as the service
 * role, which means the RLS that normally protects the bucket is not protecting anything here
 * and the path has to be right by construction instead.
 *
 * That is the whole reason this is a function rather than four lines inlined in a route:
 * `storagePath()` puts the org in segment 1 and the conversation in segment 2, and the storage
 * policies in 0004 read both back out of the object name to decide who may download it. Get the
 * path wrong and the upload still succeeds — the file is simply unreadable by every member of
 * the thread it was filed into, silently, with no error anywhere.
 */
export interface IngestedFile {
  orgId: string;
  conversationId: string;
  messageId: string;
  fileName: string;
  mime: string;
  body: ArrayBuffer;
  /** A voice note renders as a player rather than a file card. */
  voice?: boolean;
  durationMs?: number;
}

export async function ingestAttachment(admin: Admin, file: IngestedFile): Promise<{ ok: boolean; error?: string }> {
  const path = storagePath(file.orgId, file.conversationId, file.messageId, file.fileName);

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file.body, { contentType: file.mime, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error } = await admin.from("attachments").insert({
    org_id: file.orgId,
    conversation_id: file.conversationId,
    message_id: file.messageId,
    storage_path: path,
    file_name: file.fileName,
    mime: file.mime,
    size_bytes: file.body.byteLength,
    category: categoryFor(file.mime, file.voice),
    meta: toJson({ duration_ms: file.durationMs, voice: file.voice || undefined }),
  });
  if (error) {
    // Leaving the object behind would be an orphan nobody can reach, since every read goes
    // through the attachments row.
    await admin.storage.from(BUCKET).remove([path]);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
