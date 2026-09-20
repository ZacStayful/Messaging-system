import { describe, expect, it } from "vitest";
import type { SlackConversation, SlackMessage, SlackUser } from "@/lib/slack/client";
import {
  addressesFromTopic,
  decideConversation,
  deslugify,
  looksLikeAddress,
  slugify,
  type DecideConversationContext,
  type ExistingConversation,
} from "@/lib/slack/conversations";
import { replaceShortcodes, shortcodeToUnicode } from "@/lib/slack/emoji";
import { blocksToText, mrkdwnToBody, type MrkdwnContext } from "@/lib/slack/mrkdwn";
import { fileNotImportedLine, normaliseMessage, type NormaliseContext } from "@/lib/slack/normalise";
import { decideUser, uniqueDisplayName, type DecideUserContext, type ExistingProfile } from "@/lib/slack/users";

/**
 * The pure half of the Slack import: text conversion, and the decisions about people, channels
 * and messages. Nothing here touches Slack or the database, so every case is a plain call.
 */

const names: Record<string, string> = { U1: "Zac", U2: "Nigel Hyde" };
const profiles: Record<string, string> = { U1: "p-zac", U2: "p-nigel", B1: "p-monday" };
const ctx: MrkdwnContext = {
  userName: (id) => names[id] ?? null,
  userProfileId: (id) => profiles[id] ?? null,
  channelName: (id) => (id === "C1" ? "general" : null),
};

describe("mrkdwnToBody", () => {
  it("turns Slack's single-asterisk bold into this app's double", () => {
    expect(mrkdwnToBody("this is *bold* text").body).toBe("this is **bold** text");
  });

  it("leaves italic, strike and code as they are, since both dialects agree", () => {
    expect(mrkdwnToBody("_italic_ ~strike~ `code`").body).toBe("_italic_ ~strike~ `code`");
  });

  it("rewrites nothing inside code, apart from decoding entities", () => {
    expect(mrkdwnToBody("say `a *b* c` and `x &amp; y`").body).toBe("say `a *b* c` and `x & y`");
    const fenced = mrkdwnToBody("```\n*not bold* <@U1> &lt;tag&gt; :tada:\n```", ctx);
    expect(fenced.body).toBe("```\n*not bold* <@U1> <tag> :tada:\n```");
    expect(fenced.mentions).toEqual([]);
  });

  it("resolves a user mention by display name and records the profile id", () => {
    expect(mrkdwnToBody("morning <@U1>", ctx)).toEqual({ body: "morning @Zac", mentions: ["p-zac"] });
  });

  it("uses Slack's label for a user nobody here knows, and records no mention", () => {
    expect(mrkdwnToBody("morning <@U9|dan>", ctx)).toEqual({ body: "morning @dan", mentions: [] });
    expect(mrkdwnToBody("morning <@U9>", ctx).body).toBe("morning @U9");
  });

  it("brackets a display name with a space, the composer's own form", () => {
    expect(mrkdwnToBody("<@U2> can you look?", ctx)).toEqual({
      body: "@[Nigel Hyde] can you look?",
      mentions: ["p-nigel"],
    });
  });

  it("writes a channel reference as #name", () => {
    expect(mrkdwnToBody("see <#C1|general>", ctx).body).toBe("see #general");
    expect(mrkdwnToBody("see <#C1>", ctx).body).toBe("see #general");
    expect(mrkdwnToBody("see <#C9>", ctx).body).toBe("see #C9");
  });

  it("writes the broadcast commands as plain text", () => {
    expect(mrkdwnToBody("<!here> <!channel> <!everyone>").body).toBe("@here @channel @everyone");
  });

  it("uses the handle of a user group and the fallback text of a date", () => {
    expect(mrkdwnToBody("cc <!subteam^S1|@ops>").body).toBe("cc @ops");
    expect(mrkdwnToBody("cc <!subteam^S1>").body).toBe("cc @group");
    expect(mrkdwnToBody("due <!date^1392734382^{date}|Feb 18>").body).toBe("due Feb 18");
  });

  it("writes links in the markdown forms this app renders", () => {
    expect(mrkdwnToBody("<https://x.com|label>").body).toBe("[label](https://x.com)");
    expect(mrkdwnToBody("<https://x.com>").body).toBe("https://x.com");
    expect(mrkdwnToBody("<https://x.com|https://x.com>").body).toBe("https://x.com");
    expect(mrkdwnToBody("<mailto:a@b.com|Email>").body).toBe("Email");
    expect(mrkdwnToBody("<mailto:a@b.com>").body).toBe("a@b.com");
  });

  it("decodes entities last, so an escaped token stays text", () => {
    expect(mrkdwnToBody("fish &amp; chips &lt;3 &gt;&gt;").body).toBe("fish & chips <3 >>");
    // Someone typed "<@U1>" literally; Slack escaped it, and it must not become a mention here.
    expect(mrkdwnToBody("type &lt;@U1&gt; to mention", ctx)).toEqual({
      body: "type <@U1> to mention",
      mentions: [],
    });
  });

  it("replaces emoji shortcodes, with their skin tone, and leaves custom emoji as text", () => {
    expect(mrkdwnToBody("nice :thumbsup: :thumbsup::skin-tone-3: :partyparrot:").body).toBe("nice 👍 👍🏼 :partyparrot:");
  });

  it("keeps a quote line as a quote", () => {
    expect(mrkdwnToBody("&gt; quoted\nreply").body).toBe("> quoted\nreply");
  });

  it("normalises line endings and trims", () => {
    expect(mrkdwnToBody("  one\r\ntwo  \r\n").body).toBe("one\ntwo");
  });
});

