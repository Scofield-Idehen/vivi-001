import {
  IconActivityHeartbeat,
  IconBuildingCommunity,
  IconDoorEnter,
  IconLayoutDashboard,
  IconLock,
  IconLogout,
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
import {
  RailButton,
  RailFooter,
  RailFrame,
  RailGroup,
  RailInitial,
  RailLink,
  RailToggle,
  useRail,
} from './Rail.tsx';

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

function ConsoleNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Console" className="flex flex-col gap-0.5">
      {CONSOLE_NAV.map((item) => (
        <RailLink
          key={item.to}
          to={item.to}
          label={item.label}
          icon={item.icon}
          end={item.end}
          onNavigate={onNavigate}
        />
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
    <RailGroup label="Workspaces">
      {entries.map((entry) => {
        const label = entry.support
          ? `${entry.organisationName}: support, until ${clockTime(entry.support.expiresAt)}`
          : entry.organisationName;
        return (
          <RailButton
            key={entry.organisationId}
            label={label}
            icon={entry.support ? IconLock : IconDoorEnter}
            onClick={() => {
              choose(entry.organisationId);
              onNavigate?.();
              navigate('/today');
            }}
          >
            <span className="min-w-0">
              <span className="block truncate">{entry.organisationName}</span>
              {entry.support ? (
                <span className="block text-[12px] text-console-muted">
                  Support, until {clockTime(entry.support.expiresAt)}
                </span>
              ) : null}
            </span>
          </RailButton>
        );
      })}
    </RailGroup>
  );
}

function ConsoleFooter() {
  const { session } = useSession();
  const { collapsed } = useRail();
  const role = useMe().data?.platformRole;
  const email = session?.user.email ?? '';
  const roleText = role ? `V-01 ${PLATFORM_ROLE_LABELS[role].toLowerCase()}` : null;

  if (collapsed) {
    return (
      <RailFooter>
        <span aria-hidden className="mb-2 h-px w-6 bg-white/20" />
        <RailInitial person text={email} label={[email, roleText].filter(Boolean).join(', ')} />
        <RailButton label="Sign out" icon={IconLogout} onClick={() => void signOut()} />
        <RailToggle />
      </RailFooter>
    );
  }

  return (
    <RailFooter>
      <div className="flex flex-col gap-2.5 border-t border-white/15 px-2.5 pt-4 text-[12.5px]">
        <div className="min-w-0">
          <p className="truncate text-canvas" title={email}>
            {email}
          </p>
          {roleText ? <p className="text-console-muted">{roleText}</p> : null}
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
      <RailToggle />
    </RailFooter>
  );
}

/** The console's name at the top of the sidebar: in full, or folded to "V-01". */
function ConsoleHeader() {
  const { collapsed } = useRail();
  if (collapsed) {
    return (
      <span className="mx-auto pt-1 text-[13px] font-semibold tracking-[0.06em] text-canvas">
        <span aria-hidden>V-01</span>
        <span className="sr-only">V-01 console</span>
      </span>
    );
  }
  return (
    <div className="px-2.5">
      <ConsoleMark />
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
    <RailFrame
      tone="dark"
      label="Console"
      sidebar={
        <>
          <ConsoleHeader />
          <ConsoleNavigation />
          <WorkspaceLinks />
          <ConsoleFooter />
        </>
      }
    >
      <div className="gutter flex items-center justify-between gap-4 bg-accent py-3 min-[560px]:hidden">
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
        <div id="console-menu" className="gutter flex flex-col gap-6 bg-accent py-5 min-[560px]:hidden">
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
    </RailFrame>
  );
}
