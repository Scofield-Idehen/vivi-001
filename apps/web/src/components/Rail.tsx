import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  type TablerIcon,
} from '@tabler/icons-react';
import {
  createContext,
  type ReactNode,
  useCallback,
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
/** From this width the sidebar can stay open beside the page; narrower, it opens over it. */
const DOCK_MIN = 1024;
const STORAGE_KEY = 'v01.sidebar';

export type RailTone = 'light' | 'dark';

interface RailState {
  /** Inside a sidebar at all (false in the phone menu). */
  inRail: boolean;
  /** Showing icons only. */
  collapsed: boolean;
  tone: RailTone;
  toggle(): void;
  showTip(target: HTMLElement, label: string): void;
  hideTip(): void;
}

const RailContext = createContext<RailState>({
  inRail: false,
  collapsed: false,
  tone: 'light',
  toggle() {},
  showTip() {},
  hideTip() {},
});

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

// The choice is a convenience for this browser only, so storage failing just means the default.
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Not kept; the sidebar still works for this visit.
  }
}

const TONES: Record<RailTone, { aside: string; overlay: string }> = {
  light: { aside: 'border-r border-hairline bg-paper', overlay: 'bg-paper text-ink' },
  dark: { aside: 'bg-accent', overlay: 'bg-accent text-canvas' },
};

/**
 * The page frame with its sidebar. On wide screens the sidebar folds down to icons and back, and
 * remembers which; on narrower ones it stays as icons and opens over the page; on phones it is a
 * top bar with a menu (drawn by the shell, above `children`).
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
  const wide = useMediaQuery(`(min-width: ${DOCK_MIN}px)`);
  const [folded, setFolded] = useState(readCollapsed);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const overlay = useRef<HTMLDialogElement>(null);
  const location = useLocation();

  const collapsed = !wide || folded;

  // Going somewhere closes the sidebar that opened over the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose whenever the page changes
  useEffect(() => {
    setOverlayOpen(false);
    setTip(null);
  }, [location.pathname]);

  useEffect(() => {
    if (wide) setOverlayOpen(false);
  }, [wide]);

  useEffect(() => {
    const dialog = overlay.current;
    if (!dialog) return;
    if (overlayOpen && !dialog.open) dialog.showModal();
    if (!overlayOpen && dialog.open) dialog.close();
  }, [overlayOpen]);

  const toggle = useCallback(() => {
    setTip(null);
    if (wide) {
      setFolded((was) => {
        writeCollapsed(!was);
        return !was;
      });
    } else {
      setOverlayOpen((open) => !open);
    }
  }, [wide]);

  const showTip = useCallback((target: HTMLElement, text: string) => {
    const box = target.getBoundingClientRect();
    setTip({ label: text, top: box.top + box.height / 2, left: box.right + 10 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  const docked = useMemo<RailState>(
    () => ({ inRail: true, collapsed, tone, toggle, showTip, hideTip }),
    [collapsed, tone, toggle, showTip, hideTip],
  );
  const opened = useMemo<RailState>(
    () => ({ inRail: true, collapsed: false, tone, toggle, showTip() {}, hideTip() {} }),
    [tone, toggle],
  );

  return (
    <div className="min-h-dvh min-[560px]:flex">
      <RailContext.Provider value={docked}>
        <aside
          aria-label={label}
          className={cx(
            'sticky top-0 hidden h-dvh shrink-0 flex-col overflow-x-hidden overflow-y-auto transition-[width] duration-200 ease-out min-[560px]:flex',
            collapsed ? 'w-16 gap-4 px-2 pt-4' : 'w-[244px] gap-6 px-4 pt-6',
            TONES[tone].aside,
          )}
        >
          {sidebar}
        </aside>
      </RailContext.Provider>

      {/* On narrower screens the full sidebar opens over the page. */}
      <RailContext.Provider value={opened}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it through onCancel; this only catches clicks on the dimmed page beside it */}
        <dialog
          ref={overlay}
          aria-label={label}
          onCancel={(event) => {
            event.preventDefault();
            setOverlayOpen(false);
          }}
          onClick={(event) => {
            if (event.target === overlay.current) setOverlayOpen(false);
          }}
          className={cx(
            'rail fixed inset-y-0 right-auto left-0 m-0 h-dvh max-h-dvh w-[264px] max-w-[86vw] p-0',
            TONES[tone].overlay,
          )}
        >
          {overlayOpen ? (
            <div className="flex h-full flex-col gap-6 overflow-y-auto px-4 py-6">{sidebar}</div>
          ) : null}
        </dialog>
      </RailContext.Provider>

      <div className="min-w-0 flex-1">{children}</div>

      {tip && collapsed ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-md bg-ink px-2.5 py-1 text-[12.5px] whitespace-nowrap text-canvas shadow-[0_4px_14px_rgb(21_24_27/0.18)]"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.label}
        </div>
      ) : null}
    </div>
  );
}

