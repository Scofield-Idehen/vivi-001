# For developers

The technical side of V-01: how the code is laid out, how operators' data is kept apart, how to run
it with a real database, and the checks. To just see what's built, follow the README instead.

Built from the V-01 Build Playbook (v1.2) and the V-01 Design Roadmap (v1.3): the **base** (Phase 0 plus
integration steps 1 and 2) and the **first V-01 console**. The product uses the Vivistays palette for now,
with a soft white page.

| What | Where | State |
| --- | --- | --- |
| Operator isolation (every table, row-level security, tests that prove it) | `packages/db` | Done |
| Double-booking guard in Postgres | `packages/db/migrations/0001_security.sql` | Done |
| Audit log of who changed what | same | Done |
| API: sign-in, workspaces, properties, Channex webhook intake | `apps/api` | Done |
| Worker: outbox sender, webhook handling, feed sweep, nightly full sync | `apps/worker` | Done |
| Channel swap layer and Channex adapter | `packages/channels` | Built, not yet certified |
| Web app: sign-in, shell, Today, Properties, Workspace | `apps/web` | Done |
| V-01 console: overview, operators, sync health, support log | `apps/web/src/pages/console`, `apps/api/src/routes/console.ts` | Done |
| V-01 staff and read-only support access, logged and visible to the operator | `packages/db/migrations/0003_console_security.sql` | Done |
| Booking import into reservations, then acknowledgement | `apps/worker/src/bookings.ts` | Done, tested against the stand-in |
| Calendar: nightly prices, stay rules and blocks | `apps/api/src/routes/calendar.ts`, `packages/shared/src/calendar.ts` | Done |
| Calendar screen: one scrolling timeline (a year back, two ahead, loaded four weeks at a time), Availability, filters, channel marks and the actions panel | `apps/web/src/pages/calendar` | Done; awaiting design sign-off |
| Clean and dirty: marked by hand, or dirty after a check-out | `apps/api/src/routes/cleaning.ts`, `apps/worker/src/cleaning.ts`, `packages/db/migrations/0016_cleaning_status.sql` | Done |
| Property sync into Channex (step 3): asked for from the property page, made by the worker in the operator's group | `apps/api/src/routes/channex.ts`, `apps/worker/src/setup.ts`, `packages/db/migrations/0018_channex_setups.sql` | Done, tested against the stand-in |
| Property tags | `packages/db/migrations/0014_property_tags.sql`, `apps/web/src/pages/properties/Tags.tsx` | Done |
| Reservations: list, one booking's page, and its edits | `apps/api/src/routes/reservations.ts`, `apps/web/src/pages/reservations` | Done; awaiting design sign-off |
| Changes queued for the channels by the database | `packages/db/migrations/0012_channel_queue.sql` | Done |
| Prices and stay rules out | `apps/worker/src/outbox.ts` | Done, tested against the stand-in |

## Layout

```
apps/
  api/          Node API (Fastify): sign-in, workspaces, properties, webhooks
  worker/       Outbox sender, webhook handling, booking feed sweep, nightly jobs (pg-boss)
  web/          React app (Vite): the V-01 console and each operator's workspace
packages/
  db/           Drizzle schema, migrations, row-level security, roles, seeds, test helpers
  shared/       Zod schemas, enums, money and date helpers used everywhere
  channels/     ChannelProvider interface, Channex adapter, webhook signatures, rate limiter
  integrations/ Slack alerts now; PriceLabs, Stripe Connect and email later
  brand/        The app's look (Vivistays for now) and contrast checks for operator accents
docs/           Decision log and runbooks
```

## How operator data stays separate

1. Every operator table has `organisation_id`, and Postgres row-level security is on for all of them.
2. The API and worker connect as `app_api` / `app_worker`. Neither can bypass row-level security or owns a table.
3. All database access goes through `withOrg()` in `packages/db`, which sets the operator for one
   transaction. Outside that scope every operator table returns nothing. Importing `pg` anywhere else
   fails the lint.
