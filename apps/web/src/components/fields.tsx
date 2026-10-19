import { IconCheck, IconCopy } from '@tabler/icons-react';
import { type ReactNode, useEffect, useId, useState } from 'react';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const INPUT =
  'w-full rounded-md border border-edge bg-white text-[14px] text-ink placeholder:text-mist focus:border-accent focus:outline-none aria-invalid:border-urgent';

/** A count that turns red past the limit, so people trim before a channel cuts it for them. */
function Count({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={cx('tnum text-[12px]', over ? 'text-urgent' : 'text-mist')}>
      {value.length} of {max}
    </span>
  );
}

export function TextField({
  label,
  value,
  onChange,
  max,
  hint,
  error,
  placeholder,
  autoComplete = 'off',
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  /** Shows a running count against this limit. */
  max?: number;
  hint?: ReactNode;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] text-slate">
          {label}
        </label>
        {max ? <Count value={value} max={max} /> : null}
      </div>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={cx(INPUT, 'h-9 px-3')}
      />
      {error ? (
        <p id={`${id}-note`} className="text-[12.5px] text-urgent">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-note`} className="text-[12.5px] leading-snug text-mist">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  max,
  hint,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  max: number;
  hint?: ReactNode;
  rows?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] text-slate">
          {label}
        </label>
        <Count value={value} max={max} />
      </div>
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={value.length > max ? true : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cx(INPUT, 'resize-y px-3 py-2 leading-relaxed')}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] leading-snug text-mist">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField<V extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: V;
  onChange(value: V): void;
  options: readonly { value: V; label: string }[];
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-slate">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cx(INPUT, 'h-9 px-2.5')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] leading-snug text-mist">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** An amount of money typed as people type it: "120", "£120.50". */
export function MoneyField({
  label,
  value,
  onChange,
  symbol,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  symbol: string;
  error?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-slate">
        {label}
      </label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[14px] text-mist"
        >
          {symbol}
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          className={cx(INPUT, 'h-9 pr-3 pl-7')}
        />
      </div>
      {error ? (
        <p id={`${id}-note`} className="text-[12.5px] text-urgent">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-note`} className="text-[12.5px] leading-snug text-mist">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** An on/off setting, with a line saying what "on" means. */
export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[14.5px] text-ink">
          {label}
        </p>
        {description ? (
          <p id={`${id}-description`} className="mt-0.5 text-[13px] leading-snug text-slate">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-ink' : 'bg-edge/60',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'inline-block size-5 rounded-full bg-canvas shadow-[0_1px_2px_rgb(21_24_27/0.25)] transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
          )}
        />
      </button>
    </div>
  );
}

/** Copies text for pasting into a channel's own editor. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
      className="inline-flex items-center gap-1 text-[12.5px] action"
    >
      {copied ? (
        <IconCheck size={14} stroke={2} aria-hidden />
      ) : (
        <IconCopy size={14} stroke={1.75} aria-hidden />
      )}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}
