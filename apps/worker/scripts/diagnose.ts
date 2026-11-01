import { sql } from 'drizzle-orm';
import { liveDeps } from '../src/live-deps.ts';

/**
 * pnpm diagnose --org <slug>
 *
 * Read-only counts for one workspace: homes, owners, bookings by status and month, and bookings
 * with no price. Prints numbers only, never names or guests' details. Run from GitHub
 * (Actions → Diagnose) when a page shows figures that look wrong.
 */

const args = process.argv.slice(2);
const at = args.indexOf('--org');
const slug = at >= 0 ? args[at + 1] : undefined;
if (!slug) {
  console.error('Which operator? pnpm diagnose --org <slug>');
  process.exit(2);
}
const { deps } = liveDeps(undefined, { applicationName: 'v01-diagnose', queryTimeoutMs: 60_000 });
try {
  const org = await deps.db.findOrganisation(slug);
  if (!org) throw new Error(`No operator with the slug "${slug}".`);
  await deps.db.withOrg({ orgId: org.id }, async (tx) => {
    const q = async (title: string, query: ReturnType<typeof sql>) => {
      const rows = (await tx.execute(query)).rows;
      console.log(`\n${title}`);
      console.table(rows);
    };
    await tx.execute(sql`set transaction read only`);
    await q(
      'Homes',
      sql`select count(*)::int as homes,
                 count(*) filter (where archived_at is not null)::int as archived,
                 count(*) filter (where owner_id is not null)::int as with_owner,
                 count(*) filter (where owner_id is not null and archived_at is null)::int as live_with_owner,
                 count(*) filter (where managed_by::text = 'guesty')::int as run_by_guesty
            from app.properties`,
    );
    await q(
      'Owners',
      sql`select count(*)::int as owners,
                 count(*) filter (where exists (select 1 from app.properties p where p.owner_id = o.id))::int as with_homes,
                 count(*) filter (where exists (select 1 from app.properties p where p.owner_id = o.id and p.archived_at is null))::int as with_live_homes
            from app.owners o`,
    );
    await q(
      'Bookings by status',
      sql`select status::text, count(*)::int as bookings,
                 count(*) filter (where total_minor is null)::int as no_price,
                 min(check_in)::text as first_check_in, max(check_out)::text as last_check_out
            from app.reservations group by 1 order by 2 desc`,
    );
    await q(
      'Confirmed nights by month (all homes, homes with an owner)',
      sql`select to_char(d, 'YYYY-MM') as month, count(*)::int as nights,
                 count(*) filter (where p.owner_id is not null)::int as owned_nights,
                 count(*) filter (where p.owner_id is not null and p.archived_at is null)::int as owned_live_nights,
                 round(sum(r.total_minor::numeric / greatest(r.check_out - r.check_in, 1)) / 100)::int as earned_major
            from app.reservations r
            join app.properties p on p.id = r.property_id
            cross join lateral generate_series(r.check_in, r.check_out - 1, interval '1 day') d
           where r.status = 'confirmed' and d >= date '2026-05-01' and d < date '2027-01-01'
           group by 1 order by 1`,
    );
    await q(
      'Imports',
      sql`select started_at::text, finished_at::text, dry_run,
                 summary -> 'reservations' ->> 'seen' as bookings_seen,
                 summary -> 'reservations' ->> 'created' as bookings_created
            from app.guesty_imports order by started_at desc limit 5`,
    );
  });
} finally {
  await deps.db.close();
}
