import { afterEach, describe, expect, it } from "vitest";
import { messageWhatsApp } from "@/lib/whatsapp/templates";
import { dryRun, sendWhatsApp, whatsappApiBase, whatsappConfigured } from "@/lib/whatsapp/timelines";
import { normaliseInboundPayload, verifyWebhookToken } from "@/lib/whatsapp/inbound";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("messageWhatsApp", () => {
  const base = {
    senderName: "Sarah Hill",
    body: "The photos are booked for Tuesday.",
    conversationTitle: "#nick-clarke",
    isGroup: true,
    viewUrl: "https://chat.stayful.co.uk/home/abc",
  };

  it("names the author, because one number serves the whole company", () => {
    const { text } = messageWhatsApp(base);
    expect(text).toContain("*Sarah Hill*");
    expect(text).toContain("#nick-clarke");
  });

  it("uses WhatsApp markup, not HTML", () => {
    const { text } = messageWhatsApp(base);
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(text).toMatch(/^\*/);
  });

  it("carries the message itself, not just a nudge to go and look", () => {
    const { text } = messageWhatsApp(base);
    expect(text).toContain("The photos are booked for Tuesday.");
    expect(text).toContain(base.viewUrl);
  });

  it("drops the group name for a direct message", () => {
    const { text } = messageWhatsApp({ ...base, isGroup: false });
    expect(text).toContain("*Sarah Hill*");
    expect(text).not.toContain("#nick-clarke");
  });

  it("trims a very long message rather than sending a wall of text", () => {
    const { text } = messageWhatsApp({ ...base, body: "x".repeat(5000) });
    expect(text.length).toBeLessThan(1100);
    expect(text).toContain("…");
    expect(text).toContain(base.viewUrl);
  });

  it("sends just the message for a lead-database customer, who is not using the app", () => {
    const { text } = messageWhatsApp({ ...base, plain: true });
    expect(text).toBe("The photos are booked for Tuesday.");
    expect(text).not.toContain(base.viewUrl);
    expect(text).not.toContain("Sarah Hill");
  });

  it("does not leave ragged blank lines when the body has its own spacing", () => {
    const { text } = messageWhatsApp({ ...base, body: "\n\n  Hello  \n\n" });
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).toContain("Hello");
  });
});

describe("timelines adapter", () => {
  it("is not configured without a token", () => {
    delete process.env.TIMELINES_API_TOKEN;
    delete process.env.TIMELINES_DRY_RUN;
    expect(whatsappConfigured()).toBe(false);
  });

  it("counts dry-run as configured, so the drain can be exercised offline", () => {
    delete process.env.TIMELINES_API_TOKEN;
    process.env.TIMELINES_DRY_RUN = "1";
    expect(dryRun()).toBe(true);
    expect(whatsappConfigured()).toBe(true);
  });

  it("reports skipped rather than failed when there is no token", async () => {
    delete process.env.TIMELINES_API_TOKEN;
    delete process.env.TIMELINES_DRY_RUN;
    const res = await sendWhatsApp({ to: "+447957516879", text: "hi" });
    // skipped matters: the drain leaves the row pending instead of burning an attempt.
    expect(res).toMatchObject({ ok: false, skipped: true });
  });

  it("succeeds without a request in dry-run", async () => {
    process.env.TIMELINES_DRY_RUN = "1";
    const res = await sendWhatsApp({ to: "+447957516879", text: "hi" });
    expect(res.ok).toBe(true);
    expect(res.id).toMatch(/^dry-run-/);
  });

  it("defaults to the documented base and tolerates a trailing slash", () => {
    delete process.env.TIMELINES_API_BASE;
    expect(whatsappApiBase()).toBe("https://app.timelines.ai/integrations/api");
    process.env.TIMELINES_API_BASE = "https://stub.test/api/";
    expect(whatsappApiBase()).toBe("https://stub.test/api");
  });
});

