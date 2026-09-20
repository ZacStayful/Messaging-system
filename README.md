# Stayful Messaging

Owner and team messaging for Stayful: the Slack replacement described in the internal
"Owner Messaging Platform" spec. This repository holds the first pass, the **full-stack
foundation**: a Next.js app that reproduces the Claude Design prototypes, backed by
Supabase (Postgres with Row Level Security, Auth, Realtime Broadcast, Storage).

## What is in this pass

- Sign in with email + password (customers get a generated password by email when the team
  creates their account), an email magic link, or Google (Supabase Auth). Sessions persist.
- Desktop layout: top bar, icon rail (Home, DMs, Activity, Files, Later),
  sidebar and conversation pane on the dark green frame (dark theme only).
- Mobile layout: single pane with a bottom tab bar (Home, DMs, Activity, You).
- Direct messages list with unread toggle, filter, presence dots, draft indicator.
- Home sidebar with the "Customers" groups and recent DMs.
- Activity feed (mentions, new members, messages).
- Conversation pane: day dividers, red "New" marker, rich text (headings, bullet lists,
  links, @mention chips), composer with drafts, optimistic send with retry, internal notes
  for team accounts, live updates over Supabase Realtime, read state.
- Message actions (hover, or focus on mobile): emoji reactions with counts, pin/unpin, edit
  and delete your own messages (customers within 15 minutes, team any time), all live over
  Realtime.
- Attachments: photos, PDFs, Office files, audio and video up to 50 MB via the `+` menu,
  drag-and-drop or paste; camera capture on phones; inline photo previews, file cards,
  signed download links. Voice notes recorded in the browser with an inline player.
- Composer helpers: `@` mention picker (display names with spaces are stored as
  `@[Nigel Hyde]`), emoji picker, formatting hint.
- New message flow: pick one person for a DM, several for a group DM, or (team) create a
  named customer group or internal channel.
- Search: the top-bar "Search Stayful" box (and a search icon on mobile) opens `/search`,
  covering messages (Postgres full-text via `search_messages`, RLS-scoped), people and files;
  results deep-link to the message (`?m=<id>`). The magnifier in a conversation header opens
  in-conversation search with highlighted matches and next/previous.
- Bookmarks (`0015_conversation_bookmarks.sql`): a scrolling row of link chips under the
  conversation header plus a Bookmarks tab, for the third-party sites and important information a
  group needs often — a listing, a cleaning rota, a shared folder, a gate code in the note field.
  Any member can add one (http/https only, never a private or local address — the rule lives in
  `src/lib/urls.ts` and is shared with `/api/unfurl`, with a CHECK constraint as the backstop);
  pasting a link offers to fill the title from its Open Graph data. The team can reorder and
  remove anything, a customer can edit their own. Changes reach everyone live over a `BOOKMARK`
  broadcast on the conversation topic. Also available over the API and MCP.
- Every customer group carries two required bookmarks — the quarterly review call and Stayful
  Intelligence — applied on creation and backfilled onto existing groups. They cannot be removed
  or re-pointed from the app, the REST API or MCP. Growing or changing the set is an INSERT or
  UPDATE on `bookmark_templates`, which fans out to every group with no deploy.
- Pins tab (jump to message, unpin), Files and links tab (newest/oldest), details modal with
  editable topic and description, member add/remove/leave, rename and archive (team).
- Header menus: notification level (all / mentions / nothing) per conversation, mute, star,
  copy link, leave, archive; top-bar History (recent conversations) and Help sheet; collapsible
  sidebar sections; archived groups hidden behind a toggle and read-only.
- Activity filters: Mentions, Threads (replies), Reactions, plus mark-all-read.
- Sidebar row menus (right-click or the hover "⋯"): mark as read, star, mute, notification
  level, move to section, copy link, leave and archive (team), on every conversation list
  including the customer view.
- Sidebar sections you make yourself (`0039_sidebar_sections.sql`): every other heading in the
  sidebar is computed — Starred from the membership row, Customers and Channels from the
  conversation type, the lead sub-lists from `profiles.lead_category` — so none of them can say
  "these six are what I am working on this week". **New section** names one, and a group is filed
  into it by dragging the row onto it with the mouse; dropping it back on Customers or Channels
  takes it out again. Filed groups leave the computed list they came from so nothing appears
  twice, and starring still wins, because starring means "keep this where I can see it". Sections
  are private to one person, like starring and muting: organising your own sidebar never moves
  anyone else's. Dragging is mouse-only, so the row menu's **Move to section** is the same action
  by keyboard and on a phone. Deleting a section never hides a group — its contents fall back to
  the section they are computed into.
- People and presence: profile cards on any avatar or name (role, custom status, local time,
  Message / Copy email), a People directory for the team (`/people`), profile editing (names,
  photo to the public `avatars` bucket, time zone), custom status with an expiry, pause
  notifications (DND), and away-after-10-minutes presence. Profile changes reach everyone live
  through a `profile_changed` broadcast on the org topic (`0012_profile_presence.sql`).
- Manual **Away** (`0014_manual_away.sql`): set yourself away from the status sheet, the You
  sidebar or `/away` (`/away 1h`, `/away off`). Everyone sees an Away badge — including while your
  tab is closed, because it is stored on the profile rather than derived from the idle timer — and
  every notification stops until you clear it: no notification emails (the SQL trigger and the
  cron worker both check it) and no rail or tab-bar badges. Unread counts and the activity feed
  keep accruing, so nothing is lost while you are away; you are simply not nagged about it. Away
  implies DND, so pausing notifications stays available separately for silence without looking
  away. Note that team accounts never receive notification emails in the first place
  (`enqueue_message_notifications` is customer-only), so for a team member Away changes the
  visible badge and the in-app badges only.
- Later: save any message (bookmark action), In progress / Archived / Completed tabs, reminders
  (20 min to next week) that surface as a badge on the Later rail item when due.
- Files: workspace-wide list of everything shared in your conversations with Media / Documents /
  Voice notes chips and search; each row opens the file in its chat.
- Timeline polish: consecutive messages from one sender within 5 minutes collapse Slack-style
  (time on hover), and a "N new messages" pill appears when messages arrive while scrolled up.
- Composer: formatting toolbar (Aa) and shortcuts for bold, italic, strikethrough, inline code,
  code blocks, quotes, bulleted and numbered lists and links; slash commands (`/status`, `/dnd`,
  `/shrug`, `/mute`, `/dm`, `/search`, `/topic`, `/invite`, `/leave`, `/collapse`); schedule a
  message for tomorrow, Monday or a custom time (posted by the minute cron); typing indicator;
  ↑ edits your last message.
- Link previews: the first external link in a message unfurls to an Open Graph card via
  `/api/unfurl` (signed-in only, no private hosts, cached a week in `link_previews`).
- Keyboard: Ctrl/⌘+K quick switcher for conversations and people, Alt+↑/↓ previous/next
  conversation, Shift+Esc mark everything read. The Help popover lists them all.
- Threads: "Reply in thread" on any message, a side panel (full screen on mobile) with its own
  composer, reply counts under the parent, a Threads view (team) listing every thread you
  follow with unread counts, and deep links (`?thread=<parent>` or `?m=<reply>`).
- Customers get a simplified shell: their groups and direct messages with people in those
  groups, nothing else (team routes return 404 for customer accounts).
- Admins add team members from the workspace menu (`/team/new`).
- Account page: change password, email notification preference, sign out.
- Team: "Invite a customer" creates the account, adds them to groups and emails the login details.
- Email notifications (D8): every customer-visible message is queued in `notification_outbox`;
  a Vercel cron drains it through Resend (grouping messages within two minutes), with a
  signed one-click unsubscribe link.
- Several Stayful numbers: each account manager connects their own mobile, and a customer group
  owns one of them, so the customer's phone shows one continuous conversation rather than a chat
  per person who replied. A new group takes its creator's number, falling back to the default.
  A number we have not seen registers itself the first time it receives a message. Replies land
  in the customer's group whichever of our numbers they reach — their number identifies them,
  ours is only the doorway — and which one they used is recorded on the message.
- WhatsApp out: the same outbox carries a `whatsapp` row for anyone who switched it on and has a
  verified mobile. One message, one WhatsApp — no batching window, with a per-run cap instead.
  If a send runs out of retries the email version is queued in its place and an internal-only
  note appears in the group so the team can fix the number.
- WhatsApp in: TimelinesAI posts to `/api/whatsapp/inbound/<WHATSAPP_WEBHOOK_TOKEN>`; the number
  identifies the customer and the reply lands in their group as a normal message from them
  (`sent_via = whatsapp`). Anything unroutable — an unknown number, an archived group — is
  recorded in `inbound_messages_unmatched` and still answered 200, because a 4xx only makes
  the provider retry a message that was never going to route. Inbound email now does the same.
- Reply by email: notification emails carry `Reply-To: reply+<token>@<EMAIL_REPLY_DOMAIN>`;
  Resend Inbound posts replies to `/api/email/inbound`, which stores them in the same
  conversation as the customer (`sent_via = email`).
- Multi-tenant schema (`org_id` everywhere), customer vs team accounts and roles, RLS
  policies for every table, audit log table, private attachments bucket.
