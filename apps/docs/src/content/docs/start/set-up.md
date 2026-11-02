---
title: Setting up an operator
description: Onboarding a new operator end to end, in order, and who does each step.
---

This is the order to set up a new operator. Each step says who does it: **V-01 staff**, or the operator's **admin** (the first person on the operator's team).

## 1. Workspace and brand (V-01 staff)

V-01 staff make the workspace: the company name and legal name, currency, time zone and country, and what guests see (the name shown, the accent colour and the name emails come from). They also invite the operator's first admin by email. The operator appears in the V-01 console as **Onboarding** and turns **Live** once its first home's channels run through V-01.

Before go-live, V-01 also makes sure a data processing agreement is signed and the operator's email domain is set up to send email.

The admin can then set **Phone guests call** on the Workspace page. To change the rest of the brand, contact V-01 support for now.

## 2. Team and roles (admin)

On **Workspace → Team**, invite each colleague by email with a role, and limit them to certain homes if needed. Cleaners and maintenance staff can be added straight from Guesty. See [Team and access](/guides/team-and-access/) and [Tasks and the field team](/guides/tasks-and-field-team/).

## 3. Homes (V-01 staff, or the admin)

- **From Guesty:** the admin creates an Open API application in Guesty (Settings → Integrations → Open API) and passes the credentials to V-01 privately, never in a chat. V-01 staff run the import. It brings homes, bookings from the last year, the calendar, custom fields, owners and recent guest conversations. Active listings arrive as live homes, inactive ones as archived. V-01 runs a rehearsal first and shares what needs checking.
- **In V-01:** **Properties → Add property**. See [Properties](/guides/properties/).

## 4. Custom fields (admin)

Every workspace starts with Top lock code, Bottom lock code, Wi-Fi name, Wi-Fi password and Check-in instructions. Add your own with **Manage fields** on any property page, then fill in each home. See [Properties](/guides/properties/#custom-fields).

## 5. Channels through Channex (admin, then V-01 staff)

The admin adds each channel account on **Channels & sync** and connects each home to Channex. Homes from Guesty stay run by Guesty until V-01 staff move them over, one at a time, once their listings are off Guesty. See [Channels](/guides/channels/).

## 6. Door locks (admin or operations)

Connect the TTLock app account in **Workspace → Door locks**, put each lock on its home, and turn on "V-01 makes the codes" only for locks Guesty no longer codes. See [Door locks](/guides/door-locks/).

## 7. Card payments (V-01 staff)

V-01 staff connect Stripe. Until then card payments stay switched off. For now there is one Stripe account, Vivistays'; each operator having its own Stripe account is not built yet. See [Payments and deposits](/guides/payments-and-deposits/).

## 8. Deposits (admin or operations)

On each home's **Settings**, set the security deposit and choose whether to ask guests for it. See [Payments and deposits](/guides/payments-and-deposits/).

## 9. Booking website (admin)

Turn it on in **Workspace → Booking website**, then switch on each home. See [Booking website](/guides/booking-website/).

## 10. Owners (admin, operations or accounts)

Owners come across from Guesty with their homes, or are added on **Owners → Add an owner**. Set each home's terms, upload contracts, and invite owners to log in. See [Owners and statements](/guides/owners-and-statements/).
