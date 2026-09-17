import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A scroll container must never carry `justify-end` (or any justify-content that pushes
 * content away from the start).
 *
 * `justify-content: flex-end` on an element that also scrolls collapses its scrollHeight to
 * its clientHeight: the element cannot scroll at all, and everything above the fold becomes
 * unreachable. Verified in Chromium — 40 messages in such a container give 0px of scrollable
 * distance, while the same markup with `mt-auto` on the inner element gives the full 1180px
 * and still hugs the bottom when there are only a few messages.
 *
 * The conversation message list shipped with exactly this bug from the first commit. It stayed
 * invisible while conversations were short, and took the "N new messages" pill, deep links to a
 * message, in-conversation search and jump-from-pins down with it, because every one of those
 * works by setting scrollTop.
 *
 * This is a static guard rather than a rendering test: the failure needs a real layout engine,
 * which unit tests do not have, but the class combination that causes it is greppable.
 */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** Pulls out every className string literal in the file. */
function classNames(source: string): string[] {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? "");
}

describe("scroll containers", () => {
  const files = tsxFiles("src");

  it("finds the components to check", () => {
    // Guards the guard: a broken glob would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.includes("ConversationView"))).toBe(true);
  });

  it("never combine a justify-content that offsets content with overflow scrolling", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const cls of classNames(readFileSync(file, "utf8"))) {
        const scrolls = /\boverflow(-[xy])?-(auto|scroll)\b/.test(cls);
        const offsets = /\bjustify-(end|center)\b/.test(cls);
        if (scrolls && offsets) offenders.push(`${file}: "${cls}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the conversation message list still pins messages to the bottom", () => {
    // The behaviour justify-end was there for has to survive the fix, or short
    // conversations float at the top of the pane.
    const src = readFileSync("src/components/conversation/ConversationView.tsx", "utf8");
    const scroller = classNames(src).find((c) => c.includes("overflow-y-auto") && c.includes("flex-col"));
    expect(scroller, "the message list scroll container").toBeDefined();
    expect(scroller).not.toContain("justify-end");
    expect(src).toContain('className="mt-auto px-3.5 md:px-5"');
  });
});
