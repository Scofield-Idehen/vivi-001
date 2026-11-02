---
title: Using the API
description: How to call V-01's API, sign in, choose a workspace, and read its errors.
sidebar:
  order: 1
---

V-01's own screens use this API, so anything the screens do, the API does. The full list of
endpoints, with what to send and what comes back, is under **API endpoints** in the sidebar. It is
written from the API's code on every build, so it always matches what is running.

## Where it is

The API lives at the same address as the app, under `/v1`. On staging that is
`https://vivi-os.web.app/v1/…`.

## Signing in

Most calls need two headers:

| Header | What it carries |
| --- | --- |
| `Authorization: Bearer <token>` | The person's access token from signing in (Supabase Auth). It lasts an hour and the app refreshes it. |
| `x-org-id: <workspace id>` | Which workspace (operator) the call is for. `GET /v1/me` lists the workspaces the person belongs to. |

Every call is checked against the person's [role](/reference/roles/) and, if they are limited to some
homes, only those homes are visible. One operator can never see another's data: the database
itself refuses it.

## Public calls

Two parts need no sign-in:

- **The booking website**, `/v1/site/{workspace}/…`: the homes, nights and prices, a quote, and
  booking. Only works while the operator has switched the website on, and only shows the homes they
  put on it. See [Booking website](/guides/booking-website/).
- **The guest's stay page**, `/v1/stay/{key}`: by the private key in the guest's link.

## Booking from your own website

If you'd rather keep your own website's design, it can call the booking website's API directly:

1. `GET /v1/site/{workspace}?checkIn=2026-12-18&checkOut=2026-12-21&adults=2` lists the homes, each with its total
   for those dates or why it isn't free.
2. `GET /v1/site/{workspace}/homes/{id}/nights?from=…&to=…` gives each night's price and whether it's free, for a
   calendar.
3. `POST /v1/site/{workspace}/quote` with the home, dates and guests gives the price, line by line.
4. `POST /v1/site/{workspace}/book` with the same plus the guest's name, email and `acceptTerms: true` returns a
   Stripe payment page address. Send the guest there.
5. Stripe sends the guest back to `/book/{workspace}/done/{bookingId}` on V-01, which confirms the booking.
   `GET /v1/site/{workspace}/bookings/{bookingId}` says whether it's `open`, `booked`, `refused` (the nights went
   while they paid; nothing charged) or `expired`.

The price is always worked out again by V-01 when the guest books; a price sent by a website is never
trusted.

## Errors

Every error has the same shape, with a stable code to act on and a message a person can read:

```json
{ "error": { "code": "nights_taken", "message": "Those dates aren’t free. Try other dates." } }
```

| Status | Meaning |
| --- | --- |
| 400 | Something in the request isn't valid; the message names the field. |
| 401 | Not signed in, or the token has run out. |
| 403 | Signed in, but the role doesn't allow this. |
| 404 | Not found in this workspace (or not yours to see). |
| 409 | It can't be done as things stand: the nights are taken, the booking is cancelled, and so on. |
| 502 / 503 | A service V-01 relies on (Stripe, Channex) didn't answer, or isn't set up yet. |

Every response carries an `x-request-id`. Quote it when asking V-01 support about a call.
