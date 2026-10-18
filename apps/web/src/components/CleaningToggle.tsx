import type { CleaningState } from '@v01/shared';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const WHEN = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** What happened last, for the tooltip: who marked it and when, or that a check-out made it dirty. */
export function cleaningStory(state: CleaningState, guest?: string | null): string {
  if (!state.changedAt)
    return state.status === 'dirty' ? 'Marked dirty.' : 'Nobody has marked it since it was added.';
  const when = WHEN.format(new Date(state.changedAt));
  if (state.changedBy) return `Marked ${state.status} by ${state.changedBy}, ${when}.`;
  return guest ? `Dirty since ${guest} checked out, ${when}.` : `Dirty since a check-out, ${when}.`;
}

/**
 * Clean or dirty as a small switch: on is clean. One tap flips it. Dirty is amber, and red when a
 * guest arrives today. Without permission it only shows.
 */
export function CleaningToggle({
  state,
  name,
  urgent = false,
  short = false,
  canChange,
  pending = false,
  story,
  onChange,
}: {
  state: CleaningState;
  /** The property, for screen readers. */
  name: string;
  /** A guest arrives today and it is dirty. */
  urgent?: boolean;
  /** Fewer words, for a narrow column. */
  short?: boolean;
  canChange: boolean;
  pending?: boolean;
  /** The tooltip. */
  story: string;
  onChange(status: 'clean' | 'dirty'): void;
}) {
  const clean = state.status === 'clean';
  const words = clean ? 'Clean' : urgent ? (short ? 'Dirty, arriving' : 'Dirty, guest arriving') : 'Dirty';
  const tone = clean ? 'text-done-text' : urgent ? 'text-urgent' : 'text-pending-text';
  const track = clean ? 'bg-done' : urgent ? 'bg-urgent' : 'bg-pending';
  const inner = (
    <>
      <span
        aria-hidden
        className={cx(
          'relative inline-block h-[14px] w-[24px] shrink-0 rounded-full transition-colors',
          track,
          pending && 'opacity-60',
        )}
      >
        <span
          className={cx(
            'absolute top-[2px] size-[10px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-[left]',
            clean ? 'left-[12px]' : 'left-[2px]',
          )}
        />
      </span>
      <span className={cx('truncate text-[11.5px] leading-none font-medium', tone)}>{words}</span>
    </>
  );
  if (!canChange) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5" title={story}>
        {inner}
        <span className="sr-only">{`${name} is ${words.toLowerCase()}.`}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={clean}
      aria-label={`${name} is ${words.toLowerCase()}. ${story} Switch to ${clean ? 'dirty' : 'clean'}.`}
      title={`${story} Click to mark ${clean ? 'dirty' : 'clean'}.`}
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        onChange(clean ? 'dirty' : 'clean');
      }}
      className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full outline-offset-2 disabled:cursor-wait"
    >
      {inner}
    </button>
  );
}
