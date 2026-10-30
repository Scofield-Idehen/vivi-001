import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const monthName = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`));

/** ‹ October 2026 › */
export function MonthPicker({ value, onChange }: { value: string; onChange(m: string): void }) {
  const arrow =
    'flex size-8 items-center justify-center rounded-full text-slate hover:bg-linen hover:text-ink';
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-hairline bg-canvas p-[3px]">
      <button
        type="button"
        aria-label="Month before"
        onClick={() => onChange(shiftMonth(value, -1))}
        className={arrow}
      >
        <IconChevronLeft size={16} stroke={1.75} aria-hidden />
      </button>
      <span className="min-w-[124px] text-center text-[13px] font-medium text-ink" aria-live="polite">
        {monthName(value)}
      </span>
      <button
        type="button"
        aria-label="Month after"
        onClick={() => onChange(shiftMonth(value, 1))}
        className={arrow}
      >
        <IconChevronRight size={16} stroke={1.75} aria-hidden />
      </button>
    </div>
  );
}
