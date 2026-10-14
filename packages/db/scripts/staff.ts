import pg from 'pg';

/**
 * V-01's own staff: the people who can open the console.
 *
 *   pnpm db:staff list
 *   pnpm db:staff add <email> <owner|support|viewer>
 *   pnpm db:staff remove <email>
 *
 * Runs as the owner (DATABASE_OWNER_URL), from a trusted machine. Someone added here becomes
 * staff the first time they sign in with that email. Removing someone ends any support access
 * they have open at once.
 *
 *   owner    everything in the console, and support access to any operator
 *   support  the console, and support access to any operator
 *   viewer   the console's totals and statuses only
 */
const ROLES = ['owner', 'support', 'viewer'];
const url = process.env.DATABASE_OWNER_URL;
const [command, rawEmail, role] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('Usage: pnpm db:staff list | add <email> <owner|support|viewer> | remove <email>');
  process.exit(1);
}

if (!url) usage('Set DATABASE_OWNER_URL.');
if (command !== 'list' && !email?.includes('@')) usage('Give an email address.');
if (command === 'add' && !ROLES.includes(role ?? '')) usage(`Role must be one of: ${ROLES.join(', ')}.`);

const client = new pg.Client({ connectionString: url, application_name: 'v01-staff' });
await client.connect();
try {
  if (command === 'list') {
    const { rows } = await client.query<{ email: string; role: string; signed_in: boolean }>(
      `select email, role, user_id is not null as signed_in from app.platform_staff order by role, email`,
    );
    if (rows.length === 0) console.log('No V-01 staff yet.');
    for (const r of rows)
      console.log(`${r.role.padEnd(8)} ${r.email}${r.signed_in ? '' : '  (not signed in yet)'}`);
  } else if (command === 'add') {
    await client.query(
      `insert into app.platform_staff (email, role) values ($1, $2::app.platform_role)
       on conflict (email) do update set role = excluded.role`,
      [email, role],
    );
    // If they have already signed in, link them now rather than at their next sign-in.
    await client.query(
      `update app.platform_staff s set user_id = u.id
         from app.app_users u
        where s.email = $1 and s.user_id is null and lower(u.email) = $1`,
      [email],
    );
    console.log(`${email} is V-01 ${role}.`);
  } else if (command === 'remove') {
    await client.query('begin');
    await client.query(
      `update app.support_access_grants g set ended_at = now()
         from app.platform_staff s
        where s.email = $1 and g.staff_user_id = s.user_id and g.ended_at is null and g.expires_at > now()`,
      [email],
    );
    const { rowCount } = await client.query('delete from app.platform_staff where email = $1', [email]);
    await client.query('commit');
    console.log(rowCount ? `${email} is no longer V-01 staff.` : `${email} was not V-01 staff.`);
  } else {
    usage();
  }
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  await client.end();
}