describe("blocksToText", () => {
  it("reads a section's text and fields", () => {
    expect(
      blocksToText([
        { type: "section", text: { type: "mrkdwn", text: "Hello *there*" }, fields: [{ text: "A" }, { text: "B" }] },
      ]),
    ).toBe("Hello *there*\nA\nB");
  });

  it("writes rich text elements back as the mrkdwn tokens mrkdwnToBody understands", () => {
    const text = blocksToText([
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              { type: "text", text: "Hi " },
              { type: "user", user_id: "U1" },
              { type: "text", text: " see " },
              { type: "link", url: "https://x.com", text: "the site" },
              { type: "text", text: " or " },
              { type: "link", url: "https://y.com" },
              { type: "text", text: " in " },
              { type: "channel", channel_id: "C1" },
              { type: "text", text: " " },
              { type: "emoji", name: "tada" },
              { type: "text", text: " " },
              { type: "broadcast", range: "channel" },
              { type: "text", text: " " },
              { type: "usergroup", usergroup_id: "S1" },
            ],
          },
        ],
      },
    ]);
    expect(text).toBe(
      "Hi <@U1> see <https://x.com|the site> or <https://y.com> in <#C1> :tada: <!channel> <!subteam^S1>",
    );
    expect(mrkdwnToBody(text, ctx).body).toBe(
      "Hi @Zac see [the site](https://x.com) or https://y.com in #general 🎉 @channel @group",
    );
  });

  it("writes lists, preformatted blocks and quotes in this app's markup", () => {
    const list = {
      type: "rich_text_list",
      style: "bullet",
      elements: [
        { type: "rich_text_section", elements: [{ type: "text", text: "one" }] },
        { type: "rich_text_section", elements: [{ type: "text", text: "two" }] },
      ],
    };
    const pre = { type: "rich_text_preformatted", elements: [{ type: "text", text: "let x = 1;" }] };
    const quote = { type: "rich_text_quote", elements: [{ type: "text", text: "wise words" }] };
    expect(blocksToText([{ type: "rich_text", elements: [list, pre, quote] }])).toBe(
      "- one\n- two\n```let x = 1;```\n&gt; wise words",
    );
  });

  it("makes a header bold and joins a context block's text, skipping its images", () => {
    expect(
      blocksToText([
        { type: "header", text: { type: "plain_text", text: "Weekly update" } },
        {
          type: "context",
          elements: [
            { type: "image", image_url: "https://x/i.png" },
            { type: "mrkdwn", text: "posted by" },
            { type: "plain_text", text: "Monday" },
          ],
        },
        { type: "divider" },
      ]),
    ).toBe("*Weekly update*\nposted by Monday");
  });

  it("falls back to the legacy attachments only when the blocks say nothing", () => {
    const attachments = [
      { title: "Report", title_link: "https://x.com/r", text: "All good" },
      { fallback: "plain fallback" },
    ];
    expect(blocksToText([{ type: "divider" }], attachments)).toBe("<https://x.com/r|Report>\nAll good\nplain fallback");
    expect(blocksToText(undefined, [{ title: "Untitled link", text: "" }])).toBe("Untitled link");
    expect(blocksToText([{ type: "section", text: { text: "from blocks" } }], attachments)).toBe("from blocks");
  });
});

