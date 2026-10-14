# V-01

Our own platform for running short-stay properties, built to replace Guesty. V-01 is its own company.
Its console oversees every operator on the platform (an operator is a company that manages properties),
and each operator gets its own workspace. Vivistays is the first operator.

## See it running

You need Node 22 and pnpm 10. If you don't have them, install Node 22 from
[nodejs.org](https://nodejs.org), then run `corepack enable`, which sets up pnpm.

```bash
git clone https://github.com/Scofield-Idehen/vivi-001.git
cd vivi-001
pnpm install
pnpm demo
```

Then open http://localhost:5173.

The demo runs on sample data kept in your browser, so it needs no database or sign-in. After pulling new
code, run `pnpm install` again before `pnpm demo`.

## What you'll see

You're signed in as a V-01 owner and a Vivistays admin. Vivistays is empty until its properties come
across from Guesty. Northwind Stays and Brightwater Lets are made-up companies.

- **The V-01 console**
  - Every operator in one place: their properties, their team, and whether prices and bookings are
    flowing to and from the channels.
  - Problems are listed first.
- **Support access**
  - V-01 staff open a company's workspace with a reason and a time limit, and can't change anything.
  - The company sees every visit.
- **A company's workspace**
  - Today, Properties and Workspace settings.
  - The other modules are in the menu and arrive in later phases.

![The V-01 console overview](docs/images/console-overview.png)
*The console: every operator, what needs attention, and channel sync.*

![One operator in the console](docs/images/console-operator.png)
*One operator: details, team, channels and support history.*

![An operator's workspace opened with support access](docs/images/support-access.png)
*Support access: the company's workspace, read-only, with a banner showing when access ends.*

## Coming next

Phase 1 connects V-01 to Airbnb, Booking.com and Vrbo through Channex: properties, prices and
availability out; bookings in. It also adds the Calendar, Reservations and Channels & sync screens.

---

For developers: [docs/developers.md](docs/developers.md). Decisions and the reasons for them:
[docs/decisions.md](docs/decisions.md).
