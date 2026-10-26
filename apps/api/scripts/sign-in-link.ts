/**
 * pnpm sign-in-link <email> [--to https://vivi-os.web.app]
 *
 * Makes a one-time sign-in link for someone already invited or signed up, without sending any
 * email: for when the email service isn't working. Prints the link; open it in the browser where
 * you want to be signed in. It works once and runs out after an hour, like the emailed one.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/api/.env, so only someone holding the
 * service key can make one. Never paste the link anywhere: it signs in whoever opens it.
 */

const args = process.argv.slice(2);
const email = args
  .find((a) => !a.startsWith('--') && a.includes('@'))
  ?.trim()
  .toLowerCase();
const toAt = args.indexOf('--to');
const redirectTo = (toAt >= 0 ? args[toAt + 1] : undefined) ?? 'https://vivi-os.web.app';

if (!email) {
  console.error('Whose link? pnpm sign-in-link name@vivistays.com');
  process.exit(2);
}
const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/api/.env.');
  process.exit(2);
}

const response = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirectTo }),
});
const body = (await response.json().catch(() => ({}))) as {
  action_link?: string;
  properties?: { action_link?: string };
  msg?: string;
  message?: string;
  error_description?: string;
};
const link = body.properties?.action_link ?? body.action_link;
if (!response.ok || !link) {
  console.error(
    `Supabase wouldn't make the link (${response.status}): ${body.msg ?? body.message ?? body.error_description ?? 'no reason given'}`,
  );
  if (response.status === 404 || response.status === 422) {
    console.error('Has this email been invited to a workspace, or signed in before?');
  }
  process.exit(1);
}
console.log(`\nOne-time sign-in link for ${email} (works once, for an hour):\n\n${link}\n`);
console.log('Open it in your browser. Don’t paste it into chat or email: whoever opens it is signed in.');