describe("shortcodeToUnicode / replaceShortcodes", () => {
  it("maps a Slack short name, with or without its colons, to the character", () => {
    expect(shortcodeToUnicode("thumbsup")).toBe("👍");
    expect(shortcodeToUnicode(":thumbsup:")).toBe("👍");
    expect(shortcodeToUnicode("+1")).toBe("👍");
  });

  it("keeps a skin tone when the table has it, and drops it when it does not", () => {
    expect(shortcodeToUnicode("thumbsup::skin-tone-3")).toBe("👍🏼");
    expect(shortcodeToUnicode("tada::skin-tone-3")).toBe("🎉");
  });

  it("has no character for a custom emoji", () => {
    expect(shortcodeToUnicode("partyparrot")).toBeNull();
    expect(shortcodeToUnicode("")).toBeNull();
  });

  it("replaces shortcodes in text but not inside code", () => {
    expect(replaceShortcodes("nice :+1: :thumbsup::skin-tone-3: :partyparrot:")).toBe("nice 👍 👍🏼 :partyparrot:");
    expect(replaceShortcodes("`:tada:` and ```\n:tada:\n``` but :tada:")).toBe("`:tada:` and ```\n:tada:\n``` but 🎉");
  });
});

describe("normaliseMessage", () => {
  const context = (over: Partial<NormaliseContext> = {}): NormaliseContext => ({
    ...ctx,
    profileId: (id) => profiles[id] ?? null,
    importBotMessages: true,
    ...over,
  });
  const msg = (over: Partial<SlackMessage>): SlackMessage => ({
    type: "message",
    ts: "1700000000.000100",
    user: "U1",
    text: "hello",
    ...over,
  });
  const norm = (over: Partial<SlackMessage>, c = context()) => normaliseMessage("C1", msg(over), c);

  it("turns a plain message into a text row from the sender's profile", () => {
    const n = norm({ text: "hello *world* <@U2>" });
    expect(n).not.toBeNull();
    expect(n!.row).toEqual({
      channel_id: "C1",
      ts: "1700000000.000100",
      thread_ts: null,
      sender_id: "p-zac",
      body: "hello **world** @[Nigel Hyde]",
      kind: "text",
      edited_ts: null,
      meta: {
        slack: { channel: "C1", ts: "1700000000.000100", user: "U1", bot_id: null, subtype: null, username: null },
        mentions: ["p-nigel"],
      },
      reactions: [],
      pinned: false,
      pinned_by: null,
      pinned_ts: null,
    });
    expect(n).toMatchObject({ files: [], replyCount: 0, latestReply: null, droppedReactions: 0 });
  });

  it("leaves the sender empty for a Slack user nobody here maps to", () => {
    expect(norm({ user: "U9" })!.row.sender_id).toBeNull();
  });

  it("keeps a reply in its thread, including one broadcast to the channel", () => {
    const reply = norm({ ts: "1700000001.000200", thread_ts: "1700000000.000100", user: "U2", text: "reply" });
    expect(reply!.row).toMatchObject({ thread_ts: "1700000000.000100", sender_id: "p-nigel", kind: "text" });
    const broadcast = norm({
      subtype: "thread_broadcast",
      ts: "1700000002.000300",
      thread_ts: "1700000000.000100",
      text: "fyi",
    });
    expect(broadcast!.row).toMatchObject({ thread_ts: "1700000000.000100", kind: "text" });
    expect(broadcast!.row.meta).toMatchObject({ slack: { subtype: "thread_broadcast" } });
  });

  it("is a top-level message when thread_ts is its own ts", () => {
    const parent = norm({ thread_ts: "1700000000.000100", reply_count: 2, latest_reply: "1700000009.000000" });
    expect(parent!.row.thread_ts).toBeNull();
    expect(parent).toMatchObject({ replyCount: 2, latestReply: "1700000009.000000" });
  });

  it("makes a join or leave a system line with the event in meta and no sender", () => {
    const join = norm({ subtype: "channel_join", user: "U2", text: "<@U2> has joined the channel" });
    expect(join!.row).toMatchObject({ kind: "system", sender_id: null, body: "@[Nigel Hyde] has joined the channel" });
    expect(join!.row.meta).toMatchObject({ event: "member_joined", user_id: "p-nigel" });
    const leave = norm({ subtype: "channel_leave", user: "U2", text: "<@U2> has left the channel" });
    expect(leave!.row.meta).toMatchObject({ event: "member_left" });
  });

  it("records topic, purpose and name changes as system lines", () => {
    const topic = norm({ subtype: "channel_topic", text: "<@U1> set the channel topic: 6 Trent St" });
    expect(topic!.row).toMatchObject({ kind: "system", sender_id: null });
    expect(topic!.row.meta).toMatchObject({ event: "topic_changed", user_id: "p-zac" });
    const purpose = norm({ subtype: "channel_purpose", text: "<@U1> set the channel purpose: keys" });
    expect(purpose!.row.meta).toMatchObject({ event: "topic_changed" });
    const renamed = norm({ subtype: "channel_name", text: '<@U1> has renamed the channel from "a" to "b"' });
    expect(renamed!.row.meta).toMatchObject({ event: "channel_renamed" });
  });

  it("drops what has no place here: tombstones, pin notices, hidden messages, no ts", () => {
    expect(norm({ subtype: "tombstone", text: "This message was deleted." })).toBeNull();
    expect(norm({ subtype: "pinned_item", text: "<@U1> pinned a message" })).toBeNull();
    expect(norm({ hidden: true })).toBeNull();
    expect(norm({ ts: "" })).toBeNull();
  });

  it("drops an empty message, unless it carries files", () => {
    expect(norm({ text: "" })).toBeNull();
    expect(norm({ text: "   " })).toBeNull();
    const withFiles = norm({
      text: "",
      files: [
        { id: "F1", name: "a.png", mode: "hosted" },
        { id: "F2", name: "gone.png", mode: "tombstone" },
        { id: "F3", name: "old.png", mode: "hidden_by_limit" },
      ],
    });
    expect(withFiles).not.toBeNull();
    expect(withFiles!.row.body).toBe("");
    expect(withFiles!.files.map((f) => f.id)).toEqual(["F1"]);
  });

  it("imports a bot message only when asked, and only from a bot with a profile", () => {
    const bot: Partial<SlackMessage> = {
      subtype: "bot_message",
      user: undefined,
      bot_id: "B1",
      username: "Monday",
      text: "",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Task *done*" } }],
    };
    expect(norm(bot, context({ importBotMessages: false }))).toBeNull();
    const n = norm(bot);
    expect(n!.row).toMatchObject({ sender_id: "p-monday", body: "Task **done**", kind: "text" });
    expect(n!.row.meta).toMatchObject({
      slack: { user: null, bot_id: "B1", subtype: "bot_message", username: "Monday" },
    });
    expect(norm({ ...bot, bot_id: "B9" })).toBeNull();
  });

  it("resolves reactions to profiles, counts the ones it cannot, and keeps custom emoji by name", () => {
    const n = norm({
      reactions: [
        { name: "thumbsup", users: ["U1", "U9"], count: 2 },
        { name: "partyparrot", users: ["U2"], count: 1 },
        { name: "wave::skin-tone-2", users: ["U2"], count: 1 },
      ],
    });
    expect(n!.row.reactions).toEqual([
      { user_id: "p-zac", emoji: "👍" },
      { user_id: "p-nigel", emoji: ":partyparrot:" },
      { user_id: "p-nigel", emoji: "👋🏻" },
    ]);
    expect(n!.droppedReactions).toBe(1);
  });

  it("carries a pin in this channel, with who pinned it and when", () => {
    const pinned = norm({ pinned_to: ["C1"], pinned_info: { pinned_by: "U2", pinned_ts: 1700000005 } });
    expect(pinned!.row).toMatchObject({ pinned: true, pinned_by: "p-nigel", pinned_ts: "1700000005" });
    expect(norm({ pinned_to: ["C2"] })!.row).toMatchObject({ pinned: false, pinned_by: null });
  });

  it("keeps the edit stamp", () => {
    expect(norm({ edited: { user: "U1", ts: "1700000009.000000" } })!.row.edited_ts).toBe("1700000009.000000");
  });

  it("reports a parent's reply count so its thread can be fetched, and never a reply's", () => {
    expect(norm({ reply_count: 3, latest_reply: "1700000010.000000" })).toMatchObject({
      replyCount: 3,
      latestReply: "1700000010.000000",
    });
    expect(norm({ ts: "1700000001.000200", thread_ts: "1700000000.000100", reply_count: 3 })!.replyCount).toBe(0);
  });
});

