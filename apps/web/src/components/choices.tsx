import { IconCheck, IconMinus, IconPlus, type TablerIcon } from '@tabler/icons-react';
import type { ReactNode } from 'react';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// The radio input stays real (and keyboard-operable); it is hidden, and its label shows the state.
const focusRing =
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent';

/** A choice shown as a tile: an icon and a short name. One of a group. */
export function OptionTile({
  name,
  value,
  checked,
  onSelect,
  icon: Icon,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect(value: string): void;
  icon: TablerIcon;
  label: string;
}) {
  return (
    <label
      className={cx(
        'relative flex min-h-[104px] cursor-pointer flex-col justify-between gap-4 rounded-xl border bg-canvas p-4 transition-colors',
        checked
          ? 'border-ink shadow-[inset_0_0_0_1px_var(--color-ink)]'
          : 'border-hairline hover:border-edge',
        focusRing,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <Icon size={28} stroke={1.4} aria-hidden className={checked ? 'text-ink' : 'text-slate'} />
      <span className="text-[14px] leading-tight font-medium text-ink">{label}</span>
      {checked ? (
        <span
          aria-hidden
          className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-ink"
        >
          <IconCheck size={13} stroke={2.5} className="text-canvas" />
        </span>
      ) : null}
    </label>
  );
}

/** A choice shown as a row: an icon, a name and one line about what it means. */
export function OptionRow({
  name,
  value,
  checked,
  onSelect,
  icon: Icon,
  label,
  description,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect(value: string): void;
  icon: TablerIcon;
  label: string;
  description: ReactNode;
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-center gap-4 rounded-xl border bg-canvas px-4 py-3.5 transition-colors',
        checked
          ? 'border-ink shadow-[inset_0_0_0_1px_var(--color-ink)]'
          : 'border-hairline hover:border-edge',
        focusRing,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <Icon
        size={24}
        stroke={1.4}
        aria-hidden
        className={cx('shrink-0', checked ? 'text-ink' : 'text-slate')}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium text-ink">{label}</span>
        <span className="block text-[13px] leading-snug text-slate">{description}</span>
      </span>
      <span
        aria-hidden
        className={cx(
          'grid size-5 shrink-0 place-items-center rounded-full border',
          checked ? 'border-ink bg-ink' : 'border-edge',
        )}
      >
        {checked ? <span className="size-2 rounded-full bg-canvas" /> : null}
      </span>
    </label>
  );
}

/** A number changed with minus and plus, for counts people would otherwise mistype. */
export function Stepper({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
}) {
  const shown = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
  const lower = label.toLowerCase();
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <p className="text-[15px] text-ink">{label}</p>
        {hint ? <p className="mt-0.5 text-[13px] leading-snug text-mist">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${lower}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
          className="grid size-9 place-items-center rounded-full border border-edge text-slate transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:border-hairline disabled:text-hairline"
        >
          <IconMinus size={16} stroke={2} aria-hidden />
        </button>
        <output aria-live="polite" className="tnum w-9 text-center text-[16px] font-medium text-ink">
          {shown}
        </output>
        <button
          type="button"
          aria-label={`More ${lower}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
          className="grid size-9 place-items-center rounded-full border border-edge text-slate transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:border-hairline disabled:text-hairline"
        >
          <IconPlus size={16} stroke={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
