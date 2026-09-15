/** Top-level sections of the app; the first URL segment. Safe to import from server and client code. */
export const NAVS = ["home", "dms", "activity", "files", "later", "you"] as const;
export type Nav = (typeof NAVS)[number];

export function isNav(value: string | undefined): value is Nav {
  return (NAVS as readonly string[]).includes(value ?? "");
}
