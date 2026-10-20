import { IconArrowLeft, IconInfoCircle, IconLock, IconLogout, IconRefresh } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { PLATFORM_ROLE_LABELS, ROLE_LABELS } from '@v01/shared';
import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useEndSupportAccess, useMe, useWorkspace } from '../lib/api.ts';
import { config } from '../lib/config.ts';
import { demoOriginalRole, resetDemoData, setDemoRole } from '../lib/demo.ts';
import { clockTime, useNow } from '../lib/format.ts';
import { MODULE_GROUPS } from '../lib/modules.ts';
import { signOut, useSession } from '../lib/session.tsx';
import { useCurrentWorkspace, useWorkspaces } from '../lib/workspace.tsx';
import { NoWorkspace } from '../pages/misc.tsx';
import { OperatorMark } from './BrandMark.tsx';
import {
  RailButton,
  RailFooter,
  RailFrame,
  RailGroup,
  RailInitial,
  RailLink,
  RailMark,
  RailPerson,
  useRail,
} from './Rail.tsx';
import { Button, EmptyState } from './ui.tsx';

/** The top of the sidebar: whose workspace this is, and the way back to the console for V-01 staff. */
function WorkspaceHeader({ onNavigate }: { onNavigate?: () => void }) {
  const { orgId, entry, entries, choose } = useCurrentWorkspace();
  const { collapsed } = useRail();
  const platformRole = useMe().data?.platformRole ?? null;
  const workspace = useWorkspace(orgId);
  const name = workspace.data?.brand.displayName ?? entry.organisationName;

  return (
    <div className="flex flex-col gap-1">
      {platformRole ? (
        <RailLink to="/console" label="V-01 console" icon={IconArrowLeft} end onNavigate={onNavigate} />
      ) : null}
      <RailMark
        small={<RailInitial text={name} tone="light" />}
        full={<OperatorMark name={name} logoUrl={workspace.data?.brand.logoLightUrl} />}
      />
      {/* People in more than one company switch here. V-01 staff switch from the console instead. */}
      {!platformRole && entries.length > 1 && !collapsed ? (
        <div className="px-2.5 pt-1">
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
        </div>
      ) : null}
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Modules" className="flex flex-col gap-3">
      {MODULE_GROUPS.map((group) => (
        <RailGroup key={group.label} label={group.label}>
          {group.items.map((item) => (
            <RailLink
              key={item.path}
              to={`/${item.path}`}
              label={item.label}
              icon={item.icon}
              quiet={!item.built}
              tip={item.built ? item.label : `${item.label}: arrives in ${item.phase}`}
              onNavigate={onNavigate}
            />
          ))}
        </RailGroup>
      ))}
    </nav>
  );
}

/** Demo only: puts the sample data back the way it started. */
export function useResetSampleData(): (() => void) | null {
  const queryClient = useQueryClient();
  if (!config.demo) return null;
  return () => {
    resetDemoData();
    void queryClient.invalidateQueries();
  };
}

function AccountFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { session } = useSession();
  const { entry } = useCurrentWorkspace();
  const reset = useResetSampleData();
  const platformRole = useMe().data?.platformRole ?? null;
  const roles = [ROLE_LABELS[entry.role]];
  if (platformRole && entry.role !== 'v01_support') {
    roles.push(`V-01 ${PLATFORM_ROLE_LABELS[platformRole].toLowerCase()}`);
  }

  return (
    <RailFooter>
      <RailPerson email={session?.user.email ?? ''} detail={roles.join(', ')} />
      <RailButton label="Sign out" icon={IconLogout} onClick={() => void signOut()} />
      <RailLink to="/about" label="About" icon={IconInfoCircle} quiet onNavigate={onNavigate} />
      {reset ? <RailButton label="Reset sample data" icon={IconRefresh} quiet onClick={reset} /> : null}
    </RailFooter>
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
          className="text-[14px] action"
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
  // The calendar uses the whole width: every extra column is another night on screen.
  const wide = location.pathname.startsWith('/calendar');

  return (
    <RailFrame
      tone="light"
      label="Workspace"
      sidebar={
        <>
          <WorkspaceHeader />
          <Navigation />
          <AccountFooter />
        </>
      }
    >
      <SupportBanner />
      <div className="gutter flex items-center justify-between gap-4 border-b border-hairline bg-paper py-3 min-[560px]:hidden">
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
          className="gutter flex flex-col gap-6 border-b border-hairline bg-paper py-5 min-[560px]:hidden"
        >
          <WorkspaceHeader onNavigate={() => setMenuOpen(false)} />
          <Navigation onNavigate={() => setMenuOpen(false)} />
          <AccountFooter onNavigate={() => setMenuOpen(false)} />
        </div>
      ) : null}
      <main
        key={location.pathname}
        className={`gutter mx-auto w-full py-8 md:py-10 ${wide ? 'max-w-none md:px-8' : 'md:gutter-wide max-w-[1200px]'}`}
      >
        {ended ? <SupportEnded /> : <Outlet />}
      </main>
    </RailFrame>
  );
}

/**
 * The field team's own screen: a phone with their jobs on it and nothing else. No menu of office
 * pages they can't use; any other address brings them back to their jobs.
 */
function FieldFrame() {
  const location = useLocation();
  const { entry } = useCurrentWorkspace();
  const me = useMe();
  const queryClient = useQueryClient();
  const officeRole = config.demo ? demoOriginalRole(entry.organisationId) : null;
  const workspace = useWorkspace(entry.organisationId);
  const name = me.data?.user.fullName ?? me.data?.user.email ?? '';
  if (!location.pathname.startsWith('/tasks') && location.pathname !== '/about') {
    return <Navigate to="/tasks" replace />;
  }
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="gutter sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-hairline bg-paper py-3">
        <div className="min-w-0">
          <OperatorMark name={workspace.data?.brand.displayName ?? entry.organisationName} />
          <p className="mt-0.5 truncate text-[12.5px] text-slate">{name}</p>
        </div>
        {officeRole ? (
          <button
            type="button"
            onClick={() => {
              setDemoRole(entry.organisationId, officeRole);
              void queryClient.invalidateQueries();
            }}
            className="action shrink-0"
          >
            Back to the office view (demo)
          </button>
        ) : (
          <button type="button" onClick={() => void signOut()} className="action shrink-0">
            <IconLogout size={16} stroke={1.75} aria-hidden />
            Sign out
          </button>
        )}
      </header>
      <main key={location.pathname} className="gutter mx-auto w-full max-w-[720px] py-6">
        <Outlet />
      </main>
    </div>
  );
}

/** An operator's workspace. V-01 staff with no workspace open go back to the console. */
export function AppShell() {
  const { current } = useWorkspaces();
  const me = useMe();
  if (current?.entry.role === 'field') return <FieldFrame />;
  if (current) return <WorkspaceFrame />;
  if (me.data?.platformRole) return <Navigate to="/console" replace />;
  return <NoWorkspace />;
}
