import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * A turning ring: a quarter arc in the accent colour on a quiet track. With reduced motion it turns
 * slowly rather than not at all, so it still says "working".
 */
export function Spinner({ size = 36, className }: { size?: number; className?: string }) {
  const stroke = Math.max(2.5, size / 12);
  const r = (size - stroke) / 2;
  const around = 2 * Math.PI * r;
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cx(
        'shrink-0 animate-spin [animation-duration:0.9s] motion-reduce:[animation-duration:2.4s]',
        className,
      )}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-hairline)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${around * 0.28} ${around}`}
      />
    </svg>
  );
}

/** A page on its way: the spinner in the middle of where the page will be, and what is loading. */
export function PageLoading({ children = 'Loading' }: { children?: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[46vh] flex-col items-center justify-center gap-4"
    >
      <Spinner />
      <p className="text-[13.5px] text-mist">{children}</p>
    </div>
  );
}

/** The app starting: the brand, the spinner under it, and what is happening. */
export function StartLoading({ children = 'Loading' }: { children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-6">
      <BrandMark />
      <Spinner size={40} />
      <p className="text-[13.5px] text-mist">{children}</p>
    </div>
  );
}
