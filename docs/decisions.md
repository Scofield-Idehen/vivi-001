# Decision log

Newest first. Each entry says what was decided and why. Product decisions also live in the
V-01 Build Playbook and Design Roadmap.

## 2026-10-15

- **A night's price and stay rules are stored only where they differ from the property's usual ones**
  (`calendar_days`, migrations 0010 and 0011). A night with no row uses the usual price, or the weekend
  price on Friday and Saturday nights, and the usual minimum stay. One `nightRules()` in `@v01/shared`
  works out every night, for the calendar screen and for what the channels get, so the two can't
  disagree. Changes reach up to two years ahead and never touch nights that have passed.
- **Prices stay within each property's limits.** The calendar refuses a price outside them, naming
  the property and the limit; a price that falls outside later, because the limits changed, goes to the
  channels at the limit. Properties priced by PriceLabs keep PriceLabs' prices: V-01 sends them stay
  rules only.
- **Blocking takes only the free nights.** Booked nights are left as they are, and the reply says how
  many. Reopening part of a block keeps the rest of it blocked.
- **The database queues every change for the channels** (migration 0012), in the same transaction as
  the change: a booking or block queues availability for its nights, a change to nightly prices or stay
  rules queues them once per change however many nights it covers, and a change to the usual price,
  price limits or stay lengths queues the whole 500-night horizon. Only properties V-01 runs queue
  anything. The worker sends only nights from today, where the operator is, and the nightly full sync
  now sends prices and stay rules as well as availability.
- **V-01 stays on Channex (Alpha).** Vivistays' Airbnb, Booking.com and Vrbo listings are linked into
  Channex as they are, so they keep their reviews, photos and descriptions; Channex carries prices,
  availability, stay rules and bookings. Photos, descriptions and amenities are changed on each channel,
  using the copy buttons on the property page, until Channex can send them (its target is 2027, for
  Airbnb and Booking.com). A brand-new listing is made on the channel first, then linked. Vrbo needs
  Guesty's API connection taken off the account first (Vrbo support may have to turn it back into a
  normal account) and any iCal links removed.
- **The sidebar is a rail of icons that opens while the mouse rests on it (Alpha).** It opens over the
  page, so nothing on the page moves, and closes when the mouse leaves. There is no button to fold or
  unfold it. Keyboard focus inside it opens it too, and on touch screens a tap on the rail opens it and
  a tap elsewhere closes it. Phones keep the top bar and menu. Workspaces and the console both work
  this way. This replaces the fold button from 14 October.
- **Adding a property follows Airbnb's three stages:** about the place (the place, name and address,
  guests and rooms), make it stand out (amenities, photos, title and description), then finish up
  (pricing, check and add). Amenities are offered as tiles in three groups: guest favourites, standout
  features and safety. The rest of the list is on the property's page. The title can start from a
  suggestion made from the answers, such as "3-bedroom cottage in Port Seton with a hot tub", always
  within Airbnb's 50 characters. Only the name is still required.
- **Photos chosen while adding a property upload once it exists.** Until then they are held in the
  page, checked as they are chosen (type, and at least 800 pixels), so closing and reopening the panel
  keeps them. A reload loses them, and the panel says so; the written draft is kept as before.
- **On narrow screens the property list is one row per property** with its cover photo, instead of a
  table cut off at the side.

## 2026-10-14

- **Channex carries prices, availability, stay lengths and bookings to Airbnb, Booking.com and Vrbo;
  it does not create listings or carry photos, descriptions or amenities** (Channex's own documentation,
  checked 14 Oct 2026). It connects to listings that already exist on each channel, and for Airbnb it
  also sets pricing rules (cleaning and extra-guest fees, deposit), booking rules (instant book,
  check-in times, cancellation policy, pets, smoking, events, children) and publishing. So V-01 keeps
  the master copy of every listing, everything Channex can carry syncs, and the rest is set on each
  channel from the property page's copy buttons. (Decided on 15 October: stay on Channex.)
