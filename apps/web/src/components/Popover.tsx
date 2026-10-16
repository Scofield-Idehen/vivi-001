import { IconChevronDown } from '@tabler/icons-react';
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Space kept between a panel and the edge of the screen. */
const EDGE = 12;

/**
 * A button that opens a small panel beneath it: a filter's choices, the calendar's key, a
 * property's cleaning. Escape, a click elsewhere or tabbing away closes it. The panel is not modal:
 * the page stays usable.
 */
export function Popover({
  label,
  title,
  active = false,
  icon,
  buttonClassName,
  buttonLabel,
  floating = false,
  panelClassName,
  children,
}: {
  /** The button's words. */
  label: ReactNode;
  /** The panel's name for screen readers: "Area", "Availability". */
  title: string;
  /** Something is chosen: the button is outlined in ink. */
  active?: boolean;
  /** Shown before the words, instead of the arrow after them. */
  icon?: ReactNode;
  /** A button of its own look instead of the filter button's (no arrow). */
  buttonClassName?: string;
  /** What the button says to a screen reader, when its words alone are too short. */
  buttonLabel?: string;
  /**
   * Opens over everything, placed against the window: for a button inside something that scrolls
   * or clips (the calendar grid). It closes when the page scrolls. Not inside a modal dialog.
   */
  floating?: boolean;
  panelClassName?: string;
  /** The panel, or a function given `close` for panels that finish (a form's button). */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const inside = useCallback(
    (node: Node | null) =>
      Boolean(node && (wrapper.current?.contains(node) || panel.current?.contains(node))),
    [],
  );

  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, inside]);

  // A floating panel is placed once, so it closes when what's under it moves.
  useEffect(() => {
    if (!open || !floating) return;
    const onScroll = (event: Event) => {
      if (!inside(event.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, floating, inside]);

  useLayoutEffect(() => {
    if (!open || !wrapper.current || !panel.current) return;
    // The page's own width: on a phone the window's grows with anything that overflows, this panel too.
    const width = document.documentElement.clientWidth;
    if (floating && button.current) {
      // Below the button, or above it when there's no room below; never off the side.
      const box = button.current.getBoundingClientRect();
      const height = document.documentElement.clientHeight;
      const { offsetWidth, offsetHeight } = panel.current;
      const left = Math.max(EDGE, Math.min(box.left, width - EDGE - offsetWidth));
      const below = box.bottom + 8;
      const above = box.top - 8 - offsetHeight;
      setPlace({ left, top: below + offsetHeight > height - EDGE && above > EDGE ? above : below });
      return;
    }
    // Opened near the right edge, the panel moves left so all of it is on screen.
    const left = wrapper.current.getBoundingClientRect().left;
    const over = left + panel.current.offsetWidth - (width - EDGE);
    setShift(over > 0 ? -Math.min(over, Math.max(0, left - EDGE)) : 0);
  }, [open, floating]);

  // Focus goes to the first thing to use inside, or the panel itself when it only tells.
  useEffect(() => {
    if (!open || !panel.current) return;
    const first = panel.current.querySelector<HTMLElement>(
      'input:not([type="hidden"]), button, select, textarea, a[href]',
    );
    (first ?? panel.current).focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) setPlace(null);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      // Only the popover closes: not a side panel it sits in, which Escape would otherwise close too.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  // Tabbing out of the button or the panel, to anything else, closes it.
  const onBlur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !inside(next)) setOpen(false);
  };

  const body = open ? (
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      style={
        floating
          ? {
              position: 'fixed',
              top: place?.top ?? 0,
              left: place?.left ?? 0,
              visibility: place ? 'visible' : 'hidden',
            }
          : { left: shift }
      }
      className={cx(
        'max-w-[calc(100vw-24px)] rounded-xl border border-hairline bg-canvas shadow-[0_10px_30px_rgb(21_24_27/0.14)] outline-none',
        floating ? 'z-50' : 'absolute top-full z-30 mt-2',
        panelClassName ?? 'w-[280px]',
      )}
    >
      {typeof children === 'function' ? children(close) : children}
    </div>
  ) : null;

  return (
    <div ref={wrapper} className={buttonClassName ? 'relative inline-flex max-w-full' : 'relative'}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={buttonLabel}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className={
          buttonClassName ??
          cx(
            'inline-flex h-9 max-w-[260px] items-center gap-1.5 rounded-md border bg-canvas text-[13.5px] whitespace-nowrap text-ink transition-colors hover:bg-linen',
            icon ? 'pr-3 pl-2.5' : 'pr-2 pl-3',
            active ? 'border-ink font-medium shadow-[inset_0_0_0_1px_var(--color-ink)]' : 'border-hairline',
          )
        }
      >
        {icon}
        {buttonClassName ? label : <span className="truncate">{label}</span>}
        {icon || buttonClassName ? null : (
          <IconChevronDown
            size={15}
            stroke={1.75}
            aria-hidden
            className={cx('shrink-0 text-mist transition-transform', open && 'rotate-180')}
          />
        )}
      </button>
      {floating && body ? createPortal(body, document.body) : body}
    </div>
  );
}
