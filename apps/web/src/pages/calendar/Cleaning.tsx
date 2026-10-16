import { IconSparkles, IconSpray } from '@tabler/icons-react';
import { CLEANING_STATUS_LABELS } from '@v01/shared';
import { Popover } from '../../components/Popover.tsx';
import { Button } from '../../components/ui.tsx';
import { ApiError, useSetCleaning } from '../../lib/api.ts';
import { arrivesToday, type CalendarRow, cleaningWhen, guestWhoLeft } from './model.ts';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const ISO_DAY = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });

/** What happened last, in a sentence: who marked it and when, or which check-out made it dirty. */
function story(row: CalendarRow, timeZone: string, today: string): string {
  const { status, changedAt, changedBy } = row.property.cleaning;
  if (!changedAt) return status === 'dirty' ? 'Marked dirty.' : 'Nobody has marked it since it was added.';
  const when = cleaningWhen(changedAt, timeZone, today);
  if (changedBy) return `Marked ${CLEANING_STATUS_LABELS[status].toLowerCase()} by ${changedBy}, ${when}.`;
  const guest = guestWhoLeft(row, ISO_DAY(timeZone).format(new Date(changedAt)));
  return guest ? `Dirty since ${guest} checked out, ${when}.` : `Dirty since a check-out, ${when}.`;
}

function ChangePanel({
  row,
  orgId,
  timeZone,
  today,
  close,
}: {
  row: CalendarRow;
  orgId: string;
  timeZone: string;
  today: string;
  close(): void;
}) {
  const set = useSetCleaning(orgId);
  const { status } = row.property.cleaning;
  const next = status === 'dirty' ? 'clean' : 'dirty';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] font-medium text-ink">
        {row.property.name} is {CLEANING_STATUS_LABELS[status].toLowerCase()}
      </p>
      <p className="-mt-1.5 text-[13px] leading-snug text-slate">{story(row, timeZone, today)}</p>
      {arrivesToday(row, today) && status === 'dirty' ? (
        <p className="text-[13px] leading-snug text-urgent">A guest arrives today.</p>
      ) : null}
      {set.error ? (
        <p role="alert" className="text-[12.5px] text-urgent">
          {set.error instanceof ApiError ? set.error.message : 'That didn’t save. Try again.'}
        </p>
      ) : null}
      <Button
        variant={next === 'clean' ? 'primary' : 'secondary'}
        disabled={set.isPending}
        onClick={() => set.mutate({ propertyId: row.property.id, status: next }, { onSuccess: close })}
      >
        {set.isPending ? 'Saving' : next === 'clean' ? 'Mark clean' : 'Mark dirty'}
      </Button>
    </div>
  );
}

/**
 * Under each property's name: clean or dirty. A guest's check-out makes it dirty by itself; one
 * click marks it clean. Dirty is amber, and red on a day a guest arrives; it says so in words too.
 */
export function CleaningBadge({
  row,
  orgId,
  today,
  timeZone,
  canChange,
  short = false,
}: {
  row: CalendarRow;
  orgId: string;
  today: string;
  timeZone: string;
  /** The role can mark properties clean or dirty. */
  canChange: boolean;
  /** The names column is a phone's narrow one: fewer words fit. */
  short?: boolean;
}) {
  const { status } = row.property.cleaning;
  const dirty = status === 'dirty';
  const urgent = dirty && arrivesToday(row, today);
  const Icon = dirty ? IconSpray : IconSparkles;
  const words = urgent
    ? short
      ? 'Dirty, arriving'
      : 'Dirty, guest arriving'
    : CLEANING_STATUS_LABELS[status];
  // A screen reader hears the whole of it, whatever fits on screen.
  const said = urgent ? 'Dirty, guest arriving' : CLEANING_STATUS_LABELS[status];
  const pill = cx(
    'inline-flex h-5 max-w-full items-center gap-1 rounded-full px-1.5 text-[11px] leading-none font-medium whitespace-nowrap',
    urgent
      ? 'bg-urgent/12 text-urgent'
      : dirty
        ? 'bg-pending/20 text-pending-text'
        : 'bg-done/10 text-done-text',
  );
  const content = (
    <>
      <Icon size={12} stroke={2} aria-hidden className="shrink-0" />
      <span className="truncate" aria-hidden={words !== said}>
        {words}
      </span>
      {words !== said ? <span className="sr-only">{said}</span> : null}
    </>
  );
  if (!canChange) {
    return (
      <span className={pill} title={story(row, timeZone, today)}>
        {content}
      </span>
    );
  }
  return (
    <Popover
      floating
      title={`Cleaning at ${row.property.name}`}
      label={content}
      buttonLabel={`${said}. Change the cleaning of ${row.property.name}`}
      buttonClassName={cx(
        pill,
        'cursor-pointer transition-shadow hover:shadow-[inset_0_0_0_1px_currentColor]',
      )}
      panelClassName="w-[270px] p-4"
    >
      {(close) => <ChangePanel row={row} orgId={orgId} timeZone={timeZone} today={today} close={close} />}
    </Popover>
  );
}