- Seed data reproducing the prototype (`supabase/seed.sql`).
- Tests: unit (formatting, rich text), RLS suite against the live project, Playwright smoke
  tests on desktop and mobile including two-user realtime delivery.

- Public REST API at `/api/v1` with scoped API keys managed at `/settings/api`, and a remote
  MCP server at `/api/mcp` so Claude, n8n or Zapier can read conversations, create groups,
  invite people, post messages and manage bookmarks. Both act as a real team member, so nothing
  an integration does escapes that person's own access. See "Public API" below.

- Monday.com sync: a new Contact on the Clients board becomes two groups — the customer's own
  group, opening with the standard welcome message, and a property group carrying a **Cleaning**
  and a **Maintenance** thread. It ships **switched off**: deliveries are received and logged with
  no side effects until an admin turns it on at `/settings/integrations`. See "Monday.com" below.
- Lead database customers (`0034_lead_database_customers.sql`): the people on the "Stayful Lead
  database enquiries" board are put on file — one group each, an account that cannot sign in,
  nothing sent — so their WhatsApp messages, the replies typed to them on the phone, and their
  emails are kept in one thread per person. Filed under **Lead database customers** in the
  sidebar, split into **Airbnb management leads** and **R2R leads**. See "Lead database
  customers" under Monday.com below.
- Message templates (`0023_message_templates.sql`): the welcome message lives in
  `message_templates` and is edited at `/settings/templates`, with `{{customer_name}}`-style
  placeholders and a live preview. Editing it changes what the next group opens with; it never
  rewrites what a customer has already read.
- Service contacts: a cleaner or contractor registered on a property thread (Details → Service
  contacts) gets an account, their login details by email, and — with a UK mobile on file — their
  WhatsApp filed into that property's thread. Their replies reach the team, and the team's replies
  in the thread reach them.
- Filing: any message can be moved into a thread in the same conversation, or filed into a
  property's Cleaning or Maintenance thread from elsewhere (a copy, credited to whoever sent it,
  linked back to the original).

Out of scope for this pass (next passes): staff inbox with SLA, email attachments,
huddles/calls, canvases, digest emails, Uplisting sync, per-property routing of inbound
maintenance WhatsApp, outgoing webhooks. Slack import shipped in the next pass — see "Slack" below.

## Stack