describe("fileNotImportedLine", () => {
  it("names the file and the reason, with a fallback name", () => {
    expect(fileNotImportedLine("big.zip", "larger than 50 MB")).toBe(
      "[file not imported: big.zip (larger than 50 MB)]",
    );
    expect(fileNotImportedLine(undefined, "no download link")).toBe("[file not imported: file (no download link)]");
  });
});

describe("decideUser", () => {
  const userContext = (over: Partial<DecideUserContext> = {}): DecideUserContext => ({
    teamDomains: ["stayful.co.uk"],
    profilesByEmail: new Map(),
    profilesBySlackId: new Map(),
    takenDisplayNames: new Set(),
    ...over,
  });
  const zac: SlackUser = {
    id: "U1",
    name: "zac",
    real_name: "Zac Smith",
    tz: "Europe/London",
    profile: {
      email: "Zac@Stayful.co.uk",
      display_name: "Zac",
      image_512: "https://avatars.slack-edge.com/zac_512.png",
    },
  };
  const existing: ExistingProfile = {
    id: "p-zac",
    email: "zac@stayful.co.uk",
    slackUserId: null,
    displayName: "Zac S",
  };

  it("does nothing with Slackbot", () => {
    const d = decideUser({ id: "USLACKBOT", name: "slackbot", real_name: "Slackbot" }, userContext());
    expect(d).toMatchObject({ decision: "skip", reason: "slackbot", isBot: true });
  });

  it("links a member whose email already has an account, keeping that account's display name", () => {
    const ctx = userContext({ profilesByEmail: new Map([["zac@stayful.co.uk", existing]]) });
    expect(decideUser(zac, ctx)).toMatchObject({
      decision: "link",
      reason: "email_match",
      profileId: "p-zac",
      displayName: "Zac S",
      email: "zac@stayful.co.uk",
    });
    expect(ctx.takenDisplayNames.size).toBe(0);
  });

  it("links a member already carrying a slack_user_id, whatever their email is now", () => {
    const ctx = userContext({ profilesBySlackId: new Map([["U1", { ...existing, slackUserId: "U1" }]]) });
    expect(decideUser({ ...zac, profile: { ...zac.profile, email: "new@elsewhere.com" } }, ctx)).toMatchObject({
      decision: "link",
      reason: "already_linked",
      profileId: "p-zac",
    });
  });

  it("gives a bot a deactivated team profile named after the app", () => {
    const bots: SlackUser[] = [
      { id: "UB1", name: "monday", real_name: "Monday", is_bot: true },
      { id: "UB2", name: "zapier", real_name: "Zapier", is_app_user: true },
      { id: "UB3", name: "github", real_name: "GitHub", profile: { bot_id: "B123" } },
    ];
    for (const bot of bots) {
      expect(decideUser(bot, userContext()), bot.id).toMatchObject({
        decision: "create_bot",
        reason: "bot",
        accountType: "team",
        deactivated: true,
        isBot: true,
        displayName: `${bot.real_name} (Slack app)`,
        fullName: `${bot.real_name} (Slack app)`,
      });
    }
  });

  it("makes a guest a dormant customer, deleted or not", () => {
    const myles: SlackUser = {
      id: "U3",
      name: "myles",
      real_name: "Myles Denton",
      is_restricted: true,
      profile: { email: "myles@murraystays.co.uk", display_name: "Myles" },
    };
    expect(decideUser(myles, userContext())).toMatchObject({
      decision: "create_customer",
      reason: "guest",
      accountType: "customer",
      role: "owner",
      deactivated: false,
      displayName: "Myles",
      fullName: "Myles Denton",
      email: "myles@murraystays.co.uk",
    });
    expect(
      decideUser({ ...myles, is_restricted: undefined, is_ultra_restricted: true, deleted: true }, userContext()),
    ).toMatchObject({ decision: "create_customer", reason: "guest_deleted", deactivated: true });
  });

  it("skips a full member with no email, since nothing could be sent to them", () => {
    expect(decideUser({ id: "U4", name: "dan", real_name: "Dan Jones" }, userContext())).toMatchObject({
      decision: "skip",
      reason: "no_email",
      displayName: "Dan",
    });
  });

  it("creates a dormant, deactivated account for a deleted member so their posts keep a name", () => {
    expect(decideUser({ ...zac, deleted: true }, userContext())).toMatchObject({
      decision: "create_team",
      reason: "deleted",
      accountType: "team",
      role: "staff",
      deactivated: true,
    });
  });

  it("holds a member from another domain for review rather than inviting them", () => {
    expect(decideUser({ ...zac, profile: { ...zac.profile, email: "zac@gmail.com" } }, userContext())).toMatchObject({
      decision: "create_team",
      reason: "domain_review",
      deactivated: false,
    });
  });

  it("invites a live member on the team's own domain", () => {
    expect(decideUser(zac, userContext())).toMatchObject({
      decision: "invite_team",
      reason: "team_member",
      accountType: "team",
      role: "staff",
      email: "zac@stayful.co.uk",
      fullName: "Zac Smith",
      displayName: "Zac",
      timezone: "Europe/London",
      imageUrl: "https://avatars.slack-edge.com/zac_512.png",
      deactivated: false,
      isBot: false,
      profileId: null,
    });
  });

  it("falls back to the first name when Slack has no display name", () => {
    const nigel: SlackUser = {
      id: "U5",
      name: "nigel",
      real_name: "Nigel Hyde",
      profile: { email: "nigel@stayful.co.uk" },
    };
    expect(decideUser(nigel, userContext())).toMatchObject({ displayName: "Nigel", fullName: "Nigel Hyde" });
  });

  it("keeps display names unique across the workspace, since mentions resolve by name", () => {
    const ctx = userContext({ takenDisplayNames: new Set(["sam"]) });
    const sam = (id: string): SlackUser => ({
      id,
      name: "samw",
      real_name: "Sam Walters",
      profile: { email: `${id}@stayful.co.uk`, display_name: "Sam" },
    });
    expect(decideUser(sam("U6"), ctx).displayName).toBe("Sam W.");
    expect(decideUser(sam("U7"), ctx).displayName).toBe("Sam Walters");
    expect(decideUser(sam("U8"), ctx).displayName).toBe("samw");
    expect(decideUser(sam("U9"), ctx).displayName).toBe("Sam (samw)");
    expect(decideUser(sam("U10"), ctx).displayName).toBe("Sam 2");
    expect(ctx.takenDisplayNames).toEqual(new Set(["sam", "sam w.", "sam walters", "samw", "sam (samw)", "sam 2"]));
  });
});

