import {
  IconActivityHeartbeat,
  IconBuildingCommunity,
  IconDoorEnter,
  IconLayoutDashboard,
  IconLock,
  IconShieldLock,
  type TablerIcon,
} from '@tabler/icons-react';
import { PLATFORM_ROLE_LABELS } from '@v01/shared';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useMe } from '../lib/api.ts';
import { clockTime } from '../lib/format.ts';
import { signOut, useSession } from '../lib/session.tsx';
import { useWorkspaces } from '../lib/workspace.tsx';
import { ResetSampleData } from './AppShell.tsx';
import { ConsoleMark } from './BrandMark.tsx';

interface ConsoleNavItem {
  to: string;
  label: string;
  icon: TablerIcon;
  end?: boolean;
}

const CONSOLE_NAV: ConsoleNavItem[] = [
  { to: '/console', label: 'Overview', icon: IconLayoutDashboard, end: true },
  { to: '/console/operators', label: 'Operators', icon: IconBuildingCommunity },
  { to: '/console/sync', label: 'Sync health', icon: IconActivityHeartbeat },
  { to: '/console/support', label: 'Support log', icon: IconShieldLock },
];

const navItem = ({ isActive }: { isActive: boolean }) =>
  [
    'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
    isActive ? 'bg-white/12 font-medium text-canvas' : 'text-accent-tint hover:bg-white/8 hover:text-canvas',
  ].join(' ');

function ConsoleNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Console" className="flex flex-col gap-0.5">
      {CONSOLE_NAV.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={navItem}>
          <item.icon size={18} stroke={1.6} aria-hidden className="shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Workspaces this person can step into: their own memberships, and any open support access. */
function WorkspaceLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { entries, choose } = useWorkspaces();
  const navigate = useNavigate();
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2.5 pb-1 text-[12px] text-console-muted">Workspaces</p>
      {entries.map((entry) => (
        <button
          key={entry.organisationId}
          type="button"
          onClick={() => {
            choose(entry.organisationId);
            onNavigate?.();
            navigate('/today');
          }}
          className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-accent-tint transition-colors hover:bg-white/8 hover:text-canvas"
        >
          {entry.support ? (
            <IconLock size={18} stroke={1.6} aria-hidden className="shrink-0" />
          ) : (
            <IconDoorEnter size={18} stroke={1.6} aria-hidden className="shrink-0" />
          )}
          <span className="min-w-0">
            <span className="block truncate">{entry.organisationName}</span>
            {entry.support ? (
              <span className="block text-[12px] text-console-muted">
                Support, until {clockTime(entry.support.expiresAt)}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function ConsoleFooter() {
  const { session } = useSession();
  const role = useMe().data?.platformRole;
  return (
    <div className="mt-auto flex flex-col gap-2.5 border-t border-white/15 pt-4 text-[12.5px]">
      <div className="min-w-0">
        <p className="truncate text-canvas" title={session?.user.email}>
          {session?.user.email}
        </p>
        {role ? <p className="text-console-muted">V-01 {PLATFORM_ROLE_LABELS[role].toLowerCase()}</p> : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-canvas underline-offset-4 hover:underline"
        >
          Sign out
        </button>
        <NavLink to="/console/about" className="text-console-muted underline-offset-4 hover:underline">
          About
        </NavLink>
        <ResetSampleData className="text-console-muted underline-offset-4 hover:underline" />
      </div>
    </div>
  );
}

/**
 * V-01's own console, above every operator. The dark teal sidebar keeps it unmistakable
 * from an operator's workspace, which has a light one.
 */
export function ConsoleShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 overflow-y-auto bg-accent px-4 py-6 md:flex">
        <div className="px-2.5">
          <ConsoleMark />
        </div>
        <ConsoleNavigation />
        <WorkspaceLinks />
        <div className="px-2.5">
          <ConsoleFooter />
        </div>
      </aside>

      <div className="min-w-0">
        <div className="gutter flex items-center justify-between gap-4 bg-accent py-3 md:hidden">
          <ConsoleMark />
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="console-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="h-9 rounded-md border border-white/35 px-4 text-[13.5px] font-medium text-canvas hover:bg-white/10"
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        {menuOpen ? (
          <div id="console-menu" className="gutter flex flex-col gap-6 bg-accent py-5 md:hidden">
            <ConsoleNavigation onNavigate={() => setMenuOpen(false)} />
            <WorkspaceLinks onNavigate={() => setMenuOpen(false)} />
            <ConsoleFooter />
          </div>
        ) : null}
        <main
          key={location.pathname}
          className="gutter md:gutter-wide mx-auto w-full max-w-[1200px] py-8 md:py-10"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
