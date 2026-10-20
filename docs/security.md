# Security: signing in and keeping people out

An addition to the V-01 Build Playbook (for v1.3, as a new section after 15, "Adapters"). Decided
with Alpha on 20 October 2026: written down now, built later; only item 1 is built today.

## What the playbook already settles

- Every table is scoped to the operator; row-level security is the second lock; isolation tests run
  on every push.
- Three database roles (`app_api`, `app_worker`, `app_jobs`) with the least each needs; nothing
  connects as the owner.
- Secrets (lock codes, Wi-Fi passwords) are encrypted by the API before they reach the database and
  are shown only to admins, operations and guest comms; never to accounts, the field team or V-01
  support.
- Every change is in the audit trail. Support access is time-limited, read-only and logged where the
  operator can see it. Webhooks are refused until signed.

## 1. Sign-in lifetime (built 20 Oct 2026)

- Supabase's access token lasts an hour and refreshes silently while the app is open; a stale token
  is refreshed and the request retried before anyone is signed out.
- The sign-in itself lasts `SESSION_MAX_HOURS` (48 by default; 12 or 24 are fine; 0 never). After
  that the person signs in again. The API enforces it from the token's sign-in time, so it holds
  whatever a browser does.
- Supabase settings to keep: JWT expiry 3600 s; refresh token rotation on, reuse interval 10 s or
  more; no time-box or inactivity timeout shorter than ours.

## 2. Two-step sign-in for admins (later)

- Admins (and V-01 staff) add an authenticator app (TOTP) to their account; Supabase supports it.
  Required before an operator's real guest data is in; optional for other roles.
- A lost authenticator is reset by another admin, logged in the audit trail.

## 3. Removing a leaver (later)

- Removing a membership also ends that person's sessions everywhere, at once (Supabase's sign-out
  of all sessions for the user), and revokes any field-team phone that was signed in.
- The console can do the same for V-01 staff.

## 4. A sign-in log and alerts (later)

- Each sign-in is recorded: who, when, from where (country from the address), which device.
  Admins see their workspace's; the console sees V-01 staff's.
- An alert on a sign-in from a new country for an admin, and on five failed attempts in a row.

## 5. Rate limits (later)

- Sign-in: a cap per address and per email, so the sign-in email can't be used to flood an inbox.
- The guest's stay page: a cap per address on `/v1/stay/:key`, so links can't be guessed at speed
  (128 random bits makes guessing hopeless anyway; the cap keeps the noise down).
- The API in general: a per-token cap, generous, so a runaway script can't take the operator down.

## 6. Secrets housekeeping (before anything real)

- Rotate everything pasted in chat during set-up: the database password, the three role passwords,
  the field secret key, the Channex key.
- Keys live only in `.env` files on the machines that need them; the service-role key never
  reaches a browser; nothing secret in the repo, the demo, or documents.
- The guest page shows codes only between arrival and departure; the link is never sent to anyone
  but the guest.
