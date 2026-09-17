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
  level, copy link, leave and archive (team), on every conversation list including the
  customer view.
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
maintenance WhatsApp, outgoing webhooks, Slack import.

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

Responses are `{"data": …}` or `{"error": {"code", "message"}}`, with codes `unauthorized`,
`forbidden`, `insufficient_scope`, `not_found`, `invalid_request`, `conflict`, `rate_limited`,
`not_configured` and `internal`. 600 requests per key per minute, counted in Postgres (a fixed
window — coarse, but the only stateful option without adding Redis; a token bucket is a
follow-up). Posting a message with the same `client_id` twice returns the original rather than
a duplicate, enforced by a unique index.

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
| `pnpm db:verify`                               | Applies every migration to a throwaway PostgreSQL cluster (no Docker, no Supabase CLI) — see below           |

The RLS and sign-in tests expect the fixtures from `supabase/seed.sql` (test accounts and groups).
Run them against a local stack (`supabase start && supabase db reset`) or a staging project, never
against production, which holds real accounts only.
| `pnpm db:types` | Regenerate `src/lib/database.types.ts` from the hosted project |

Playwright options for sandboxes: `PW_CHROMIUM_EXECUTABLE` to use a preinstalled Chromium,
`PW_CERT_SPKI_ALLOWLIST` to trust a proxy CA by SPKI hash, `PW_DIRECT=1` to bypass an HTTP
proxy that cannot upgrade WebSockets. None are needed on a normal machine or in CI.

## Deployment

Vercel project `messaging-system` builds from this repository. Set the three
`NEXT_PUBLIC_*` variables in the Vercel project settings. Production domain:
`chat.stayful.co.uk`.
