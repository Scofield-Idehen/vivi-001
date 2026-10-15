import type { TablerIcon } from '@tabler/icons-react';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { NavLink, useLocation } from 'react-router';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Below this width the sidebar becomes a top bar with a menu. */
export const RAIL_MIN = 560;
/** How long the pointer rests on the sidebar before it opens, so passing over it does nothing. */
const OPEN_DELAY = 120;
/** How long it stays open after the pointer leaves, so a slip past its edge doesn't snap it shut. */
const CLOSE_DELAY = 240;

export type RailTone = 'light' | 'dark';

interface RailState {
  /** Inside the sidebar at all (false in the phone menu, which always shows names). */
  inRail: boolean;
  /** Showing icons only. */
  collapsed: boolean;
  tone: RailTone;
}

const RailContext = createContext<RailState>({ inRail: false, collapsed: false, tone: 'light' });

export function useRail(): RailState {
  return useContext(RailContext);
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const TONES: Record<RailTone, string> = {
  light: 'border-r border-hairline bg-paper',
  dark: 'bg-accent',
};

/**
 * The page frame with its sidebar. The sidebar is a rail of icons that opens over the page while
 * the pointer rests on it, or while keyboard focus is inside it, and closes again when it leaves.
 * There is no button: on touch screens a tap on the rail opens it and a tap outside closes it.
 * On phones it is a top bar with a menu instead (drawn by the shell, above `children`).
 */
export function RailFrame({
  tone,
  label,
  sidebar,
  children,
}: {
  tone: RailTone;
  label: string;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const canHover = useMediaQuery('(hover: hover)');
  const [open, setOpen] = useState(false);
  const aside = useRef<HTMLElement>(null);
  const pointerInside = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const location = useLocation();

  const after = (ms: number, fn: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Going somewhere closes it, unless the pointer is still resting on it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose whenever the page changes
  useEffect(() => {
    if (!pointerInside.current) setOpen(false);
  }, [location.pathname]);

  // Escape closes it, and so does a tap anywhere else (touch screens have no pointer to leave).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!aside.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const state = useMemo<RailState>(() => ({ inRail: true, collapsed: !open, tone }), [open, tone]);

  return (
    <div className="min-h-dvh min-[560px]:flex">
      {/* Holds the rail's place, so the page never moves when the rail opens over it. */}
      <div aria-hidden className="hidden w-16 shrink-0 min-[560px]:block" />
      <RailContext.Provider value={state}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard focus opens it through onFocus; the tap is for touch screens */}
        <aside
          ref={aside}
          aria-label={label}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse' || !canHover) return;
            pointerInside.current = true;
            after(OPEN_DELAY, () => setOpen(true));
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'mouse') return;
            pointerInside.current = false;
            after(CLOSE_DELAY, () => setOpen(false));
          }}
          onFocus={(event) => {
            // Keyboard users get the names too. A click focuses a link as well, which is fine: it's open.
            if (event.target.matches(':focus-visible')) {
              window.clearTimeout(timer.current);
              setOpen(true);
            }
          }}
          onBlur={(event) => {
            if (!pointerInside.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setOpen(false);
            }
          }}
          onClick={(event) => {
            // A tap on the rail itself, not on a link, opens it where there is no pointer to rest.
            if (canHover || open || (event.target as HTMLElement).closest('a, button, select')) return;
            setOpen(true);
          }}
          className={cx(
            'fixed inset-y-0 left-0 z-40 hidden flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-4 transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none min-[560px]:flex',
            open ? 'w-[248px] shadow-[8px_0_28px_-10px_rgb(21_24_27/0.22)]' : 'w-16',
            TONES[tone],
          )}
        >
          {sidebar}
        </aside>
      </RailContext.Provider>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const ITEM: Record<RailTone, { active: string; idle: string; quiet: string }> = {
  light: {
    active: 'bg-linen font-medium text-ink',
    idle: 'text-slate hover:bg-linen hover:text-ink',
    quiet: 'text-mist hover:bg-linen hover:text-ink',
  },
  dark: {
    active: 'bg-white/12 font-medium text-canvas',
    idle: 'text-accent-tint hover:bg-white/8 hover:text-canvas',
    quiet: 'text-console-muted hover:bg-white/8 hover:text-canvas',
  },
};

/**
 * Every row keeps its icon in the same place, open or not, centred in the 64-pixel rail; the name
 * beside it fades in as the rail widens. Nothing jumps.
 */
const ROW =
  'flex min-h-9 w-full shrink-0 items-center gap-3 rounded-lg py-1.5 pr-2.5 pl-[14px] text-left text-[13.5px] transition-colors';

/** The words beside an icon: always there for screen readers, shown only while the rail is open. */
function Words({ children }: { children: ReactNode }) {
  const { collapsed } = useRail();
  return (
    <span
      className={cx(
        'min-w-0 flex-1 truncate transition-opacity duration-150 motion-reduce:transition-none',
        collapsed ? 'opacity-0' : 'opacity-100 delay-75',
      )}
    >
      {children}
    </span>
  );
}

/** A page in the sidebar: its icon, and its name while the rail is open. */
export function RailLink({
  to,
  label,
  icon: Icon,
  end,
  quiet,
  tip,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: TablerIcon;
  end?: boolean;
  /** Not built yet: shown, but quieter. */
  quiet?: boolean;
  /** Said on hover when there is more to say than the name, such as when the page arrives. */
  tip?: string;
  onNavigate?: () => void;
}) {
  const { tone } = useRail();
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={tip && tip !== label ? tip : undefined}
      className={({ isActive }) =>
        cx(ROW, isActive ? ITEM[tone].active : quiet ? ITEM[tone].quiet : ITEM[tone].idle)
      }
    >
      <Icon size={19} stroke={1.6} aria-hidden className="shrink-0" />
      <Words>{label}</Words>
    </NavLink>
  );
}

