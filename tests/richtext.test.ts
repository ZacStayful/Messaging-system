import { describe, expect, it } from "vitest";
import { mentionedNames, parseBlocks, parseInline, plainText, previewableLink, previewMentions } from "@/lib/richtext";

describe("richtext inline", () => {
  it("parses bold, italic, strike and code", () => {
    expect(parseInline("a **b** _c_ *d* ~e~ `f`")).toEqual([
      { type: "text", text: "a " },
      { type: "bold", text: "b" },
      { type: "text", text: " " },
      { type: "italic", text: "c" },
      { type: "text", text: " " },
      { type: "italic", text: "d" },
      { type: "text", text: " " },
      { type: "strike", text: "e" },
      { type: "text", text: " " },
      { type: "code", text: "f" },
    ]);
  });
  it("leaves snake_case and file names alone", () => {
    expect(parseInline("see my_file_name.txt and a*b")).toEqual([
      { type: "text", text: "see my_file_name.txt and a*b" },
    ]);
  });
  it("keeps mentions and links working", () => {
    expect(parseInline("hi @[Nigel Hyde] see https://example.com/x")).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", text: "@Nigel Hyde", name: "Nigel Hyde" },
      { type: "text", text: " see " },
      { type: "link", text: "https://example.com/x", href: "https://example.com/x" },
    ]);
  });
});

describe("richtext blocks", () => {
  it("parses numbered lists, quotes and code fences", () => {
    const blocks = parseBlocks("1. one\n2. two\n\n> quoted\n\n```\nlet x = 1;\n```\ntail");
    expect(blocks.map((b) => b.type)).toEqual(["ol", "quote", "code", "p"]);
    expect(blocks[0]).toMatchObject({ type: "ol", start: 1 });
    expect(blocks[2]).toEqual({ type: "code", text: "let x = 1;" });
  });
  it("handles a one-line code fence", () => {
    expect(parseBlocks("```npm test```")).toEqual([{ type: "code", text: "npm test" }]);
  });

  // "**Update:** all done **today**" used to be one heading: the heading rule was greedy and
  // matched from the first "**" to the last.
  it("keeps a line that merely starts and ends in bold as a paragraph", () => {
    expect(parseBlocks("**Update:** all done **today**")).toEqual([
      {
        type: "p",
        lines: [
          [
            { type: "bold", text: "Update:" },
            { type: "text", text: " all done " },
            { type: "bold", text: "today" },
          ],
        ],
      },
    ]);
    expect(parseBlocks("**Just a heading**")).toEqual([{ type: "h", text: "Just a heading" }]);
  });
});

describe("plainText and previewableLink", () => {
  it("strips markers", () => {
    expect(plainText("**bold** _it_ ~s~ `c` > q")).toBe("bold it s c > q");
  });
  it("skips Stayful and file links", () => {
    expect(previewableLink("see https://chat.stayful.co.uk/x and https://a.com/pic.png then https://b.com/page")).toBe(
      "https://b.com/page",
    );
    expect(previewableLink("nothing here")).toBeNull();
  });
});

describe("previewMentions", () => {
  it("matches both forms the composer writes", () => {
    expect(previewMentions("morning @Zac, all set?", "Zac")).toBe(true);
    expect(previewMentions("cc @[Zac Stayful] please", "Zac Stayful")).toBe(true);
    expect(previewMentions("@zac lower case", "Zac")).toBe(true);
  });

  it("does not match someone else", () => {
    expect(previewMentions("morning @Dan", "Zac")).toBe(false);
    expect(previewMentions("no mentions here", "Zac")).toBe(false);
  });

  // The crash this replaced: these names went straight into a RegExp, and the throw happened
  // inside the realtime handler, before the state update that moves the sidebar.
  it("survives names that are not valid regex", () => {
    for (const name of ["Zac (Stayful", "Ops )", "Dan [", "*Ops", "Zac ++", "a|b", "\\"]) {
      expect(() => previewMentions("@someone said hello", name), name).not.toThrow();
      expect(previewMentions("@someone said hello", name), name).toBe(false);
    }
  });

  it("does not treat a full stop in a name as a wildcard", () => {
    // "@JX Smith" matched /@\[?J. Smith\b/ and badged a false mention.
    expect(previewMentions("@JX Smith", "J. Smith")).toBe(false);
    expect(previewMentions("@[J. Smith] hello", "J. Smith")).toBe(true);
  });

  it("ignores an empty name rather than matching everything", () => {
    expect(previewMentions("@Zac hello", "")).toBe(false);
    expect(previewMentions("@Zac hello", "   ")).toBe(false);
  });
});

describe("mentions next to other text", () => {
  // "zac@stayful.co.uk" used to parse as the text "zac" followed by a mention of "stayful.co.uk":
  // the bare-mention pattern had no left boundary.
  it("leaves an email address as plain text", () => {
    expect(parseInline("mail zac@stayful.co.uk today")).toEqual([
      { type: "text", text: "mail zac@stayful.co.uk today" },
    ]);
    expect(parseInline("v1.@Zac")).toEqual([{ type: "text", text: "v1.@Zac" }]);
  });

  it("still mentions at the start of a line, after a space and after punctuation", () => {
    const zac = { type: "mention", text: "@Zac", name: "Zac" };
    expect(parseInline("@Zac hi")).toEqual([zac, { type: "text", text: " hi" }]);
    expect(parseInline("hi @Zac")).toEqual([{ type: "text", text: "hi " }, zac]);
    expect(parseInline("(@Zac)")).toEqual([{ type: "text", text: "(" }, zac, { type: "text", text: ")" }]);
  });

  it("applies the same boundary to the bracketed form", () => {
    expect(parseInline("cc @[Nigel Hyde] please")).toEqual([
      { type: "text", text: "cc " },
      { type: "mention", text: "@Nigel Hyde", name: "Nigel Hyde" },
      { type: "text", text: " please" },
    ]);
    expect(parseInline("x@[Nigel Hyde]")).toEqual([{ type: "text", text: "x@[Nigel Hyde]" }]);
  });

  it("reads the names out the same way, so nobody is badged for an email address", () => {
    expect(mentionedNames("mail zac@stayful.co.uk and @Zac")).toEqual(["Zac"]);
    expect(previewMentions("mail zac@stayful.co.uk", "stayful.co.uk")).toBe(false);
  });
});
