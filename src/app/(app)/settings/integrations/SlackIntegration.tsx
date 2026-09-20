"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  requestSlackDiscovery,
  retrySlackConversation,
  saveSlackSettings,
  setSlackConversationDecision,
  setSlackPaused,
  setSlackUserDecision,
  startSlackBackfill,
  syncSlackNow,
  type SlackActionResult,
} from "./actions";

/** The same class constants as the Monday card, so the two integrations read as one page. */
const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const secondary =
  "h-11 rounded-lg border border-line px-4 text-[15px] font-semibold text-ink hover:bg-hover disabled:opacity-60";
const card = "rounded-xl border border-line bg-card p-5";
/** The table controls: the same look, at row height. */
const rowInput =
  "h-8 w-full rounded-md border border-input-border bg-input px-2 text-[13px] text-ink outline-none focus:border-brand disabled:opacity-60";
const rowButton =
  "h-8 self-start rounded-md border border-line px-2.5 text-[13px] font-semibold text-ink hover:bg-hover disabled:opacity-60";

export interface SlackUserRow {
  slack_user_id: string;
  name: string | null;
  real_name: string | null;
  display_name: string | null;
  email: string | null;
  is_bot: boolean;
  is_app_user: boolean;
  is_restricted: boolean;
  is_ultra_restricted: boolean;
  deleted: boolean;
  decision: string;
  decision_source: string;
  resolved_display: string | null;
  profile_id: string | null;
  outcome: string | null;
  error: string | null;
}

export interface SlackChannelRow {
  slack_channel_id: string;
  name: string | null;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
  member_count: number;
  decision: string;
  skip_reason: string | null;
  decision_source: string;
  target_kind: string | null;
  property_address: string | null;
  address_guessed: boolean;
  conversation_id: string | null;
  status: string;
  imported_messages: number;
  imported_replies: number;
  imported_files: number;
  skipped_files: number;
  member_outcomes: Record<string, string>;
  last_error: string | null;
  next_sync_at: string | null;
  last_synced_at: string | null;
  completed_at: string | null;
  attempts: number;
}

/** An existing conversation a channel can be linked to. */
export interface LinkTarget {
  id: string;
  name: string | null;
  slug: string | null;
  type: string;
}

interface Props {
  tokenSet: boolean;
  enabled: boolean;
  actorUserId: string;
  teamId: string | null;
  teamName: string | null;
  skipNamePatterns: string[];
  importBotMessages: boolean;
  paused: boolean;
  discoverRequestedAt: string | null;
  discoveredAt: string | null;
  backfillRequestedAt: string | null;
  backfillCompletedAt: string | null;
  admins: { id: string; display_name: string }[];
  users: SlackUserRow[];
  channels: SlackChannelRow[];
  conversations: LinkTarget[];
  files: { pending: number; dead: number };
}

