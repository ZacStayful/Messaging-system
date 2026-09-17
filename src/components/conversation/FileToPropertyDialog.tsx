"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/components/shell/store";

const primary = "h-10 rounded-lg bg-brand px-3.5 text-[15px] font-semibold text-white disabled:opacity-50";
const secondary = "h-10 rounded-lg border border-input-border px-3.5 text-[15px] font-semibold text-ink hover:bg-hover";

interface PropertyOption {
  conversationId: string;
  name: string;
  kinds: string[];
}

/**
 * Filing a message into a property's Cleaning or Maintenance thread.
 *
 * Two different operations behind one question, which is why the RPC decides rather than this
 * dialog: within the same conversation it is a move (`move_message`), and across conversations —
 * the central Maintenance inbox into a property — it has to be a copy, because `parent_id` means
 * "a reply to" and a thread cannot span two groups. `file_message_to_property` (0027) does the
 * right one and keeps both ends pointing at each other.
 */
export function FileToPropertyDialog({
  messageId,
  conversationId,
  onClose,
}: {
  messageId: string;
  conversationId: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { refresh } = useStore();
  const [options, setOptions] = useState<PropertyOption[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Only groups this person is already in come back — property_threads mirrors the
      // conversation's own membership rule, so there is no separate access decision here.
      const { data } = await supabase
        .from("property_threads")
        .select("conversation_id, kind, conversations!inner(name, archived_at)");
      if (cancelled) return;
      const byConversation = new Map<string, PropertyOption>();
      for (const row of data ?? []) {
        const conversation = row.conversations as unknown as { name: string | null; archived_at: string | null };
        if (conversation?.archived_at) continue;
        const existing = byConversation.get(row.conversation_id);
        if (existing) existing.kinds.push(row.kind);
        else
          byConversation.set(row.conversation_id, {
            conversationId: row.conversation_id,
            name: conversation?.name ?? "a property",
            kinds: [row.kind],
          });
      }
      setOptions([...byConversation.values()].sort((a, b) => a.name.localeCompare(b.name)));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const file = async (target: string, kind: string) => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("file_message_to_property", {
      p_message_id: messageId,
      p_conversation_id: target,
      p_kind: kind,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    refresh();
    onClose();
  };

  const shown = (options ?? []).filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-overlay p-3 md:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="File this message"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-line bg-card"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-bold text-ink">File this message</h2>
          <p className="mt-1 text-[14px] text-muted">
            Choose the property and the thread it belongs in. Filing from somewhere else leaves the original where it is
            and posts a copy, still credited to whoever sent it.
          </p>
        </div>
        <div className="px-5 py-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a property"
            aria-label="Find a property"
            className="w-full rounded-lg border border-input-border bg-input px-3 py-2 text-[16px] text-ink outline-none focus:border-brand"
          />
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-3">
          {options === null && <p className="py-2 text-[14px] text-muted">Loading…</p>}
          {options !== null && shown.length === 0 && (
            <p className="py-2 text-[14px] text-muted">
              No property groups {q ? "match that" : "yet"}. They are created from Monday, or by hand from the new
              message menu.
            </p>
          )}
          {shown.map((o) => (
            <div key={o.conversationId} className="border-b border-line py-2.5 last:border-0">
              <p className="mb-1.5 truncate text-[15px] text-ink">#{o.name}</p>
              <div className="flex gap-2">
                {["cleaning", "maintenance"]
                  .filter((k) => o.kinds.includes(k))
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={busy}
                      onClick={() => void file(o.conversationId, k)}
                      className="h-8 rounded-lg border border-input-border px-3 text-[14px] text-ink capitalize hover:bg-hover disabled:opacity-50"
                    >
                      {o.conversationId === conversationId ? "Move to" : "File in"} {k}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
        {error && <p className="px-5 pb-2 text-[14px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className={secondary}>
            Cancel
          </button>
          <button type="button" onClick={onClose} className={primary} hidden>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
