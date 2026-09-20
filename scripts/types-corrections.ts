/**
 * What `pnpm db:types` adds to the generator's output.
 *
 * The Supabase type generator is right about almost everything and wrong about three things, in
 * ways it cannot fix: Postgres simply does not record the information it would need. Those
 * corrections used to be applied by hand, directly in `src/lib/database.types.ts`, and its header
 * pointed at "CORRECTIONS in the regeneration step" for the list — which did not exist anywhere in
 * this repository. So regenerating silently discarded every one of them, and nobody could
 * reconstruct what had been lost. This file is that list, made real.
 *
 * Adding a correction: add an entry below. `pnpm db:types` applies them, and fails loudly naming
 * any that no longer match — a column renamed, a type changed, or the generator getting it right
 * on its own. A correction that has stopped applying is a signal, not something to work around.
 */

export type Correction = {
  /**
   * Dotted path from `Database["public"]` to the property, e.g.
   * `Functions.my_conversations.Returns.last_message_at` or
   * `Tables.conversation_members.Insert.member_side`.
   */
  path: string;
  /** The type text the generator emits today. The correction fails if it finds anything else. */
  from: string;
  /** What to write instead. Equal to `from` when only optionality changes. */
  to: string;
  /** Also make the property optional (`?:`). */
  optional?: true;
  /** Why the generator is wrong. Printed when the correction fails to apply. */
  why: string;
};

/**
 * Note for anyone extending this: the two kinds of correction never overlap. Every nullability
 * entry changes only the type and leaves optionality alone; the only two optionality entries leave
 * the type alone. That is not a rule, just how it has worked out — but it is the opposite of what
 * a reader tends to assume, so it is worth saying.
 */
export const CORRECTIONS: Correction[] = [
  // --- RPC arguments -------------------------------------------------------------------------
  // The generator marks an argument optional when its SQL parameter has a DEFAULT, but never
  // marks one nullable — and passing null is precisely how a caller says "no topic", "no note".
  {
    path: "Functions.add_bookmark.Args.p_emoji",
    from: "string",
    to: "string | null",
    why: "null is how a caller says the bookmark has no emoji",
  },
  {
    path: "Functions.add_bookmark.Args.p_note",
    from: "string",
    to: "string | null",
    why: "null is how a caller says the bookmark has no note",
  },
  {
    path: "Functions.create_channel.Args.p_topic",
    from: "string",
    to: "string | null",
    why: "null is how a caller creates a channel with no topic",
  },
  {
    path: "Functions.create_property_group.Args.p_property_id",
    from: "string",
    to: "string | null",
    why: "null is how a caller creates a group not tied to a property",
  },
  {
    path: "Functions.create_property_group.Args.p_topic",
    from: "string",
    to: "string | null",
    why: "null is how a caller creates a group with no topic",
  },
  {
    path: "Functions.mark_outbox.Args.p_error",
    from: "string",
    to: "string | null",
    why: "null is how the worker records a send that did not fail",
  },
  {
    path: "Functions.mark_outbox.Args.p_provider_message_id",
    from: "string",
    to: "string | null",
    why: "null is how the worker records a send the provider gave no id for",
  },
  {
    path: "Functions.import_lead_customer.Args.p_phone",
    from: "string",
    to: "string | null",
    why: "a lead imported without a phone number passes null",
  },
  {
    path: "Functions.start_call.Args.p_parent_message_id",
    from: "string",
    to: "string | null",
    why: "null is how a caller places a call that is not a reply to a message",
  },
  {
    path: "Functions.set_channel_details.Args.p_description",
    from: "string",
    to: "string | null",
    why: "null is how a caller clears the description",
  },
  {
    path: "Functions.set_channel_details.Args.p_topic",
    from: "string",
    to: "string | null",
    why: "null is how a caller clears the topic",
  },

  // --- RETURNS TABLE columns ----------------------------------------------------------------
  // Postgres records no nullability for the columns of a RETURNS TABLE function, so the generator
  // has no choice but to call every one of them NOT NULL. Several are nullable in reality, and
  // the app would confidently dereference them.
  {
    path: "Functions.default_message_templates.Returns.description",
    from: "string",
    to: "string | null",
    why: "a template need not carry a description",
  },
  {
    path: "Functions.my_activity.Returns.emoji",
    from: "string",
    to: "string | null",
    why: "only a reaction row carries an emoji",
  },
  {
    path: "Functions.my_activity.Returns.parent_id",
    from: "string",
    to: "string | null",
    why: "an activity row for a top-level message has no parent",
  },
  {
    path: "Functions.my_activity.Returns.sender_id",
    from: "string",
    to: "string | null",
    why: "a system message has no sender",
  },
  {
    path: "Functions.my_conversations.Returns.archived_at",
    from: "string",
    to: "string | null",
    why: "a live conversation is not archived",
  },
  {
    path: "Functions.my_conversations.Returns.description",
    from: "string",
    to: "string | null",
    why: "a conversation need not carry a description",
  },
  {
    path: "Functions.my_conversations.Returns.last_message_at",
    from: "string",
    to: "string | null",
    why: "a conversation with no messages yet has no last message",
  },
  {
    path: "Functions.my_conversations.Returns.last_message_body",
    from: "string",
    to: "string | null",
    why: "a conversation with no messages yet has no last message",
  },
  {
    path: "Functions.my_conversations.Returns.last_message_kind",
    from: 'Database["public"]["Enums"]["message_kind"]',
    to: 'Database["public"]["Enums"]["message_kind"] | null',
    why: "a conversation with no messages yet has no last message",
  },
  {
    path: "Functions.my_conversations.Returns.last_message_sender_id",
    from: "string",
    to: "string | null",
    why: "a conversation with no messages yet has no last message",
  },
  {
    path: "Functions.my_conversations.Returns.last_read_at",
    from: "string",
    to: "string | null",
    why: "a conversation nobody has opened has never been read",
  },
  {
    path: "Functions.my_conversations.Returns.lead_category",
    from: "string",
    to: "string | null",
    why: "only a lead conversation carries a category (0034)",
  },
  {
    path: "Functions.my_conversations.Returns.name",
    from: "string",
    to: "string | null",
    why: "a DM has no name of its own; it is titled from its members",
  },
  {
    path: "Functions.my_conversations.Returns.owner_user_id",
    from: "string",
    to: "string | null",
    why: "a channel need not have an owner",
  },
  {
    path: "Functions.my_conversations.Returns.slug",
    from: "string",
    to: "string | null",
    why: "only a channel has a slug",
  },
  {
    path: "Functions.my_conversations.Returns.topic",
    from: "string",
    to: "string | null",
    why: "a conversation need not carry a topic",
  },
  {
    path: "Functions.my_threads.Returns.last_read_at",
    from: "string",
    to: "string | null",
    why: "a thread nobody has opened has never been read",
  },
  {
    path: "Functions.my_threads.Returns.last_reply_at",
    from: "string",
    to: "string | null",
    why: "a thread with no replies yet has no last reply",
  },
  {
    path: "Functions.my_threads.Returns.participant_ids",
    from: "string[]",
    to: "string[] | null",
    why: "a thread with no replies yet has no participants beyond its author",
  },
  {
    path: "Functions.my_threads.Returns.sender_id",
    from: "string",
    to: "string | null",
    why: "a system message has no sender",
  },
  {
    path: "Functions.search_messages.Returns.conversation_name",
    from: "string",
    to: "string | null",
    why: "a hit in a DM has no conversation name",
  },
  {
    path: "Functions.search_messages.Returns.sender_id",
    from: "string",
    to: "string | null",
    why: "a system message has no sender",
  },
  {
    path: "Functions.search_messages.Returns.sender_name",
    from: "string",
    to: "string | null",
    why: "a system message has no sender",
  },

  // --- Trigger-filled columns ----------------------------------------------------------------
  // The generator reads the column definition, which cannot see a trigger.
  {
    path: "Tables.conversation_members.Insert.member_side",
    from: "string",
    to: "string",
    optional: true,
    why: "NOT NULL with no default, filled by a BEFORE INSERT trigger (0018); every caller but add_property_contact relies on it",
  },
  {
    path: "Tables.conversation_members.Update.member_side",
    from: "string",
    to: "string",
    optional: true,
    why: "same trigger as the Insert above; an update that does not mention it keeps the trigger's value",
  },
];

