import { describe, expect, it } from "vitest";
import { normaliseInboundPayload } from "@/lib/whatsapp/inbound";
import { appSendMatches, counterpartPhone, decideMirror, type MirrorInput } from "@/lib/whatsapp/mirror";
import { pickOwnerGroup } from "@/lib/whatsapp/capture";
import { whatsAppBodyText } from "@/lib/whatsapp/templates";

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

describe("appSendMatches — recognising the app's own WhatsApp send coming back", () => {
  it("matches a short message the app sent verbatim", () => {
    expect(appSendMatches("Hi Myles, yes we can do Tuesday.", "Hi Myles, yes we can do Tuesday.")).toBe(true);
  });

  it("matches a long message against the trimmed text that actually went out", () => {
    // The bug this exists for. The outbox row keeps the whole body; a lead receives
    // whatsAppBodyText(body), cut at 900 characters with an ellipsis. Comparing the two raw
    // meant every message over that length failed to match its own echo and was mirrored back
    // into the customer's group as though they had typed it.
    const body = `${"a".repeat(1200)} end`;
    expect(appSendMatches(body, whatsAppBodyText(body))).toBe(true);
    expect(whatsAppBodyText(body)).not.toBe(body.trim());
    expect(whatsAppBodyText(body).endsWith("…")).toBe(true);
  });

  it("tolerates the whitespace a provider may add or strip", () => {
    expect(appSendMatches("  Tuesday works.  ", "Tuesday works.")).toBe(true);
  });

  it("does not match a different message", () => {
    expect(appSendMatches("Tuesday works.", "Wednesday works.")).toBe(false);
  });

  it("does not match nothing at all", () => {
    // An empty inbound must never be read as "the app sent this", or every attachment-only
    // message from a customer would be dropped.
    expect(appSendMatches("Tuesday works.", "   ")).toBe(false);
  });
});

describe("pickOwnerGroup — a lead with more than one customer group", () => {
  const live = { conversation_id: "live", conversations: { type: "owner", archived_at: null } };
  const archived = {
    conversation_id: "old",
    conversations: { type: "owner", archived_at: "2026-01-01T00:00:00.000Z" },
  };

  it("prefers the live group when an archived one also exists", () => {
    // one_owner_group_per_external (0018) counts only live groups, so this pairing is legal and
    // happens whenever a group is archived and remade. Both callers used to take .limit(1) with
    // no ordering, so which one Postgres returned decided whether a live customer's message
    // reached their group or went to inbound_messages_unmatched.
    expect(pickOwnerGroup([archived, live])).toEqual({ conversationId: "live", archivedAt: null });
    expect(pickOwnerGroup([live, archived])).toEqual({ conversationId: "live", archivedAt: null });
  });

  it("still reports an archived group when that is the only one", () => {
    // The archived outcome stays meaningful: a lead whose group really has been archived is
    // filed as unmatched rather than silently posted into a closed group.
    expect(pickOwnerGroup([archived])).toEqual({ conversationId: "old", archivedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("finds nothing when the lead has no group", () => {
    expect(pickOwnerGroup([])).toBeNull();
    expect(pickOwnerGroup(null)).toBeNull();
    expect(pickOwnerGroup(undefined)).toBeNull();
  });
});