Next.js 16 (App Router, React 19, TypeScript), Tailwind CSS v4, Supabase (`@supabase/ssr`),
pnpm, Vitest, Playwright. Deployed on Vercel (project `messaging-system`).

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in the values below
pnpm dev                     # http://localhost:3000
```

Environment variables (`.env.local`, also set in Vercel):

| Variable                               | Purpose                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                                                                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key                                                                                       |
| `NEXT_PUBLIC_SITE_URL`                 | Public URL of the deployment, used for auth redirects                                                                 |
| `SEED_TEST_PASSWORD`                   | Only for the test-suites; the password given to the two seeded test accounts                                          |
| `RESEND_API_KEY`                       | Resend API key; without it accounts are still created and the password is shown to the team member instead of emailed |
| `EMAIL_FROM`                           | Sender, e.g. `Stayful <noreply@stayful.co.uk>` (domain verified in Resend)                                            |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server only. Used by the cron worker, unsubscribe links and the inbound email webhook                                 |
| `CRON_SECRET`                          | Random string. Vercel sends it to the cron route; it also signs unsubscribe links                                     |
| `EMAIL_REPLY_DOMAIN`                   | Optional. Subdomain receiving replies (MX at Resend), e.g. `reply.stayful.co.uk`                                      |
| `RESEND_WEBHOOK_SECRET`                | Optional. `whsec_…` secret of the Resend webhook for `email.received`                                                 |
| `EMAIL_CAPTURE_ADDRESS`                | Optional. Address on the receiving domain Gmail forwards to; mail there is filed for lead-database customers          |
| `TIMELINES_API_TOKEN`                  | TimelinesAI public API token. Also sends the first-login verification code, so sign-in degrades without it            |
| `TIMELINES_WHATSAPP_ACCOUNT_ID`        | Optional fallback only. The sending number comes from the group's `whatsapp_accounts` row (0022)                      |
| `TIMELINES_API_BASE`                   | Optional. Overrides the API base, e.g. a local stub in tests                                                          |
| `TIMELINES_DRY_RUN`                    | Local and test only. `1` makes every WhatsApp send succeed without a request                                          |
| `WHATSAPP_WEBHOOK_TOKEN`               | Secret path segment of the inbound webhook URL. TimelinesAI publishes no signature scheme                             |
| `WHATSAPP_WEBHOOK_SECRET`              | Optional second factor: when set, an `x-stayful-token` header must match too                                          |
| `WHATSAPP_MAX_PER_RUN`                 | Optional. Caps WhatsApp sends per cron run (default 60), since WhatsApp does not batch                                |
| `SUPABASE_JWT_SECRET`                  | Server only. Required by the REST API and MCP server: each request is signed as the key's user (see below)            |
| `MONDAY_WEBHOOK_TOKEN`                 | Secret path segment of the Monday webhook URL. Monday's board-level recipes send an unsigned POST                     |
| `MONDAY_WEBHOOK_SECRET`                | Optional second factor: when set, an `x-stayful-token` header must match too                                          |
| `MONDAY_API_TOKEN`                     | Monday API token, read-only use. Without it the webhook logs the delivery and does nothing else                       |
| `MONDAY_CLIENTS_BOARD_ID`              | Optional. Defaults to `4972230367`; an event from any other board is logged and ignored                               |
| `MONDAY_LEADS_BOARD_ID`                | Optional. Defaults to `18420649520`, the lead database board the import reads                                         |
| `TWILIO_ACCOUNT_SID`                   | Twilio account. All six Twilio variables are required or the Call button does not render                              |
| `TWILIO_AUTH_TOKEN`                    | Signs Twilio's webhooks. The only thing that can verify one really came from Twilio                                   |
| `TWILIO_API_KEY_SID`                   | Signs the browser's short-lived Voice access token. The auth token cannot do this                                     |
| `TWILIO_API_KEY_SECRET`                | The other half of the API key. Shown once at creation; a lost secret means a new key                                  |
| `TWILIO_TWIML_APP_SID`                 | The TwiML App the browser SDK dials through                                                                           |
| `TWILIO_WEBHOOK_TOKEN`                 | Secret path segment of the Twilio webhook URLs. Invent it — Twilio issues no such token                               |
| `TWILIO_DRY_RUN`                       | Optional. `1` composes every call and places none                                                                     |

## Database

Migrations live in `supabase/migrations` and are applied in order:

1. `0001_schema.sql` tables, enums, bookkeeping triggers, profile-on-signup trigger
2. `0002_rls.sql` helper functions, policies, RPCs (`my_conversations`, `my_activity`,
   `mark_read`, `dm_between`)
3. `0003_realtime.sql` broadcast trigger and `realtime.messages` policies
4. `0004_storage.sql` private `attachments` bucket and policies
5. `0005_hardening.sql` advisor fixes (search_path, grants, indexes, per-statement auth)
6. `0006_customer_accounts_notifications.sql` `create_customer_account`, `reset_customer_password`,
   `notification_outbox` + trigger, welcome-email helpers
7. `0007_reply_by_email.sql` `email_reply_threads`, unique inbound email ref
8. `0008_pgcrypto_search_path.sql` account RPCs find `crypt`/`gen_salt` in `extensions`
9. `0009_slack_essentials.sql` full-text search column + `search_messages`, `attachments.meta`,
   `create_group_dm`, `create_channel`, realtime broadcasts for reactions/pins/attachments
10. `0010_slack_parity.sql` threads (`reply_count`, `thread_follows`, `my_threads`, `mark_thread_read`),
    `saved_items`, `scheduled_messages`, `link_previews`, channel RPCs (`rename_channel`,
    `set_channel_details`, `archive_channel`, `add_members`, `remove_member`), `create_team_account`,
    notify-level aware `my_conversations`/`my_activity`, `conversation_changed` realtime events,
    profile status/DND columns, public `avatars` bucket
11. `0011_thread_fixes.sql` replies inherit an internal parent's visibility and cannot target
    messages the sender cannot read; messages update policy no longer self-references (soft
    delete works again), immutable columns guarded by trigger
12. `0012_profile_presence.sql` `profile_changed` broadcast trigger on `profiles`
13. `0013_profiles_update_policy.sql` profiles update policy without self-reference (status, name and
    photo edits work again); role / account type / email changes guarded by trigger (admin only)
14. `0014_manual_away.sql` manual away (`presence_mode`, `away_since`, `away_until`); away implies
    do-not-disturb inside `enqueue_message_notifications`; away travels on the `profile_changed`
    broadcast so everyone sees the badge live
15. `0015_conversation_bookmarks.sql` `conversation_bookmarks` with pins-mirrored RLS,
    `add_bookmark` / `move_bookmark`, and a `BOOKMARK` realtime broadcast
16. `0016_api_keys.sql` `api_keys` (sha256 hashes, scopes, revoke), `api_rate_limits` +
    `api_rate_hit`, and a partial unique index on `meta->>'client_id'` for idempotent posting
17. `0017_api_key_last_used.sql` `api_rate_hit` also stamps `api_keys.last_used_at`, because the
    separate `api_touch_key` call was an un-awaited promise that serverless dropped before it
    ran; that function is now unused and dropped
18. `0018_phone_and_member_sides.sql` `profiles.phone` (verified by code, guarded against direct
    writes), `phone_verifications`, `conversation_members.member_side`, and the trigger enforcing
    one customer group per external member
19. `0019_outbox_channels.sql` `notification_outbox` gains `channel`, `recipient_phone` and
    `fallback_from`; `enqueue_message_notifications` emits one row per channel the external
    participant has switched on; `whatsapp_threads` records which group we last messaged
    someone from
20. `0020_whatsapp_inbound.sql` unique `external_ref` for WhatsApp so a redelivered webhook is
    one message, and `inbound_messages_unmatched` so nothing a customer sends is dropped
    silently on either channel
21. `0021_mandatory_bookmarks.sql` `bookmark_templates` plus `is_mandatory`/`template_key` on
    `conversation_bookmarks`; every customer group gets the quarterly review call and Stayful
    Intelligence automatically, and a guard trigger stops either being removed or re-pointed
22. `0022_whatsapp_accounts.sql` `whatsapp_accounts` (one per account manager's mobile) and
    `conversations.whatsapp_account_id`; a new customer group takes its creator's number, so a
    customer always sees the same one
23. `0023_message_templates.sql` `message_templates` + `render_message_template`, seeded with the
    customer welcome message; `default_message_templates()` is the single source of that text, and
    a trigger seeds both catalogues for organisations created later (which `0021` did not, so a
    fresh stack had no mandatory bookmarks either)
24. `0024_properties_and_threads.sql` `properties` (and at last a foreign key for
    `conversations.property_id`), `property_threads`, `property_contacts`, `create_property_group`,
    `add_property_contact`, `ensure_maintenance_channel`, `next_available_slug`; widens
    `create_customer_account` to accept the `cleaner` and `contractor` roles
25. `0025_whatsapp_thread_routing.sql` `whatsapp_threads` is keyed on `(user_id, conversation_id)`
    and records the thread, so one cleaner can serve several properties
26. `0026_integrations.sql` `integrations` (the master switch, off by default), `monday_events`
    (every delivery, deduped on Monday's own event id) and `monday_links` (what an item produced)
27. `0027_move_message.sql` `move_message` and `file_message_to_property`, and the narrowing of
    `messages_guard_update` that lets `parent_id` change inside them and nowhere else
28. `0028_tenant_guards.sql` the org guard on the three `security definer` functions that took a
    `p_org` and believed it (`render_message_template`, `next_available_slug`,
    `ensure_maintenance_channel`)
29. `0029_security_fixes.sql` sign-up metadata is only honoured behind `app.trusted_signup`;
    `conversation_id` pinned in the `conversation_members` update policy and the scheduled-message
    update policy given the same predicates as its insert; internal notes broadcast on
    `conversation-internal:<id>`, which requires `is_team()`; `notification_outbox.claimed_at` so
    the stranded-row rescue keys on the claim rather than on when the row was queued
30. `0030_tenant_and_audit_fixes.sql` `link_previews` scoped to an organisation (it was
    `using (true)`, so one tenant could read every link another had posted); the org check
    `remove_member` was missing on its `is_admin()` branch; `edited_at`, `sent_via` and
    `external_ref` added to `messages_guard_update`, so the "(edited)" marker cannot be erased
    on its own; `org_id` on `monday_events` and `inbound_messages_unmatched`, whose policies
    asked only "are you team?"
31. `0031_reply_expiry_and_scheduled_claim.sql` `email_reply_threads.expires_at` (30 days from
    last use, refreshed at both ends — the token is a bearer credential printed in every
    notification, and the inbound webhook carries no DKIM result to check instead — superseded by
    0036, which makes the token perishable instead);
    `scheduled_messages.claimed_at`, so the cron claims a message before posting it rather than
    after, and a claimed row can no longer be edited or cancelled underneath the send

32. `0032_calls.sql` `calls` and `call_recordings` (a separate table, not a column, so a customer
    can see that a call happened without being able to play back the team discussing them),
    `voice_numbers` (which of our numbers a call goes out from — one row today, one per account
    manager later without a migration), and `start_call`
33. `0033_voice_inbound.sql` `inbound_messages_unmatched.channel` widened to accept `'voice'`
    (it is a plain CHECK from 0020 that knew only the two channels existing then),
    `messages_external_ref_voice_idx` so a redelivered voicemail is one message rather than two
    — the third of these after email (0007) and WhatsApp (0020) — and a fixed `search_path` on
    `topic_internal_conversation_id`, which the linter had flagged since 0029
34. `0034_lead_database_customers.sql` `profiles.lead_category` and `profiles.portal_access`,
    `import_lead_customer` (an account with no known password and `auth.users.banned_until` far
    in the future, so nobody can sign in; email off, WhatsApp on), `my_conversations` gains
    `lead_category`, and `enqueue_message_notifications` ignores a message with
    `meta.mirrored = true` — one captured from a channel, which the other party already has

35. `0035_rate_limit_sweep.sql` an index on `api_rate_limits.window_start` and a sampled sweep
    inside `api_rate_hit`, which used to run a sequential-scan delete on **every** API request —
    the limiter's own housekeeping helping to cause the timeouts that made the limiter fail open
36. `0036_reply_tokens_single_use.sql` reply tokens become perishable: `unique (user_id,
conversation_id)` dropped so there is one token per notification email rather than one per
    pair, `used_at` added for single use, and the expiry cut to seven days **from issue** and no
    longer refreshed — a forwarded notification used to be a working way in indefinitely

37. `0037_outbox_dead_status.sql` `'dead'` joins the `notification_outbox` status CHECK, so a
    notification given up on after five attempts is a state rather than an absence — it used to
    be left as `failed`, indistinguishable from one that will be retried next minute — plus the
    missing index on `org_id`

38. `0038_outbox_dispatched_at.sql` `notification_outbox.dispatched_at`, written immediately
    before every provider call. The claim (0029) stops two runs sending the same row; this is what
    survives one run dying between the provider accepting a message and the UPDATE recording it.
    Email then retries under a Resend `Idempotency-Key`; WhatsApp, which has no such mechanism,
    reads the chat's recent outbound history before it resends
39. `0039_sidebar_sections.sql` `sidebar_sections` and `sidebar_section_items`, the sidebar
    sections a person makes for themselves and what they have filed into them. Both are private to
    one user and shaped after `saved_items` (0010): plain `user_id = auth.uid()` policies, with the
    insert and update `WITH CHECK` on the items proving the section is yours and that you are in
    the conversation. No column on `conversation_members`, whose update policy does not restrict
    which columns move (which is what 0029 was about), and so no change to `my_conversations()`

40. `0040_rate_limit_token_bucket.sql` the token bucket 0016 said was the real answer, replacing
    its fixed window. A fixed window lets a key spend its whole allowance at 10:00:59 and the whole
    of it again at 10:01:00 — twice the limit inside two seconds, with every window counted
    correctly. A bucket has no boundary to sit on: one row per key, refilling continuously at
    limit/window a second and capped at limit, so an idle key keeps its burst but a busy one cannot
    exceed the refill rate. The per-window rows go, and with them the sweep 0016 added and 0035 had
    to sample down — a bucket row is removed by its key's own cascade. `api_rate_hit` keeps its
    signature, so the migration and the deploy can land in either order
41. `0041_read_state_broadcast.sql` read state reaches the same person's other devices. All three
    read markers — `conversation_members.last_read_at`, `thread_follows.last_read_at` and
    `profiles.activity_seen_at` — moved in silence, so reading on a phone left the badge lit on the
    laptop until that tab reloaded. Four triggers publish `read_state`, `thread_read_state` and
    `activity_seen` to the reader's own `user:<id>` topic. Triggers rather than a broadcast inside
    `mark_read`, because there are three writers: `messages_after_insert` moves the mark when you
    send, and the UPDATE policy has no column list, so a client can PATCH the column directly.
    Whether anything is still unread is decided in the trigger and shipped as a boolean
42. `0042_slack_sync.sql` the Slack import: `profiles.slack_user_id`, `slack_users` and
    `slack_conversations` (what discovery found and what was decided about each, reviewable before
    anything is written), `slack_messages` (Slack's `(channel, ts)` → a message, which is how a
    reply finds its parent and how a re-read is diffed), `slack_files` (the download queue; the
    only unique key `attachments` gets), `slack_leases`; the three `import_slack_*` writers, each
    idempotent on Slack's own ids and each raising the transaction-local `app.bulk_import` flag
    that every broadcast function — the six from 0009/0010/0029 and the three from 0041 — now
    checks first, so a three-year backfill sends nothing to nobody; `add_property_anchors`,
    `mark_slack_deleted`, the claim / finish / lease functions the worker uses, and
    `grant_portal_access` for cutover. Two fixes ride along: `properties_monday_item_idx` was
    partial and PostgREST cannot target a partial index, so the Monday upsert had failed silently
    since 0024; and `next_available_slug` ignored archived rows while the unique index includes
    them. Asserted in `supabase/verify/checks/0042_slack_sync.sql`

Apply them with the Supabase CLI (`supabase db push`) or the Supabase MCP `apply_migration`.
After every migration regenerate types: `pnpm db:types`.

### Seed

`supabase/seed.sql` creates the Stayful organisation, the team and customer users from the
design prototype, the conversations, messages and pins. Replace `__TEST_PASSWORD__` with a
random value before running it and put the same value in `.env.local` as
`SEED_TEST_PASSWORD`. Only the two `*@stayful.test` accounts get a password; everyone else
signs in with a magic link or Google.

Locally: `supabase start && supabase db reset` (runs migrations and the seed).

### How access works

- Every row carries `org_id`. Users belong to exactly one organisation.
- `profiles.account_type` is `team` or `customer`; `role` refines it. New sign-ups get a
  team account when their email domain is listed in `organisations.settings.team_domains`
  (currently `stayful.co.uk`), otherwise a customer account with access to nothing until
  they are added to a group.
- Conversations are `owner` groups, `internal` channels, `dm`, `group_dm` or `job`.
  Membership (`conversation_members`) is what grants access; RLS checks it on every table.
- Messages have `visibility = public | internal`. Internal notes are never returned to
  customer accounts, including over Realtime and in the sidebar previews.
- Customers can only open DMs with team members who share a group with them
  (`dm_between`).

## Realtime

A trigger on `messages` broadcasts the full row to the private topic
`conversation:<id>` (events `INSERT`/`UPDATE`) and a light `message_created` event to every
member's `user:<id>` topic. Reactions, pins and attachments broadcast `REACTION`, `PIN` and
`ATTACHMENT` events on the same conversation topic. Presence runs on `org:<id>`. Clients
back-fill from Postgres after any reconnect.

`user:<id>` also carries this person's own read state, so a conversation read on one device clears
its badge on the others: `read_state`, `thread_read_state` and `activity_seen`
(`0041_read_state_broadcast.sql`). These are the only events a device receives about itself —
there is no sender to compare against, so the device that did the reading gets its own event back
and reconciles `last_read_at` to the server's clock rather than its own. Whether anything is still
unread is decided in the trigger and arrives as `has_unread`, so the client does no timestamp
arithmetic. The rules for applying them are in `src/lib/realtime/readState.ts`.

## Attachments

Files live in the private `attachments` bucket at
`<org_id>/<conversation_id>/<message_id>/<random>-<file name>`; storage policies check
conversation membership from the path. The browser inserts the message first, uploads each file,
then inserts an `attachments` row (`meta` holds image dimensions or `duration_ms`/`voice` for
voice notes). Downloads use one-hour signed URLs.

## Auth configuration (Supabase dashboard)

- Authentication > URL configuration: Site URL `https://chat.stayful.co.uk`; add
  `https://chat.stayful.co.uk/auth/callback`, `http://localhost:3000/auth/callback` and the
  Vercel preview pattern `https://*-zacs-projects-bcdb6016.vercel.app/auth/callback` to the
  redirect allow list.