describe("uniqueDisplayName", () => {
  it("prefers the name itself, then an initial, then the full name, then the handle", () => {
    expect(uniqueDisplayName("Sam", "Sam Walters", "samw", new Set())).toBe("Sam");
    expect(uniqueDisplayName("Sam", "Sam Walters", "samw", new Set(["sam"]))).toBe("Sam W.");
    expect(uniqueDisplayName("Sam", "Sam Walters", "samw", new Set(["sam", "sam w."]))).toBe("Sam Walters");
    expect(uniqueDisplayName("Sam", "Sam Walters", "samw", new Set(["sam", "sam w.", "sam walters"]))).toBe("samw");
  });

  it("compares case-insensitively and numbers the name as a last resort", () => {
    expect(uniqueDisplayName("Sam", "Sam", "", new Set(["SAM"]))).toBe("Sam 2");
    expect(uniqueDisplayName("Sam", "Sam", "", new Set(["sam", "sam 2"]))).toBe("Sam 3");
  });
});

describe("slugify / deslugify", () => {
  it("applies the rule create_channel uses", () => {
    expect(slugify("6 Trent Street, Stockton-on-Tees")).toBe("6-trent-street-stockton-on-tees");
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
    expect(slugify("a".repeat(59) + "-b")).toBe("a".repeat(59));
  });

  it("turns a slug back into a readable address", () => {
    expect(deslugify("6-trent-street-stockton-on-tees")).toBe("6 Trent Street Stockton On Tees");
    expect(deslugify("flat-2b-12-high-st")).toBe("Flat 2B 12 High St");
  });
});

