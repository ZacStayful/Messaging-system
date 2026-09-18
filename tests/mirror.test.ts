import { describe, expect, it } from "vitest";
import { normaliseInboundPayload } from "@/lib/whatsapp/inbound";
import { counterpartPhone, decideMirror, type MirrorInput } from "@/lib/whatsapp/mirror";

/** The documented event shape, as tests/whatsapp.test.ts uses it, but going the other way. */
const sentEvent = {
  event_type: "message:sent:new",
  chat: { chat_id: 123456, is_group: false, phone: "+447828117537" },
  whatsapp_account: { full_name: "Zac", email: "zac@stayful.co.uk", phone: "+447957516879" },
  message: {
    text: "Hi Myles, yes we can do Tuesday.",
    direction: "sent",
    message_uid: "sent-uid-1",
    sender: { full_name: "Zac", phone: "+447957516879" },
    recipient: { full_name: "Myles Denton", phone: "+447828117537" },
    attachments: [],
  },
};

describe("normaliseInboundPayload — the other party's number", () => {
  it("exposes the chat and recipient phones on the event shape", () => {
    const [m] = normaliseInboundPayload(sentEvent);
    expect(m).toMatchObject({
      direction: "sent",
      fromPhone: "+447957516879",
      chatPhone: "+447828117537",
      recipientPhone: "+447828117537",
      receivedOn: "+447957516879",
      receivedByEmail: "zac@stayful.co.uk",
    });
  });

  it("exposes them on the bundle shape too", () => {
    const [m] = normaliseInboundPayload({
      chat_id: 9,
      phone: "+447828117537",
      whatsapp_account: { phone: "+447957516879", email: "zac@stayful.co.uk" },
      messages: [{ message_uid: "u1", direction: "sent", text: "hello", recipient: { phone: "+447828117537" } }],
    });
    expect(m).toMatchObject({ direction: "sent", chatPhone: "+447828117537", recipientPhone: "+447828117537" });
  });
});

describe("counterpartPhone", () => {
  it("is the recipient for a sent message, falling back to the chat", () => {
    expect(
      counterpartPhone({ direction: "sent", fromPhone: "+447957516879", chatPhone: "+441", recipientPhone: "+442" }),
    ).toBe("+442");
    expect(
      counterpartPhone({ direction: "sent", fromPhone: "+447957516879", chatPhone: "+441", recipientPhone: null }),
    ).toBe("+441");
    expect(
      counterpartPhone({ direction: "sent", fromPhone: "+447957516879", chatPhone: null, recipientPhone: null }),
    ).toBe(null);
  });

  it("is the sender for a received message", () => {
    expect(
      counterpartPhone({
        direction: "received",
        fromPhone: "+447828117537",
        chatPhone: "+441",
        recipientPhone: "+442",
      }),
    ).toBe("+447828117537");
  });
});

describe("decideMirror", () => {
  const message = normaliseInboundPayload(sentEvent)[0];
  const base: MirrorInput = {
    message,
    counterpart: { profileId: "lead-1", orgId: "org-1", leadCategory: "airbnb_management", deactivatedAt: null },
    ownerGroup: { conversationId: "conv-1", archivedAt: null },
    sentByApp: false,
    senderUserId: "zac",
  };

  it("mirrors a reply typed on the phone into the lead's group", () => {
    expect(decideMirror(base)).toEqual({
      kind: "mirror",
      conversationId: "conv-1",
      orgId: "org-1",
      senderId: "zac",
      body: "Hi Myles, yes we can do Tuesday.",
      to: "+447828117537",
    });
  });

  it("still mirrors when the sending number cannot be attributed", () => {
    expect(decideMirror({ ...base, senderUserId: null })).toMatchObject({ kind: "mirror", senderId: null });
  });

  it("ignores everything that is not a sent, one-to-one message", () => {
    expect(decideMirror({ ...base, message: { ...message, direction: "received" } })).toEqual({
      kind: "ignore",
      reason: "not_sent",
      record: false,
    });
    expect(decideMirror({ ...base, message: { ...message, isGroup: true } })).toMatchObject({ reason: "group" });
  });

  it("ignores a message with no usable counterpart number", () => {
    expect(decideMirror({ ...base, message: { ...message, chatPhone: null, recipientPhone: null } })).toMatchObject({
      reason: "no_counterpart_phone",
      record: false,
    });
    expect(
      decideMirror({ ...base, message: { ...message, chatPhone: "+15551234567", recipientPhone: "+15551234567" } }),
    ).toMatchObject({ reason: "bad_number", record: false });
  });

  it("drops the app's own sends — the echo loop guard, unchanged", () => {
    expect(decideMirror({ ...base, sentByApp: true })).toEqual({
      kind: "ignore",
      reason: "sent_by_app",
      record: false,
    });
  });

  it("quietly ignores numbers that are not a lead-database customer", () => {
    // Every app send to an ordinary customer passes through here; none is worth a record.
    expect(decideMirror({ ...base, counterpart: null })).toEqual({
      kind: "ignore",
      reason: "unknown_counterpart",
      record: false,
    });
    expect(decideMirror({ ...base, counterpart: { ...base.counterpart!, leadCategory: null } })).toEqual({
      kind: "ignore",
      reason: "not_a_lead",
      record: false,
    });
  });

  it("records the lead-specific failures someone needs to look at", () => {
    expect(decideMirror({ ...base, counterpart: { ...base.counterpart!, deactivatedAt: "2026-01-01" } })).toEqual({
      kind: "ignore",
      reason: "deactivated",
      record: true,
    });
    expect(decideMirror({ ...base, ownerGroup: null })).toMatchObject({ reason: "no_group", record: true });
    expect(decideMirror({ ...base, ownerGroup: { conversationId: "conv-1", archivedAt: "2026-01-01" } })).toMatchObject(
      {
        reason: "archived",
        record: true,
      },
    );
    expect(decideMirror({ ...base, message: { ...message, text: "   " } })).toMatchObject({
      reason: "empty_body",
      record: true,
    });
  });

  it("keeps a record of an attachment with no caption", () => {
    expect(decideMirror({ ...base, message: { ...message, text: "", mediaUrl: "https://x/y.jpg" } })).toMatchObject({
      kind: "mirror",
      body: "[Sent an attachment on WhatsApp]",
    });
  });
});
