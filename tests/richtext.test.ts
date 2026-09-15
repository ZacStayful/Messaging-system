import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline, plainText, previewableLink } from "@/lib/richtext";

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