const USER_DECISIONS: [string, string][] = [
  ["link", "Link to their account here"],
  ["invite_team", "Invite as a team member (emails them)"],
  ["create_customer", "Customer account, dormant"],
  ["create_team", "Team account, dormant"],
  ["create_bot", "Bot profile"],
  ["skip", "Skip"],
];
const USER_DECISION_LABEL: Record<string, string> = Object.fromEntries(USER_DECISIONS);
const USER_DECISION_SHORT: Record<string, string> = {
  link: "to link",
  invite_team: "to invite",
  create_customer: "customers to create",
  create_team: "team accounts to create",
  create_bot: "bots",
  skip: "to skip",
};
/** Before the backfill the outcome column holds why the decision was made; after it, what happened. */
const USER_OUTCOMES: Record<string, string> = {
  slackbot: "Slackbot",
  already_linked: "Already linked",
  email_match: "Email matches an account here",
  bot: "Bot or app",
  guest: "Guest, so a customer",
  guest_deleted: "Deleted guest",
  no_email: "No email on Slack",
  deleted: "Deleted from Slack",
  domain_review: "Email outside the team domain — check",
  team_member: "Team member",
  linked: "Linked",
  invited: "Invited — login details emailed",
  created: "Created, dormant",
  updated: "Updated",
  skipped: "Skipped",
  error: "Failed",
};
const USER_OUTCOME_SHORT: Record<string, string> = {
  linked: "linked",
  invited: "invited",
  created: "created",
  updated: "updated",
  skipped: "skipped",
  error: "failed",
};
const CHANNEL_STATUS: Record<string, string> = {
  discovered: "Discovered",
  ready: "Queued",
  members: "Adding members",
  history: "Reading history",
  files: "Downloading files",
  bookmarks: "Bookmarks",
  complete: "Complete",
  error: "Failed",
  skipped: "Skipped",
  paused: "Paused",
};
const CHANNEL_STATUS_SHORT: Record<string, string> = {
  discovered: "discovered",
  ready: "queued",
  members: "adding members",
  history: "reading history",
  files: "downloading files",
  bookmarks: "bookmarks",
  complete: "complete",
  error: "failed",
  skipped: "skipped",
  paused: "paused",
};
const CHANNEL_STATUS_ORDER = Object.keys(CHANNEL_STATUS);
const IN_FLIGHT = new Set(["ready", "members", "history", "files", "bookmarks"]);
const CHANNEL_DECISION_SHORT: Record<string, string> = {
  pending: "pending",
  create: "to create",
  link: "to link",
  skip: "to skip",
};
const SKIP_REASONS: Record<string, string> = {
  archived: "archived",
  test: "test channel",
  not_visible: "not visible to the token",
  manual: "by hand",
};
const TARGET_KINDS: [string, string][] = [
  ["internal", "Internal channel"],
  ["owner", "Customer group"],
  ["property", "Property group"],
];
const TARGET_KIND_LABEL: Record<string, string> = Object.fromEntries(TARGET_KINDS);
const CONFLICTS = new Set(["member_conflict", "external_in_internal"]);

const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function tally<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** One line of the progress card: "3 to link · 2 to invite", zeros left out. */
function Counts(props: {
  label: string;
  counts: Record<string, number>;
  order: string[];
  names: Record<string, string>;
}) {
  const parts = props.order.filter((k) => props.counts[k]).map((k) => `${props.counts[k]} ${props.names[k] ?? k}`);
  return (
    <div className="flex gap-3 text-[14px]">
      <dt className="w-20 shrink-0 text-ink-dim">{props.label}</dt>
      <dd className="text-ink">{parts.length ? parts.join(" · ") : "—"}</dd>
    </div>
  );
}

