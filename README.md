# V-01

## Where we are (14 October 2026)

A plain-English summary of what exists today, for Alessio and anyone else who isn't reading the code.
The technical side starts at [For developers](#for-developers).

**What V-01 is.** Our own platform for running short-stay properties, built to replace Guesty. V-01 is its
own company. Its console oversees every operator on the platform (an operator is a company that manages
properties), and each operator gets its own workspace. Vivistays is the first operator.

### What's built and working

- **The V-01 console.** V-01 staff see every operator in one place:
  - how many properties each one has, and how many have moved over from Guesty;
  - who is on its team;
  - whether prices, availability and bookings are flowing to and from Airbnb, Booking.com and Vrbo.

  Problems are listed first.
- **Support access.** V-01 staff can look inside an operator's workspace only by giving a reason. They can
  look but not change anything, and access lasts at most four hours. The operator sees every visit, and
  every page opened is recorded.
- **Each operator's workspace.**
  - Today: the steps to switching off Guesty.
  - Properties.
  - Workspace settings.

  Calendar, Reservations, Inbox and the other modules are already in the menu and arrive in later phases.
- **The foundations.**
  - The database itself keeps each operator's data separate from every other operator's.
  - The database refuses double bookings.
  - Every change is recorded with who made it.
  - 128 automatic checks run every time the code changes.

### Not yet

V-01 isn't connected to Airbnb, Booking.com or Vrbo yet, so it holds no real bookings or prices. That is
Phase 1. It starts with a Channex test account in V-01's name.

### How to look at it

- **Without installing anything:** ask Alpha for the link to the hosted demo.
- **On your own Mac** (needs Node 22 and pnpm 10): run `pnpm install`, then `pnpm demo`, and open
  http://localhost:5173. Run `pnpm install` again whenever you pull new code.

The demo runs on sample data, and you are a V-01 owner and a Vivistays admin.

- Vivistays is empty until its properties are imported from Guesty.
- Northwind Stays and Brightwater Lets are made-up companies. You can open them with support access.

![The V-01 console overview](docs/images/console-overview.png)
*The console: every operator, what needs attention, and channel sync.*

![One operator in the console](docs/images/console-operator.png)
*One operator: its details, team, channels and history of support access.*

![An operator's workspace opened with support access](docs/images/support-access.png)
*Support access: the operator's own workspace, read-only, with a banner showing when access ends.*

### Waiting for your sign-off

- **Soft white page.** The background moved from warm paper to soft white (#FCFBF8). The teal and plum are
  unchanged. Alpha has approved it.
- **The console's dark teal sidebar.** It keeps the console distinct from operators' workspaces, which
  keep a light sidebar.

### Next

Phase 1:

1. Open a Channex test account in V-01's name.
2. Send properties, prices and availability out to the channels.
3. Bring bookings in.
4. Build the Calendar, Reservations and Channels & sync screens.

Vivistays switches off Guesty about 17 weeks after the build starts. The reasons behind each decision
are in [docs/decisions.md](docs/decisions.md).

---

## For developers

Built from the V-01 Build Playbook (v1.2) and the V-01 Design Roadmap (v1.3): the **base** (Phase 0 plus
integration steps 1 and 2) and the **first V-01 console**. The product uses the Vivistays palette for now,
with a soft white page.

| What | Where | State |
| --- | --- | --- |
| Operator isolation (every table, row-level security, tests that prove it) | `packages/db` | Done |
| Double-booking guard in Postgres | `packages/db/migrations/0001_security.sql` | Done |
| Audit log of who changed what | same | Done |
| API: sign-in, workspaces, properties, Channex webhook intake | `apps/api` | Done |
| Worker: outbox sender, webhook handling, feed sweep, nightly full sync | `apps/worker` | Done (availability only) |
| Channel swap layer and Channex adapter | `packages/channels` | Built, not yet certified |
| Web app: sign-in, shell, Today, Properties, Workspace | `apps/web` | Done |
| V-01 console: overview, operators, sync health, support log | `apps/web/src/pages/console`, `apps/api/src/routes/console.ts` | Done |
| V-01 staff and read-only support access, logged and visible to the operator | `packages/db/migrations/0003_console_security.sql` | Done |
| Booking import into reservations, then acknowledgement | `apps/worker/src/bookings.ts` | Phase 1, step 5 |
| Prices and restrictions out | `apps/worker/src/outbox.ts` | Phase 1, step 4 |

### Layout

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

### How operator data stays separate

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

### Local setup

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

### See it without a backend

```bash
pnpm install
pnpm demo              # opens the web app at http://localhost:5173 with sample data
```

Demo mode runs the real screens against sample data kept in your browser: no database, API or
sign-in. You are a V-01 owner and a Vivistays admin; Northwind Stays and Brightwater Lets are invented
operators you can open with support access. `pnpm --filter @v01/web build:demo` builds the same thing as
static files in `apps/web/dist-demo`.

### Checks

```bash
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
pnpm build
```

Tests create and drop their own databases. CI runs all of this on every pull request against Postgres 17,
and also fails if the schema changed without a migration (`pnpm db:generate`).

### Supabase and Render

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

### Next (Phase 1)

- Channex staging account in V-01's name; set `CHANNEL_PROVIDER=channex` and the staging key.
- Property sync into Channex (step 3), prices and restrictions out (step 4), booking import with
  acknowledgement after saving (step 5), auto-availability settings (step 6), mapping screens (step 7).
- Calendar, Reservations and Channels & sync screens from design phase D1.
- Nightly cross-check.

Design sign-off: Alpha and Alessio, at every design gate.
