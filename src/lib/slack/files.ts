/**
 * The file queue: what a Slack message carried, copied into the attachments bucket.
 *
 * Idempotent on slack_files (message_id, slack_file_id) and, as a backstop, on
 * attachments_slack_file_idx. A file the bucket would refuse — over 50 MB, or a type outside its
 * allow-list — is not silently absent: a line naming it is appended to the message, and the
 * queue row says why.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ingestAttachment } from "@/lib/storage/ingest";
import { ALLOWED_MIME, MAX_FILE_BYTES, baseMime } from "@/lib/storage/attachments";
import { downloadFile, SlackApiError, type SlackFile } from "./client";
import { fileNotImportedLine } from "./normalise";
import type { Budget } from "./lease";

type Admin = SupabaseClient<Database>;

export const FILE_MAX_ATTEMPTS = 5;
const FILES_PER_SLICE = 15;
const BYTES_PER_SLICE = 40 * 1024 * 1024;

/** Queues a message's files. Existing rows are left alone. */
export async function queueFiles(
  admin: Admin,
  orgId: string,
  conversationId: string,
  channelId: string,
  messageId: string,
  files: SlackFile[],
): Promise<void> {
  if (files.length === 0) return;
  const rows = files.map((f) => ({
    org_id: orgId,
    slack_file_id: f.id,
    message_id: messageId,
    conversation_id: conversationId,
    channel_id: channelId,
    name: f.name ?? f.title ?? null,
    mimetype: f.mimetype ?? null,
    size: f.size ?? null,
    url_private: f.url_private_download ?? f.url_private ?? null,
    mode: f.mode ?? null,
  }));
  await admin.from("slack_files").upsert(rows, { onConflict: "message_id,slack_file_id", ignoreDuplicates: true });
}

/** Adds the "not imported" line without leaving an "(edited)" marker behind. */
async function noteSkipped(admin: Admin, messageId: string, name: string | null, reason: string): Promise<void> {
  const { data: m } = await admin.from("messages").select("body, edited_at").eq("id", messageId).maybeSingle();
  if (!m) return;
  const line = fileNotImportedLine(name ?? undefined, reason);
  if (m.body.includes(line)) return;
  const body = m.body ? `${m.body}\n${line}` : line;
  await admin.from("messages").update({ body }).eq("id", messageId);
  // messages_before_update stamped edited_at; the service role may put it back (0030).
  await admin.from("messages").update({ edited_at: m.edited_at }).eq("id", messageId);
}

export interface FilesReport {
  done: number;
  skipped: number;
  failed: number;
  remaining: boolean;
}

/**
 * Downloads and files as many pending rows as the slice allows. `conversationId` narrows the
 * pass to one channel (the backfill's files phase); without it the daily catch-up sweeps all.
 */
export async function processFiles(admin: Admin, budget: Budget, conversationId?: string): Promise<FilesReport> {
  const report: FilesReport = { done: 0, skipped: 0, failed: 0, remaining: false };
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  let query = admin
    .from("slack_files")
    .select("*")
    .eq("status", "pending")
    .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
    .order("created_at")
    .limit(FILES_PER_SLICE + 1);
  if (conversationId) query = query.eq("conversation_id", conversationId);
  const { data: rows } = await query;
  if (!rows?.length) return report;
  report.remaining = rows.length > FILES_PER_SLICE;
  let bytes = 0;

  for (const row of rows.slice(0, FILES_PER_SLICE)) {
    if (!budget.has(12_000) || bytes > BYTES_PER_SLICE) {
      report.remaining = true;
      break;
    }
    const key = { message_id: row.message_id, slack_file_id: row.slack_file_id };
    const { data: claimed } = await admin
      .from("slack_files")
      .update({ claimed_at: new Date().toISOString() })
      .match(key)
      .eq("status", "pending")
      .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
      .select("slack_file_id");
    if (!claimed?.length) continue;

    const finish = async (patch: Record<string, unknown>) =>
      admin.from("slack_files").update({ ...patch, claimed_at: null }).match(key);

    const mime = baseMime(row.mimetype || "application/octet-stream");
    if (row.mode && ["tombstone", "hidden_by_limit", "external"].includes(row.mode)) {
      await noteSkipped(admin, row.message_id, row.name, row.mode === "external" ? "external file" : "no longer available");
      await finish({ status: "skipped_mode" });
      report.skipped += 1;
      continue;
    }
    if ((row.size ?? 0) > MAX_FILE_BYTES) {
      await noteSkipped(admin, row.message_id, row.name, "larger than 50 MB");
      await finish({ status: "skipped_size" });
      report.skipped += 1;
      continue;
    }
    if (!ALLOWED_MIME.has(mime)) {
      await noteSkipped(admin, row.message_id, row.name, mime);
      await finish({ status: "skipped_mime" });
      report.skipped += 1;
      continue;
    }
    if (!row.url_private) {
      await noteSkipped(admin, row.message_id, row.name, "no download link");
      await finish({ status: "skipped_mode" });
      report.skipped += 1;
      continue;
    }

    try {
      const dl = await downloadFile(row.url_private, MAX_FILE_BYTES);
      if (!dl.ok) throw new Error(dl.error);
      bytes += dl.body.byteLength;
      const result = await ingestAttachment(admin, {
        orgId: row.org_id,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        fileName: row.name || `slack-${row.slack_file_id}`,
        mime,
        body: dl.body,
        meta: { slack_file_id: row.slack_file_id },
      });
      if (!result.ok) {
        // 23505 on attachments_slack_file_idx: a previous run filed it and died before saying so.
        if (/duplicate key|23505/.test(result.error ?? "")) {
          await finish({ status: "done" });
          report.done += 1;
          continue;
        }
        throw new Error(result.error);
      }
      await finish({ status: "done" });
      report.done += 1;
    } catch (e) {
      if (e instanceof SlackApiError && e.rateLimited) {
        await finish({});
        report.remaining = true;
        break;
      }
      const attempts = row.attempts + 1;
      const message = e instanceof Error ? e.message : String(e);
      if (attempts >= FILE_MAX_ATTEMPTS) {
        await noteSkipped(admin, row.message_id, row.name, "could not be downloaded");
        await finish({ status: "dead", attempts, last_error: message });
      } else {
        await finish({ attempts, last_error: message });
      }
      report.failed += 1;
    }
  }
  return report;
}