describe("addressesFromTopic", () => {
  it("reads one address per line, ignoring lines with no number or too short to be one", () => {
    expect(addressesFromTopic("C-cust", "6 Trent St, Stockton.\nFlat 2, 10 High Street;\nno digits here\n1 x")).toEqual(
      [
        { channelId: "C-cust", address: "6 Trent St, Stockton", slug: "6-trent-st-stockton" },
        { channelId: "C-cust", address: "Flat 2, 10 High Street", slug: "flat-2-10-high-street" },
      ],
    );
    expect(addressesFromTopic("C-cust", null)).toEqual([]);
    expect(addressesFromTopic("C-cust", "")).toEqual([]);
  });
});

describe("looksLikeAddress", () => {
  it("recognises a house number, a flat and a postcode, and nothing else", () => {
    expect(looksLikeAddress("6-trent-street")).toBe(true);
    expect(looksLikeAddress("flat-2b-high-st")).toBe(true);
    expect(looksLikeAddress("the-old-mill")).toBe(true);
    expect(looksLikeAddress("rose-cottage-ts18-4dl")).toBe(true);
    expect(looksLikeAddress("maintenance")).toBe(false);
    expect(looksLikeAddress("ops-2026")).toBe(false);
  });
});

describe("decideConversation", () => {
  const convContext = (over: Partial<DecideConversationContext> = {}): DecideConversationContext => ({
    isGuest: (id) => id === "U-guest",
    isBot: (id) => id === "B1",
    existingBySlug: new Map(),
    customerAddresses: [{ channelId: "C-cust", address: "6 Trent St, Stockton", slug: "6-trent-st-stockton" }],
    skipNamePatterns: ["test", "zac-test"],
    ...over,
  });
  const channel = (over: Partial<SlackConversation> = {}): SlackConversation => ({
    id: "C1",
    name: "maintenance",
    is_channel: true,
    ...over,
  });
  const existing = (over: Partial<ExistingConversation> = {}): ExistingConversation => ({
    id: "conv-1",
    type: "internal",
    propertyId: null,
    archivedAt: null,
    slackLinked: false,
    ...over,
  });

  it("skips an archived channel", () => {
    expect(decideConversation(channel({ is_archived: true }), ["U1"], convContext())).toMatchObject({
      decision: "skip",
      skipReason: "archived",
      slug: "maintenance",
    });
  });

  it("skips a channel on the test list, matched as a whole slug", () => {
    expect(decideConversation(channel({ name: "Zac-Test" }), ["U1"], convContext())).toMatchObject({
      decision: "skip",
      skipReason: "test",
    });
    expect(decideConversation(channel({ name: "test-kitchen" }), ["U1"], convContext())).toMatchObject({
      decision: "create",
    });
    expect(
      decideConversation(channel({ name: "test" }), ["U1"], convContext({ skipNamePatterns: [" TEST "] })),
    ).toMatchObject({ skipReason: "test" });
  });

  it("skips a private channel the token cannot see into", () => {
    expect(decideConversation(channel({ is_private: true, is_member: false }), [], convContext())).toMatchObject({
      decision: "skip",
      skipReason: "not_visible",
    });
    expect(decideConversation(channel({ is_private: true, is_member: true }), ["U1"], convContext())).toMatchObject({
      decision: "create",
    });
  });

  it("makes a channel with a guest in it a customer group", () => {
    expect(decideConversation(channel(), ["U1", "U-guest"], convContext())).toMatchObject({
      decision: "create",
      targetKind: "owner",
      propertyAddress: null,
    });
  });

  it("does not count a bot as a guest", () => {
    const ctx = convContext({ isGuest: (id) => id === "B1" });
    expect(decideConversation(channel(), ["U1", "B1"], ctx)).toMatchObject({ targetKind: "internal" });
  });

  it("makes a channel named after a customer's address a property group tied to that customer", () => {
    expect(decideConversation(channel({ name: "6-trent-st-stockton" }), ["U1"], convContext())).toMatchObject({
      decision: "create",
      targetKind: "property",
      propertyAddress: "6 Trent St, Stockton",
      customerChannelId: "C-cust",
      addressGuessed: false,
    });
    // The channel carries the whole town; the topic stopped at the street.
    expect(decideConversation(channel({ name: "6 Trent St Stockton on Tees" }), ["U1"], convContext())).toMatchObject({
      targetKind: "property",
      propertyAddress: "6 Trent St, Stockton",
      customerChannelId: "C-cust",
    });
  });

  it("guesses the address from the name when it looks like one and no customer topic has it", () => {
    expect(decideConversation(channel({ name: "12-high-street" }), ["U1"], convContext())).toMatchObject({
      decision: "create",
      targetKind: "property",
      propertyAddress: "12 High Street",
      addressGuessed: true,
      customerChannelId: null,
    });
  });

  it("makes anything else an internal channel", () => {
    expect(decideConversation(channel(), ["U1"], convContext())).toEqual({
      decision: "create",
      skipReason: null,
      targetKind: "internal",
      targetConversationId: null,
      slug: "maintenance",
      propertyAddress: null,
      addressGuessed: false,
      customerChannelId: null,
    });
  });

  it("links to the group that already holds the name, so history lands where the team works", () => {
    const ctx = convContext({ existingBySlug: new Map([["maintenance", existing()]]) });
    expect(decideConversation(channel(), ["U1"], ctx)).toMatchObject({
      decision: "link",
      targetConversationId: "conv-1",
      targetKind: "internal",
    });
  });

  it("keeps an existing customer group a customer group, and an existing internal one internal", () => {
    const owner = convContext({ existingBySlug: new Map([["maintenance", existing({ type: "owner" })]]) });
    expect(decideConversation(channel(), [], owner)).toMatchObject({ decision: "link", targetKind: "owner" });
    const internal = convContext({ existingBySlug: new Map([["maintenance", existing()]]) });
    expect(decideConversation(channel(), ["U-guest"], internal)).toMatchObject({
      decision: "link",
      targetKind: "internal",
    });
  });

  it("treats an existing group that already has a property as a property group", () => {
    const ctx = convContext({
      existingBySlug: new Map([
        ["maintenance", existing({ propertyId: "prop-1" })],
        ["12-high-street", existing({ id: "conv-2", propertyId: "prop-2" })],
      ]),
    });
    expect(decideConversation(channel(), ["U1"], ctx)).toMatchObject({
      decision: "link",
      targetKind: "property",
      targetConversationId: "conv-1",
      propertyAddress: null,
      addressGuessed: false,
    });
    expect(decideConversation(channel({ name: "12-high-street" }), ["U1"], ctx)).toMatchObject({
      decision: "link",
      targetKind: "property",
      targetConversationId: "conv-2",
      propertyAddress: "12 High Street",
      addressGuessed: true,
    });
  });

  it("creates afresh rather than linking to a group another channel took, or an archived one", () => {
    const taken = convContext({ existingBySlug: new Map([["maintenance", existing({ slackLinked: true })]]) });
    expect(decideConversation(channel(), ["U1"], taken)).toMatchObject({
      decision: "create",
      targetConversationId: null,
    });
    const archived = convContext({
      existingBySlug: new Map([["maintenance", existing({ archivedAt: "2026-01-01T00:00:00Z" })]]),
    });
    expect(decideConversation(channel(), ["U1"], archived)).toMatchObject({
      decision: "create",
      targetConversationId: null,
    });
  });
});
