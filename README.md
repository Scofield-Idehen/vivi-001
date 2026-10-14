# V-01

The property management platform replacing Guesty. V-01 is its own company; Vivistays is the first
operator, and for now the product wears Vivistays' logo and design. Built from the V-01 Build Playbook
(v1.2) and the V-01 Design Roadmap (v1.3).

This is the **base**: Phase 0 plus integration steps 1 and 2. It is the foundation every module is built on.

| What | Where | State |
| --- | --- | --- |
| Operator isolation (every table, row-level security, tests that prove it) | `packages/db` | Done |
| Double-booking guard in Postgres | `packages/db/migrations/0001_security.sql` | Done |
| Audit log of who changed what | same | Done |
| API: sign-in, workspaces, properties, Channex webhook intake | `apps/api` | Done |
| Worker: outbox sender, webhook handling, feed sweep, nightly full sync | `apps/worker` | Done (availability only) |
| Channel swap layer and Channex adapter | `packages/channels` | Built, not yet certified |
| Web app: sign-in, shell, Today, Properties, Workspace | `apps/web` | Done |
| Booking import into reservations, then acknowledgement | `apps/worker/src/bookings.ts` | Phase 1, step 5 |
| Prices and restrictions out | `apps/worker/src/outbox.ts` | Phase 1, step 4 |

## Layout

```
apps/
  api/          Node API (Fastify): sign-in, workspaces, properties, webhooks
  worker/       Outbox sender, webhook handling, booking feed sweep, nightly jobs (pg-boss)
  web/          React app (Vite): staff workspace
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
5. Tests in `packages/db/test/security-coverage.test.ts` fail if a new table or function skips these rules.

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

Sign in with the email in `SEED_ADMIN_EMAIL`; the invitation turns into a membership on first sign-in.

## See it without a backend

```bash
pnpm install
pnpm demo              # opens the web app at http://localhost:5173 with sample data
```

Demo mode runs the real screens against sample data kept in your browser: no database, API or
sign-in. `pnpm --filter @v01/web build:demo` builds the same thing as static files in `apps/web/dist-demo`.

## Checks

```bash
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
pnpm build
```

Tests create and drop their own databases. CI runs all of this on every pull request against Postgres 17,
and also fails if the schema changed without a migration (`pnpm db:generate`).

## Supabase and Render

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

## Next (Phase 1)

- Channex staging account in V-01's name; set `CHANNEL_PROVIDER=channex` and the staging key.
- Property sync into Channex (step 3), prices and restrictions out (step 4), booking import with
  acknowledgement after saving (step 5), auto-availability settings (step 6), mapping screens (step 7).
- Calendar, Reservations and Channels & sync screens from design phase D1.
- Nightly cross-check.

Design sign-off: Alpha and Alessio, at every design gate.
