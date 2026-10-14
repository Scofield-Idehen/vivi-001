# Adding an operator by hand

The V-01 console lists every operator and tracks their onboarding, but adding one from the console
comes later (design phase D8). Until then, V-01 sets up each operator from a trusted machine with the
owner connection. `packages/db/scripts/seed.ts` shows the same steps in code. The new operator appears
in the console at once, as Onboarding, and turns Live when its first property moves to V-01.

```sql
begin;

insert into app.organisations (name, legal_name, slug)
values ('Operator name', 'Operator legal name Ltd', 'operator-slug')
returning id;  -- use this id below as :org

insert into app.organisation_settings (organisation_id, currency, time_zone, country_code)
values (:org, 'GBP', 'Europe/London', 'GB');

insert into app.organisation_brand (organisation_id, display_name, accent_hex, sender_name)
values (:org, 'Operator name', '#1E4D4F', 'Operator name');

-- The operator's first admin. Accepted when this email first signs in.
insert into app.invitations (organisation_id, email, role)
values (:org, 'admin@operator.example', 'admin');

commit;
```

Before go-live for a new operator:

- A data processing agreement is signed (V-01 is the processor; the operator is the controller).
- Their own Channex group is created, and their channel accounts connect to it.
- Their sender domain has SPF, DKIM and DMARC records.