- **Every property has its own page with the whole listing,** editable part by part after it is added:
  photos, the place, rooms and beds, amenities, title and description, address, arriving, house rules,
  booking rules, prices and fees, licence and channels. A checklist shows what the channels still need
  (five photos, title, description, amenities, beds, full address, check-in method, a nightly price).
- **Listing photos live in a public Supabase Storage bucket** (`property-photos`), under
  `{operator}/{property}/`. Browsers upload straight to it with a short-lived ticket from the API, after
  resizing to 2,560 pixels; the API registers only paths under the property's own folder. Up to 50 a
  property; the first is the cover. Nothing private ever goes in that bucket.
- **Amenities are V-01's own list** (about 90, 18 of them standout features such as a hot tub or sea
  view), stored as codes so the list can grow, and mapped down to each channel's nearest equivalents.
- **Beds are recorded room by room;** the bedroom and bed counts the channels show follow the rooms.
- **New listing tables carry a composite key to their property's operator** (migration 0008), so a
  room, amenity or photo can never point at another operator's property, even by mistake.
- **The sidebar folds down to icons,** in workspaces and the console, and remembers the choice per
  browser. It is icons by default between 560 and 1024 pixels wide; phones keep a top bar. (Replaced on
  15 October: it now opens on hover, with no button.)
- **A property on Guesty is never run by V-01 at the same time (Alpha).** Two managers on one listing
  means the same home can be listed or booked twice. V-01 sends nothing to Airbnb, Booking.com or Vrbo
  for a property until `managed_by` is `v01`, and a trigger (migration 0007) stops the API and worker
  from ever setting that. Only the Phase 1 move-over step may, acting as the database owner, and it must
  first confirm the property's listings are off Guesty.
- **A property added in V-01 starts as "not connected"** (`managed_by = none`), not "still on Guesty".
  It sends nothing either. The console now counts properties on Guesty separately (migration 0006), so
  its "still on Guesty" figure is exact.
- **Adding a property is a panel from the right that asks one thing at a time.** It replaces the
  six-field sheet, which was thinner than Guesty's wizard. Five steps: the place, name and address,
  guests and rooms, pricing, then check and add. The step list on the left fills with each answer, and
  any step is one click away. On wide screens a preview shows the property as it's described.
  Only the name is required; everything else starts with a sensible answer, and the short code is
  made from the name until someone types their own. Close, Escape or a click beside the panel closes
  it, and the draft stays in that browser until the property is added. It lives at `/properties/new`.
  Awaiting design sign-off from Alpha and Alessio.
- **Properties record what kind of place they are, what guests get, beds and bathrooms.** Guests get
  the whole place, a private room or a shared room. Bathrooms count in halves (a toilet and basin is a
  half). The kind of place is stored as text, so the list can grow without a migration (migration 0004).
- **The page background is soft white (`canvas`, #FCFBF8).** Approved by Alpha; Alessio to confirm.
  The roadmap's paper (#F5F2EC) is now the sidebar, card and panel colour, and hairlines are lighter
  (#E7E1D7, was #D6CFC3). Teal, plum, ink and the status colours are unchanged; every text colour
  still passes 4.5:1 on both canvas and paper (`packages/brand/test`). Three livelier palettes were
  compared first; the roadmap palette was kept.
- **V-01's company console is the top level.** It tracks every operator; Vivistays and later
  operators are tenants with their own workspaces.
- **The console reads across operators only through `console_*` functions.** Each checks the caller's
  V-01 role in the database, not just in the API, and returns totals, statuses and operator metadata.
  Guests' details never reach the console.
- **Three V-01 staff roles:** owner, support (both can open support access) and viewer (totals only,
  no names or emails). Staff are added by email with `pnpm db:staff` and linked on first sign-in.
- **Support access is the only way V-01 staff see inside a workspace.** It needs a reason the operator
  can read, is read-only, lasts 5 minutes to 4 hours, and logs every request, allowed or refused, in its
  own transaction so a failed request is still recorded. Removing someone from staff closes it at once.
  The operator sees every visit on their Workspace page.
- **The console has a dark teal sidebar; workspaces have a light one,** so nobody mistakes one for the
  other. Both use the same palette.
- **An operator is Live once one property's channels run through V-01;** until then it is Onboarding.
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
