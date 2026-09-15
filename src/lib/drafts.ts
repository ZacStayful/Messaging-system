"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Per-conversation composer drafts kept in localStorage (synced across tabs by the storage event). */
const PREFIX = "stayful-draft:";
export const DRAFT_EVENT = "stayful-draft";

export function readDraft(conversationId: string): string {
  try {
    return localStorage.getItem(PREFIX + conversationId) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(conversationId: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(PREFIX + conversationId, text);
    else localStorage.removeItem(PREFIX + conversationId);
  } catch {
    // storage unavailable (private mode); drafts are a convenience only
  }
  window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { conversationId } }));
}

export function hasDraft(conversationId: string): boolean {
  return readDraft(conversationId).trim().length > 0;
}

function subscribe(onChange: () => void) {
  window.addEventListener(DRAFT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DRAFT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The draft for one conversation, read straight from storage so it survives navigation and reloads. */
export function useDraft(conversationId: string): [string, (text: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readDraft(conversationId),
    () => "",
  );
  const set = useCallback((text: string) => writeDraft(conversationId, text), [conversationId]);
  return [value, set];
}

/** A stable, comma-joined list of conversation ids that currently have a draft. */
export function useDraftIds(conversationIds: string[]): ReadonlySet<string> {
  const key = conversationIds.join(",");
  const joined = useSyncExternalStore(
    subscribe,
    () =>
      key
        .split(",")
        .filter((id) => id && hasDraft(id))
        .join(","),
    () => "",
  );
  return new Set(joined ? joined.split(",") : []);
}