/** The banner written at the top of the generated file. */
export const HEADER = `// GENERATED FILE — DO NOT EDIT.
//
// Written by \`pnpm db:types\` (scripts/gen-types.sh) from the hosted Supabase project, then
// corrected. Every hand edit made here is destroyed the next time that runs.
//
// The generator is wrong about three things, because Postgres does not record what it would need:
//
//   - The columns of a \`RETURNS TABLE\` function are all typed NOT NULL. Several are nullable in
//     reality — a conversation with no messages yet has a null last_message_at — so the app would
//     confidently dereference a null.
//   - An RPC argument with a DEFAULT comes back optional but never nullable, while passing null is
//     exactly how a caller says "no topic".
//   - conversation_members.member_side is NOT NULL with no default because a BEFORE INSERT trigger
//     fills it (0018); a trigger is invisible to the generator, so it marks the column required.
//
// Each correction is listed in CORRECTIONS in scripts/types-corrections.ts, which is where to
// change one. The type aliases at the foot of this file come from ALIASES in the same place.
`;

/** Re-exported shorthands for the rows and RPC results the app names most often. */
export const ALIASES = `export type Profile = Tables<"profiles">;
export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;
export type Pin = Tables<"pins">;
export type Attachment = Tables<"attachments">;
export type Reaction = Tables<"reactions">;
export type SavedItem = Tables<"saved_items">;
export type SidebarSection = Tables<"sidebar_sections">;
export type SidebarSectionItem = Tables<"sidebar_section_items">;
export type ConversationBookmark = Tables<"conversation_bookmarks">;
export type ApiKey = Tables<"api_keys">;
export type ScheduledMessage = Tables<"scheduled_messages">;
export type LinkPreview = Tables<"link_previews">;
export type ThreadSummary = Database["public"]["Functions"]["my_threads"]["Returns"][number];
export type SearchHit = Database["public"]["Functions"]["search_messages"]["Returns"][number];
export type NotificationOutbox = Tables<"notification_outbox">;
export type Call = Tables<"calls">;
export type CallRecording = Tables<"call_recordings">;
export type VoiceNumber = Tables<"voice_numbers">;
export type ConversationSummary = Database["public"]["Functions"]["my_conversations"]["Returns"][number];
export type ActivityItem = Database["public"]["Functions"]["my_activity"]["Returns"][number];
`;