4. The few operations that must cross operators (claiming queued work, routing a webhook) are narrow
   `sys_*` functions that only the worker role may call.
5. The V-01 console reads across operators only through `console_*` functions. Each checks the caller is
   V-01 staff and returns totals, statuses and operator metadata, never guests' details.
6. To look inside an operator's workspace, V-01 staff open a support grant: it needs a reason, is
   read-only, lasts at most four hours, logs every request, and the operator sees it on their Workspace page.
7. Tests in `packages/db/test/security-coverage.test.ts` fail if a new table or function skips these rules.
8. Secret custom fields (lock codes, Wi-Fi passwords) are sealed in the API (`apps/api/src/secrets.ts`,
   AES-256-GCM under `FIELD_SECRET_KEY`) before they reach Postgres, and opened only for roles with
   `secrets.read`. Support grants never include it, so V-01 staff never see a secret.

## Local setup

You need Node 22, pnpm 10 and Postgres 16 or 17 (or a Supabase project).

```bash
pnpm install
cp packages/db/.env.example packages/db/.env      # owner URL, role passwords, your email
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env.local

pnpm db:migrate        # schema, row-level security, roles (without login)
pnpm db:roles          # turns on login for app_api, app_worker, app_jobs
pnpm db:seed:demo      # Vivistays, plus a fictional demo operator with invented properties
pnpm dev               # API on :3001, worker, web on :5173
```

Sign in with the email in `SEED_ADMIN_EMAIL`; the invitation turns into a membership on first sign-in,
and the same email is a V-01 owner, so you land in the console. Add other V-01 staff with
`pnpm db:staff add <email> <owner|support|viewer>` (see `docs/runbooks/v01-staff.md`).

## See it without a backend

```bash
pnpm install
pnpm demo              # opens the web app at http://localhost:5173 with sample data
```

Demo mode runs the real screens against sample data kept in your browser: no database, API or
sign-in. You are a V-01 owner and a Vivistays admin; Northwind Stays and Brightwater Lets are invented
operators you can open with support access. `pnpm --filter @v01/web build:demo` builds the same thing as
static files in `apps/web/dist-demo`.

## Checks

```bash
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
pnpm build
```

Tests create and drop their own databases. CI runs all of this on every pull request against Postgres 17,
and also fails if the schema changed without a migration (`pnpm db:generate`).

## Checking a Channex key

Put the key in `apps/worker/.env`, which git ignores. Never put it in `.env.example`: git tracks that
file, and a test fails if it holds a key.

```bash
CHANNEX_API_KEY=<the key>
```

`pnpm channex:check` then says which Channex server knows the key (staging or live), lists the
properties in the account with their room types, rate plans and channels, and counts the booking changes
waiting in the feed. It only reads, never prints the key, and never acknowledges a booking.

On staging, `pnpm channex:check --round-trip <Channex property id>` sends one test price, minimum stay
and closed night, about 300 days ahead, through V-01's own adapter, reads them back, then puts the night
back as it was. That proves the adapter's requests before certification.

An empty staging account has nothing to send to, so `pnpm channex:check --make-test-property` first
makes a property called "V-01 test property" through the adapter, the way V-01 will make each property
it connects (one unit, one rate plan), then runs the round trip on it. Run again, it uses the same one.
It never makes anything on live.

`pnpm cross-check` (in `apps/worker`) runs the nightly cross-check now: every calendar V-01 runs
against what Channex holds for the next 90 nights (`--days 500` for the whole horizon). Differing
nights are sent again through the outbox and logged; the Today page lists them. Set `APP_URL` in the
worker's `.env` so alerts link to the page that fixes them.

## Door locks (TTLock)

