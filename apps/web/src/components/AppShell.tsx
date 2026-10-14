import { IconArrowLeft, IconLock } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { PLATFORM_ROLE_LABELS, ROLE_LABELS } from '@v01/shared';
import { useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useEndSupportAccess, useMe, useWorkspace } from '../lib/api.ts';
import { config } from '../lib/config.ts';
import { resetDemoData } from '../lib/demo.ts';
import { clockTime, useNow } from '../lib/format.ts';
import { MODULE_GROUPS } from '../lib/modules.ts';
import { signOut, useSession } from '../lib/session.tsx';
import { useCurrentWorkspace, useWorkspaces } from '../lib/workspace.tsx';
import { NoWorkspace } from '../pages/misc.tsx';
import { OperatorMark } from './BrandMark.tsx';
import { Button, EmptyState } from './ui.tsx';

/** The top of the sidebar: whose workspace this is, and the way back to the console for V-01 staff. */
function WorkspaceHeader() {
  const { orgId, entry, entries, choose } = useCurrentWorkspace();
  const platformRole = useMe().data?.platformRole ?? null;
  const workspace = useWorkspace(orgId);
  const name = workspace.data?.brand.displayName ?? entry.organisationName;

  return (
    <div className="flex flex-col gap-3">
      {platformRole ? (
        <Link
          to="/console"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-accent underline-offset-4 hover:underline"
        >
          <IconArrowLeft size={14} stroke={1.75} aria-hidden />
          V-01 console
        </Link>
      ) : null}
      <OperatorMark name={name} logoUrl={workspace.data?.brand.logoLightUrl} />
      {/* People in more than one company switch here. V-01 staff switch from the console instead. */}
      {!platformRole && entries.length > 1 ? (
        <>
          <label htmlFor="workspace" className="sr-only">
            Switch company
          </label>
          <select
            id="workspace"
            value={orgId}
            onChange={(e) => choose(e.target.value)}
            className="h-9 w-full rounded-md border border-hairline bg-canvas px-2 text-[13.5px] text-ink"
          >
            {entries.map((e) => (
              <option key={e.organisationId} value={e.organisationId}>
                {e.organisationName}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Modules" className="flex flex-col gap-5">
      {MODULE_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[12px] text-mist">{group.label}</p>
          {group.items.map((item) => (
            <NavLink
              key={item.path}
              to={`/${item.path}`}
              onClick={onNavigate}
              title={item.built ? undefined : `Arrives in ${item.phase}`}
              className={({ isActive }) =>
                [
                  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors',
                  isActive ? 'bg-linen font-medium text-ink' : 'hover:bg-linen hover:text-ink',
                  !isActive && (item.built ? 'text-slate' : 'text-mist'),
                ]
                  .filter(Boolean)
                  .join(' ')
              }
            >
              <item.icon size={17} stroke={1.6} aria-hidden className="shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Demo only: puts the sample data back the way it started. */
export function ResetSampleData({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  if (!config.demo) return null;
  return (
    <button
      type="button"
      className={className ?? 'text-[12.5px] text-mist underline-offset-4 hover:underline'}
      onClick={() => {
        resetDemoData();
        void queryClient.invalidateQueries();
      }}
    >
      Reset sample data
    </button>
  );
}

function AccountFooter() {
  const { session } = useSession();
  const { entry } = useCurrentWorkspace();
  const platformRole = useMe().data?.platformRole ?? null;
  const roles = [ROLE_LABELS[entry.role]];
  if (platformRole && entry.role !== 'v01_support') {
    roles.push(`V-01 ${PLATFORM_ROLE_LABELS[platformRole].toLowerCase()}`);
  }

  return (
    <div className="mt-auto flex flex-col gap-2.5 border-t border-hairline pt-4 text-[12.5px]">
      <div className="min-w-0">
        <p className="truncate text-ink" title={session?.user.email}>
          {session?.user.email}
        </p>
        <p className="text-mist">{roles.join(' · ')}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Button variant="quiet" className="text-[12.5px]" onClick={() => void signOut()}>
          Sign out
        </Button>
        <NavLink to="/about" className="text-[12.5px] text-mist underline-offset-4 hover:underline">
          About
        </NavLink>
        <ResetSampleData />
      </div>
    </div>
  );
}

/** Always on screen while V-01 staff look at an operator's workspace on a support grant. */
function SupportBanner() {
  const { orgId, entry } = useCurrentWorkspace();
  const end = useEndSupportAccess();
  const navigate = useNavigate();
  if (!entry.support) return null;
  const { grantId, expiresAt } = entry.support;

  return (
    <div className="gutter flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-ink py-2.5 text-[13px] text-canvas">
      <p className="flex min-w-0 items-start gap-2">
        <IconLock size={16} stroke={1.75} aria-hidden className="mt-[1px] shrink-0" />
        <span>
          V-01 support access to <span className="font-medium">{entry.organisationName}</span>: read-only
          until {clockTime(expiresAt)}. They can see this visit and the pages you open.
        </span>
      </p>
      <button
        type="button"
        disabled={end.isPending}
        onClick={() =>
          end.mutate(grantId, { onSuccess: () => navigate(`/console/operators/${orgId}`, { replace: true }) })
        }
        className="h-8 shrink-0 rounded-md border border-white/35 px-3 text-[12.5px] font-medium hover:bg-white/10 disabled:opacity-60"
      >
        {end.isPending ? 'Ending' : 'End access'}
      </button>
    </div>
  );
}

function SupportEnded() {
  const { orgId, entry } = useCurrentWorkspace();
  const queryClient = useQueryClient();
  return (
    <EmptyState
      title="Support access has ended"
      action={
        <Link
          to={`/console/operators/${orgId}`}
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['me'] })}
          className="text-[14px] text-accent underline-offset-4 hover:underline"
        >
          Back to {entry.organisationName} in the console
        </Link>
      }
    >
      Access to {entry.organisationName} closed at{' '}
      {entry.support ? clockTime(entry.support.expiresAt) : 'its end time'}. Open it again from the console if
      you still need it.
    </EmptyState>
  );
}

function WorkspaceFrame() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { entry } = useCurrentWorkspace();
  const now = useNow();
  const ended = entry.support !== null && Date.parse(entry.support.expiresAt) <= now;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-7 overflow-y-auto border-r border-hairline bg-paper px-4 py-6 md:flex">
        <div className="px-2.5">
          <WorkspaceHeader />
        </div>
        <Navigation />
        <div className="px-2.5">
          <AccountFooter />
        </div>
      </aside>

      <div className="min-w-0">
        <SupportBanner />
        <div className="gutter flex items-center justify-between gap-4 border-b border-hairline bg-paper py-3 md:hidden">
          <div className="min-w-0">
            <OperatorMark name={entry.organisationName} />
          </div>
          <Button
            variant="secondary"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </Button>
        </div>
        {menuOpen ? (
          <div
            id="mobile-menu"
            className="gutter flex flex-col gap-6 border-b border-hairline bg-paper py-5 md:hidden"
          >
            <WorkspaceHeader />
            <Navigation onNavigate={() => setMenuOpen(false)} />
            <AccountFooter />
          </div>
        ) : null}
        <main
          key={location.pathname}
          className="gutter md:gutter-wide mx-auto w-full max-w-[1200px] py-8 md:py-10"
        >
          {ended ? <SupportEnded /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}

/** An operator's workspace. V-01 staff with no workspace open go back to the console. */
export function AppShell() {
  const { current } = useWorkspaces();
  const me = useMe();
  if (current) return <WorkspaceFrame />;
  if (me.data?.platformRole) return <Navigate to="/console" replace />;
  return <NoWorkspace />;
}