/** An action in the sidebar, shaped like a link. */
export function RailButton({
  label,
  icon: Icon,
  onClick,
  quiet,
  children,
}: {
  label: string;
  icon: TablerIcon;
  onClick(): void;
  quiet?: boolean;
  /** What the open rail shows instead of the plain label, such as a second line. */
  children?: ReactNode;
}) {
  const { tone } = useRail();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={children ? label : undefined}
      className={cx(ROW, quiet ? ITEM[tone].quiet : ITEM[tone].idle)}
    >
      <Icon size={19} stroke={1.6} aria-hidden className="shrink-0" />
      <Words>{children ?? label}</Words>
    </button>
  );
}

/** A named group of links. In the closed rail its name gives way to a short rule, in the same space. */
export function RailGroup({ label, children }: { label: string; children: ReactNode }) {
  const { collapsed, tone } = useRail();
  return (
    <div className="flex flex-col gap-0.5">
      <div className="relative h-6 shrink-0">
        <span
          aria-hidden
          className={cx(
            'absolute top-1/2 left-[10px] h-px w-7 transition-opacity duration-150',
            tone === 'dark' ? 'bg-white/20' : 'bg-hairline',
            collapsed ? 'opacity-100' : 'opacity-0',
          )}
        />
        <p
          className={cx(
            'absolute inset-x-0 top-1/2 -translate-y-1/2 truncate pl-[14px] text-[12px] transition-opacity duration-150',
            tone === 'dark' ? 'text-console-muted' : 'text-mist',
            collapsed ? 'opacity-0' : 'opacity-100 delay-75',
          )}
        >
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

/**
 * The top of the sidebar: a mark that fits the closed rail (an initial, or a short name), and the
 * full name or logo once it opens, in the same place.
 */
export function RailMark({ small, full }: { small: ReactNode; full: ReactNode }) {
  const { inRail, collapsed } = useRail();
  if (!inRail) return <div className="px-2.5">{full}</div>;
  return (
    <div className="relative h-9 shrink-0">
      <div
        className={cx(
          'absolute inset-y-0 left-0 grid w-12 place-items-center transition-opacity duration-150',
          collapsed ? 'opacity-100' : 'opacity-0',
        )}
      >
        {small}
      </div>
      <div
        className={cx(
          'absolute inset-y-0 right-0 left-[14px] flex min-w-0 items-center transition-opacity duration-150',
          collapsed ? 'opacity-0' : 'opacity-100 delay-75',
        )}
      >
        {full}
      </div>
    </div>
  );
}

/** The bottom of the sidebar, kept in view while the links above it scroll. */
export function RailFooter({ children }: { children: ReactNode }) {
  const { inRail, tone } = useRail();
  return (
    <div
      className={cx(
        'flex flex-col gap-0.5',
        // Only inside the sidebar, which scrolls; the phone menu is part of the page.
        inRail && 'sticky bottom-0 mt-auto pb-4',
        inRail && (tone === 'dark' ? 'bg-accent' : 'bg-paper'),
      )}
    >
      <span aria-hidden className={cx('mx-2 mb-2 h-px', tone === 'dark' ? 'bg-white/15' : 'bg-hairline')} />
      {children}
    </div>
  );
}

/** Who is signed in: their initial in the closed rail, with their email and role beside it once open. */
export function RailPerson({ email, detail }: { email: string; detail: string }) {
  const { tone } = useRail();
  return (
    <div className="flex min-h-11 items-center gap-3 pr-2.5 pl-[8px] text-[12.5px]">
      <span
        aria-hidden
        className={cx(
          'grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold uppercase',
          tone === 'dark' ? 'bg-white/14 text-canvas' : 'bg-linen text-ink',
        )}
      >
        {email.trim().charAt(0) || '?'}
      </span>
      <Words>
        <span className={cx('block truncate', tone === 'dark' ? 'text-canvas' : 'text-ink')} title={email}>
          {email}
        </span>
        <span className={cx('block truncate', tone === 'dark' ? 'text-console-muted' : 'text-mist')}>
          {detail}
        </span>
      </Words>
    </div>
  );
}

/** The operator's initial, standing in for their name in the closed rail. */
export function RailInitial({ text, tone }: { text: string; tone: RailTone }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-lg text-[13px] font-semibold uppercase',
        tone === 'dark' ? 'bg-white/14 text-canvas' : 'bg-ink text-canvas',
      )}
    >
      {text.trim().charAt(0) || '?'}
    </span>
  );
}
