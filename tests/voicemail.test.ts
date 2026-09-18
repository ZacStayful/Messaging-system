import { describe, expect, it } from "vitest";
import { categoryFor, storagePath } from "@/lib/storage/attachments";
import { normaliseUkMobile } from "@/lib/phone";

/**
 * A voicemail is the first thing this codebase writes into storage from a server. Everything
 * else uploads from the browser under the user's own session, where the storage policies check
 * the path on the way in. The service role bypasses those policies, so on this path the object
 * key is not a naming convention — it *is* the access rule, and nothing will complain if it is
 * wrong.
 */
describe("storagePath", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const conversation = "22222222-2222-4222-8222-222222222222";
  const message = "33333333-3333-4333-8333-333333333333";

  it("puts the org first and the conversation second, which is what the policies read back", () => {
    // 0004_storage.sql: `split_part(name, '/', 1) = auth_org_id()::text`, and
    // storage_path_conversation_id() parses segment 2. Reorder these and the upload still
    // succeeds — the audio is simply unreadable by every member of the thread, silently.
    const parts = storagePath(org, conversation, message, "Voicemail 0930.mp3").split("/");
    expect(parts[0]).toBe(org);
    expect(parts[1]).toBe(conversation);
    expect(parts[2]).toBe(message);
    expect(parts).toHaveLength(4);
  });

  it("keeps the extension, because the bucket and the player both go by it", () => {
    expect(storagePath(org, conversation, message, "Voicemail 0930.mp3")).toMatch(/\.mp3$/);
  });

  it("does not let a file name escape its own segment", () => {
    // Twilio does not choose the name here, but this is the property that makes that safe to
    // stop worrying about: a slash in the name cannot add a path segment.
    const path = storagePath(org, conversation, message, "../../other-org/theirs.mp3");
    expect(path.split("/")).toHaveLength(4);
    expect(path.startsWith(`${org}/${conversation}/${message}/`)).toBe(true);
  });

  it("gives two voicemails in one message distinct keys", () => {
    const a = storagePath(org, conversation, message, "Voicemail 0930.mp3");
    const b = storagePath(org, conversation, message, "Voicemail 0930.mp3");
    expect(a).not.toBe(b);
  });
});

describe("categoryFor", () => {
  it("files a voicemail as a voice note, which is what renders a player", () => {
    // isVoiceNote() keys on this. Get it wrong and a voicemail shows as a file card that has to
    // be downloaded before anyone can hear who rang.
    expect(categoryFor("audio/mpeg", true)).toBe("voice");
    expect(categoryFor("audio/mpeg")).toBe("audio");
  });
});

/**
 * Who a voicemail can be attributed to. Not a restatement of phone.test.ts: the point here is
 * the consequence for inbound voice, which is a real operational limit rather than a bug.
 */
describe("attributing an inbound caller", () => {
  it("resolves a UK mobile however the network presents it", () => {
    expect(normaliseUkMobile("+447957516879").e164).toBe("+447957516879");
    expect(normaliseUkMobile("07957516879").e164).toBe("+447957516879");
  });

  it("cannot attribute a landline, so an office caller is always unmatched", () => {
    // profiles.phone is +447… only (ACCEPT_RE, and the matching CHECK on the column), so a
    // contractor ringing from the office can never be matched to their account no matter how
    // well we know them. The voicemail still lands — in inbound_messages_unmatched.
    expect(normaliseUkMobile("+441614960000").ok).toBe(false);
  });

  it("cannot attribute an overseas caller either", () => {
    expect(normaliseUkMobile("+33612345678").ok).toBe(false);
  });

  it("treats a withheld number as unmatched rather than throwing", () => {
    // Twilio sends "anonymous" for a withheld CLI, and a route that assumed a phone-shaped
    // string here would fail the whole webhook instead of filing the voicemail.
    expect(normaliseUkMobile("anonymous").ok).toBe(false);
    expect(normaliseUkMobile("").ok).toBe(false);
  });
});
