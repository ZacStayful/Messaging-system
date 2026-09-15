"use client";

import { useSyncExternalStore } from "react";
import { THEME_COOKIE, THEME_EVENT, type Theme } from "./theme";

/** Persist the theme for a year and apply it to the document immediately. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/** Current theme as applied on <html>, plus a toggle. */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    () => "light" as Theme,
  );
  const toggle = () => applyTheme(theme === "dark" ? "light" : "dark");
  return [theme, toggle];
}
