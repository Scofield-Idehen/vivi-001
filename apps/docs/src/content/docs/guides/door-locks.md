---
title: Door locks
description: Letting V-01 make door codes on TTLock smart locks for each stay and each job.
---

V-01 can make door codes on **TTLock** smart locks, as Guesty's Locks Manager does. Each guest and each job gets its own code, and codes follow the booking.

## What V-01 does

- **Each stay** gets one six-digit code on every lock of the home. It works from the check-in time to 30 minutes after check-out, and is made up to 14 days ahead.
- **Each job** (a clean or repair) gets a code for its day only, 07:00 to 22:00.
- If a booking's dates move, the code's times move. If it is cancelled, the code is taken off.
- A code shows only once the lock holds it.

## Where codes appear

- On the booking's page, under **Door code**, for roles that may see codes.
- On the guest's [stay page](/guides/guest-stay-page/), from the day of arrival to the day of departure.
- In the job's **Getting in** box, on the job's day.
- In [automatic messages](/guides/inbox/#automatic-messages), where the message asks for the door code.

Accounts and V-01 support never see codes.

## Setting it up

Admins and operations do this in **Workspace → Door locks**.

1. **Connect TTLock**. Enter the email or phone and the password you use to sign in to the **TTLock app**, the account that owns the locks. V-01 passes the password to TTLock once and doesn't keep it.
2. Your locks are listed. Put each one on its home.
3. Turn on **V-01 makes the codes** for a lock.

**V-01 makes the codes** is off for every lock until you turn it on. Turn it on only for locks that Guesty's Locks Manager no longer codes, so the two never fight over a lock.

The locks need to be on a TTLock gateway, so V-01 can reach them.

## Keeping an eye on them

[Today](/guides/today/) warns you about:

- a lost TTLock sign-in (**Sign in again** in Door locks)
- a gateway that is offline
- codes that didn't reach a lock (V-01 keeps trying)
- batteries under 25%

## Disconnecting

**Disconnect** stops V-01 making codes. Codes already on the locks keep working until they end.
