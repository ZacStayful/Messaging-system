import { describe, expect, it } from "vitest";
import { dayLabel, futureTime, listTime, pinWhen, previewOf, timeLabel } from "@/lib/format";
import { extractLinks, mentionToken, mentionedNames, parseBlocks, parseInline } from "@/lib/richtext";

const now = new Date("2026-09-15T09:00:00+01:00");

describe("format", () => {
  it("labels days relative to now", () => {
    expect(dayLabel("2026-09-15T07:44:00+01:00", now)).toBe("Today");
    expect(dayLabel("2026-09-14T11:20:00+01:00", now)).toBe("Yesterday");
    expect(dayLabel("2026-09-10T09:15:00+01:00", now)).toBe("Thursday");
    expect(dayLabel("2026-08-25T10:44:00+01:00", now)).toBe("25 August");
    expect(dayLabel("2024-08-20T13:43:00+01:00", now)).toBe("20 Aug 2024");
  });

  it("formats times Slack-style", () => {
    expect(timeLabel("2026-09-15T07:44:00+01:00")).toBe("7:44 AM");
    expect(timeLabel("2026-09-14T16:12:00+01:00")).toBe("4:12 PM");
  });

  it("formats list timestamps", () => {
    expect(listTime("2026-09-15T08:59:30+01:00", now)).toBe("Just now");
    expect(listTime("2026-09-15T07:55:00+01:00", now)).toBe("7:55 AM");
    expect(listTime("2026-09-14T18:40:00+01:00", now)).toBe("Yesterday");
    expect(listTime(null, now)).toBe("");
  });

  it("formats pin timestamps", () => {
    expect(pinWhen("2024-08-20T13:43:00+01:00")).toBe("20 Aug 2024 at 1:43 PM");
  });

  it("flattens markdown for previews", () => {
    expect(previewOf("**Next steps**\n- Book [here](https://x.y)\n- Clean")).toBe("Next steps Book here Clean");
  });
});

describe("richtext", () => {
  it("parses links, mentions and bold", () => {
    expect(parseInline("Hi @Zac see [here](https://a.b/c) and https://d.e/f **now**")).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", text: "@Zac", name: "Zac" },
      { type: "text", text: " see " },
      { type: "link", text: "here", href: "https://a.b/c" },
      { type: "text", text: " and " },
      { type: "link", text: "https://d.e/f", href: "https://d.e/f" },
      { type: "text", text: " " },
      { type: "bold", text: "now" },
    ]);
  });

  it("parses headings, lists and paragraphs", () => {
    const blocks = parseBlocks("Welcome!\n\n**Our Next steps**\n- Book a call\n- Deep clean\n\nThanks\nteam");
    expect(blocks.map((b) => b.type)).toEqual(["p", "h", "ul", "p"]);
    expect(blocks[1]).toEqual({ type: "h", text: "Our Next steps" });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
    expect((blocks[3] as { lines: unknown[] }).lines).toHaveLength(2);
  });

  it("extracts unique links with host and path", () => {
    const links = extractLinks(
      "see https://drive.google.com/file/d/1/view and https://www.stayful.co.uk/x, again https://drive.google.com/file/d/1/view",
    );
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      href: "https://drive.google.com/file/d/1/view",
      host: "drive.google.com",
      path: "/file/d/1/view",
    });
    expect(links[1].host).toBe("stayful.co.uk");
  });

  it("finds mentioned names", () => {
    expect(mentionedNames("Hi @Zac and @Martyn, cc @Bien.")).toEqual(["Zac", "Martyn", "Bien"]);
  });

  it("supports display names with spaces", () => {
    expect(mentionedNames("Morning @[Nigel Hyde], @Zac will call.")).toEqual(["Nigel Hyde", "Zac"]);
    expect(parseInline("hi @[Nigel Hyde]!")).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", text: "@Nigel Hyde", name: "Nigel Hyde" },
      { type: "text", text: "!" },
    ]);
    expect(mentionToken("Zac")).toBe("@Zac");
    expect(mentionToken("Nigel Hyde")).toBe("@[Nigel Hyde]");
    expect(previewOf("cc @[Nigel Hyde] please")).toBe("cc @Nigel Hyde please");
  });
});

describe("futureTime", () => {
  const now = new Date("2026-09-15T13:00:00");
  it("labels today, tomorrow, this week and later", () => {
    expect(futureTime(new Date("2026-09-15T17:00:00"), now)).toMatch(/^today at/);
    expect(futureTime(new Date("2026-09-16T09:00:00"), now)).toMatch(/^tomorrow at/);
    expect(futureTime(new Date("2026-09-18T09:00:00"), now)).toMatch(/^Friday at/);
    expect(futureTime(new Date("2026-10-02T09:00:00"), now)).toMatch(/^2 October at/);
  });
});