/** Hover and keyboard focus show the name beside an icon while the sidebar is folded. */
function useTip(label: string) {
  const { collapsed, showTip, hideTip } = useRail();
  if (!collapsed) return {};
  return {
    onMouseEnter: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, label),
    onFocus: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, label),
    onMouseLeave: hideTip,
    onBlur: hideTip,
  };
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

function itemShape(collapsed: boolean): string {
  return collapsed
    ? 'mx-auto grid size-9 shrink-0 place-items-center rounded-lg transition-colors'
    : 'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors';
}

/** A page in the sidebar: icon and name, or just the icon when folded. */
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
  /** What the folded sidebar says on hover, when it should say more than the name. */
  tip?: string;
  onNavigate?: () => void;
}) {
  const { collapsed, tone } = useRail();
  const tipProps = useTip(tip ?? label);
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={!collapsed && tip && tip !== label ? tip : undefined}
      className={({ isActive }) =>
        cx(itemShape(collapsed), isActive ? ITEM[tone].active : quiet ? ITEM[tone].quiet : ITEM[tone].idle)
      }
      {...tipProps}
    >
      <Icon size={collapsed ? 19 : 17} stroke={1.6} aria-hidden className="shrink-0" />
      {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </NavLink>
  );
}

/** An action in the sidebar, shaped like a link. */
export function RailButton({
  label,
  icon: Icon,
  onClick,
  children,
}: {
  label: string;
  icon: TablerIcon;
  onClick(): void;
  /** What the open sidebar shows instead of the plain label, such as a second line. */
  children?: ReactNode;
}) {
  const { collapsed, tone } = useRail();
  const tipProps = useTip(label);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(itemShape(collapsed), !collapsed && 'min-h-9 py-1.5 text-left', ITEM[tone].idle)}
      {...tipProps}
    >
      <Icon size={collapsed ? 19 : 17} stroke={1.6} aria-hidden className="shrink-0" />
      {collapsed ? <span className="sr-only">{label}</span> : (children ?? <span>{label}</span>)}
    </button>
  );
}

/** A named group of links; folded, the name becomes a short rule. */
export function RailGroup({ label, children }: { label: string; children: ReactNode }) {
  const { collapsed, tone } = useRail();
  return (
    <div className={cx('flex flex-col', collapsed ? 'gap-1' : 'gap-0.5')}>
      {collapsed ? (
        <span
          aria-hidden
          className={cx('mx-auto mb-1 h-px w-6', tone === 'dark' ? 'bg-white/20' : 'bg-hairline')}
        />
      ) : (
        <p className={cx('px-2.5 pb-1 text-[12px]', tone === 'dark' ? 'text-console-muted' : 'text-mist')}>
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

/** Folds the sidebar to icons, or opens it again. */
export function RailToggle() {
  const { inRail, collapsed, tone, toggle } = useRail();
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const tipProps = useTip(label);
  if (!inRail) return null;
  const Icon = collapsed ? IconLayoutSidebarLeftExpand : IconLayoutSidebarLeftCollapse;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? label : undefined}
      className={cx(itemShape(collapsed), ITEM[tone].quiet)}
      {...tipProps}
    >
      <Icon size={collapsed ? 19 : 17} stroke={1.6} aria-hidden className="shrink-0" />
      {collapsed ? null : <span>{label}</span>}
    </button>
  );
}

/** The bottom of the sidebar, kept in view while the links above it scroll. */
export function RailFooter({ children }: { children: ReactNode }) {
  const { inRail, collapsed, tone } = useRail();
  return (
    <div
      className={cx(
        'flex flex-col',
        // Only inside the sidebar, which scrolls; the phone menu is part of the page.
        inRail && 'sticky bottom-0 mt-auto pb-4',
        inRail && (tone === 'dark' ? 'bg-accent' : 'bg-paper'),
        collapsed ? 'items-center gap-1 pt-3' : 'gap-3 pt-1',
      )}
    >
      {children}
    </div>
  );
}

/** A round initial standing in for someone or something when the sidebar is folded. */
export function RailInitial({
  text,
  label,
  person = false,
}: {
  text: string;
  label: string;
  /** People get a round, quieter mark; the operator a square, solid one. */
  person?: boolean;
}) {
  const { tone } = useRail();
  const tipProps = useTip(label);
  const look = person
    ? tone === 'dark'
      ? 'rounded-full bg-white/14 text-canvas'
      : 'rounded-full bg-linen text-ink'
    : tone === 'dark'
      ? 'rounded-lg bg-white/14 text-canvas'
      : 'rounded-lg bg-ink text-canvas';
  return (
    <span
      role="img"
      aria-label={label}
      className={cx(
        'mx-auto grid size-8 shrink-0 place-items-center text-[13px] font-semibold uppercase',
        look,
      )}
      {...tipProps}
    >
      {text.trim().charAt(0) || '?'}
    </span>
  );
}
