import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  htmlToText,
  newReplyToken,
  REPLY_TOKEN_TTL_MS,
  stripQuotedReply,
  tokenFromRecipients,
  verifySvixSignature,
} from "@/lib/email/inbound";
import { generatePassword } from "@/lib/email/password";
import { messageEmail, welcomeEmail } from "@/lib/email/templates";
import { unsubscribeUrl, verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

describe("inbound email", () => {
  it("strips quoted history and signatures", () => {
    const text = `Thanks, that works for me.\n\nJason\n\nOn Mon, 15 Sep 2026 at 09:00, Stayful <noreply@stayful.co.uk> wrote:\n> Hi Jason,\n> Photos are booked`;
    expect(stripQuotedReply(text)).toBe("Thanks, that works for me.\n\nJason");
  });

  it("handles Outlook-style separators and mobile signatures", () => {
    expect(stripQuotedReply("Yes please\n\nSent from my iPhone\n\n-----Original Message-----\nFrom: x")).toBe(
      "Yes please",
    );
    expect(stripQuotedReply("Go ahead with the repair.\n________________________________\nFrom: Stayful")).toBe(
      "Go ahead with the repair.",
    );
  });

  it("finds the reply token in recipients", () => {
    // The domain is now part of the contract rather than ignored, so it is passed explicitly
    // here; in the route it comes from EMAIL_REPLY_DOMAIN.
    const ours = "reply.stayful.co.uk";
    expect(tokenFromRecipients(["Stayful <reply+AbC123xyz789@reply.stayful.co.uk>"], ours)).toBe("AbC123xyz789");
    expect(tokenFromRecipients(["zac@stayful.co.uk"], ours)).toBeNull();
  });

  /**
   * The reply token is a bearer credential printed in an email anyone may forward, and the
   * inbound webhook carries no DKIM result to check the sender against. So the domain matters:
   * the recipient list is attacker-influenced — anyone can address a mail to whatever they
   * like — and this used to accept `reply+TOKEN@` on any domain at all.
   */
  it("ignores a token on someone else's domain", () => {
    const ours = "reply.stayful.co.uk";
    expect(tokenFromRecipients(["Stayful <reply+AbC123xyz789@reply.stayful.co.uk>"], ours)).toBe("AbC123xyz789");
    expect(tokenFromRecipients(["reply+AbC123xyz789@evil.example"], ours)).toBeNull();
    // A lookalike that merely ends with our domain must not match either.
    expect(tokenFromRecipients(["reply+AbC123xyz789@notreply.stayful.co.uk"], ours)).toBeNull();
    // A dot is a regex metacharacter, so it has to be matched literally rather than as "any".
    expect(tokenFromRecipients(["reply+AbC123xyz789@replyXstayful.co.uk"], ours)).toBeNull();
  });

  it("matches nothing when reply-by-email is switched off", () => {
    expect(tokenFromRecipients(["reply+AbC123xyz789@reply.stayful.co.uk"], null)).toBeNull();
  });

  it("gives a reply token a week from issue, not a month from last use", () => {
    // The old value was 30 days, refreshed by every send *and* every reply, which for a
    // conversation in use amounted to for ever. Pinned because the SQL default in 0036 has to
    // agree with it and nothing else connects the two.
    expect(REPLY_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("mints a distinct token every time", () => {
    // One per notification email since 0036. Two notifications sharing a token would put the
    // durable credential straight back.
    const tokens = new Set(Array.from({ length: 200 }, () => newReplyToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it("converts html replies to text and drops blockquotes", () => {
    expect(htmlToText("<div>Hi<br>there</div><blockquote>old</blockquote>")).toBe("Hi\nthere\n");
  });

  it("verifies Svix signatures", () => {
    const secretRaw = Buffer.from("test-secret-key-0123456789").toString("base64");
    const secret = `whsec_${secretRaw}`;
    const body = JSON.stringify({ type: "email.received" });
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(secretRaw, "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    expect(verifySvixSignature(body, { id, timestamp, signature: `v1,${sig}` }, secret)).toBe(true);
    expect(verifySvixSignature(body, { id, timestamp, signature: `v1,${sig}x` }, secret)).toBe(false);
    expect(verifySvixSignature(body, { id, timestamp: "1", signature: `v1,${sig}` }, secret)).toBe(false);
  });
});

describe("passwords and links", () => {
  it("generates readable 14-char passwords with digits", () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
      expect(pw).toMatch(/\d/);
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });

  it("signs and verifies unsubscribe links", () => {
    process.env.CRON_SECRET = "unit-test-secret";
    const url = new URL(unsubscribeUrl("https://chat.stayful.co.uk", "user-1"));
    expect(url.pathname).toBe("/api/email/unsubscribe");
    expect(verifyUnsubscribeToken("user-1", url.searchParams.get("t")!)).toBe(true);
    expect(verifyUnsubscribeToken("user-2", url.searchParams.get("t")!)).toBe(false);
  });
});

describe("templates", () => {
  it("welcome email carries the login details and escapes html", () => {
    const m = welcomeEmail({
      recipientName: "<Jason>",
      email: "j@example.com",
      password: "Ab2c-De3f-Gh4j",
      loginUrl: "https://chat.stayful.co.uk/login",
      invitedBy: "Zac",
      groups: ["jason-beckhurst"],
    });
    expect(m.html).toContain("&lt;Jason&gt;");
    expect(m.html).toContain("Ab2c-De3f-Gh4j");
    expect(m.text).toContain("Password: Ab2c-De3f-Gh4j");
    expect(m.text).toContain("jason-beckhurst");
  });

  it("message email groups several messages", () => {
    const m = messageEmail({
      recipientName: "Jason",
      conversationTitle: "#jason-beckhurst",
      items: [
        { senderName: "Bien", body: "Quote attached", createdAt: "2026-09-15T09:00:00Z" },
        { senderName: "Zac", body: "Let us know", createdAt: "2026-09-15T09:01:00Z" },
      ],
      viewUrl: "https://chat.stayful.co.uk/home/x",
      unsubscribeUrl: "https://chat.stayful.co.uk/api/email/unsubscribe?u=1&t=2",
      canReplyByEmail: true,
    });
    expect(m.subject).toBe("2 new messages from Bien, Zac");
    expect(m.html).toContain("reply to this email");
    expect(m.text).toContain("Turn off email notifications");
  });
});
