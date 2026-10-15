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

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Space kept between a panel and the edge of the screen. */
const EDGE = 12;

/**
 * A button that opens a small panel beneath it: a filter's choices, or the calendar's key. Escape,
 * a click elsewhere or tabbing away closes it. The panel is not modal: the page stays usable.
 */
export function Popover({
  label,
  title,
  active = false,
  icon,
  panelClassName,
  children,
}: {
  /** The button's words. */
  label: ReactNode;
  /** The panel's name for screen readers: "Area", "Free dates". */
  title: string;
  /** Something is chosen: the button is outlined in ink. */
  active?: boolean;
  /** Shown before the words, instead of the arrow after them. */
  icon?: ReactNode;
  panelClassName?: string;
  /** The panel, or a function given `close` for panels that finish (a form's button). */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Opened near the right edge, the panel moves left so all of it is on screen.
  useLayoutEffect(() => {
    if (!open || !wrapper.current || !panel.current) return;
    const left = wrapper.current.getBoundingClientRect().left;
    const over = left + panel.current.offsetWidth - (window.innerWidth - EDGE);
    setShift(over > 0 ? -Math.min(over, Math.max(0, left - EDGE)) : 0);
  }, [open]);

  // Focus goes to the first thing to use inside, or the panel itself when it only tells.
  useEffect(() => {
    if (!open || !panel.current) return;
    const first = panel.current.querySelector<HTMLElement>(
      'input:not([type="hidden"]), button, select, textarea, a[href]',
    );
    (first ?? panel.current).focus({ preventScroll: true });
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close();
    }
  };
  // Tabbing out of the button or the panel, to anything else, closes it.
  const onBlur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !wrapper.current?.contains(next)) setOpen(false);
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className={cx(
          'inline-flex h-9 max-w-[260px] items-center gap-1.5 rounded-md border bg-canvas text-[13.5px] whitespace-nowrap text-ink transition-colors hover:bg-linen',
          icon ? 'pr-3 pl-2.5' : 'pr-2 pl-3',
          active ? 'border-ink font-medium shadow-[inset_0_0_0_1px_var(--color-ink)]' : 'border-hairline',
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
        {icon ? null : (
          <IconChevronDown
            size={15}
            stroke={1.75}
            aria-hidden
            className={cx('shrink-0 text-mist transition-transform', open && 'rotate-180')}
          />
        )}
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={title}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          style={{ left: shift }}
          className={cx(
            'absolute top-full z-30 mt-2 max-w-[calc(100vw-24px)] rounded-xl border border-hairline bg-canvas shadow-[0_10px_30px_rgb(21_24_27/0.14)] outline-none',
            panelClassName ?? 'w-[280px]',
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
