import { afterEach, describe, expect, it } from "vitest";
import {
  decideCapture,
  emailAddressOf,
  isCaptureRecipient,
  normaliseMessageId,
  type CaptureDirectory,
  type CaptureMessage,
} from "@/lib/email/capture";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("emailAddressOf / normaliseMessageId", () => {
  it("reads the address out of a display-name form and lower-cases it", () => {
    expect(emailAddressOf("Myles Denton <Myles@MurrayStays.co.uk>")).toBe("myles@murraystays.co.uk");
    expect(emailAddressOf("  zac@stayful.co.uk ")).toBe("zac@stayful.co.uk");
    expect(emailAddressOf("not an address")).toBeNull();
    expect(emailAddressOf(null)).toBeNull();
  });

  it("strips the angle brackets off a Message-ID", () => {
    expect(normaliseMessageId("<abc@mail.gmail.com>")).toBe("abc@mail.gmail.com");
    expect(normaliseMessageId("abc@mail.gmail.com")).toBe("abc@mail.gmail.com");
    expect(normaliseMessageId("<>")).toBeNull();
    expect(normaliseMessageId(undefined)).toBeNull();
  });
});

describe("isCaptureRecipient", () => {
  it("is off until an address is configured", () => {
    delete process.env.EMAIL_CAPTURE_ADDRESS;
    expect(isCaptureRecipient(["capture@reply.stayful.co.uk"])).toBe(false);
  });

  it("matches the configured address in any form", () => {
    process.env.EMAIL_CAPTURE_ADDRESS = "Capture@reply.stayful.co.uk";
    expect(isCaptureRecipient(["Stayful <capture@reply.stayful.co.uk>"])).toBe(true);
    expect(isCaptureRecipient(["zac@stayful.co.uk", "CAPTURE@REPLY.STAYFUL.CO.UK"])).toBe(true);
    expect(isCaptureRecipient(["zac@stayful.co.uk"])).toBe(false);
    expect(isCaptureRecipient([null, undefined])).toBe(false);
  });
});

describe("decideCapture", () => {
  const directory: CaptureDirectory = {
    leadsByEmail: new Map([
      [
        "myles@murraystays.co.uk",
        {
          userId: "myles",
          orgId: "org",
          deactivatedAt: null,
          ownerGroup: { conversationId: "conv-myles", archivedAt: null },
        },
      ],
      [
        "thomas@effortless-stays.co.uk",
        {
          userId: "thomas",
          orgId: "org",
          deactivatedAt: null,
          ownerGroup: { conversationId: "conv-thomas", archivedAt: null },
        },
      ],
      ["gone@example.com", { userId: "gone", orgId: "org", deactivatedAt: "2026-01-01", ownerGroup: null }],
      ["nogroup@example.com", { userId: "nogroup", orgId: "org", deactivatedAt: null, ownerGroup: null }],
      [
        "archived@example.com",
        {
          userId: "arch",
          orgId: "org",
          deactivatedAt: null,
          ownerGroup: { conversationId: "conv-arch", archivedAt: "2026-01-01" },
        },
      ],
    ]),
    teamByEmail: new Map([["zac@stayful.co.uk", "zac"]]),
    fallbackTeamUserId: "fallback",
  };
  const inbound: CaptureMessage = {
    messageId: "<m1@mail.gmail.com>",
    from: "Myles Denton <myles@murraystays.co.uk>",
    to: ["zac@stayful.co.uk"],
    subject: "Tuesday",
    text: "Tuesday works for me.\n\nOn Mon, 15 Sep 2026 at 09:00, Zac <zac@stayful.co.uk> wrote:\n> Can you do Tuesday?",
    html: null,
  };

  it("posts an inbound email as the lead, quoted history stripped", () => {
    expect(decideCapture(inbound, directory)).toEqual({
      kind: "post",
      direction: "inbound",
      body: "Tuesday works for me.",
      posts: [{ conversationId: "conv-myles", orgId: "org", senderId: "myles", leadUserId: "myles" }],
    });
  });

  it("infers the direction from who is writing", () => {
    const out = decideCapture(
      { ...inbound, from: "zac@stayful.co.uk", to: ["Myles <myles@murraystays.co.uk>"], text: "Can you do Tuesday?" },
      directory,
    );
    expect(out).toMatchObject({ kind: "post", direction: "outbound" });
    expect(out.kind === "post" ? out.posts[0] : null).toEqual({
      conversationId: "conv-myles",
      orgId: "org",
      senderId: "zac",
      leadUserId: "myles",
    });
  });

  it("posts an outbound email to two leads into both groups, once each", () => {
    const out = decideCapture(
      {
        ...inbound,
        from: "zac@stayful.co.uk",
        to: ["myles@murraystays.co.uk", "thomas@effortless-stays.co.uk", "myles@murraystays.co.uk"],
        cc: ["someone@else.com"],
        text: "Both of you: Tuesday.",
        direction: "outbound",
      },
      directory,
    );
    expect(out.kind).toBe("post");
    expect(out.kind === "post" ? out.posts.map((p) => p.conversationId) : []).toEqual(["conv-myles", "conv-thomas"]);
  });

  it("attributes an outbound email from an unlisted address to the fallback, or refuses", () => {
    const msg: CaptureMessage = {
      ...inbound,
      from: "assistant@stayful.co.uk",
      to: ["myles@murraystays.co.uk"],
      text: "hi",
      direction: "outbound",
    };
    expect(decideCapture(msg, directory)).toMatchObject({ kind: "post", posts: [{ senderId: "fallback" }] });
    expect(decideCapture(msg, { ...directory, fallbackTeamUserId: null })).toEqual({
      kind: "unmatched",
      reason: "no_team_sender",
      from: "assistant@stayful.co.uk",
    });
  });

  it("refuses what it cannot place", () => {
    expect(decideCapture({ ...inbound, messageId: null }, directory)).toMatchObject({ reason: "no_message_id" });
    expect(decideCapture({ ...inbound, from: "nobody" }, directory)).toMatchObject({ reason: "no_sender" });
    expect(decideCapture({ ...inbound, from: "stranger@example.com" }, directory)).toMatchObject({
      reason: "no_lead",
      from: "stranger@example.com",
    });
    expect(decideCapture({ ...inbound, from: "gone@example.com" }, directory)).toMatchObject({ reason: "deactivated" });
    expect(decideCapture({ ...inbound, from: "nogroup@example.com" }, directory)).toMatchObject({ reason: "no_group" });
    expect(decideCapture({ ...inbound, from: "archived@example.com" }, directory)).toMatchObject({
      reason: "archived",
    });
    expect(decideCapture({ ...inbound, text: "> all quoted", html: null }, directory)).toMatchObject({
      reason: "empty_body",
    });
    expect(
      decideCapture(
        { ...inbound, from: "zac@stayful.co.uk", to: ["stranger@example.com"], direction: "outbound" },
        directory,
      ),
    ).toMatchObject({ reason: "no_lead" });
  });

  it("falls back to the HTML body when there is no text part", () => {
    expect(decideCapture({ ...inbound, text: null, html: "<p>Tuesday <b>works</b>.</p>" }, directory)).toMatchObject({
      kind: "post",
      body: "Tuesday works.",
    });
  });
});
