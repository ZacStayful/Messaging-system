import { describe, expect, it } from "vitest";
import type { SidebarSection } from "@/lib/database.types";
import { partitionBySection } from "@/lib/sections";

interface Row {
  id: string;
  starred: boolean;
}

const conversation = (id: string, starred = false): Row => ({ id, starred });
const section = (id: string, name: string, position = 1000): SidebarSection => ({
  id,
  name,
  position,
  org_id: "org",
  user_id: "me",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

/** `sectionOf` built from a plain map of conversation id -> section id. */
const filing =
  (map: Record<string, string>) =>
  (id: string): string | null =>
    map[id] ?? null;

describe("partitionBySection", () => {
  it("leaves everything in rest when there are no sections", () => {
    const rows = [conversation("a"), conversation("b")];
    const { starred, filed, rest } = partitionBySection(rows, [], filing({}));
    expect(starred).toEqual([]);
    expect(filed).toEqual([]);
    expect(rest.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("moves a filed conversation out of rest and into its section", () => {
    const rows = [conversation("a"), conversation("b")];
    const management = section("s1", "Management customers");
    const { filed, rest } = partitionBySection(rows, [management], filing({ a: "s1" }));
    expect(filed).toHaveLength(1);
    expect(filed[0].section.name).toBe("Management customers");
    expect(filed[0].conversations.map((c) => c.id)).toEqual(["a"]);
    expect(rest.map((c) => c.id)).toEqual(["b"]);
  });

  it("shows a conversation once only: starred wins over its section", () => {
    const rows = [conversation("a", true)];
    const management = section("s1", "Management customers");
    const { starred, filed, rest } = partitionBySection(rows, [management], filing({ a: "s1" }));
    expect(starred.map((c) => c.id)).toEqual(["a"]);
    expect(filed[0].conversations).toEqual([]);
    expect(rest).toEqual([]);
  });

  it("keeps an empty section, so it is still there to drop into", () => {
    const empty = section("s1", "This week");
    const { filed } = partitionBySection([conversation("a")], [empty], filing({}));
    expect(filed).toHaveLength(1);
    expect(filed[0].conversations).toEqual([]);
  });

  it("keeps the sections in the order given", () => {
    const rows = [conversation("a"), conversation("b")];
    const first = section("s1", "First", 1000);
    const second = section("s2", "Second", 2000);
    const { filed } = partitionBySection(rows, [first, second], filing({ a: "s2", b: "s1" }));
    expect(filed.map((f) => f.section.name)).toEqual(["First", "Second"]);
    expect(filed[0].conversations.map((c) => c.id)).toEqual(["b"]);
    expect(filed[1].conversations.map((c) => c.id)).toEqual(["a"]);
  });

  // The moment after a section is deleted, before the refresh lands, its filings still point at an
  // id that is gone. Dropping those rows would take the conversation out of the sidebar entirely.
  it("falls back to rest when the section no longer exists", () => {
    const { filed, rest } = partitionBySection([conversation("a")], [], filing({ a: "deleted" }));
    expect(filed).toEqual([]);
    expect(rest.map((c) => c.id)).toEqual(["a"]);
  });
});
