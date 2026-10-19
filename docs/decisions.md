# Decision log

Newest first. Each entry says what was decided and why. Product decisions also live in the
V-01 Build Playbook and Design Roadmap.

## 2026-10-19

- **The sign-in page shows one of Vivistays' lodges at sunset (Alpha's photo, 19 Oct 2026).** A
  full-height picture beside the form. To change it without code, a photo at
  `apps/web/public/sign-in.jpg` is used the moment it exists.

- **Connect all to Channex, in one press (Alpha, 19 Oct 2026: "I thought we were adding all
  properties at once").** The Properties page gains a Channex column (In Channex, Connecting, Not
  yet, Couldn't connect) and, for admins, a Connect all button that queues every property not yet
  in Channex; the worker does them one by one and the list watches them turn green. The move from
  Guesty is: import everything through Guesty's API, Connect all, link each property to its
  existing listing (which keeps its reviews, photos and ranking, because the listing itself is
  untouched), then move over. Reviews inside V-01 wait for Phase 2 (Alpha).
- **The import takes active Guesty listings as live properties and inactive ones as archived**
  (default, Alpha to confirm), so nothing is lost and the Calendar stays clean.

- **Airbnb specifics go through Channex's Airbnb API (integration step 8).** Once a property's Airbnb
  listing is live, the worker sends the property's own fees and booking rules to the listing:
  nightly and weekend price, guests included and the extra-guest fee, cleaning fee and security
  deposit, instant book, check-in and check-out times, and the cancellation policy in Airbnb's
  words. A database trigger marks the link due again whenever one of those changes on the property
  (migration 0022), so the two never drift; a refusal from Airbnb stays on the card until the
  property changes again. The team can **pause** an Airbnb listing from its card (Guesty's
  "temporarily unlist"): Channex takes it off Airbnb, the card says so, and Resume puts it back.
  Booking.com and Vrbo listings are still paused on the channel itself; Channex's documented API
  offers publish and unpublish for Airbnb only.
- **Accepting or declining Airbnb booking requests and enquiries is not built yet.** Channex's
  documentation names them but the fetched API pages show no endpoints for them, so building
  against a guess would be wrong. Added to the Channex questions; until answered, requests are
  handled in the Airbnb app as today.

- **List on channels is built as channel accounts, listing links and a card per channel
  (integration step 7).** An admin adds an account for each sign-in on a channel (Airbnb A and B,
  Booking.com A and B, Vrbo) on the new Channels & sync page and asks to connect it; the worker makes
  the connection in Channex inside the operator's group, holding its connected properties. Airbnb
  and Vrbo hand back a link the account's owner opens to authorise Channex, kept on the page to copy
  and send; Booking.com needs its hotel id and is approved on Booking.com's side. The worker looks
  every few minutes until Channex says the connection is active, then caches the listings Channex
  sees on it (`channel_account_listings`, migration 0021) and refreshes them hourly, so the API
  never talks to Channex. On a property's page each channel has a card: a linked one names the
  listing, opens it on the channel's site and can be unlinked; an unlinked one offers the connected
  accounts' free listings. A link is `linking` until the worker has sent the account's whole mapping
  set (rate plan to listing) to Channex and turned the connection on, then `live` with the date;
  an unlink is `closing` until it is out. One live listing per property per channel; a listing links
  to one property. Every step is in the sync log and on the page.
- **Pausing a listing on a channel waits for Channex's answer.** Guesty's "temporarily unlist" is
  not built: through Channex a listing's published state is a per-channel action V-01 can't yet
  confirm, and unmapping alone would leave the listing live on the channel with stale availability,
  which is a double-booking risk. Until Channex confirms the API, unlisting is done on the channel.
  Added to the Channex questions.

- **Rows are the click target, never an underlined word (Alpha, 19 Oct 2026: "underline is not a
  good UX design").** Every table row that leads somewhere (operators, sync health, the support
  log, properties, reservations) lights up under the mouse and opens on click; the name inside
  stays a plain link for keyboards and screen readers. Text links in prose keep their underline.

- **The downtime safety net is the worker's job, not a runbook step (integration step 6).** Every
  property is made in Channex with its availability auto-update settings on, so Channex closes a
  booked night by itself the moment a booking arrives; the worker reads that back after every
  connection and daily (migration 0020 adds `auto_close` and when it was checked to the mapping),
  turns it back on if someone switched it off in Channex, and raises a warning naming the property.
  The property page says so under Channels. On start-up the worker compares its last heartbeat
  (`worker_runs`) with the clock; after a gap of ten minutes or more it holds every outgoing send,
  saves the webhooks and the booking feed until a pass finds nothing new, and only then lets prices
  and availability out, so a stale push can never reopen a night booked during the gap. The console's
  Sync health shows the worker's heartbeat, a recovery in progress, and the last one. The runbook
  keeps the cross-check as the one manual step until it is built.

- **The "needs you" list, settled with Alpha on 19 Oct 2026.**
  - Leaving Guesty is not decided yet, so the plan stays undated; the build continues regardless.
  - Vivistays' data comes out of Guesty through the Guesty Open API, with a key that lives only in
    `apps/worker/.env`. The import is built against the API, not CSV exports. The account map (which
    properties sit on which Airbnb, Booking.com and Vrbo accounts) and the PriceLabs flags come from
    the same export; the Vrbo support ticket waits until the map shows which properties need it.
  - Supabase, Channex and Firebase accounts go in Vivistays' name for now and transfer to V-01 later.
    The Channex key shared in chat is retired when the Vivistays account opens.
  - Alpha signs off the Calendar, Reservations, Add a property and the soft white page alone for now;
    Alessio reviews when he comes in.
  - Team: just Alpha and this build until the Channex certification gate (week 7), then one developer.
    The developer docs are written for that hire.
  - PriceLabs is in use through Guesty, so V-01 needs its own PriceLabs connection before any
    PriceLabs-priced property moves, or its prices stop updating the day it leaves Guesty. The request
    for API access is drafted; the Channex questions (one account for several operators, uptime,
    white-label contract) are drafted with it.
  - Kept for later, all four: Expedia and other channels (through Channex, after the big three),
    different prices per channel (a markup on the Calendar's one price), damage protection (needs a
    provider decision first), and AI-suggested replies in the Phase 2 inbox, always sent by a person.
    Phone apps are still undecided; the web app works on phones meanwhile.

- **On the Calendar the whole box beside a property opens its page, not just its name (Alpha, 19 Oct
  2026: "I want the box, so it's easy; no one has to click").** The box lights up under the mouse;
  the cleaning switch inside it still only flips clean or dirty. The name stays a link for keyboards.
- **The app's start stays on screen at least 1.4 seconds (Alpha, 19 Oct 2026: "the Vivistays loading
  at the beginning is too fast").** It was fast because the demo has no server to wait for; on the
  real thing the wait is the sign-in check and the workspace answer, usually under a second on a
  good line. Either way the mark and the ring now settle rather than flash.

## 2026-10-18

- **Connecting a property to Channex is asked for from its page and done by the worker (integration
  step 3).** An admin presses Connect to Channex; the request is queued (`channex_setups`, migration
  0018) and the worker makes the property in Channex as one property, one unit and one rate plan, then
  stores the Channex ids in the mapping table. Each operator's properties go in the operator's own
  Channex group, made the first time one of its properties is connected and remembered
  (`channex_groups`), so operators stay apart in Channex as the playbook asks. Channex puts a new
  property in the account's default group as well; the operator's group is the one that matters.
- **Connecting sends nothing to any channel.** A property in Channex with no listing linked to it
  reaches no channel, so the one-manager rule holds: Guesty keeps running a property until the
  move-over step. A property V-01 already runs gets a full sync queued the moment it is connected,
  so Channex holds its prices and availability before any listing is linked (step 7).
- **When Channex is busy the worker tries again later, with a growing wait, up to ten times; when
  Channex refuses, the request fails at once with an alert,** and the page shows the reason. Pressing
  Try again starts the attempts over. Every request and outcome is in the audit trail and the sync
  log. The stand-in channel manager used in tests hands out ids unique to each instance, so two
  stand-ins in one run never clash in the mapping table.
- **Changes to a guest's name, email and phone are now in the audit trail** (migration 0017). They
  were being saved without a record of who changed them; found while mapping progress on 18 October.
- **Clean or dirty is a small switch (Alpha, 18 Oct 2026: "this should be a tiny toggle").** One tap
  flips it, on the Calendar and on the property's page; who changed it and when is in the tooltip.
  This replaces the panel with a Mark clean button from 16 October.
- **The property page opens with the property at a glance (Alpha, 18 Oct 2026: "we are missing a lot
  of details").** Under the photos: the listing's title and address; bedrooms, bathrooms, beds, guests
  and photos as counts; the channels it is listed on, as marks; clean or dirty, changeable there; and
  buttons to its own calendar and bookings (the Calendar and Reservations open searched for it).
  Guesty's property page was the measure; the page keeps V-01's own shape.
- **A property can be archived, from a Settings part at the end of its page.** It leaves every screen
  and nothing more is sent for it; its bookings, history and Channex link stay, so V-01 support can
  bring it back. Settings also shows the short code, area, who runs the channels, who sets prices and
  when it was added. Task templates, automation, saved replies and accounting are Guesty parts of
  the same page; they come with the inbox (Phase 2), tasks (Phase 3) and owner accounting (after
  switch-off).
- **Custom fields, because Guesty has them and the team's critical details live there (Alpha, 18 Oct
  2026: "see custom field for example, so we have to factor this in so we don't have issues or miss
  anything").** An admin defines fields once for the workspace (`custom_fields`, migration 0019), each
  of a kind: short text, long text, link or secret. Every property shows every field, in the admin's
  order, with its value (`property_field_values`); anyone who edits properties fills them in, from a
  Custom fields part of the property page. Links must be web addresses. Vivistays' Guesty fields
  (check-in instruction link, full address, lock codes, cleaning policy, internal note) all fit these
  kinds; the Guesty import will carry them across. Reservation custom fields and Guesty's "default
  values" for them come with the inbox (Phase 2), since that is where message templates use them.
- **Secrets are sealed in the API, not in the database.** A secret field (a lock code, a key-safe
  code, a Wi-Fi password) is encrypted with AES-256-GCM under `FIELD_SECRET_KEY` before it is sent to
  Postgres, so the database, its logs, backups and the audit log only ever hold sealed bytes; the
  plain column stays null for them. It is opened only for roles with `secrets.read` (admin,
  operations, guest comms): the accounts and field roles see that a value is set and nothing more,
  and V-01 support never sees one, even with the key on the server. Without the key the API refuses
  to save a secret rather than store it plain. Changing the key makes stored secrets unreadable, so it
  is rotated only with a re-encryption step. Only admins define fields (`fields.manage`).
- **Guesty's List on channels page is the shape of our next step (Alpha, 18 Oct 2026: "also note this
  very important").** A card per channel on the property page: Airbnb, Booking.com and Vrbo first,
  then the channels reached through Channex later and the booking engine. A linked card opens the
  listing on the channel's site and can pause it (stop taking bookings there) and resume; an unlinked
  one links a listing. This is integration step 7, the listing links that make V-01 reach the
  channels, so it comes after the downtime safety net (step 6).
- **Hosting moves to Firebase (Alpha).** Firebase hosts the whole project, the web app and the API
  and worker, in place of Render. Supabase stays the database, file storage and, for now, sign-in.
  Not urgent; nothing in the code has changed yet.

## 2026-10-16

- **Every property is clean or dirty, shown under its name on the Calendar (Alpha).** A guest's
  check-out makes it dirty by itself, at the time agreed for that stay or the property's usual
  check-out time, in the operator's time zone; the worker looks every 15 minutes. A check-out never
  undoes a later change by hand: a property marked clean after the guest left stays clean. One click
  on the label marks it clean or dirty, and the label says who did it and when, or which guest's
  check-out made it dirty. Dirty is amber, and red with "guest arriving" when a guest arrives that day.
  Admins, operations and the field team can change it; the rest of the team sees it. A Cleaning filter
  sits with the others. Migration 0016 adds the status, when it changed and who changed it, and every
  change is in the audit trail.
- **The Calendar is one long timeline, from a year back to two years ahead (Alpha).** It scrolls
  sideways with a trackpad, the scrollbar or Shift and the mouse wheel, and with the plain wheel when
  every property already fits on screen; on a phone, a swipe. Not everyone uses the arrows: they stay,
  and move a week at a time. Today comes back to today, and the dates beside the arrows open a date
  picker to jump anywhere. Nights load four weeks at a time as they come into view, with a soft grey
  pulse while they load, and only what is on screen is drawn, so a long portfolio stays quick. A
  booking that started off screen keeps its mark and name at the left edge.
- **Free dates is now Availability and comes first in the filters (Alpha):** "Available 23 to 25 Oct,
  4 guests" shows only the properties with no booking or block on those nights and room for everyone,
  so nobody checks property by property. The calendar moves to the stay when it is applied.
- **Selecting nights opens a short list of actions, as Guesty's panel does (Alpha: "ours is too
  confusing").** The panel's title is the property, with the nights under it, then what is there now.
  Below that: Set a price, Set a minimum stay and Back to the usual price and stay; Block the nights,
  Owner staying and Open the blocked nights; and Close to arrivals or departures. Choosing one shows
  only what that one needs, with All actions to go back. Its button says what will happen: "Block 2
  nights" when one of three is booked, or "Nothing to block" when all are taken.
- **Pages open with a turning ring, as Guesty's do (Alpha),** in the accent colour on a quiet track,
  with a line saying what is loading. The app's own start shows the brand above it. With reduced motion
  it turns slowly rather than not at all, so it still says "working".
- **Closing the Calendar's panel gives the keyboard back to the night or booking it came from,** and
  arrow keys pressed quickly are all counted, however fast the view moves.
- **The demo's sample properties have pictures,** two drawn rooms each, so the names column, the
  Properties list and each property's page show a cover. They are illustrations made for the demo, not
  photos of real places.
- **Direct bookings stay in Phase 4 (Alpha).** The Calendar and booking panel don't add them now.

## 2026-10-15

- **The Calendar after Alpha's review.** Anyone leaving Guesty should find their way around it as
  easily as before, without V-01 copying Guesty. The changes below come from that review.
- **A booking selected on the Calendar offers Open reservation, Edit and Message guest (Alpha).** The
  panel shows the status, channel and its code, property, check-in and check-out with their times,
  nights, party, total, the guest's contact details and the team's notes. Edit works in the panel.
- **Every booking has its own page** (design phase D1): the stay, the guest and the team's notes,
  with what the channel sent beside them and a link to the stay on the Calendar. The Reservations list
  shows upcoming bookings (staying now included), past ones and cancellations, 200 at a time, and
  finds one by guest, the channel's code or property. Both await design sign-off.
- **The team can change a booking's guest details, times agreed for that stay, and notes; the dates,
  party and price stay as the channel sent them,** because those change on the channel. Admins,
  operations and the guest team can change them; accounts and V-01 support can look; the field team
  can't see bookings, which carry guests' contact details. Migration 0015 adds the agreed times (none
  means the property's usual times) and a limit of 4,000 characters on notes. Every change is in the
  audit trail.
- **A channel's new details for a guest replace the team's, but a detail it doesn't send keeps what
  the team typed** (Airbnb shares no email address, say). The booking import only overwrites what the
  channel sends.
- **Message guest offers an email, a call or a text when V-01 has the details,** with the stay in
  the email's subject. Messages with Airbnb, Booking.com and Vrbo guests stay on those channels until
  the Inbox (design phase D2, Phase 2).
- **A night's box is 72 pixels wide at least (Alpha),** up from 52, so a two-night stay shows the
  guest's whole name. A laptop shows about 12 to 15 nights instead of 21; a phone scrolls sideways
  through two weeks. A bar too short for the name shows the first name, and a one-night stay shows
  only its channel's mark: never a stray letter. The whole name is in the hover line and the panel.
- **Each booking's bar starts with the mark of the channel it came from (Alpha):** Airbnb,
  Booking.com, "V" for Vrbo, "E" for Expedia, or a person for a direct booking. The marks are drawn in
  ink on a white circle, never in the channels' own colours, because colour still means status. This
  reverses the Design Roadmap's rule that channels are named only in words; the roadmap changes at its
  next revision. Everywhere else a channel is still named in words beside its mark.
- **The Calendar's filters sit across the top:** Area (area or town), Tags, Sync (moved here, still
  on Guesty, not connected yet), Bedrooms (this many or more) and Free dates (no booking or block on
  any night of a stay, and room for the party). Beside them: how many properties are showing out of
  how many, and Clear all. The search is at the top of the names column, where Guesty users look for
  it, and finds a property by name, short code, area or tag. Area, tags, sync and bedrooms are kept in
  the browser for each workspace; a search and free dates start empty each visit. Free dates are asked
  of the API, because they reach beyond the nights on screen, and the calendar then moves to the stay
  and marks its nights along the top.
- **Properties have tags** (migration 0014): the team's own labels, such as an owner or "Sea view",
  set under the name on the property's page. Up to 30 a property, 40 characters each, and each once
  whatever the capitals. Guests and channels never see them.
- **What the marks mean moved behind a "Key" button,** and the nights shown sit beside the arrows.
- **Each property is made in Channex as one property, one unit and one rate plan** ("Whole place" and
  "Standard"): a holiday home is booked once a night. Channex closes a night itself as soon as a booking
  arrives, so a home is never sold twice while V-01 catches up or is down, and minimum stays apply to the
  night a guest arrives. If Channex refuses any part, what was made is removed again. The channels'
  existing listings are then linked to the property in Channex, so they keep their reviews.
- **V-01's Channex code is proven on Channex staging** (Alpha ran `pnpm channex:check
  --make-test-property`). Channex accepted the property, unit and rate plan exactly as V-01 sends them;
  a price sent as whole pence (15000) read back as £150.00; a minimum stay and an open night read back as
  sent, and the night was put back afterwards. "V-01 test property" stays on staging for later tests.
- **Bookings from Channex are saved before they are acknowledged** (integration step 5). Each revision
  is stored as received, then saved as a reservation with its guest, party and total; only once that has
  committed is it acknowledged, so Channex keeps anything V-01 hasn't saved in its feed. A booking whose
  nights are taken is still saved, as a conflict that holds no nights, with an urgent alert; if it later
  stops overlapping, it is confirmed. A cancellation releases the nights. Revisions of one booking that
  arrive together apply in the order Channex made them. A revision that can't be saved is tried again
  every five minutes and alerts once (migration 0013 records the attempts).
- **A booking V-01 already has under the channel's own code is linked, not saved twice.** Bookings
  brought across from Guesty keep their Airbnb or Booking.com codes, so when Channex later sends the same
  booking it joins the one already there.
- **The Calendar screen (design phase D1) is every property by night.** Each night shows the price the
  channels get, with any minimum stay or closed date of its own; the usual minimum is beside the name.
  Bookings and blocks are bars from the middle of the arrival day to the middle of the departure day, so
  a turnover shows as two bars meeting. A booking that came in over another (`conflict`) is outlined in
  red and holds no nights. Nights fill the width of the screen; phones scroll sideways through two weeks.
  Awaiting design sign-off from Alpha and Alessio.
- **Nights are changed by choosing them.** Drag across nights, and down across properties; on a phone,
  tap a night and stretch it in the panel; on a keyboard, Shift and the arrows. A panel then sets the
  price, minimum stay, closed arrivals or departures, or blocks or opens the nights, optionally on chosen
  days of the week. Properties V-01 doesn't run yet say their changes stay in V-01. A role that can't
  change the calendar sees it read-only.
- **In the demo, the demo user also belongs to Northwind Stays,** an invented operator with sample
  bookings laid out around today, so the Calendar can be tried. Brightwater Lets shows support access.
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