- That wildcard is deliberately broad and should be narrowed once previews sit on a stable
  host (see "Preview deployments and Chrome's password warning" under Deployment). The
  `.vercel.app` arm of `siteOrigin()` in `src/app/auth/callback/route.ts` should be tightened
  to that host at the same time.
- Authentication > Providers > Google: enable and paste a Google OAuth client ID and
  secret (authorised redirect URI is `https://dqgdhmlgojhiidxlxzsr.supabase.co/auth/v1/callback`).
- Magic links only work for existing users (`shouldCreateUser: false`); invitations create
  the user first. Google sign-in creates users on first login.

## Email set-up (Resend)

1. Create a Resend account, add and verify `stayful.co.uk` (Domains), create an API key and set
   `RESEND_API_KEY` and `EMAIL_FROM` in Vercel.
   Also point Supabase Auth at Resend so magic links and password resets are not limited to the
   built-in 2-per-hour quota: Authentication > SMTP settings, host `smtp.resend.com`, port `465`,
   user `resend`, password = the API key, sender `Stayful <noreply@stayful.co.uk>`.
2. Set `SUPABASE_SERVICE_ROLE_KEY` and a random `CRON_SECRET` in Vercel. `vercel.json` schedules
   `/api/cron/notifications` every minute; Vercel adds the `Authorization: Bearer <CRON_SECRET>`
   header automatically when `CRON_SECRET` is set.
3. Reply by email: in Resend, enable Receiving for a subdomain such as `reply.stayful.co.uk`
   (add the MX record it gives you), then create a webhook for `email.received` pointing at
   `https://chat.stayful.co.uk/api/email/inbound`. Set `EMAIL_REPLY_DOMAIN` and
   `RESEND_WEBHOOK_SECRET`. Replies are stripped of quoted history, matched to the customer by
   the token in the To address, and rejected if the From address differs from the account email.
4. Lead-database customers get no notification emails, so nothing they send carries a token.
   Create a second address on the same receiving domain (say `capture@reply.stayful.co.uk`),
   set it as `EMAIL_CAPTURE_ADDRESS`, and in Gmail add a filter that forwards mail from those
   contacts to it. Mail arriving there with no token is filed by sender into the lead's group
   (`src/lib/email/capture.ts`). Replies sent from Gmail are not seen by a forward; an
   automation reading the mailbox can post both directions to `POST /api/email/capture` (see
   "Public API").

## Monday.com

A new Contact on the Clients board (`4972230367`) becomes two groups. **It ships switched off.**

### What it creates

|            | Customer group                                                                       | Property group                                      |
| ---------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Type       | `owner`                                                                              | `internal` — the customer never sees it             |
| Name       | the client's name, slugified (`#rohana-bakhshi`), matching every group already there | the address, slugified and truncated                |
| Topic      | the Property Address (`text_mm12z1ka`)                                               | the client's name                                   |
| Opens with | the `customer_welcome` template, rendered                                            | a **Cleaning** and a **Maintenance** anchor, pinned |

"Threads" are replies to those two anchors, and `property_threads` records which anchor is which.
The customer group also picks up the two mandatory bookmarks from `0021` on the way in, because
that happens on every `conversations` insert.

No account is created and nobody is emailed: inviting the customer stays a deliberate, manual
step at `/customers/new`. Nothing is written back to Monday, and no existing client is touched —
the webhook only ever acts on items created after it is switched on.

### Setting it up

1. Set `MONDAY_WEBHOOK_TOKEN` and `MONDAY_API_TOKEN` (and optionally `MONDAY_WEBHOOK_SECRET`).
2. On the Clients board: **Integrate → Webhooks → "When an item is created"**, sending a web
   request to `https://chat.stayful.co.uk/api/monday/webhook/<MONDAY_WEBHOOK_TOKEN>`. Monday
   verifies the URL with a one-off `{"challenge": "…"}` POST, which the route echoes back.
3. At `/settings/integrations` (admin), choose the team member the integration **acts as**, tick
   who should join every new group, and list any board groups to ignore — Dropped being the
   obvious one.
4. Watch **Recent deliveries** on that page. With the switch off, creating a test Contact in
   Monday shows up there within seconds and creates nothing. That is the point: the wiring can be
   proved before a real customer is involved.
5. Turn the switch on.

### Why it acts as a person

Every RPC it needs (`create_channel`, `create_property_group`) gates on `is_team()` and
`auth.uid()`, both null for the service role. Rather than a service-role bypass — a second copy
of the authorisation rules, the thing the REST API exists to avoid — the webhook mints a token
for `integrations.config.actor_user_id` with the same `mintUserToken` the API uses. Groups it
creates have a real `created_by`, the welcome message has a real author, and `audit_log` names a
person. The service role is used for exactly two things: writing `monday_events`, and posting a
contractor's message into a channel they are deliberately not a member of.

### Idempotency

Monday retries, recipes get re-fired, and a replayed payload arrives with a fresh event id. Two
things catch it: a unique index on `monday_events.event_id`, and `monday_links` keyed on the
Monday item id, which is checked before anything is created. Re-delivering the same item is a
no-op that returns the ids it made the first time.

### Lead database customers

The other board, "Stayful Lead database enquiries" (`18420649520`), holds the people who signed
up to the lead resale service. Two of its groups are paying customers, and those two are what
**Settings → Integrations → Lead database → Import now** reads:

| Monday group                              | Filed as                | `profiles.lead_category` |
| ----------------------------------------- | ----------------------- | ------------------------ |
| `group_mm5f9by1` Management customer      | Airbnb management leads | `airbnb_management`      |
| `group_mm64kqtg` Guaranteed rent customer | R2R leads               | `r2r`                    |

For each person the import creates a customer group named after them (topic: category,
properties, plan, enquiry date, website) and an account — and that is where it stops. **Nobody
is emailed, WhatsApped or given a way in.** Specifically (`import_lead_customer`, 0034):

- the password is random and discarded, and `auth.users.banned_until` is set to 2999, which
  Supabase Auth honours for every sign-in method (password, magic link, Google);
  `profiles.portal_access = false` is the readable version of the same fact;
- `email_notifications = 'off'`: a notification email carries the login link;
- `whatsapp_notifications = 'instant'`: a reply typed in the app reaches them as a **plain**
  WhatsApp — just the text, no author line, no link — from the number the group was created
  with, which is the admin's own;