V-01 has one TTLock developer application (euopen.ttlock.com). Its Client ID and Secret go in the
API's and the worker's settings as `TTLOCK_CLIENT_ID` and `TTLOCK_CLIENT_SECRET` (in `API_ENV` and
`WORKER_ENV` on GitHub, and the worker's `.env` on a laptop); `TTLOCK_API_URL` defaults to
`https://euapi.ttlock.com`. Both also need `FIELD_SECRET_KEY`, which seals the token and the codes.

An admin or operations person connects the operator's TTLock **app** account in Workspace → Door
locks. The password goes to TTLock once (as its MD5, which is what TTLock asks for) and is dropped;
only the token is kept, sealed, in `lock_accounts`. Each lock is then put on a home and "V-01 makes
the codes" turned on. It stays off by default so V-01 never fights Guesty's Locks Manager over a
lock: turn it on only for locks Guesty no longer codes.

The worker (`apps/worker/src/locks.ts`, every 5 minutes) gives every confirmed stay up to 14 days
ahead one six-digit code on every coding lock of the home, from the check-in time to 30 minutes
after check-out; every job a code for its day, 07:00 to 22:00; changes windows when dates move,
takes codes off for cancelled stays and jobs, and retries refusals (at once for five tries, then
hourly). Commands go one at a time through the gateway. Battery and gateways are listed hourly.
A code shows to anyone only once the lock holds it: on the booking (digits for roles that may read
secrets), on the guest's page from arrival to departure, in the job's Getting in box on its day,
and as `{{door_code}}` in messages. Today warns about a lost sign-in, an offline gateway, codes
that didn't reach a lock, and batteries under 25%.

## Importing from Guesty

The import also brings each booking's guest conversation from Guesty's Inbox (bookings that ended
in the last 90 days and every later one; `--messages-days-back 0` leaves them out) into the
booking's V-01 thread, oldest first, each message once by Guesty's id, marked read and not waiting.
Guesty's log lines and private notes stay behind. It can also run from GitHub: Actions → Guesty
import → Run workflow (rehearses by default), using the `WORKER_ENV` secret.

Put the Open API credentials (Guesty → Settings → Integrations → Open API → create an application)
in `apps/worker/.env`, with the same `FIELD_SECRET_KEY` the API uses, so lock codes land sealed:

```bash
GUESTY_CLIENT_ID=<client id>
GUESTY_CLIENT_SECRET=<client secret>
FIELD_SECRET_KEY=<the API's key>
```

Then, in `apps/worker`: `pnpm guesty:import --org vivistays --dry-run` does the whole import and
rolls it back, printing what it would make and what to look at (amenities without a match, a cut
title, a secret it couldn't seal, the account keys it found). `pnpm guesty:import --org vivistays`
keeps it. Run it again any time: it updates what it made before. `--bookings-days-back 365` and
`--calendar-days 730` are the defaults. Guesty allows five tokens a day per client; the token is
kept in the database, so runs and restarts share it.

What the import does is in `apps/worker/src/guesty/mapping.ts` (Guesty's words into V-01's, pure
functions) and `import.ts` (the database work), tested in `apps/worker/test/guesty.test.ts`
against a stand-in for Guesty's API.

## The field team's photos

Task photos go to a **private** bucket (`TASK_PHOTO_BUCKET`, `task-photos`; make it in Supabase
Storage with "public" off), separate from listing photos. The browser stamps each picture
(`stampPhoto` in `apps/web/src/lib/images.ts`: time, property and address, who, position) before
upload and sends the same words as `stamp`; the API serves them on signed addresses
(`PhotoStore.viewUrls`, two hours). Each photo has a `stage`: `before`/`after` for cleans, `found`
otherwise.

## Sign-in and sessions

Supabase Auth signs people in (email link); the app never touches the database directly. The
access token lasts an hour and `supabase-js` refreshes it in the background; the API checks each
token's signature (`apps/api/src/auth.ts`), allows a minute of clock drift, and refuses a sign-in
older than `SESSION_MAX_HOURS` (48) with `session_expired`. The web app's `apiFetch` refreshes
and retries once on `invalid_token`, and signs out on `session_expired` or a refresh that fails;
every auth event is logged to the browser console as `[sign-in] …`. In the Supabase dashboard
(Authentication → Sessions / Settings) keep: JWT expiry 3600 s; refresh token rotation on, reuse
interval 10 s or more; no time-box or inactivity timeout shorter than `SESSION_MAX_HOURS`.

## The Inbox and guest messages

Every booking has a thread (`app.message_threads`, made by a trigger on `reservations`); messages
in and out are `app.messages`. A reply from the team is inserted `queued`; the worker's
`send-messages` loop (every minute, `apps/worker/src/inbox.ts`) sends it. Email goes through Resend
once these are in `apps/worker/.env`:

```bash
RESEND_API_KEY=<key>
MAIL_FROM=hello@example.com   # on a domain verified in Resend
```

Without them an email waits, with the reason on the message, and goes as soon as they are set. A
text (`sms`) and the sites' chats (`airbnb`, `booking_com`, `vrbo`, `expedia`) wait the same way:
texts until a texting service is chosen; the chats until messaging is connected through Channex,
which is where a guest's own messages will come in from (`messages.direction = 'in'`, with the
site's id in `external_id` so nothing is stored twice).

Automatic messages are `app.message_templates` (four per workspace, made with it: confirmation,
the day before arrival, the day of arrival, the day before check-out; `manual` ones are saved
replies). The `automatic-messages` loop (every five minutes) writes each into the thread when its
moment comes, where the operator is, once per template per thread (`messages_template_once`).
`{{placeholders}}` are in `packages/shared/src/inbox.ts`; `APP_URL` makes the `{{stay_link}}`.
Tests: `apps/api/test/inbox.test.ts`, `apps/worker/test/inbox.test.ts`.

## Supabase and Render

Staging: Supabase project `v01-staging` (ref `nznzkjsbdkzujkoieemo`, Ireland, eu-west-1), created 19 Oct 2026 in
Vivistays' name. Production and the Firebase hosting are still to come. The steps:

1. Create two Supabase projects, staging and production, in London (eu-west-2). Keep "Confirm email" on
   in Auth settings; the app signs in with email links.
2. Turn on point-in-time recovery for production before the first real booking.
3. Add `DATABASE_OWNER_URL` (the direct connection) as a secret in GitHub environments `staging` and
   `production`, then run the **Migrate** workflow. Run `pnpm db:roles` and `pnpm db:seed` once, from a
   trusted machine, with the same owner URL.
4. Connection strings for the services use the role name with the project ref, e.g.
   `app_api.<project-ref>`: the API through the transaction pooler (port 6543), the worker and pg-boss
   through the session pooler (port 5432 on the pooler host).
5. Create the Render services from `render.yaml` and fill in the secrets in the dashboard.
6. For listing photos, create a **public** Storage bucket named `property-photos` and give the API
   `SUPABASE_SERVICE_ROLE_KEY` (server side only, never in the web app). Browsers upload straight to
   the bucket with a short-lived ticket from the API; the bucket holds listing photos and nothing else.

## Next (Phase 1)

- Channex staging account in Vivistays' name for now; set `CHANNEL_PROVIDER=channex` and the staging key.
- Steps 3 to 7 are built and tested against the stand-in channel manager (property sync, prices and
  stay rules out, booking import, the downtime safety net, channel accounts and listing links with the
  Channels & sync screen). The Channex adapter's channel endpoints (`/channels`, `connection_link`,
  `all_listings`, `rate_plans` mappings, `activate`) follow docs.channex.io and are to be confirmed on
  staging before certification.
- Airbnb requests and enquiries (accept, decline, pre-approve): waiting on Channex's answer about
  the API; fees, booking rules and pause/resume (step 8) are built.
- Nightly cross-check: built; to confirm on staging that `GET /availability` and `GET /restrictions`
  read back as the adapter expects (prices as decimals, `max_stay` 0 for no limit).

Design sign-off: Alpha and Alessio, at every design gate.

## Replies leave after the transaction commits

Inside `scope.inOrg(...)`, never call `reply.send()`. Set the status with `reply.code(201)` and
return the body; Fastify sends it once the transaction has committed. Sending from inside the
transaction lets the reply reach the browser before the row is saved, so the next request can miss
it (this was the cause of tests that failed now and then, 30 Oct 2026). A test checks every route.
