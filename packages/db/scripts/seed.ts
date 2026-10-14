import pg from 'pg';

/**
 * Sets up operators by hand until the V-01 console exists (design phase D8).
 *
 *   pnpm db:seed          Vivistays as the first operator, plus an admin invitation.
 *   pnpm db:seed --demo   Also a fictional operator with invented properties, for local development.
 *
 * Runs as the owner. Real guest or property data never goes in a seed.
 */
const url = process.env.DATABASE_OWNER_URL;
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const demo = process.argv.includes('--demo');

if (!url) {
  console.error('Set DATABASE_OWNER_URL.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, application_name: 'v01-seed' });
await client.connect();

async function upsertOperator(input: {
  name: string;
  legalName: string | null;
  slug: string;
  accentHex: string;
}): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into app.organisations (name, legal_name, slug) values ($1, $2, $3)
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [input.name, input.legalName, input.slug],
  );
  const orgId = rows[0]?.id;
  if (!orgId) throw new Error(`Could not create ${input.name}`);
  await client.query(
    `insert into app.organisation_settings (organisation_id) values ($1) on conflict do nothing`,
    [orgId],
  );
  await client.query(
    `insert into app.organisation_brand (organisation_id, display_name, accent_hex, sender_name)
     values ($1, $2, $3, $2) on conflict do nothing`,
    [orgId, input.name, input.accentHex],
  );
  return orgId;
}

async function invite(orgId: string, email: string, role: string): Promise<void> {
  await client.query(
    `insert into app.invitations (organisation_id, email, role)
     select $1, $2, $3::app.member_role
     where not exists (
       select 1 from app.invitations where organisation_id = $1 and lower(email) = $2 and accepted_at is null
     )`,
    [orgId, email, role],
  );
}

try {
  await client.query('begin');

  const vivistays = await upsertOperator({
    name: 'Vivistays',
    legalName: null,
    slug: 'vivistays',
    accentHex: '#1E4D4F',
  });
  if (adminEmail) await invite(vivistays, adminEmail, 'admin');

  if (demo) {
    const demoOrg = await upsertOperator({
      name: 'Northwind Stays',
      legalName: 'Northwind Stays (fictional demo operator)',
      slug: 'northwind-demo',
      accentHex: '#2F5E8C',
    });
    if (adminEmail) await invite(demoOrg, adminEmail, 'admin');
    await client.query('select set_config($1, $2, true)', ['app.org_id', demoOrg]);
    const properties = [
      ['Harbour View Lodge', 'HVL', 'Harbourside', 3, 6],
      ['Mill Street Flat', 'MSF', 'Old Town', 1, 2],
      ['Orchard Cottage', 'ORC', 'Riverside', 2, 4],
      ['The Granary', 'GRN', 'Riverside', 4, 8],
    ] as const;
    for (const [name, code, area, bedrooms, maxGuests] of properties) {
      await client.query(
        `insert into app.properties (organisation_id, name, internal_code, area, bedrooms, max_guests, country_code, managed_by)
         values ($1, $2, $3, $4, $5, $6, 'GB', 'v01')
         on conflict (organisation_id, internal_code) do nothing`,
        [demoOrg, name, code, area, bedrooms, maxGuests],
      );
    }
    for (const [label, channel] of [
      ['Airbnb A', 'airbnb'],
      ['Airbnb B', 'airbnb'],
      ['Booking.com A', 'booking_com'],
      ['Booking.com B', 'booking_com'],
      ['Vrbo', 'vrbo'],
    ] as const) {
      await client.query(
        `insert into app.channel_accounts (organisation_id, channel, label)
         values ($1, $2::app.channel, $3) on conflict (organisation_id, label) do nothing`,
        [demoOrg, channel, label],
      );
    }
  }

  await client.query('commit');
  console.log(
    `Seeded Vivistays${demo ? ' and the Northwind Stays demo operator' : ''}.` +
      (adminEmail ? ` Invitation for ${adminEmail} is waiting; it is accepted on first sign-in.` : ''),
  );
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
