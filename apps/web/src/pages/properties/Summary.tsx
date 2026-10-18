import {
  IconBath,
  IconBed,
  IconCalendarMonth,
  IconClipboardText,
  IconDoor,
  IconPhoto,
  IconUsers,
} from '@tabler/icons-react';
import { CHANNEL_LABELS, type PropertyDetail } from '@v01/shared';
import { Link } from 'react-router';
import { CleaningToggle, cleaningStory } from '../../components/CleaningToggle.tsx';
import { useSetCleaning } from '../../lib/api.ts';
import { ChannelMark } from '../calendar/marks.tsx';

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

/** Clean or dirty, the same switch as on the Calendar. */
function Cleaning({ d, orgId, canChange }: { d: PropertyDetail; orgId: string; canChange: boolean }) {
  const set = useSetCleaning(orgId);
  return (
    <CleaningToggle
      state={d.cleaning}
      name={d.name}
      canChange={canChange}
      pending={set.isPending}
      story={cleaningStory(d.cleaning)}
      onChange={(status) => set.mutate({ propertyId: d.id, status })}
    />
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
