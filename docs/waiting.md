# Waiting to be done

Things decided but parked. Nothing here blocks building. Newest first.

## Parked by Alpha, 20 Oct 2026

Guesty stays on for a long time, so we build almost everything first and come back to these.

- **Move the worker to the cloud.** Parked because it costs money: the worker has to run all the
  time (one Cloud Run instance that never sleeps). Until then the worker only runs on a laptop
  (`pnpm dev`), so automatic messages, sending emails and the nightly Channex check run only while
  that laptop is on. To switch it on: save the `WORKER_ENV` secret in the staging environment (the
  worker's `.env` plus `CHANNEL_PROVIDER=channex`, `APP_URL=https://vivi-os.web.app`,
  `NODE_ENV=production`, no `PORT`), set the repo variable `DEPLOY_WORKER=true`, run Deploy, then
  stop `pnpm dev` on the laptop. See `runbooks/hosting.md`.
- **Channex for real.** Connecting the channel accounts, linking listings and certification.
  Never connect Vivistays' live Airbnb, Booking.com or Vrbo accounts to Channex staging.
- **Guesty import.** Bring Vivistays' real properties and bookings across from Guesty. Needs the
  Guesty credentials, which go only into the worker's `.env` or GitHub secrets, never chat.
- **Email through Resend (important; needs the boss's go-ahead for the domain).** One Resend
  account sends both the Inbox's guest emails and Supabase's invitation and sign-in emails (Resend's
  SMTP, smtp.resend.com, port 465, user `resend`, the API key as password), from Vivistays' own
  domain. Needs DNS records added to that domain to verify it. Free plan: 3,000 emails a month,
  100 a day; Pro is $20 a month for 50,000. Then `RESEND_API_KEY` and `MAIL_FROM` go into
  `WORKER_ENV` and the worker's `.env`. Replaces the Gmail SMTP plan.
- **Before anything real: rotate every secret pasted in chat during set-up** (Supabase database
  password, role passwords, `FIELD_SECRET_KEY`, the Channex key).