- the mobile comes from Monday (the phone column, else the free-text one, both run through the
  same UK-mobile rule as everywhere else) and is not verified; the first-login gate is marked
  skipped in case access is granted later;
- no welcome message is posted.

They appear in the sidebar under **Lead database customers**, split by category, and not under
Customers. Their group behaves like any other: WhatsApp from their number routes into it
(`customer_group`), and see the next section for what they are sent.

The import is safe to repeat. `monday_links` remembers the group and `profiles.monday_person_id`
the person, so a second run refreshes name, email and mobile. Each person produces a
`monday_events` row (`event_type = lead_import`) with one of: `created`, `updated`,
`skipped_no_email` (an account needs an address), `bad_phone` (imported, but the number on the
item is not a UK mobile — fix it in Monday and run again), `phone_conflict` / `email_conflict`
(already on another account) or `error`. A second address in the Email column is not kept;
mail from it shows up in `inbound_messages_unmatched`.

There is no "grant access" action yet. When one of them is ready to use the app, that means
clearing `banned_until`, setting `portal_access`, and sending login details — a small follow-up.

### Mirroring what the team types on the phone

The WhatsApp webhook drops every `direction = "sent"` message: the app's own notifications
come back through it, and storing one would post it, which notifies, which comes back. For a
lead-database customer, though, the conversation is happening on a phone, and a thread with
only their half is not a record of anything. So a sent message **to a lead-database customer**
is mirrored into their group (`src/lib/whatsapp/mirror.ts`, tested in `tests/mirror.test.ts`)
when it was not the app that sent it — decided by the TimelinesAI `message_uid` on the outbox
row, or failing that (the webhook can beat the drain to the database) an outbox row to that
number in the last ten minutes with the same text. It is posted as the team member whose
number it went from, carries `meta.mirrored = true` so it is never sent back out, and updates
`whatsapp_threads` so their next reply lands in the same place. Sent messages to anyone else
are dropped exactly as before.

For this to work the TimelinesAI webhook has to be subscribed to **sent** messages as well as
received ones, and the sending number has to be connected in the workspace.

### Cleaners, contractors and where their WhatsApp lands

A service contact is registered on a property thread from **Details → Service contacts**. That
one action creates their account (role `cleaner` or `contractor`), emails their login details,
adds them to the group as an external member, registers the routing row, and follows the thread
on their behalf — all five, because missing any one of them leaves a contact who looks registered
and never hears from us. WhatsApp routing needs a UK mobile (`profiles.phone` is `+447…` only).

Inbound then routes like this (`src/lib/whatsapp/routing.ts`, tested exhaustively in
`tests/routing.test.ts`):

| Who                                         | Where it lands                                                    |
| ------------------------------------------- | ----------------------------------------------------------------- |
| A cleaner on one property                   | that property's Cleaning thread                                   |
| A cleaner on several                        | whichever Cleaning thread we last messaged them from              |
| A cleaner on several we have never messaged | `inbound_messages_unmatched`, reason `ambiguous_cleaner`          |
| A maintenance contact                       | the central `#maintenance` channel, top level                     |
| A customer                                  | unchanged: the thread we last used, else their one customer group |

**Maintenance is deliberately not filed per property yet.** A contractor juggles several jobs at
once, so "who did we last message" is not good enough evidence to file a real job against an
address. Everything lands in one channel and a team member files it with the message action,
which copies it into the property's Maintenance thread still credited to whoever sent it, and
links the two together. Contractors are not members of that channel, so none of them can read
another's quotes.

Note that a contractor with an account **can see the property groups they are registered on**.
That is what having a real account means. Team conversation about a contractor belongs in an
internal note, which no customer-type account ever sees.

### Verifying migrations without Docker

`pnpm db:verify` applies the whole chain to a throwaway PostgreSQL cluster using
`supabase/verify/supabase_stub.sql` — the smallest fake of `auth`, `realtime` and `storage` that
lets the migrations run. It needs only the `postgresql-16` server package, which is why CI can
run it and `supabase start` cannot. It proves the SQL parses, the plpgsql bodies compile, the
constraints hold and the triggers fire; it is not a substitute for
`supabase start && supabase db reset` against the real thing.

It then asks whether `src/lib/database.types.ts` still describes the schema those migrations just
built. That question exists because `pnpm db:types` is safe to run but nothing makes anyone run it,
and **stale types fail nothing**: `tsc` is perfectly happy with a table it has never heard of,
because nothing references it. `0033` added `topic_internal_conversation_id` and the committed types
went eight migrations without it; six tables carried empty `Relationships` for as long.

It compares table, view, column, function and enum **names** in both directions, per-column
**nullability**, the **write shape** of `Insert` and `Update` (whether each field is required,
optional, or `never` for an identity column), **foreign keys** against the `Relationships` arrays,
and that every hand correction in `scripts/types-corrections.ts` is still applied — those live
outside the generated region, so a regeneration that dropped them all would otherwise pass clean.

The write-shape rule is the generator's, derived and then checked against all 337 columns: a field
is optional in `Insert` when the column has a default, is nullable, is an identity column or is
generated, and typed `never` when it is `GENERATED ALWAYS AS IDENTITY`; in `Update` everything is
optional. A column covered by a correction is exempt, because there the correction is the authority
and the corrections check already asserts it.

It deliberately does not compare Postgres-to-TypeScript type mappings: that mapping is a large table
inside the generator, and a second copy here would drift, showing up as a failing build on a correct
change. A pass therefore means nothing has been added, removed, made nullable, made required or
re-pointed without the types being regenerated — not that the file is byte-identical to what
`pnpm db:types` produces.

When it fails there are two possible causes and the message says both: the types are stale (run
`pnpm db:types`), or the hosted project has drifted from `supabase/migrations`, in which case
regenerating reproduces the drift and the migrations are what need to catch up.

### Regenerating the database types

`pnpm db:types` rebuilds `src/lib/database.types.ts` from the hosted project. It is safe to run:
nothing is written until the result has been corrected, formatted and passed `tsc --noEmit`, and
every failure before that leaves the file alone. The script it replaced was a shell redirect, which
emptied the file before it started — so a missing CLI destroyed it.

The generator is right about almost everything and wrong about three things, because Postgres does
not record what it would need: the columns of a `RETURNS TABLE` function are all typed NOT NULL, an
RPC argument is never nullable even though passing null is how a caller says "no topic", and
`conversation_members.member_side` is filled by a trigger the generator cannot see. Those
corrections live in `CORRECTIONS` in `scripts/types-corrections.ts`, alongside the type aliases the
app imports. **`src/lib/database.types.ts` is generated — edit the corrections, not the file.**

Corrections are resolved through the TypeScript AST by structural path, not by matching text, so
the generator's formatting can change without silently dropping one. Each must match exactly once,
and the script says which of three things went wrong:

| Message                                     | What it means                     | What to do                  |
| ------------------------------------------- | --------------------------------- | --------------------------- |
| `no such property`                          | the column was renamed or dropped | repoint or delete the entry |
| `already correct in the generator's output` | the CLI or the SQL improved       | retire the entry            |
| `expected X, found Y`                       | the column's type changed         | update `from` and `to`      |

The Supabase CLI is deliberately not a dependency — the npm package downloads a ~30 MB platform
binary on install, which every CI run would pay for a script CI never runs. The script uses
`SUPABASE_CLI` if set, then one already on `PATH`, then `pnpm dlx supabase@$SUPABASE_VERSION`.
Where there is no CLI and no `supabase login` — a sandbox, for instance — generate with the
Supabase MCP `generate_typescript_types` and pass the file as `GEN_TYPES_INPUT` instead; the
corrections and the typecheck still run.

## Slack

The Slack workspace, copied here so the move off Slack starts with everything already in place:
every channel with its members, topic and purpose, the whole history with threads, edits, reactions,
pins and files, and each channel's bookmarks. After the first import a worker catches up **once a
day**. Nothing is ever written to Slack, DMs and group DMs are not copied (later, once the move is
made), and nobody is contacted by the import except a team member who was not in the app yet — they
get a real login, as they would if added from the workspace menu. It ships **switched off**.

### The app in Slack

An internal app, created by an admin from `docs/slack-app-manifest.json` (api.slack.com → Create New
App → From a manifest → paste the file), installed to the workspace by an admin who is a member of
every channel worth copying. Its **user** token (`xoxp-…`, Install App → User OAuth Token) goes in
Vercel as `SLACK_USER_TOKEN`. A user token rather than a bot token because private channels are only
visible to a member of them, and a bot is a member of nothing until invited two hundred times; an
internal customer-built app also keeps the ordinary rate limits on `conversations.history`, which
Slack's 2025 change took away from distributed apps.

The scopes are all reads: `team:read`, `users:read`, `users:read.email`, `channels:read`,
`groups:read`, `channels:history`, `groups:history`, `channels:join` (public channels the admin is
not in are joined so they can be read), `files:read`, `reactions:read`, `pins:read`, `bookmarks:read`.

### Running it

