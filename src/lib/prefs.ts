"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Small per-browser UI preferences (collapsed sections, sort orders) kept in localStorage. */
const PREFIX = "stayful-pref:";
const EVENT = "stayful-pref";

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // storage unavailable; preferences are a convenience only
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** A string preference with a default; server render uses the default. */
export function usePref(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key) ?? fallback,
    () => fallback,
  );
  const set = useCallback((v: string) => write(key, v), [key]);
  return [value, set];
}

/** A boolean preference. */
export function useBoolPref(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [raw, setRaw] = usePref(key, fallback ? "1" : "0");
  const set = useCallback((v: boolean) => setRaw(v ? "1" : "0"), [setRaw]);
  return [raw === "1", set];
}