function UserRow({ user }: { user: SlackUserRow }) {
  const router = useRouter();
  const [decision, setDecision] = useState(user.decision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = !user.profile_id;
  // An invite sends a real email the moment the backfill starts; an address outside the team
  // domain is someone the rules could not place. Both want a look before that.
  const attention = editable && (user.outcome === "domain_review" || user.decision === "invite_team");
  const flags = [
    user.is_restricted || user.is_ultra_restricted ? "guest" : null,
    user.is_bot || user.is_app_user ? "bot" : null,
    user.deleted ? "deleted" : null,
  ].filter(Boolean);

  const change = async (next: string) => {
    setDecision(next);
    setBusy(true);
    setError(null);
    const result = await setSlackUserDecision(user.slack_user_id, next);
    setBusy(false);
    if (!result.ok) {
      setDecision(user.decision);
      setError(result.error ?? "That could not be saved.");
      return;
    }
    router.refresh();
  };

  const name = user.resolved_display || user.real_name || user.display_name || user.name || user.slack_user_id;
  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <p className={`truncate text-[14px] ${attention ? "text-danger" : "text-ink"}`} title={user.slack_user_id}>
          {name}
        </p>
        <p className="truncate text-[13px] text-ink-dim" title={user.email ?? undefined}>
          {user.email ?? "no email"}
          {flags.length ? ` · ${flags.join(", ")}` : ""}
        </p>
      </td>
      <td className="py-2 pr-3">
        {editable ? (
          <select
            value={decision}
            onChange={(e) => void change(e.currentTarget.value)}
            disabled={busy}
            aria-label={`Decision for ${name}`}
            className={rowInput}
          >
            {USER_DECISIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[13px] text-ink">{USER_DECISION_LABEL[user.decision] ?? user.decision}</p>
        )}
        {user.decision_source === "manual" && <p className="mt-0.5 text-[12px] text-ink-dim">set by hand</p>}
        {error && <p className="mt-0.5 text-[12px] text-danger">{error}</p>}
      </td>
      <td className="py-2">
        <p className={`text-[13px] ${user.outcome === "error" || attention ? "text-danger" : "text-ink"}`}>
          {user.outcome ? (USER_OUTCOMES[user.outcome] ?? user.outcome) : "—"}
        </p>
        {user.error && <p className="mt-0.5 text-[12px] break-words text-danger">{user.error}</p>}
      </td>
    </tr>
  );
}

interface ChannelRowProps {
  channel: SlackChannelRow;
  /** Conversations no channel is linked to yet, plus this channel's own target. */
  targets: LinkTarget[];
  personName: (slackUserId: string) => string;
}

function ChannelRow({ channel, targets, personName }: ChannelRowProps) {
  const router = useRouter();
  const [decision, setDecision] = useState(channel.decision);
  const [targetKind, setTargetKind] = useState(channel.target_kind ?? "internal");
  const [conversationId, setConversationId] = useState(channel.conversation_id ?? "");
  const [busy, setBusy] = useState<"save" | "retry" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editable = channel.status === "discovered" || channel.status === "skipped";
  const dirty =
    decision !== channel.decision ||
    (decision !== "skip" && targetKind !== (channel.target_kind ?? "internal")) ||
    (decision === "link" && conversationId !== (channel.conversation_id ?? ""));
  const conflicts = Object.entries(channel.member_outcomes).filter(([, outcome]) => CONFLICTS.has(outcome));
  const noProfile = Object.values(channel.member_outcomes).filter((outcome) => outcome === "no_profile").length;
  const target = targets.find((t) => t.id === channel.conversation_id);
  const counted = channel.imported_messages + channel.imported_replies + channel.imported_files + channel.skipped_files;

  const save = async () => {
    setBusy("save");
    setError(null);
    const result = await setSlackConversationDecision({
      slackChannelId: channel.slack_channel_id,
      decision,
      targetKind: decision === "skip" ? null : targetKind,
      conversationId: decision === "link" ? conversationId || null : null,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "That could not be saved.");
      return;
    }
    router.refresh();
  };

  const retry = async () => {
    setBusy("retry");
    setError(null);
    const result = await retrySlackConversation(channel.slack_channel_id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "That could not be queued.");
      return;
    }
    router.refresh();
  };

  const decided =
    channel.decision === "pending"
      ? "Pending — members not read yet"
      : channel.decision === "skip"
        ? `Skip${channel.skip_reason ? ` (${SKIP_REASONS[channel.skip_reason] ?? channel.skip_reason})` : ""}`
        : channel.decision === "link"
          ? `Link to #${target?.slug ?? target?.name ?? "a group"} · ${TARGET_KIND_LABEL[channel.target_kind ?? ""] ?? "internal channel"}`
          : `Create · ${TARGET_KIND_LABEL[channel.target_kind ?? ""] ?? "internal channel"}`;

  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <p className="truncate text-[14px] text-ink" title={channel.slack_channel_id}>
          #{channel.name ?? channel.slack_channel_id}
        </p>
        <p className="text-[13px] text-ink-dim">
          {channel.is_private ? "private" : "public"}
          {channel.is_archived ? " · archived" : ""}
          {channel.member_count ? ` · ${plural(channel.member_count, "member", "members")}` : ""}
          {channel.property_address
            ? ` · ${channel.property_address}${channel.address_guessed ? " (guessed)" : ""}`
            : ""}
        </p>
        {conflicts.length > 0 && (
          <p className="mt-0.5 text-[12px] text-danger" title={conflicts.map(([id]) => id).join(", ")}>
            {plural(conflicts.length, "member conflict", "member conflicts")}:{" "}
            {conflicts.map(([id]) => personName(id)).join(", ")}
          </p>
        )}
        {noProfile > 0 && <p className="mt-0.5 text-[12px] text-ink-dim">{noProfile} without a profile here</p>}
      </td>
      <td className="py-2 pr-3">
        {editable && channel.decision !== "pending" ? (
          <div className="flex flex-col gap-1">
            <select
              value={decision}
              onChange={(e) => setDecision(e.currentTarget.value)}
              disabled={busy !== null}
              aria-label={`Decision for #${channel.name ?? channel.slack_channel_id}`}
              className={rowInput}
            >
              <option value="create">Create</option>
              <option value="link">Link to an existing group</option>
              <option value="skip">Skip</option>
            </select>
            {decision !== "skip" && (
              <select
                value={targetKind}
                onChange={(e) => setTargetKind(e.currentTarget.value)}
                disabled={busy !== null}
                aria-label="Kind of group"
                className={rowInput}
              >
                {TARGET_KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            {decision === "link" && (
              <select
                value={conversationId}
                onChange={(e) => setConversationId(e.currentTarget.value)}
                disabled={busy !== null}
                aria-label="Group to link to"
                className={rowInput}
              >
                <option value="">Choose a group…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.slug ?? t.name ?? t.id}
                    {t.type === "owner" ? " (customer group)" : ""}
                  </option>
                ))}
              </select>
            )}
            {dirty && (
              <button type="button" onClick={() => void save()} disabled={busy !== null} className={rowButton}>
                {busy === "save" ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-ink">{decided}</p>
        )}
        {channel.decision_source === "manual" && <p className="mt-0.5 text-[12px] text-ink-dim">set by hand</p>}
        {error && <p className="mt-0.5 text-[12px] text-danger">{error}</p>}
      </td>
      <td className="py-2">
        <p className={`text-[13px] ${channel.status === "error" ? "text-danger" : "text-ink"}`}>
          {CHANNEL_STATUS[channel.status] ?? channel.status}
          {channel.attempts > 0 && channel.status !== "error" ? ` · attempt ${channel.attempts + 1}` : ""}
        </p>
        {counted > 0 && (
          <p className="mt-0.5 text-[12px] text-ink-dim">
            {channel.imported_messages} messages · {channel.imported_replies} replies · {channel.imported_files} files
            {channel.skipped_files ? ` (${channel.skipped_files} skipped)` : ""}
          </p>
        )}
        {channel.last_synced_at && (
          <p className="mt-0.5 text-[12px] text-ink-dim">synced {when(channel.last_synced_at)}</p>
        )}
        {channel.last_error && <p className="mt-0.5 text-[12px] break-words text-danger">{channel.last_error}</p>}
        {channel.status === "error" && (
          <button type="button" onClick={() => void retry()} disabled={busy !== null} className={`${rowButton} mt-1`}>
            {busy === "retry" ? "Queuing…" : "Retry"}
          </button>
        )}
      </td>
    </tr>
  );
}

/** Pending first — those are the ones still changing — then the ones awaiting review, then failures. */
function channelRank(c: SlackChannelRow): number {
  if (c.decision === "pending") return 0;
  if (c.status === "discovered") return 1;
  if (c.status === "error") return 2;
  return 3;
}

export function SlackIntegration(props: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [enabled, setEnabled] = useState(props.enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (formData: FormData) => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const result = await saveSlackSettings(formData);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error ?? "That could not be saved.");
      return;
    }
    setSaved(true);
    router.refresh();
  };

  const run = async (key: string, action: () => Promise<SlackActionResult>) => {
    setBusy(key);
    setNote(null);
    const result = await action();
    setBusy(null);
    setNote(
      result.ok
        ? { ok: true, text: result.message ?? "Done." }
        : { ok: false, text: result.error ?? "That did not work." },
    );
    if (result.ok) router.refresh();
  };

  const { users, channels } = props;
  const usersByDecision = tally(users, (u) => u.decision);
  const usersByOutcome = tally(users, (u) => (u.outcome && USER_OUTCOME_SHORT[u.outcome] ? u.outcome : null));
  const byStatus = tally(channels, (c) => c.status);
  const byDecision = tally(channels, (c) => c.decision);
  const pending = byDecision.pending ?? 0;
  const inFlight = channels.filter((c) => IN_FLIGHT.has(c.status)).length;
  const complete = byStatus.complete ?? 0;
  const errors = byStatus.error ?? 0;
  const waiting = channels.filter(
    (c) => c.status === "discovered" && (c.decision === "create" || c.decision === "link"),
  ).length;
  const invites = users.filter((u) => !u.profile_id && u.decision === "invite_team").length;
  const discoveryDue =
    !!props.discoverRequestedAt && (!props.discoveredAt || props.discoverRequestedAt > props.discoveredAt);
  const lastSync = channels.reduce<string | null>(
    (m, c) => (c.last_synced_at && (!m || c.last_synced_at > m) ? c.last_synced_at : m),
    null,
  );
  const nextSync = channels.reduce<string | null>(
    (m, c) => (c.status === "complete" && c.next_sync_at && (!m || c.next_sync_at < m) ? c.next_sync_at : m),
    null,
  );

  let hint: string;
  if (!props.tokenSet) hint = "SLACK_USER_TOKEN is not set, so nothing can run until it is.";
  else if (!props.enabled) hint = "The import is switched off. Save it on above, then Discover.";
  else if (!props.actorUserId) hint = "Choose which admin the import acts as, save, then Discover.";
  else if (props.paused) hint = "Paused: the worker does nothing until you resume it.";
  else if (discoveryDue)
    hint = "Discovery requested — the worker picks it up within a minute. Refresh to see what it found.";
  else if (!props.discoveredAt)
    hint = "Discovery hasn't run. Discover lists the workspace's people and channels here and changes nothing.";
  else if (pending)
    hint = `${plural(pending, "channel", "channels")} still pending — the worker is reading their members.`;
  else if (inFlight)
    hint = `Backfill running: ${complete} of ${complete + inFlight + errors} channels complete${errors ? `, ${errors} failed` : ""}.`;
  else if (waiting)
    hint = `Review the tables below, then Start backfill: ${plural(waiting, "channel", "channels")} waiting${
      invites ? `, and ${plural(invites, "person", "people")} marked to invite will get a real email` : ""
    }.`;
  else if (errors)
    hint = `${plural(errors, "channel", "channels")} failed — the error is in the table. Retry once it is dealt with.`;
  else if (complete) hint = `All channels complete; catching up daily${nextSync ? `, next ${when(nextSync)}` : ""}.`;
  else hint = "Nothing is set to be imported. Choose create or link on a channel below, then Start backfill.";

  const linkedIds = new Set(channels.map((c) => c.conversation_id).filter((id): id is string => !!id));
  const names = new Map(
    users.map((u) => [
      u.slack_user_id,
      u.resolved_display || u.real_name || u.display_name || u.name || u.slack_user_id,
    ]),
  );
  const personName = (id: string) => names.get(id) ?? id;
  const sortedChannels = [...channels].sort(
    (a, b) =>
      channelRank(a) - channelRank(b) || (a.name ?? a.slack_channel_id).localeCompare(b.name ?? b.slack_channel_id),
  );

  return (
    <div className="mx-auto w-full max-w-[760px] border-t border-line px-4 pt-8 pb-8">
      <h2 className="font-display mb-1 text-[22px] font-bold text-ink">Slack</h2>
      <p className="mb-6 text-[14px] text-ink-dim">
        Slack — the workspace&apos;s channels and their history come across once, then a daily catch-up keeps them
        current until the team stops using Slack.
      </p>

      <form action={submit} className={`${card} mb-5`}>
        <p className="mb-3 text-[14px] text-ink-dim">
          Discover lists every channel and member and proposes what to do with each; nothing is written until you start
          the backfill. Direct messages are not included. Nobody is emailed except a Slack member invited as a new team
          member, who gets their login details; everyone else arrives dormant, to be given access from People when the
          time comes.
        </p>
        <ul className="mb-4 space-y-1 text-[13px]">
          <li className={props.tokenSet ? "text-ink-dim" : "text-danger"}>
            SLACK_USER_TOKEN is {props.tokenSet ? "set" : "not set"}
          </li>
          <li className="text-ink-dim">
            Workspace:{" "}
            {props.teamName || props.teamId
              ? `${props.teamName ?? "unknown"}${props.teamId ? ` (${props.teamId})` : ""}`
              : "not discovered yet"}
          </li>
        </ul>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={props.enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            className="mt-1 size-4 accent-brand"
          />
          <span>
            <span className="block text-[15px] font-semibold text-ink">Import from Slack</span>
            <span className="block text-[14px] text-ink-dim">
              While this is off the worker does nothing — discovery, the backfill and the daily catch-up all wait.
            </span>
          </span>
        </label>

        <div className="mt-5">
          <label htmlFor="slack-actor" className="mb-1.5 block text-[14px] font-semibold text-ink">
            Acts as
          </label>
          <select id="slack-actor" name="actor_user_id" defaultValue={props.actorUserId} className={input}>
            <option value="">Choose an admin…</option>
            {props.admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            Groups and accounts are created by this person, as if they had done it by hand, and they are added to every
            imported room. An admin, because the account functions the import calls are admin-only.
          </p>
        </div>

        <div className="mt-5">
          <label htmlFor="slack-skip" className="mb-1.5 block text-[14px] font-semibold text-ink">
            Channels to skip
          </label>
          <input
            id="slack-skip"
            name="skip_name_patterns"
            defaultValue={props.skipNamePatterns.join(", ")}
            placeholder="test, example-channel"
            className={input}
          />
          <p className="mt-1.5 text-[13px] text-ink-dim">
            Channel names, comma separated, matched whole and ignoring case. Applied at discovery; a decision changed by
            hand below is kept.
          </p>
        </div>

        <label className="mt-5 flex items-start gap-3">
          <input
            type="checkbox"
            name="import_bot_messages"
            defaultChecked={props.importBotMessages}
            className="mt-1 size-4 accent-brand"
          />
          <span>
            <span className="block text-[15px] font-semibold text-ink">Import messages posted by bots and apps</span>
            <span className="block text-[14px] text-ink-dim">
              Off, posts from Slack apps are left out; what people wrote is imported either way.
            </span>
          </span>
        </label>

        {saveError && <p className="mt-4 text-[14px] text-danger">{saveError}</p>}
        {saved && !saveError && <p className="mt-4 text-[14px] text-ink-dim">Saved.</p>}
        <button type="submit" disabled={saving} className={`${primary} mt-5`}>
          {saving ? "Saving…" : enabled ? "Save and keep it on" : "Save"}
        </button>
      </form>

      <div className={`${card} mb-5`}>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Progress</h2>
        <p className="mb-3 text-[14px] text-ink">{hint}</p>
        <dl className="space-y-1">
          <Counts
            label="People"
            counts={usersByDecision}
            order={USER_DECISIONS.map(([value]) => value)}
            names={USER_DECISION_SHORT}
          />
          <Counts
            label="Outcomes"
            counts={usersByOutcome}
            order={Object.keys(USER_OUTCOME_SHORT)}
            names={USER_OUTCOME_SHORT}
          />
          <Counts label="Channels" counts={byStatus} order={CHANNEL_STATUS_ORDER} names={CHANNEL_STATUS_SHORT} />
          <Counts
            label="Decisions"
            counts={byDecision}
            order={Object.keys(CHANNEL_DECISION_SHORT)}
            names={CHANNEL_DECISION_SHORT}
          />
          <Counts
            label="Files"
            counts={{ pending: props.files.pending, dead: props.files.dead }}
            order={["pending", "dead"]}
            names={{ pending: "waiting", dead: "given up on" }}
          />
        </dl>
        <p className="mt-3 text-[13px] text-ink-dim">
          Last discovery: {props.discoveredAt ? when(props.discoveredAt) : "never"}
          {discoveryDue ? " (requested again)" : ""} · Backfill:{" "}
          {props.backfillRequestedAt ? `requested ${when(props.backfillRequestedAt)}` : "not requested"}
          {props.backfillCompletedAt ? `, completed ${when(props.backfillCompletedAt)}` : ""} · Last sync:{" "}
          {lastSync ? when(lastSync) : "never"}
        </p>

        {note && <p className={`mt-3 text-[14px] ${note.ok ? "text-ink-dim" : "text-danger"}`}>{note.text}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void run("discover", requestSlackDiscovery)}
            disabled={busy !== null}
            className={primary}
          >
            {busy === "discover" ? "Requesting…" : "Discover"}
          </button>
          <button
            type="button"
            onClick={() => void run("backfill", startSlackBackfill)}
            disabled={busy !== null}
            className={secondary}
          >
            {busy === "backfill" ? "Queuing…" : "Start backfill"}
          </button>
          <button
            type="button"
            onClick={() => void run("sync", syncSlackNow)}
            disabled={busy !== null}
            className={secondary}
          >
            {busy === "sync" ? "Queuing…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={() => void run("pause", () => setSlackPaused(!props.paused))}
            disabled={busy !== null}
            className={secondary}
          >
            {busy === "pause" ? "Saving…" : props.paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <div className={`${card} mb-5`}>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">People</h2>
        <p className="mb-3 text-[14px] text-ink-dim">
          Everyone in the workspace and what becomes of them. A decision can be changed until an account exists for the
          person. Rows in red want a look: an invite sends a real email when the backfill starts.
        </p>
        {users.length === 0 ? (
          <p className="text-[14px] text-ink-dim">Nothing discovered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed border-collapse">
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-[34%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-[12px] font-semibold text-ink-dim">
                  <th className="pb-1.5 pr-3 font-semibold">Person</th>
                  <th className="pb-1.5 pr-3 font-semibold">Decision</th>
                  <th className="pb-1.5 font-semibold">Reason / outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <UserRow key={u.slack_user_id} user={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={card}>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Channels</h2>
        <p className="mb-3 text-[14px] text-ink-dim">
          Every channel the token can see. Create makes a new group here; link puts the history into a group that
          already exists; skip leaves it in Slack. A decision can be changed until the channel is queued.
        </p>
        {channels.length === 0 ? (
          <p className="text-[14px] text-ink-dim">Nothing discovered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed border-collapse">
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-[32%]" />
                <col className="w-[32%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-[12px] font-semibold text-ink-dim">
                  <th className="pb-1.5 pr-3 font-semibold">Channel</th>
                  <th className="pb-1.5 pr-3 font-semibold">Decision</th>
                  <th className="pb-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedChannels.map((c) => (
                  <ChannelRow
                    key={c.slack_channel_id}
                    channel={c}
                    targets={props.conversations.filter((t) => !linkedIds.has(t.id) || t.id === c.conversation_id)}
                    personName={personName}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
