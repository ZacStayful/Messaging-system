import { describe, expect, it } from "vitest";
import { KNOWN_PLACEHOLDERS, placeholdersIn, renderTemplate } from "@/lib/templates/render";
import { parseBlocks } from "@/lib/richtext";
import { readFileSync } from "node:fs";

describe("renderTemplate", () => {
  it("substitutes what it knows", () => {
    expect(
      renderTemplate("Hi {{first_name}}, about {{property_address}}.", {
        first_name: "Rohana",
        property_address: "Apt 1203",
      }),
    ).toBe("Hi Rohana, about Apt 1203.");
  });

  it("leaves an unknown placeholder visible", () => {
    // Deliberate: blanking it hides the typo until a customer reads a sentence with a hole in
    // it. Left in, the preview shows the mistake to whoever is editing the template.
    expect(renderTemplate("Hi {{frist_name}}", { first_name: "Rohana" })).toBe("Hi {{frist_name}}");
  });

  it("renders a known but empty value as nothing", () => {
    expect(renderTemplate("[{{property_address}}]", { property_address: null })).toBe("[]");
  });

  it("tolerates whitespace and case inside the braces", () => {
    expect(renderTemplate("{{ First_Name }}", { first_name: "Rohana" })).toBe("Rohana");
  });

  it("lists the placeholders a body uses, once each", () => {
    expect(placeholdersIn("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
});

/**
 * The welcome message lives in 0023 as SQL, but it has to survive `parseBlocks` to render as
 * anything other than a wall of text. This reads it out of the migration so the assertions are
 * about the text that actually ships, not a copy that can drift from it.
 */
describe("the seeded welcome template", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0023_message_templates.sql", import.meta.url), "utf8");
  const body = sql.split("$welcome$")[1];

  it("is in the migration", () => {
    expect(body).toBeTruthy();
    expect(body).toContain("Welcome to Stayful!");
  });

  it("only uses placeholders the renderer knows", () => {
    for (const p of placeholdersIn(body)) expect(KNOWN_PLACEHOLDERS).toContain(p);
  });

  it("renders as headings, bullets and links rather than plain paragraphs", () => {
    const blocks = parseBlocks(body);
    const headings = blocks.filter((b) => b.type === "h").map((b) => (b as { text: string }).text);
    expect(headings).toContain("Our next steps");
    expect(headings).toContain("What we need from you");
    expect(headings).toContain("Meet the team");

    // The original used "* item", which richtext.ts reads as italics, not a bullet. If the
    // conversion to "- item" is ever undone, this is what notices.
    const lists = blocks.filter((b) => b.type === "ul");
    expect(lists.length).toBeGreaterThanOrEqual(2);
    const bullets = lists.flatMap((b) => (b as { items: unknown[][] }).items);
    expect(bullets.length).toBeGreaterThanOrEqual(13);

    const links = blocks
      .flatMap((b) => ("lines" in b ? b.lines : "items" in b ? b.items : []))
      .flat()
      .filter((part) => (part as { type: string }).type === "link") as { href: string }[];
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toContain("https://www.stayful.co.uk/onboarding");
    expect(hrefs.some((h) => h.includes("calendly.com"))).toBe(true);
  });

  it("does not @mention the team", () => {
    // Four mention chips in every new customer group would badge four people for every client
    // we onboard. The template is editable if that is ever wanted.
    expect(body).not.toMatch(/@\[/);
  });
});
