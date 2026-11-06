---
title: Payments and deposits
description: Taking card payments and holding damage deposits through Stripe.
---

ViVi OS takes card payments through **Stripe**. The guest always types their card on Stripe's own page, so no card number ever reaches ViVi OS or your team. Stripe is connected by ViVi OS staff; until it is, the booking says "Card payments switch on once Stripe is connected."

While Stripe is in test mode, ViVi OS says so ("Stripe test mode, no real money") and test payments are marked "(Stripe test)". You can try a payment with Stripe's test card, 4242 4242 4242 4242.

## Asking for a card payment

On a booking's page:

1. **Ask for a card payment**.
2. Enter the amount and press **Make link**.
3. Copy the link, or **Send on WhatsApp** to the guest's number.

The link lasts 24 hours. When the guest pays, the payment is recorded on the booking and the balance updates. **Cancel link** stops it being used.

## Damage deposits

A deposit is a **hold** on the guest's card, not a charge. Most deposits go back untouched. A hold lets go in a day or two at no cost, while a refunded charge takes 5–10 working days to reach the guest and Stripe keeps its fee. Only what you keep is charged.

A card keeps a hold for about 7 days (5 for Visa credit cards), so ask close to arrival.

### Asking guests automatically

On each home's **Settings**, under **Damage deposit**:

- set the security deposit amount (in the home's prices)
- **Ask guests for the deposit**: the guest's stay page asks them to add their card from 3 days before arrival, and Today warns you about a guest arriving today or tomorrow without it held
- **Hold the door code until it's in place**: the door code and Wi-Fi password stay hidden on the stay page until the deposit is held
- **Ask Airbnb guests too**: leave this off unless your Airbnb listing states the deposit. Airbnb doesn't allow one otherwise; damage on Airbnb goes through a [claim](/guides/claims/).

### Holding one by hand

On a booking's page, **Hold a deposit**, enter the amount, **Make link**, and send it. This button is hidden on Airbnb bookings unless the home allows Airbnb deposits.

### After the stay

- **Release** lets the whole hold go. It can't be taken again after this.
- **Keep some or all**: enter the amount and what it was for (for example, "Broken lamp"), then **Charge the card**. The rest goes back to the guest's card. ViVi OS records both a charge and a card payment of the same amount, so the balance doesn't move.

Long stays can outlast a hold. A "charge and refund" deposit for long stays is not built yet.

## Website bookings

Guests who book on your [booking website](/guides/booking-website/) pay on Stripe's page as they book. Their booking shows "Paid in full".

## Other payments

Bank transfers, cash and payments collected by the channel are recorded by hand on the booking. See [Reservations](/guides/reservations/#money-on-a-booking).

## Not yet

Each operator having its own Stripe account. For now there is one, Vivistays'.