describe("normaliseInboundPayload", () => {
  it("reads the event form", () => {
    const out = normaliseInboundPayload({
      event_type: "message:received:new",
      data: {
        message_uid: "m-1",
        phone: "+447700900001",
        text: "Tuesday works",
        chat_id: "c-1",
        timestamp: "2026-09-16T09:00:00Z",
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      externalRef: "m-1",
      fromPhone: "+447700900001",
      text: "Tuesday works",
      direction: "received",
      chatId: "c-1",
    });
  });

  it("reads the older bundle form, including several messages at once", () => {
    const out = normaliseInboundPayload({
      chat_id: "c-9",
      phone: "+447700900002",
      is_group: false,
      messages: [
        { message_uid: "m-1", direction: "received", text: "one", sender: { phone: "+447700900002" } },
        { message_uid: "m-2", direction: "received", text: "two" },
      ],
    });
    expect(out.map((m) => m.externalRef)).toEqual(["m-1", "m-2"]);
    // The second message has no sender of its own and inherits the chat's number.
    expect(out[1].fromPhone).toBe("+447700900002");
  });

  it("labels our own outbound as sent, in both shapes", () => {
    // The caller drops these. If it did not, storing one would post our own notification into
    // the conversation as the customer, notifying them, arriving back here — the echo loop.
    const evt = normaliseInboundPayload({
      event_type: "message:sent:new",
      data: { message_uid: "m-3", phone: "+447700900001", text: "from us" },
    });
    expect(evt[0].direction).toBe("sent");

    const bundle = normaliseInboundPayload({
      chat_id: "c-1",
      phone: "+447700900001",
      messages: [{ message_uid: "m-4", direction: "sent", text: "from us" }],
    });
    expect(bundle[0].direction).toBe("sent");
  });

  it("flags group chats so they are not routed into someone's private group", () => {
    const out = normaliseInboundPayload({
      chat_id: "c-2",
      phone: "+447700900001",
      is_group: true,
      messages: [{ message_uid: "m-5", direction: "received", text: "hi all" }],
    });
    expect(out[0].isGroup).toBe(true);
  });

  it("keeps a media message rather than dropping it for having no text", () => {
    const out = normaliseInboundPayload({
      event_type: "message:received:new",
      data: { message_uid: "m-6", phone: "+447700900001", text: "", media_url: "https://x.test/p.jpg" },
    });
    expect(out[0].text).toBe("");
    expect(out[0].mediaUrl).toBe("https://x.test/p.jpg");
  });

  it("returns nothing for junk rather than throwing", () => {
    for (const junk of [null, undefined, 42, "hello", {}, { data: {} }, { messages: [] }, { messages: [{}] }]) {
      expect(normaliseInboundPayload(junk), JSON.stringify(junk)).toEqual([]);
    }
  });

  it("skips messages with no id or no number, keeping the ones beside them", () => {
    const out = normaliseInboundPayload({
      chat_id: "c-3",
      phone: "+447700900001",
      messages: [{ text: "no id" }, { message_uid: "m-7", direction: "received", text: "fine" }],
    });
    expect(out.map((m) => m.externalRef)).toEqual(["m-7"]);
  });
});

describe("verifyWebhookToken", () => {
  it("accepts the right token and rejects everything else", () => {
    expect(verifyWebhookToken("s3cret-token", "s3cret-token")).toBe(true);
    expect(verifyWebhookToken("s3cret-tokeX", "s3cret-token")).toBe(false);
    expect(verifyWebhookToken("short", "s3cret-token")).toBe(false);
    expect(verifyWebhookToken("much-much-longer-token", "s3cret-token")).toBe(false);
  });

  it("rejects a missing token or a missing secret without throwing", () => {
    expect(verifyWebhookToken(null, "s3cret")).toBe(false);
    expect(verifyWebhookToken("", "s3cret")).toBe(false);
    expect(verifyWebhookToken("s3cret", undefined)).toBe(false);
    expect(verifyWebhookToken(undefined, undefined)).toBe(false);
  });
});

describe("normaliseInboundPayload — the documented event shape", () => {
  // Copied from https://timelinesai.mintlify.app/webhook-reference/overview. This is the shape a
  // real delivery has: no `data` wrapper, chat_id a number, is_group nested under chat. An
  // earlier version of the parser returned [] for it, so no reply would ever have arrived.
  const real = {
    event_type: "message:received:new",
    chat: {
      full_name: "John Doe",
      chat_url: "https://app.timelines.ai/chat/123456/messages/",
      chat_id: 123456,
      is_group: false,
      phone: "+15551234567",
      responsible_name: "Agent Brown",
      responsible_email: "agent-brown@example.com",
    },
    whatsapp_account: { full_name: "Agent Brown", email: "agent-brown@example.com", phone: "+15559876543" },
    message: {
      text: "Hi, here is the signed contract",
      direction: "received",
      origin: "WhatsApp",
      timestamp: "2024-01-15 10:30:00 +0200",
      message_uid: "a5bbb005-37f2-402c-96fa-e479a2e09b02",
      reply_to_uid: "c7ec509d-0171-1ead-a84b-c6943a644768",
      sender: { full_name: "John Doe", phone: "+15551234567" },
      recipient: { full_name: "Agent Brown", phone: "+15559876543" },
      attachments: [],
    },
  };

  it("reads a real delivery", () => {
    const out = normaliseInboundPayload(real);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      externalRef: "a5bbb005-37f2-402c-96fa-e479a2e09b02",
      fromPhone: "+15551234567",
      text: "Hi, here is the signed contract",
      direction: "received",
      isGroup: false,
    });
  });

  it("coerces a numeric chat_id rather than losing it", () => {
    expect(normaliseInboundPayload(real)[0].chatId).toBe("123456");
  });

  it("records which of our numbers received it, which is what multi-number needs", () => {
    const out = normaliseInboundPayload(real)[0];
    expect(out.receivedOn).toBe("+15559876543");
    expect(out.receivedByEmail).toBe("agent-brown@example.com");
  });

  it("still labels our own outbound as sent in the real shape", () => {
    const sent = { ...real, event_type: "message:sent:new", message: { ...real.message, direction: "sent" } };
    expect(normaliseInboundPayload(sent)[0].direction).toBe("sent");
  });

  it("sees a group chat flagged under chat, not at the top level", () => {
    const group = { ...real, chat: { ...real.chat, is_group: true } };
    expect(normaliseInboundPayload(group)[0].isGroup).toBe(true);
  });

  it("picks up an attachment url from the attachments array", () => {
    const withFile = {
      ...real,
      message: { ...real.message, text: "", attachments: [{ url: "https://x.test/contract.pdf" }] },
    };
    expect(normaliseInboundPayload(withFile)[0].mediaUrl).toBe("https://x.test/contract.pdf");
  });
});
