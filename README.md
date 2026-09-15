# Stayful Messaging

Owner and team messaging for Stayful: the Slack replacement described in the internal
"Owner Messaging Platform" spec. This repository holds the first pass, the **full-stack
foundation**: a Next.js app that reproduces the Claude Design prototypes, backed by
Supabase (Postgres with Row Level Security, Auth, Realtime Broadcast, Storage).

## What is in this pass

- Sign in with email + password (customers get a generated password by email when the team
  creates their account), an email magic link, or Google (Supabase Auth). Sessions persist.
- Desktop layout: top bar, icon rail (Home, DMs, Activity, Files, Later, Agents & tools),
  sidebar and conversation pane on the green frame, light and dark themes.
- Mobile layout: single pane with a bottom tab bar (Home, DMs, Activity, You).
- Direct messages list with unread toggle, filter, presence dots, draft indicator.
- Home sidebar with the "Customers" groups and recent DMs.
- Activity feed (mentions, new members, messages).
- Conversation pane: day dividers, red "New" marker, rich text (headings, bullet lists,
  links, @mention chips), composer with drafts, optimistic send with retry, internal notes
  for team accounts, live updates over Supabase Realtime, read state.
- Pins tab, Files and links tab, details modal (About, Members).
- Account page: change password, email notification preference, sign out.
- Team: "Invite a customer" creates the account, adds them to groups and emails the login details.
- Email notifications (D8): every customer-visible message is queued in `notification_outbox`;
  a Vercel cron drains it through Resend (grouping messages within two minutes), with a
  signed one-click unsubscribe link.
- Reply by email: notification emails carry `Reply-To: reply+<token>@<EMAIL_REPLY_DOMAIN>`;
  Resend Inbound posts replies to `/api/email/inbound`, which stores them in the same
  conversation as the customer (`sent_via = email`).
- Multi-tenant schema (`org_id` everywhere), customer vs team accounts and roles, RLS
  policies for every table, audit log table, private attachments bucket.
- Seed data reproducing the prototype (`supabase/seed.sql`).
- Tests: unit (formatting, rich text), RLS suite against the live project, Playwright smoke
  tests on desktop and mobile including two-user realtime delivery.

Out of scope for this pass (next passes): staff inbox with SLA, attachment uploads (including
email attachments), reactions, threads, digest emails, Monday and Uplisting sync, public API,
webhooks, MCP server, Slack import.

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

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the deployment, used for auth redirects |
| `SEED_TEST_PASSWORD` | Only for the test-suites; the password given to the two seeded test accounts |
| `RESEND_API_KEY` | Resend API key; without it accounts are still created and the password is shown to the team member instead of emailed |
| `EMAIL_FROM` | Sender, e.g. `Stayful <noreply@stayful.co.uk>` (domain verified in Resend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Used by the cron worker, unsubscribe links and the inbound email webhook |
| `CRON_SECRET` | Random string. Vercel sends it to the cron route; it also signs unsubscribe links |
| `EMAIL_REPLY_DOMAIN` | Optional. Subdomain receiving replies (MX at Resend), e.g. `reply.stayful.co.uk` |
| `RESEND_WEBHOOK_SECRET` | Optional. `whsec_…` secret of the Resend webhook for `email.received` |

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
`conversation:<id>` and a light `message_created` event to every member's `user:<id>`
topic. Presence runs on `org:<id>`. Clients back-fill from Postgres after any reconnect.

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
2. Set `SUPABASE_SERVICE_ROLE_KEY` and a random `CRON_SECRET` in Vercel. `vercel.json` schedules
   `/api/cron/notifications` every minute; Vercel adds the `Authorization: Bearer <CRON_SECRET>`
   header automatically when `CRON_SECRET` is set.
3. Reply by email: in Resend, enable Receiving for a subdomain such as `reply.stayful.co.uk`
   (add the MX record it gives you), then create a webhook for `email.received` pointing at
   `https://chat.stayful.co.uk/api/email/inbound`. Set `EMAIL_REPLY_DOMAIN` and
   `RESEND_WEBHOOK_SECRET`. Replies are stripped of quoted history, matched to the customer by
   the token in the To address, and rejected if the From address differs from the account email.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | ESLint, TypeScript, Prettier |
| `pnpm test` | Vitest: unit tests; the RLS suite runs only when `SEED_TEST_PASSWORD` is set |
| `pnpm test:e2e` | Playwright smoke tests against a production build (`pnpm build` first); sign-in tests need a seeded database |

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
