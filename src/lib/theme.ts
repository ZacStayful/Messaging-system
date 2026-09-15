export type Theme = "light" | "dark";
export const THEME_COOKIE = "stayful-theme";
export const THEME_EVENT = "stayful-theme";

export function readThemeCookie(value: string | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}
