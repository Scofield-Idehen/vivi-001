---
title: Booking website
description: Your own site where guests search your homes, choose dates and pay by card.
---

The booking website is where guests book your homes directly, without Airbnb or Booking.com. It replaces Guesty's booking engine and works the same way for guests: the same search, the same price box and the same details form.

## What guests see

1. **All homes**, with photos and a "from" price. Guests search by dates and guests (adults, children, infants and pets) and can filter by bedrooms.
2. A home's page: photos, description, **What this home has**, **House rules**, **Cancellation**, and a calendar of free nights with prices.
3. The price box: nights, cleaning, service fee and total.
4. **Your details**: name, email, phone (optional), anything you should know, and the **Booking terms**.
5. Stripe's secure page to pay.

The guest's card is authorised on Stripe's page and charged once V-01 has saved the booking. If the nights were booked on a channel while the guest was paying, the hold is let go and the guest is told. Nobody pays for a stay they can't have. The price is always worked out again when the guest pays; the figure on the page is never trusted. A payment page lasts 30 minutes.

Guesty saved the card and charged it 7 days before arrival. V-01 takes the payment at booking, which is simpler and doesn't fail later on an expired card.

## What a website booking becomes

A confirmed direct booking in [Reservations](/guides/reservations/), with:

- the guest's details, and their request in the notes
- the total and cleaning fee
- the card payment recorded, so it shows "Paid in full"

The guest is sent to their [stay page](/guides/guest-stay-page/). Stripe emails them a receipt.

## Turning it on

You need card payments set up first. Without them, guests can look but not book. See [Payments and deposits](/guides/payments-and-deposits/).

In **Workspace → Booking website** (admin):

- **Booking website on**
- **Service fee (optional)**: a percentage up to 20, or leave it empty
- **Booking terms guests accept**: payment, cancellation, house rules, damage, and anything else guests agree to
- **Save**, then **Open** to see the site

Then, on each home's **Settings**, turn on **Show and take bookings on the booking website**.

Only homes whose channels V-01 runs, or that have no channels, can go on the site. A website booking must close those nights on Airbnb and Booking.com, and that only happens once V-01 runs the channels. Homes still run by Guesty say so. See [Channels](/guides/channels/).

While Stripe is in test mode, the site shows a line saying payments use test cards and no real money moves.

## Not yet

- The site on its own address (such as book.vivistays.com). For now it is under the app's address, at /book/ followed by your workspace's short name.
- A confirmation email from V-01. Stripe's receipt is sent meanwhile.
- Discount codes.