Everything happens on `/settings/integrations`, under **Slack**, and in one worker,
`/api/cron/slack`, which runs every minute and does as much as fits in 45 seconds — discovery, the
user pass, the backfill and the daily catch-up are all the same loop, and it costs a few queries
when nothing is due. `pnpm slack:backfill` runs that loop from a laptop instead, at full speed, for
the first import.

1. Choose the team member the import **acts as** (an admin: the account functions it calls are
   admin-only), save, switch on.
2. **Discover.** The worker lists members and channels into `slack_users` and `slack_conversations`,
   reads every channel's member list, and decides what each becomes. Nothing is created.
3. **Review.** Two tables. People: guests become dormant customer accounts, an address that already
   has an account here is linked, a team member not here yet is invited for real (the rows that will
   send an email are highlighted), a full member outside the team domain is held dormant for a
   decision, bots and apps become deactivated profiles so their posts keep a name. Channels: one with
   a guest in it becomes a customer group; one whose name is an address becomes a property group with
   the Cleaning and Maintenance threads; a name an existing group already holds is **linked** so the
   history lands where the team already works (`#maintenance`, the Monday-created groups); the rest
   are internal channels; archived and test channels are skipped. Any of it can be changed per row.
4. **Start backfill.** The worker creates the people, then works one channel at a time: the
   conversation, its members, its history read backwards a page at a time with every thread's
   replies, its files, its bookmarks; then marks the whole history read for every member, so nobody
   opens the app to fifty thousand unread messages. Progress and errors are on the page; a channel
   that fails five times stops with its reason and a Retry button.
5. From then on each channel is caught up a day after it was last synced: new messages and the last
   hour again for edits and reactions, threads with a reply in the last thirty days, new members,
   topic and archive changes, files and bookmarks; once a week the last ninety days are re-read in
   full, which is when deletions are noticed. **Sync now** brings everything forward.

### What a message becomes

`sent_via = 'slack'`, `external_ref = '<channel>:<ts>'`, `created_at` from Slack's `ts` to the
microsecond, `edited_at` from Slack's edit time, `meta.mirrored = true` — the one flag
`enqueue_message_notifications` (0034) honours, so an imported message never emails or WhatsApps
anyone — and `meta.slack` with the original ids. Text is converted from mrkdwn
(`src/lib/slack/mrkdwn.ts`): `*bold*` becomes `**bold**`, `<@U…>` becomes an `@Name` mention chip
resolved through the imported people, `<#C…|name>` becomes plain `#name`, `<!here>` plain `@here`,
links become `[label](url)`, `:shortcode:` becomes the character (`src/lib/slack/emoji.json`,
regenerated with `pnpm slack:emoji`; a custom emoji stays as `:name:`), and Slack's entity escaping
is undone last so nothing typed literally becomes markup. App posts with no text are read from
their blocks. Join, leave, topic and rename lines become `kind = 'system'` messages.

Every object has one idempotency key, so any slice can be re-run: people on `slack_user_id`,
channels on `slack_channel_id`, messages on `(channel, ts)` in `slack_messages`, reactions and pins
on their primary keys, files on `(message_id, slack_file_id)`, bookmarks on
`template_key = 'slack:<id>'`. A re-read of a window compares each message and applies an edit; it
never removes a reaction or a pin, because a team member may have added one here since.

The backfill runs under a transaction-local `app.bulk_import` flag that every broadcast trigger
checks, so it fires no realtime events; the daily catch-up runs without it for small batches, so
open tabs update. `conversations.history` returns newest first, hence the two watermarks on each row:
the backfill walks backwards from `history_low_ts` and resumes exactly where a killed run stopped,
the catch-up walks forwards from `history_high_ts`.

### What it cannot do

- DMs and group DMs are not imported yet; only DMs the token's owner is party to are ever visible.
- Other people's read state is not available from Slack; the import marks everything read.
- Mentions here are by display name (`src/lib/richtext.ts`), so two people with the same first name
  in Slack are given distinct display names on import (`Sam` and `Sam W.`).
- `@here`, `@channel`, channel links and custom emoji have no equivalent here and land as text.
- A file the bucket refuses (a type outside its allow-list, or over 50 MB) is not silently absent:
  a `[file not imported: …]` line is appended to the message and `slack_files` says why.
- A day's cadence means an edit or reaction on a message older than the re-read window, or a reply
  on a thread quiet for more than thirty days, waits for the weekly pass.
- A guest in more than one channel meets the one-customer-group rule (0018); the second membership
  is recorded as `member_conflict` on the channel row for someone to resolve by hand.
- Property channels are recognised by their name matching an address in a customer channel's topic,
  or by looking like an address; a guess is marked `(guessed)` on the page and can be changed.

### Cutover

Imported guests cannot sign in until an admin presses **Grant access** on their row in the People
directory, which lifts the ban, sets a password and emails them their login details
(`grant_portal_access`). Team members invited by the import already have theirs. Leave the
integration on: the daily catch-up keeps the copy current for as long as Slack is still in use.

## Calling (Twilio)

A team member presses Call on a trade contact's thread, talks in the browser, and Twilio rings
that person's mobile. It is deliberately not the huddle: a huddle is team-to-team video and can
assume both sides have the app open, whereas a cleaner mid-changeover will never open anything.
Their phone has to ring like a phone.

TimelinesAI cannot do this. Its API sends and receives messages; there is no endpoint that places
a call, and the only call-shaped thing in it is a _read_ of calls that already happened on the
connected handset.

### Setting it up in the Twilio console

In this order — the first two gate everything else, and the bundle is not instant.

1. **Upgrade off trial.** A trial account only calls numbers verified one at a time.
2. **UK Regulatory Compliance bundle.** Phone Numbers → Regulatory Compliance → Bundles.
   Mandatory since 30 September 2024 before any UK number carries voice.
3. **Geo Permissions.** Voice → Settings → Geo Permissions → enable the United Kingdom. Twilio
   restricts outbound to the signup home country by default, and splits each country into low
   and higher risk ranges — UK mobile may be in the group that is off.
4. **Buy a number** with the Voice capability, and attach an **emergency address** to it on the
   number's own page. Still required for outbound even though the bundle no longer asks for it
   at creation; calls fail without it and the error does not say so.
5. **API key.** Account → API keys & tokens → Create → Standard. The secret is shown once.
6. **TwiML App.** Voice → Manage → TwiML Apps → Create. Copy the `AP…` SID.
7. Insert the number into `voice_numbers` with `is_default = true`.

### The two webhook URLs

There is no "create a webhook" step in Twilio and no key to collect from one: a webhook here is a
text box you paste a URL into. Twilio signs its requests with the **auth token** you already
have, so nothing is issued in exchange. Two fields, in two different places, because they are two
different directions of call:

| Where                         | Field             | URL                                           |
| ----------------------------- | ----------------- | --------------------------------------------- |
| Voice → TwiML Apps → your app | Voice Request URL | `/api/twilio/voice/<TWILIO_WEBHOOK_TOKEN>`    |
| Phone Numbers → your number   | A call comes in   | `/api/twilio/incoming/<TWILIO_WEBHOOK_TOKEN>` |

The status and recording callbacks are _not_ console settings — they are parameters the code
sends with each call, so they can carry the id of the call they belong to.

### How a call actually runs

Twilio does not know what to do with a call; it stops and asks. Outbound: the browser connects,
Twilio fetches TwiML from the Voice Request URL, our answer says the recording notice and dials
the contact, and afterwards Twilio posts what happened to the status callback, which writes a
`call_summary` message into the thread. Inbound is the same shape against the number's own URL:
greeting, record, and the finished voicemail is filed into the contact's thread.

Every webhook is checked twice: the secret path segment, and `X-Twilio-Signature` verified
against the auth token (`src/lib/twilio/signature.ts`, pinned in tests against Twilio's own
published vector). Unlike TimelinesAI and Monday, which publish no signature scheme, the
signature here is mandatory rather than an optional second factor.

`readSignedWebhook()` in `src/lib/twilio/webhook.ts` does both checks in one place, and fails
closed on a missing `TWILIO_AUTH_TOKEN` rather than following the "set means required" rule the
WhatsApp webhook's optional header secret uses — there the second factor is optional because
TimelinesAI's dashboard may not be able to send custom headers, whereas Twilio always signs.

| Route                                | Called by   | Does                                                      |
| ------------------------------------ | ----------- | --------------------------------------------------------- |
| `POST /api/twilio/token`             | the browser | mints a 10-minute Voice access token for a team member    |
| `POST /api/twilio/voice/{token}`     | Twilio      | the TwiML App's answer: notice, then `<Dial>` the contact |
| `POST /api/twilio/status/{token}`    | Twilio      | records how the call went, writes the `call_summary`      |
| `POST /api/twilio/recording/{token}` | Twilio      | stores the recording reference in `call_recordings`       |

Two things the TwiML route deliberately does not take from the request: the number to dial and
the caller ID. Both are read from the `calls` row `start_call()` created, because a `To` from the
POST body would let anything that reached the endpoint place a call anywhere in the world on
Stayful's account. It checks the dialling client's identity (`From=client:<profile id>`) against
`calls.started_by`, and refuses a row that already has a different call SID, so a signed request
cannot be replayed to ring someone twice.

The `call_summary` message carries `meta.client_id = call:<id>`, which `messages_client_id_idx`
makes unique per conversation — so a status callback Twilio retries writes one line, not two.

