---
title: Door locks
description: Letting ViVi OS make door codes on TTLock smart locks for each stay and each job.
---

ViVi OS can make door codes on **TTLock** smart locks. Each guest and each job gets its own code, and codes follow the booking.

## What ViVi OS does

- **Each stay** gets one six-digit code on every lock of the home. It works from the check-in time to 30 minutes after check-out, and is made up to 14 days ahead.
- **Each job** (a clean or repair) gets a code for its day only, 07:00 to 22:00.
- If a booking's dates move, the code's times move. If it is cancelled, the code is taken off.
- A code shows only once the lock holds it.

## Where codes appear

- On the booking's page, under **Door code**, for roles that may see codes.
- On the guest's [stay page](/guides/guest-stay-page/), from the day of arrival to the day of departure.
- In the job's **Getting in** box, on the job's day.
- In [automatic messages](/guides/inbox/#automatic-messages), where the message asks for the door code.

Accounts and ViVi OS support never see codes.

## Setting it up

Admins and operations do this in **Workspace → Door locks**.

1. **Connect TTLock**. Enter the email or phone and the password you use to sign in to the **TTLock app**, the account that owns the locks. ViVi OS passes the password to TTLock once and doesn't keep it.
2. Your locks are listed. Put each one on its home.
3. Turn on **ViVi OS makes the codes** for a lock.

**ViVi OS makes the codes** is off for every lock until you turn it on. If another system also makes codes for a lock, turn it on only once that system has stopped, so the two never fight over a lock.

The locks need to be on a TTLock gateway, so ViVi OS can reach them.

## Keeping an eye on them

[Today](/guides/today/) warns you about:

- a lost TTLock sign-in (**Sign in again** in Door locks)
- a gateway that is offline
- codes that didn't reach a lock (ViVi OS keeps trying)
- batteries under 25%

## Disconnecting

**Disconnect** stops ViVi OS making codes. Codes already on the locks keep working until they end.
