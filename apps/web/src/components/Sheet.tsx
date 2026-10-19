import { IconX } from '@tabler/icons-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * A panel that slides in from the right over the page: for making or looking at one thing without
 * leaving the list behind it. Escape and a click on the dimmed page close it; focus stays inside.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  busy = false,
  children,
  footer,
  width = 'md:w-[560px]',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose(): void;
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes through onCancel; this only catches clicks on the dimmed page beside the panel
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current && !busy) onClose();
      }}
      className={`sheet fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-none border-l border-hairline bg-canvas p-0 text-ink ${width}`}
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top,0px)]">
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-medium text-ink">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 truncate text-[12.5px] text-mist">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="action action-ink -mr-2 !px-2"
          >
            <IconX size={18} stroke={1.75} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap items-center gap-3 border-t border-hairline px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom,0px))]">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