### Pressing Call

`@twilio/voice-sdk` is the only new production dependency in the feature; everything server-side
stays hand-rolled `fetch`. It lives behind `src/lib/twilio/device.ts`, so no component imports it
or knows a `Device` has a lifecycle — which matters because the SDK holds a WebSocket and a
microphone, and a component that forgets to destroy it leaves the mic light on.

Two settings are pinned rather than defaulted:

- **`edge: "dublin"`.** Twilio's public edges are `sydney, sao-paulo, dublin, frankfurt, tokyo,
singapore, ashburn, umatilla, roaming`. **There is no public London edge** — `london-ix` is a
  private Interconnect. The default `roaming` uses Global Low Latency routing and would usually
  pick Dublin for a browser in Britain, but a VPN or a bad geolocation silently anchors the media
  in Ashburn instead, which sounds like the other person keeps interrupting. Pinning it makes a
  latency complaint something that can be reasoned about.
- **`codecPreferences: ["opus", "pcmu"]`.** The SDK default is the other way round; opus first is
  audibly better on the laptop microphones these calls are actually made from.

**Who the button offers to call** is `callablePeople()` in `src/lib/calls/callable.ts`: members of
the thread other than you, with a mobile on file, who are not deactivated — and nobody at all
unless calling is configured and you are on the team. Membership rather than `property_contacts`,
because a cleaner is a member of the property group and a customer of their own, while a rule
written against `property_contacts` would refuse to call anyone in a DM. One callable person gets
one press; more than one opens a menu, because guessing between a cleaner and a contractor is the
kind of wrong that is only noticed once a stranger's phone is ringing.

`CallBar` docks above the composer rather than opening a modal, so the thread stays readable —
the last message is usually the reason for the call. It shows **the number as dialled**, not just
the name: contractor numbers are set by `set_customer_phone`, which leaves `phone_verified_at`
null, so a transposed digit calls a stranger from a number they can ring back.

Recordings are played through `/api/calls/[id]/recording`, which reads `call_recordings` on the
listener's own session so the `call recordings: team reads` policy decides, then streams from
Twilio with the account credentials attached. A customer in the group sees the summary line and
gets a 404. Twilio's own URL never reaches a browser, because anyone holding it can read it.

### Which number a call goes out from

`voice_numbers`, not an env var. A caller ID cannot be invented — Twilio only accepts a `From` it
sold you or that you verified, and since May 2023 Ofcom requires UK networks to block caller IDs
that are not valid, dialable and uniquely identifying. One row today; giving each account manager
their own number is then a row rather than a migration, exactly as `whatsapp_accounts` already
does for messaging. `calls.from_number` records the number used, so the history survives the
table changing.

Because the caller ID must be dialable, people will ring it back — so the number answers, plays a
greeting and takes a voicemail, which is routed into the right thread by the same `chooseRoute()`
that files inbound WhatsApp. A number that rings out forever looks like a real line and behaves
like a disconnected one.

`/api/twilio/incoming/{token}` answers the ring and `/api/twilio/voicemail/{token}` files what was
left. **Which organisation a ring-back belongs to is read from `To`, never from the caller**: at
that moment the caller is very often a stranger, while the number they dialled is one we bought,
which is what `voice_numbers` is for.

`gather()` lives in `src/lib/whatsapp/gather.ts` and is called by both inbound webhooks. WhatsApp
and voice ask the identical question — this number reached us, which thread does it belong to —
so they ask it once. An unroutable voicemail goes to `inbound_messages_unmatched` with
`channel = 'voice'` and the `RecordingSid` in `external_ref`, which the existing
`inbound_unmatched_ref_idx` turns into idempotency for nothing.

**A voicemail is the one case that inverts the recording rule above.** A call recording stays at
Twilio and is team-only, because it is a recording of the team. A voicemail is from the contact
and addressed to us, so it is copied into the `attachments` bucket and plays inline exactly like
the voice notes the composer produces. That is the first server-side write to storage in this
codebase (`src/lib/storage/ingest.ts`): the service role bypasses the storage policies, so the
object key is not a naming convention but the access rule itself — `storagePath()` puts the org in
segment 1 and the conversation in segment 2, and `0004_storage.sql` reads both back out. A wrong
path still uploads; the audio is simply unreadable by everyone in the thread, with no error.

**Who can be attributed.** `profiles.phone` is `+447…` only, so a UK landline or an overseas
caller can never be matched to an account however well we know them — a contractor ringing from
the office is always unmatched. Widening that means the four places named in `0018:26`.

### Recording

Both parties hear "This call is recorded for quality and record keeping" before they are
connected — UK law requires participants be informed, and an automated line is the only way that
happens on every call rather than when someone remembers. Recordings live in `call_recordings`,
which is a separate table from `calls` on purpose: a customer may see in their group that a call
happened without being able to play back the team discussing them. RLS is row-level, so a
stricter rule needs its own row.

**Retention is six months.** Recordings of conversations about named people are personal data,
and "keep for ever" is not defensible under UK GDPR. `/api/cron/retention` runs nightly at 03:00
(`vercel.json`) and deletes audio past the window: for a call recording, a `DELETE` to Twilio
followed by the `call_recordings` row; for a voicemail, the storage object and its attachment row.
The window is `RECORDING_RETENTION_DAYS` (default 180), so changing it is a setting rather than a
deploy, and an unreadable value falls back to the default rather than to zero — this job deletes
things and should never fail toward deleting more.

**The line in the thread survives the audio.** That a call happened, with whom and for how long,
is business record; the recording is the personal data. An expired voicemail keeps its message and
gains `meta.audio_expired`, which renders "Audio deleted after 180 days" where the player was — a
player that has quietly become a dead control reads as a bug rather than as a policy. Deleting the
message too would rewrite the history of a conversation six months after the fact, which is a
bigger thing than this job is for.

A recording Twilio refuses to delete keeps its row, because dropping it would lose the only handle
we have on audio that is still sitting in Twilio's account. The sweep runs again tomorrow.

## Public API

`/api/v1/*`, authenticated with an API key an admin creates at `/settings/api`. The plaintext
is shown once; only a sha256 hash is stored.

**A key acts as a real person.** It is bound to one active team member, and every request runs
with a 120-second token minted for them (`src/lib/api/jwt.ts`), so every RLS policy and every
`auth.uid()`-based RPC applies exactly as it does in the browser — there is no second copy of
the authorisation rules to drift. A key can therefore never see more than the person it acts
as. Messages it posts carry `sent_via = 'api'` and show a "via API" chip beside the timestamp,
so a conversation always shows who said what. Every write is recorded in `audit_log`.

This is why `SUPABASE_JWT_SECRET` is required: Supabase dashboard → **Project Settings → JWT
Keys** → the **Legacy JWT Secret** section → Reveal. Without it the API answers
`503 not_configured` rather than failing obscurely.

**Do not click "Migrate JWT secret" or rotate the keys on that page.** Requests are signed
HS256 with the legacy secret, so moving the project to asymmetric signing keys stops the REST
API and the MCP server at once, with 401s and no other symptom. The same is true if the secret
is rotated or revoked. Migrating is a fine thing to want — it just needs `src/lib/api/jwt.ts`
reworked to sign with the asymmetric private key first.

Scopes are checked per route: `conversations:read|write`, `messages:read|write`,
`members:write`, `bookmarks:read|write`, `users:read|invite`, `status:write`.

| Method           | Path                                          | Scope                                        |
| ---------------- | --------------------------------------------- | -------------------------------------------- |
| `GET`            | `/api/v1/me`                                  | —                                            |
| `PATCH`          | `/api/v1/me/status`                           | `status:write`                               |
| `GET` `POST`     | `/api/v1/conversations`                       | `conversations:read` / `conversations:write` |
| `GET` `PATCH`    | `/api/v1/conversations/{id}`                  | `conversations:read` / `conversations:write` |
| `GET` `POST`     | `/api/v1/conversations/{id}/messages`         | `messages:read` / `messages:write`           |
| `GET` `POST`     | `/api/v1/conversations/{id}/members`          | `conversations:read` / `members:write`       |
| `DELETE`         | `/api/v1/conversations/{id}/members/{userId}` | `members:write`                              |
| `GET` `POST`     | `/api/v1/conversations/{id}/bookmarks`        | `bookmarks:read` / `bookmarks:write`         |
| `PATCH` `DELETE` | `/api/v1/bookmarks/{id}`                      | `bookmarks:write`                            |
| `GET`            | `/api/v1/messages/{id}/replies`               | `messages:read`                              |
| `GET`            | `/api/v1/search?q=`                           | `messages:read`                              |
| `GET` `POST`     | `/api/v1/users`                               | `users:read` / `users:invite`                |
| `GET` `POST`     | `/api/email/capture`                          | `users:read` / `messages:write` (team key)   |
| `POST`           | `/api/whatsapp/capture`                       | `messages:write` (team key)                  |

Responses are `{"data": …}` or `{"error": {"code", "message"}}`, with codes `unauthorized`,
`forbidden`, `insufficient_scope`, `not_found`, `invalid_request`, `conflict`, `rate_limited`,
`not_configured` and `internal`. 600 requests per key per minute, as a token bucket in Postgres
(`0040`): a key that has been idle can spend the whole allowance at once, and one that keeps going
settles at ten requests a second. A `rate_limited` response carries `retry-after` — one second when
you are simply going too fast, since that is how long an empty bucket takes to earn a token, and a
minute when the limiter could not reach the database at all, because that is not about tokens and
a retry storm is the last thing a struggling database needs. Posting a message with the same
`client_id` twice returns the original rather than a duplicate, enforced by a unique index.

`POST /api/email/capture` is the mailbox side of "Lead database customers": an automation that
reads Gmail (an n8n Gmail trigger, say) posts each email as
`{"message_id", "from", "to": [], "cc": [], "subject", "text", "html", "direction": "inbound"|"outbound"}`,
and the ones to or from a lead-database customer land in their group, as them (inbound) or as
the team member who wrote it (outbound; the key's own user when the From is not a team
address). `direction` may be left out, in which case a From that belongs to a team member is
outbound. The Message-ID is the dedupe key, so the same mail arriving by forward and by this
route is stored once. Everything else answers `{"ignored": reason}` and is recorded in
`inbound_messages_unmatched`.

Both capture routes take a history as well as a live feed. `sent_at` (ISO 8601, or an epoch in
seconds or milliseconds) dates the stored row when the message was actually sent, so a backfill
reads in order and never lifts a thread to the top of the sidebar; `backfill: true` marks the
row (`meta.backfill`) so an import can be told apart from live capture later. The `GET` also
returns `contacts` — each lead-database customer's `user_id`, `name`, `email`, `phone`,
`monday_item_id` and `lead_category` — which is what a backfill needs to read their chat and
their enquiry date.

`POST /api/whatsapp/capture` is the WhatsApp side of the same thing: an automation reading a
chat's history out of TimelinesAI posts each message as
`{"message_uid", "chat_id", "phone", "direction": "inbound"|"outbound", "text", "media_url", "sent_at", "sent_from"}`,
and the ones with a lead-database customer land in their group, as them (inbound) or as the
owner of the number in `sent_from` (outbound; the key's own user when that number is not on
file). The uid is the dedupe key it shares with the live webhook, so a message stored by both is
stored once. Nothing captured this way is ever sent back out (`meta.mirrored`).

Not covered in this pass: attachments and uploads, reactions, pins, editing and deleting
messages, scheduled messages, saved items, outgoing webhooks, pagination beyond
`before` + `limit`, and an OpenAPI document.

```bash
K=sk_live_...
curl -sS -H "Authorization: Bearer $K" https://chat.stayful.co.uk/api/v1/me
curl -sS -X POST -H "Authorization: Bearer $K" -H 'content-type: application/json' \
  -d '{"body":"Posted over the API","client_id":"demo-1"}' \
  "https://chat.stayful.co.uk/api/v1/conversations/$CID/messages"
```

## MCP server

`/api/mcp` speaks the Model Context Protocol over Streamable HTTP, so Claude, n8n, Zapier or
anything else speaking MCP can drive the workspace with nothing to install. It authenticates
with the same API keys and the same `verifyApiKey` helper as the REST API, so the two surfaces
cannot end up authenticating differently, and every tool goes through the same
`src/lib/api/service.ts` — neither front door holds logic of its own.

Every tool acts as the key's Stayful team member and is bounded by that person's own access:
an agent cannot see a group they are not in, and its messages are labelled "via MCP". Write
tools say so in their own descriptions, so a model knows it is acting in a live workspace and
not a sandbox.

Seventeen tools in all.

**Reading:** `list_conversations`, `get_conversation`, `list_messages`, `list_thread_replies`,
`search_messages`, `list_people`, `list_bookmarks`, `whoami`.
**Writing:** `send_message`, `create_group`, `open_dm`, `add_members`, `remove_member`,
`invite_member`, `add_bookmark`, `remove_bookmark`, `set_my_status`.

Scopes are checked per tool, not just at the endpoint, so a read-only key can still connect.

```bash
claude mcp add --transport http stayful https://chat.stayful.co.uk/api/mcp \
  --header "Authorization: Bearer sk_live_..."
```

The endpoint is **stateless** — Vercel keeps nothing between requests, so there is no session
to resume, and `maxSubscriptions: 0` rejects `subscriptions/listen` rather than opening an SSE
stream a serverless function cannot hold. That rules out server-initiated notifications,
resource subscriptions and streaming progress: every tool is plain request/response. The app's
own live updates ride Supabase Realtime; MCP clients poll.

**A bearer key works today** for Claude Code (above), the Anthropic Messages API `mcp_servers`
block, n8n's MCP Client node, and stdio-only clients via `npx mcp-remote <url>`. **Adding this
as a connector in the claude.ai or Claude Desktop UI generally needs OAuth**, which wants an
authorization server this app does not have — that is a follow-up, not something this pass
delivers. The groundwork is in place for it (`mcp-handler` ships `protectedResourceHandler` for
RFC 9728, and the 401 already carries a spec-compliant `WWW-Authenticate` challenge). Check
whether Zapier's MCP client accepts a static bearer header before promising it there.

## Scripts

| Command                                        | What it does                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm dev` / `pnpm build` / `pnpm start`       | Next.js                                                                                                      |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | ESLint, TypeScript, Prettier                                                                                 |
| `pnpm test`                                    | Vitest: unit tests; the RLS suite runs only when `SEED_TEST_PASSWORD` is set                                 |
| `pnpm test:e2e`                                | Playwright smoke tests against a production build (`pnpm build` first); sign-in tests need a seeded database |
| `pnpm db:verify`                               | Applies every migration to a throwaway PostgreSQL cluster, asserts behaviour, checks the types — see below   |
| `pnpm db:types`                                | Regenerates `src/lib/database.types.ts`, re-applies the hand corrections, typechecks the result — see below  |
| `pnpm slack:backfill`                          | Runs the Slack worker from a machine until nothing is due (`--once` for one slice) — see "Slack"             |
| `pnpm slack:emoji`                             | Regenerates `src/lib/slack/emoji.json` (Slack short names → characters) from `emoji-datasource`              |

The RLS and sign-in tests expect the fixtures from `supabase/seed.sql` (test accounts and groups).
Run them against a local stack (`supabase start && supabase db reset`) or a staging project, never
against production, which holds real accounts only.

Playwright options for sandboxes: `PW_CHROMIUM_EXECUTABLE` to use a preinstalled Chromium,
`PW_CERT_SPKI_ALLOWLIST` to trust a proxy CA by SPKI hash, `PW_DIRECT=1` to bypass an HTTP
proxy that cannot upgrade WebSockets. None are needed on a normal machine or in CI.

## Deployment

Vercel project `messaging-system` builds from this repository. Set the three
`NEXT_PUBLIC_*` variables in the Vercel project settings. Production domain:
`chat.stayful.co.uk`.

### Browser security headers

`next.config.ts` sets `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors
'none'` (the sign-in form must never be framable — that is how a clean domain ends up embedded
in someone else's phishing page), plus `nosniff`, `Referrer-Policy` and a `Permissions-Policy`
that keeps camera and microphone on `self` for voice notes and Twilio Voice.

There is no full CSP yet, on purpose. The app talks to Supabase REST and Realtime
(`wss://*.supabase.co`), the Twilio Voice SDK and Resend, and ships Next.js inline bootstrap
scripts and Tailwind v4 inline styles. Add the full policy as
`Content-Security-Policy-Report-Only` first, exercise a real session (sign in, send a message,
record a voice note, place a call, open a link preview), then promote it to enforcing.

### Preview deployments and Chrome's password warning

Vercel preview URLs change on every deploy, so each one is a hostname Chrome has never seen,
on `vercel.app` — a public-suffix domain heavily used by real phishing kits. A password form
on such a host draws Chrome's "you entered your password into a deceptive site" warning
whenever the password typed is one Chrome protects (for example a Google Workspace password).
`chat.stayful.co.uk` itself is not flagged; the preview hostnames are the problem.

Vercel Deployment Protection is already enabled, so previews sit behind Vercel SSO and are not
publicly reachable. That matters for the diagnosis: an unreachable host is not one Safe
Browsing has crawled and classified, so this is the Chrome/Workspace **password-reuse** policy
warning on a non-allow-listed domain, not a phishing verdict on the deployment.

To stop it recurring:

- Never reuse a Google Workspace password for a Stayful Messaging account. This is the whole
  arming condition, and no change in this repo can override it. Prefer "Continue with Google",
  which is now the first option on the sign-in page.
- Give previews a **stable** host — a Vercel branch-alias domain, or better a subdomain you
  own such as `preview.stayful.co.uk` — so an allow-list entry can actually hold. Per-deploy
  hostnames defeat any allow-list by design.
- Then add that host (and `chat.stayful.co.uk`) to `SafeBrowsingAllowlistDomains` in the
  Google Admin console, under Chrome > Settings > Users.
- Keep Deployment Protection on, so a sign-in form never becomes publicly reachable on
  `vercel.app`.

The sign-in page renders the host it is actually served from (`src/app/login/page.tsx`); it
must never hardcode a domain, because a page naming a domain it is not on is precisely what a
spoofed login page looks like.
