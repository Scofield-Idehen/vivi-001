import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'quiet';

/** One primary (ink) button per screen; everything else is secondary or quiet. */
export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'h-9 bg-ink px-4 text-canvas hover:bg-ink/88',
        variant === 'secondary' && 'h-9 border border-hairline px-4 text-ink hover:bg-linen',
        variant === 'quiet' && 'text-accent underline-offset-4 hover:underline',
        className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] text-slate">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
        className="h-9 rounded-md border border-edge bg-white px-3 text-[14px] text-ink placeholder:text-mist focus:border-accent focus:outline-none aria-invalid:border-urgent"
      />
      {error ? (
        <p id={`${id}-error`} className="text-[12.5px] text-urgent">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-mist">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Channels and accounts are named in a badge, never given a colour. */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-linen px-2 py-0.5 text-[12px] text-slate">
      {children}
    </span>
  );
}

export type Status = 'urgent' | 'pending' | 'done' | 'neutral';

const DOT: Record<Status, string> = {
  urgent: 'bg-urgent',
  pending: 'bg-pending',
  done: 'bg-done',
  neutral: 'bg-edge',
};

/** Colour means status, never decoration. The label always says it in words too. */
export function StatusDot({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={cx('size-[7px] shrink-0 rounded-full', DOT[status])} />
      <span>{children}</span>
    </span>
  );
}

/** A soft panel in the paper colour, for figures and groups of facts. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl bg-paper p-5', className)}>{children}</div>;
}

/** One figure with its label and a line of context underneath. */
export function Stat({
  label,
  value,
  foot,
  status,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  status?: Status;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-2">
      <p className="text-[13px] text-slate">{label}</p>
      <p className="tnum flex items-center gap-2.5 text-[28px] leading-none font-medium tracking-[-0.015em] text-ink">
        {status ? <span aria-hidden className={cx('size-[9px] shrink-0 rounded-full', DOT[status])} /> : null}
        {value}
      </p>
      {foot ? <p className="text-[13px] leading-snug text-slate">{foot}</p> : null}
    </Card>
  );
}

export function SectionHeading({
  id,
  children,
  action,
}: {
  id: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-[15px] font-medium text-ink">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
      <div className="min-w-0">
        <h1 className="font-serif text-[34px] leading-[1.1] font-normal tracking-[-0.01em] text-ink">
          {title}
        </h1>
        {description ? <p className="mt-2 max-w-[62ch] text-[14px] text-slate">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex max-w-[52ch] flex-col items-start gap-3 py-16">
      <h2 className="font-serif text-[22px] font-normal">{title}</h2>
      <p className="text-[14px] leading-relaxed text-slate">{children}</p>
      {action}
    </div>
  );
}

export function Notice({
  tone = 'pending',
  children,
}: {
  tone?: 'pending' | 'urgent' | 'done';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'urgent' ? 'alert' : 'status'}
      className={cx(
        'rounded-md border-l-2 bg-linen px-4 py-3 text-[13.5px] leading-relaxed text-ink',
        tone === 'urgent' ? 'border-urgent' : tone === 'done' ? 'border-done' : 'border-pending',
      )}
    >
      {children}
    </div>
  );
}

export function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-[14px] text-mist" aria-live="polite">
      {children}
    </div>
  );
}
