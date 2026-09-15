import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { htmlToText, stripQuotedReply, tokenFromRecipients, verifySvixSignature } from "@/lib/email/inbound";
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
    expect(tokenFromRecipients(["Stayful <reply+AbC123xyz789@reply.stayful.co.uk>"])).toBe("AbC123xyz789");
    expect(tokenFromRecipients(["zac@stayful.co.uk"])).toBeNull();
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
