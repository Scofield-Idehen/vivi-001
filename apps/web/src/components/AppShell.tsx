import { ROLE_LABELS } from '@v01/shared';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { MODULE_GROUPS } from '../lib/modules.ts';
import { signOut, useSession } from '../lib/session.tsx';
import { useCurrentWorkspace } from '../lib/workspace.tsx';
import { BrandMark } from './BrandMark.tsx';
import { Button } from './ui.tsx';

function WorkspaceSwitcher() {
  const { orgId, membership, memberships, choose } = useCurrentWorkspace();
  return (
    <div className="flex flex-col gap-1">
      {memberships.length > 1 ? (
        <>
          <label htmlFor="workspace" className="sr-only">
            Workspace
          </label>
          <select
            id="workspace"
            value={orgId}
            onChange={(e) => choose(e.target.value)}
            className="h-9 w-full rounded-md border border-hairline bg-transparent px-2 text-[14px] font-medium text-ink hover:bg-linen"
          >
            {memberships.map((m) => (
              <option key={m.organisationId} value={m.organisationId}>
                {m.organisationName}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className="text-[14px] font-medium text-ink">{membership.organisationName}</p>
      )}
      <p className="text-[12.5px] text-mist">{ROLE_LABELS[membership.role]}</p>
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
                  'flex h-8 items-center rounded-md px-2.5 text-[13.5px] transition-colors',
                  isActive ? 'bg-linen font-medium text-ink' : 'hover:bg-linen hover:text-ink',
                  !isActive && (item.built ? 'text-slate' : 'text-mist'),
                ]
                  .filter(Boolean)
                  .join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function AccountFooter() {
  const { session } = useSession();
  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-hairline pt-4 text-[12.5px]">
      <p className="truncate text-mist" title={session?.user.email}>
        {session?.user.email}
      </p>
      <div className="flex gap-4">
        <Button variant="quiet" className="text-[12.5px]" onClick={() => void signOut()}>
          Sign out
        </Button>
        <NavLink to="/about" className="text-[12.5px] text-mist underline-offset-4 hover:underline">
          About
        </NavLink>
      </div>
    </div>
  );
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-7 overflow-y-auto border-r border-hairline px-4 py-6 md:flex">
        <div className="px-2.5">
          <BrandMark />
        </div>
        <div className="px-2.5">
          <WorkspaceSwitcher />
        </div>
        <Navigation />
        <div className="px-2.5">
          <AccountFooter />
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3 md:hidden">
          <BrandMark />
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
          <div id="mobile-menu" className="flex flex-col gap-6 border-b border-hairline px-5 py-5 md:hidden">
            <WorkspaceSwitcher />
            <Navigation onNavigate={() => setMenuOpen(false)} />
            <AccountFooter />
          </div>
        ) : null}
        <main key={location.pathname} className="mx-auto w-full max-w-[1200px] px-5 py-8 md:px-10 md:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
