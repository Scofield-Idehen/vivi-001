import { IconBell, IconLogout, IconUserCircle } from '@tabler/icons-react';
import { can, ROLE_LABELS } from '@v01/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMe, useToday, useWorkspace } from '../lib/api.ts';
import { signOut, useSession } from '../lib/session.tsx';
import { useCurrentWorkspace } from '../lib/workspace.tsx';

/**
 * The bar along the top of every page (after Guesty's): a bell with everything that needs someone,
 * and the person's own menu with their profile and sign out.
 */

/** Two letters for a name or an email: "Scofield Alpha" → "SA". */
export function initials(name: string): string {
  const words = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (
    (words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : (words[0]?.[1] ?? ''))
  ).toUpperCase();
}

function Popover({
  label,
  trigger,
  children,
  wide,
}: {
  label: string;
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center justify-center rounded-full transition-colors hover:bg-linen"
      >
        {trigger(open)}
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute right-0 top-11 z-40 overflow-hidden rounded-xl border border-hairline bg-canvas shadow-[0_12px_32px_-12px_rgb(21_24_27/0.25)] ${wide ? 'w-[360px]' : 'w-[260px]'}`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function Notifications() {
  const { orgId } = useCurrentWorkspace();
  const today = useToday(orgId);
  const items = today.data?.attention ?? [];
  const urgent = items.some((i) => i.severity === 'urgent');
  return (
    <Popover
      label={items.length ? `Notifications, ${items.length}` : 'Notifications'}
      wide
      trigger={() => (
        <span className="relative flex size-9 items-center justify-center text-ink">
          <IconBell size={20} stroke={1.75} aria-hidden />
          {items.length ? (
            <span
              className={`absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full px-1 text-center text-[11px] leading-[18px] font-semibold text-white ${urgent ? 'bg-urgent' : 'bg-pending'}`}
            >
              {items.length > 99 ? '99+' : items.length}
            </span>
          ) : null}
        </span>
      )}
    >
      {(close) => (
        <>
          <p className="border-b border-hairline px-4 py-3 text-[14px] font-semibold text-ink">
            Notifications
          </p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13.5px] text-slate">Nothing needs you right now.</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-hairline overflow-y-auto">
              {items.map((item) => {
                const body = (
                  <span className="flex gap-3">
                    <span
                      aria-hidden
                      className={`mt-[6px] size-2 shrink-0 rounded-full ${item.severity === 'urgent' ? 'bg-urgent' : 'bg-pending'}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-ink">{item.title}</span>
                      {item.detail ? (
                        <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-slate">
                          {item.detail}
                        </span>
                      ) : null}
                    </span>
                  </span>
                );
                return (
                  <li key={item.id}>
                    {item.to ? (
                      <Link
                        to={item.to}
                        onClick={close}
                        role="menuitem"
                        className="block px-4 py-3 hover:bg-paper"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Popover>
  );
}

function ProfileMenu() {
  const { orgId, entry } = useCurrentWorkspace();
  const me = useMe();
  const { session } = useSession();
  const workspace = useWorkspace(orgId);
  const email = me.data?.user.email ?? session?.user.email ?? '';
  const name = me.data?.user.fullName ?? email;
  return (
    <Popover
      label="Your account"
      trigger={() => (
        <span className="flex size-9 items-center justify-center rounded-full bg-accent text-[12.5px] font-semibold text-white">
          {initials(name)}
        </span>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-tint text-[12.5px] font-semibold text-accent">
              {initials(name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-ink">{name}</span>
              <span className="block truncate text-[12px] text-slate">
                {workspace.data?.brand.displayName ?? entry.organisationName} · {ROLE_LABELS[entry.role]}
              </span>
            </span>
          </div>
          <Link
            to="/profile"
            onClick={close}
            role="menuitem"
            className="flex items-center gap-3 px-4 py-2.5 text-[13.5px] text-ink hover:bg-paper"
          >
            <IconUserCircle size={18} stroke={1.75} aria-hidden /> My profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-3 border-t border-hairline px-4 py-2.5 text-left text-[13.5px] text-ink hover:bg-paper"
          >
            <IconLogout size={18} stroke={1.75} aria-hidden /> Sign out
          </button>
        </>
      )}
    </Popover>
  );
}

/** The bell and the person's menu, for the top of the page; the bell only where Today can be read. */
export function AccountActions() {
  const { entry } = useCurrentWorkspace();
  return (
    <div className="flex items-center gap-1.5">
      {can(entry.role, 'workspace.read') && entry.role !== 'field' ? <Notifications /> : null}
      <ProfileMenu />
    </div>
  );
}
