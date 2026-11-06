import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

/**
 * ViVi OS's own "are you sure?" (1 Nov 2026), in place of the browser's confirm box, which shows the
 * web address and its own OK and Cancel. On a laptop it is a small box in the middle of the page;
 * on a phone it rises from the bottom with two full-width buttons in reach of a thumb. The button
 * names the action ("Finalise", "Remove"), never "OK". Escape, Cancel or a tap outside says no.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Remove Tom?', body: '…', action: 'Remove', tone: 'urgent' })) …
 */

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The button's words: what happens, such as "Finalise" or "Remove log-in". */
  action: string;
  /** Urgent for removing, deleting or disconnecting. */
  tone?: 'primary' | 'urgent';
  cancel?: string;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm needs <ConfirmProvider> above it');
  return ask;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<(ConfirmOptions & { resolve(yes: boolean): void }) | null>(null);
  const ask = useCallback<Ask>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setOpen({ ...options, resolve });
      }),
    [],
  );
  const answer = (yes: boolean) => {
    open?.resolve(yes);
    setOpen(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {open ? <ConfirmBox options={open} onAnswer={answer} /> : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmBox({ options, onAnswer }: { options: ConfirmOptions; onAnswer(yes: boolean): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    // The safe answer has the focus for something that can't be undone; otherwise the action.
    if (options.tone !== 'urgent') yes.current?.focus();
  }, [options.tone]);
  const urgent = options.tone === 'urgent';
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape answers through onCancel; this only catches taps outside the box
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={options.body ? bodyId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onAnswer(false);
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onAnswer(false);
      }}
      className="confirm m-0 w-full max-w-none bg-transparent p-0 text-ink max-sm:mt-auto sm:m-auto sm:max-w-[420px]"
    >
      <div className="rounded-t-3xl border border-hairline bg-canvas px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgb(21_24_27/0.12)] sm:rounded-2xl sm:pb-5 sm:shadow-[0_16px_48px_rgb(21_24_27/0.18)]">
        <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline sm:hidden" />
        <h2 id={titleId} className="text-[17px] leading-snug font-semibold tracking-[-0.01em] text-ink">
          {options.title}
        </h2>
        {options.body ? (
          <div id={bodyId} className="mt-1.5 text-[14px] leading-relaxed text-slate">
            {options.body}
          </div>
        ) : null}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <button
            ref={yes}
            type="button"
            onClick={() => onAnswer(true)}
            className={`h-12 rounded-xl px-4 text-[15px] font-medium text-canvas sm:h-9 sm:rounded-lg sm:text-[14px] ${
              urgent ? 'bg-urgent hover:bg-urgent/90' : 'bg-ink hover:bg-ink/88'
            }`}
          >
            {options.action}
          </button>
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="h-12 rounded-xl border border-hairline px-4 text-[15px] text-ink hover:bg-linen sm:h-9 sm:rounded-lg sm:text-[14px]"
          >
            {options.cancel ?? 'Cancel'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
