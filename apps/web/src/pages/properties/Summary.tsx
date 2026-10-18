import {
  IconBath,
  IconBed,
  IconCalendarMonth,
  IconClipboardText,
  IconDoor,
  IconPhoto,
  IconSparkles,
  IconSpray,
  IconUsers,
} from '@tabler/icons-react';
import { CHANNEL_LABELS, CLEANING_STATUS_LABELS, type PropertyDetail } from '@v01/shared';
import { Link } from 'react-router';
import { Popover } from '../../components/Popover.tsx';
import { Button } from '../../components/ui.tsx';
import { ApiError, useSetCleaning } from '../../lib/api.ts';
import { ChannelMark } from '../calendar/marks.tsx';

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

function Count({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof IconBed;
  value: number | string | null;
  label: string;
}) {
  if (value === null || value === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13.5px] text-slate" title={label}>
      <Icon size={16} stroke={1.6} aria-hidden className="text-mist" />
      <span className="tnum">{value}</span>
      <span className="sr-only"> {label}</span>
    </span>
  );
}

/** Clean or dirty, changed here as on the Calendar; says who last changed it, and when. */
function Cleaning({ d, orgId, canChange }: { d: PropertyDetail; orgId: string; canChange: boolean }) {
  const set = useSetCleaning(orgId);
  const { status, changedAt, changedBy } = d.cleaning;
  const dirty = status === 'dirty';
  const Icon = dirty ? IconSpray : IconSparkles;
  const next = dirty ? 'clean' : 'dirty';
  const story = !changedAt
    ? 'Nobody has marked it since it was added.'
    : changedBy
      ? `Marked ${CLEANING_STATUS_LABELS[status].toLowerCase()} by ${changedBy}, ${WHEN.format(new Date(changedAt))}.`
      : `Dirty since a guest checked out, ${WHEN.format(new Date(changedAt))}.`;
  const pill = cx(
    'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium',
    dirty ? 'bg-pending/20 text-pending-text' : 'bg-done/10 text-done-text',
  );
  const content = (
    <>
      <Icon size={14} stroke={2} aria-hidden />
      {CLEANING_STATUS_LABELS[status]}
    </>
  );
  if (!canChange) {
    return (
      <span className={pill} title={story}>
        {content}
      </span>
    );
  }
  return (
    <Popover
      title={`Cleaning at ${d.name}`}
      label={content}
      buttonLabel={`${CLEANING_STATUS_LABELS[status]}. Change the cleaning of ${d.name}`}
      buttonClassName={cx(
        pill,
        'cursor-pointer transition-shadow hover:shadow-[inset_0_0_0_1px_currentColor]',
      )}
      panelClassName="w-[270px] p-4"
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] font-medium text-ink">
            {d.name} is {CLEANING_STATUS_LABELS[status].toLowerCase()}
          </p>
          <p className="-mt-1.5 text-[13px] leading-snug text-slate">{story}</p>
          {set.error ? (
            <p role="alert" className="text-[12.5px] text-urgent">
              {set.error instanceof ApiError ? set.error.message : 'That didn’t save. Try again.'}
            </p>
          ) : null}
          <Button
            variant={next === 'clean' ? 'primary' : 'secondary'}
            disabled={set.isPending}
            onClick={() => set.mutate({ propertyId: d.id, status: next }, { onSuccess: close })}
          >
            {set.isPending ? 'Saving' : next === 'clean' ? 'Mark clean' : 'Mark dirty'}
          </Button>
        </div>
      )}
    </Popover>
  );
}

/**
 * The property at a glance, under its name: the listing's title and address, what it sleeps, the
 * channels it is listed on, clean or dirty, and the way to its calendar and bookings.
 */
export function Summary({ d, orgId, canClean }: { d: PropertyDetail; orgId: string; canClean: boolean }) {
  const address = [d.addressLine1, d.city, d.postcode].filter(Boolean).join(', ');
  const code = d.internalCode ?? d.name;
  return (
    <div className="mt-5 flex flex-col gap-4 rounded-2xl bg-paper px-5 py-4">
      {d.title || address ? (
        <div className="min-w-0">
          {d.title ? <p className="text-[15px] text-ink">{d.title}</p> : null}
          {address ? <p className="mt-0.5 text-[13.5px] text-slate">{address}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Count icon={IconDoor} value={d.bedrooms} label={d.bedrooms === 1 ? 'bedroom' : 'bedrooms'} />
        <Count icon={IconBath} value={d.bathrooms} label={d.bathrooms === 1 ? 'bathroom' : 'bathrooms'} />
        <Count icon={IconBed} value={d.beds} label={d.beds === 1 ? 'bed' : 'beds'} />
        <Count icon={IconUsers} value={d.maxGuests} label="guests at most" />
        <Count icon={IconPhoto} value={d.photoCount} label={d.photoCount === 1 ? 'photo' : 'photos'} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-hairline pt-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2 text-[13.5px]">
            <span className="text-slate">Channels</span>
            {d.listings.length ? (
              <span className="flex items-center gap-1">
                {d.listings.map((l) => (
                  <span
                    key={`${l.channel}-${l.externalListingId}`}
                    title={`${CHANNEL_LABELS[l.channel]}, ${l.account}`}
                  >
                    <ChannelMark channel={l.channel} size={24} />
                    <span className="sr-only">{`${CHANNEL_LABELS[l.channel]}, ${l.account}`}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-mist">none linked yet</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[13.5px]">
            <span className="text-slate">Cleaning</span>
            <Cleaning d={d} orgId={orgId} canChange={canClean} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/calendar?property=${encodeURIComponent(code)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-canvas px-3 text-[13px] text-ink hover:bg-linen"
          >
            <IconCalendarMonth size={15} stroke={1.75} aria-hidden />
            Calendar
          </Link>
          <Link
            to={`/reservations?q=${encodeURIComponent(code)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-canvas px-3 text-[13px] text-ink hover:bg-linen"
          >
            <IconClipboardText size={15} stroke={1.75} aria-hidden />
            Bookings
          </Link>
        </div>
      </div>
    </div>
  );
}
