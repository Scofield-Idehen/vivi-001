# Decision log

Newest first. Each entry says what was decided and why. Product decisions also live in the
V-01 Build Playbook and Design Roadmap.

## 2026-10-14

- **Base build delivered.** Phase 0 foundations plus integration steps 1 and 2.
- **The app wears Vivistays' logo and design for now.** The look lives in
  `packages/brand/app-brand.json`, so a future V-01 brand replaces it without code changes.
- **Design sign-off: Alpha and Alessio, at every gate.**
- **All tables live in schema `app`, not `public`.** Supabase exposes `public` through its Data API;
  `app` is reached only through our API and worker.
- **Four database roles.** `app_base` holds table privileges; `app_api` and `app_worker` log in
  and inherit them; `app_jobs` owns only pg-boss's schema. None can bypass row-level security.
  Passwords are set by `pnpm db:roles`, never in migrations.
- **Row-level security is enabled, not forced.** Forcing it would also bind the table owner, which the
  audit and occupancy triggers and the `sys_*` functions rely on. The application roles are never owners,
  so they are always bound.
- **One exclusion constraint guards against double booking.** Confirmed reservations and blocks
  both write a row to `occupancies` through triggers; Postgres refuses overlapping nights for a property.
  A refused channel booking must be saved as status `conflict` and raise an urgent alert (Phase 1 importer).
- **Channex IDs live only in mapping tables** (`channex_mappings`, `channex_channels`,
  `channex_bookings`). That is what makes the channel swap layer work.
- **Migrations run from GitHub Actions**, never from Render, so runtime services never hold owner credentials.
- **Tooling:** pnpm workspaces, TypeScript 7, Biome for lint and format, Vitest against real Postgres,
  esbuild bundles for the API and worker.
- **`managed_by` values are `guesty` and `v01`.** If V-01 is renamed, rename the enum value in a migration.
