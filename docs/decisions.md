# Decision log

Newest first. Each entry says what was decided and why. Product decisions also live in the
V-01 Build Playbook and Design Roadmap.

## 2026-10-14

- **The page background is soft white (`canvas`, #FCFBF8).** Approved by Alpha; Alessio to confirm.
  The roadmap's paper (#F5F2EC) is now the sidebar, card and panel colour, and hairlines are lighter
  (#E7E1D7, was #D6CFC3). Teal, plum, ink and the status colours are unchanged; every text colour
  still passes 4.5:1 on both canvas and paper (`packages/brand/test`). Three livelier palettes were
  compared first; the roadmap palette was kept.
- **V-01's company console is the top level.** It tracks every operator; Vivistays and later
  operators are tenants with their own workspaces.
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
