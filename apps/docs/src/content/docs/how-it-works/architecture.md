---
title: How ViVi OS is built
description: The parts of ViVi OS, where they run, and how a booking travels through them.
sidebar:
  order: 10
---

## The parts

| Part | What it does | Where it runs |
| --- | --- | --- |
| Web app | Every screen: the team's app, the guest's stay page, the booking website, the owner log-in and ViVi OS's console. | Firebase Hosting |
| API | Everything the screens ask for and change, checked against the person's role. | Google Cloud Run |
| Worker | Background jobs: sending prices and free nights to the channels, saving bookings from them, lock codes, reminders. | Google Cloud Run |
| Database | Postgres, one database for every operator, kept apart by the database itself. | Supabase |
| Sign-in and files | Accounts, photos and receipts. | Supabase |

Outside services, each behind ViVi OS's own code so they can be changed:

- **A channel connection** links ViVi OS to Airbnb, Booking.com and Vrbo.
- **Stripe** takes card payments and holds deposits. No card number ever reaches ViVi OS.
- **TTLock** makes door codes.
- **The operator's previous system**, while they move over: ViVi OS imports homes, bookings, owners and staff from it.

## A booking's journey

1. A guest books on Airbnb. Airbnb tells ViVi OS through the channel connection.
2. ViVi OS stores the message exactly as received before doing anything else, so it can be replayed.
3. The worker saves it as a booking. If the nights are already taken, the database refuses the overlap and the
   booking is flagged as a conflict on Today instead of being lost.
4. The nights close on every other channel, through the channel connection.
5. The check-out clean is made and given to the home's usual cleaner, the guest gets their stay page link, and
   the door code is made for the stay.

A booking on the [booking website](/guides/booking-website/) takes the same path from step 3: it closes the nights
everywhere the moment it is saved.

## Rules that never bend

- **No double bookings.** The database refuses two stays on the same night in the same home, whatever the code
  does.
- **One operator never sees another.** Every row belongs to one operator, and the database checks it on every
  read.
- **Codes and passwords are sealed** before they are stored, and shown only to the roles that need them.
- **Everything is recorded.** Every change is in the audit trail, with who made it.

More in [Security](/how-it-works/security/).
