import { ROLE_LABELS } from '@v01/shared';
import { initials } from '../components/TopBar.tsx';
import { Button, PageHeader } from '../components/ui.tsx';
import { useMe } from '../lib/api.ts';
import { signOut, useSession } from '../lib/session.tsx';
import { useWorkspaces } from '../lib/workspace.tsx';
import { YourName } from './WorkspacePage.tsx';

/**
 * The person's own page (Alpha, 29 Oct 2026: "that is the page everyone sees"): their name as the
 * team sees it, the email they sign in with, the companies they're in and as what, and sign out.
 */
export function ProfilePage() {
  const me = useMe();
  const { session } = useSession();
  const { entries: workspaces } = useWorkspaces();
  const email = me.data?.user.email ?? session?.user.email ?? '';
  const name = me.data?.user.fullName ?? null;
  const signedInAt = session?.user.last_sign_in_at ? new Date(session.user.last_sign_in_at) : null;

  return (
    <>
      <PageHeader title="My profile" description="How you appear to your team, and where you sign in." />
      <div className="flex max-w-[720px] flex-col gap-8">
        <section className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent text-[20px] font-semibold text-white">
            {initials(name ?? email)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[20px] font-semibold tracking-[-0.015em] text-ink">{name ?? email}</p>
            <p className="truncate text-[14px] text-slate">{email}</p>
          </div>
        </section>

        <section aria-labelledby="details">
          <h2 id="details" className="mb-2 text-[15px] font-semibold text-ink">
            Details
          </h2>
          <dl className="divide-y divide-hairline rounded-xl border border-hairline">
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-[13.5px] text-slate">Name</dt>
              <dd className="text-[14px] text-ink">
                <YourName current={name} />
              </dd>
            </div>
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-[13.5px] text-slate">Email</dt>
              <dd className="text-[14px] text-ink">
                {email}
                <span className="block text-[12.5px] text-mist">
                  You sign in with a link sent here; there is no password.
                </span>
              </dd>
            </div>
            {signedInAt ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-center">
                <dt className="text-[13.5px] text-slate">Signed in</dt>
                <dd className="text-[14px] text-ink">
                  {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
                    signedInAt,
                  )}
                  <span className="block text-[12.5px] text-mist">
                    You stay signed in for 48 hours on this device.
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section aria-labelledby="companies">
          <h2 id="companies" className="mb-2 text-[15px] font-semibold text-ink">
            Companies
          </h2>
          <ul className="divide-y divide-hairline rounded-xl border border-hairline">
            {workspaces.map((w) => (
              <li
                key={w.organisationId}
                className="flex items-center justify-between gap-4 px-4 py-3 text-[14px]"
              >
                <span className="text-ink">{w.organisationName}</span>
                <span className="text-slate">{ROLE_LABELS[w.role]}</span>
              </li>
            ))}
          </ul>
        </section>

        <div>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </>
  );
}
