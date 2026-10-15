import { IconBan, IconInfoCircle } from '@tabler/icons-react';
import { CHANNEL_LABELS, CHANNELS } from '@v01/shared';
import type { ReactNode } from 'react';
import { Popover } from '../../components/Popover.tsx';
import { ChannelMark, Mark } from './marks.tsx';

function Row({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="flex items-center">{swatch}</dt>
      <dd className="text-[13px] leading-snug text-slate">{children}</dd>
    </div>
  );
}

const bar = 'flex h-[22px] w-[60px] items-center rounded-full pl-[3px]';

/** What every mark on the calendar means, in words, behind one button. */
export function CalendarKey() {
  return (
    <Popover
      title="What the calendar shows"
      label="Key"
      icon={<IconInfoCircle size={16} stroke={1.75} aria-hidden className="shrink-0 text-slate" />}
      panelClassName="w-[360px] p-4"
    >
      <p className="text-[14px] font-medium text-ink">What the calendar shows</p>
      <dl className="mt-3 grid grid-cols-[60px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2.5">
        <Row
          swatch={
            <span className={`${bar} bg-accent`}>
              <ChannelMark channel="airbnb" size={16} />
            </span>
          }
        >
          A booking, from the arrival to the departure day. Select it to see the guest and the stay.
        </Row>
        <Row
          swatch={
            <span
              className={`${bar} border border-urgent bg-[repeating-linear-gradient(135deg,rgb(169_65_47/0.1)_0_5px,var(--color-canvas)_5px_10px)]`}
            >
              <ChannelMark channel="booking_com" size={14} tone="conflict" />
            </span>
          }
        >
          A booking that overlaps another, so it needs sorting out with the guest or the channel.
        </Row>
        <Row
          swatch={
            <span
              className={`${bar} border border-edge/45 bg-[repeating-linear-gradient(135deg,var(--color-linen)_0_5px,var(--color-paper)_5px_10px)]`}
            >
              <Mark size={16} tone="block">
                <IconBan size={11} stroke={1.9} />
              </Mark>
            </span>
          }
        >
          Blocked: no bookings on those nights.
        </Row>
        <Row swatch={<span className="tnum text-[13px] font-semibold text-accent">£180</span>}>
          A price set for that night.
        </Row>
        <Row swatch={<span className="tnum text-[13px] text-ink">£165</span>}>
          The usual price, or the weekend price on Fridays and Saturdays.
        </Row>
        <Row swatch={<span className="tnum text-[13px] text-pending-text">£95</span>}>
          Held at the lowest or highest price set for the property.
        </Row>
        <Row swatch={<span className="text-[11px] font-medium text-accent">min 3</span>}>
          A minimum stay set for that night. The usual one is under the property’s name.
        </Row>
        <Row swatch={<span aria-hidden className="ml-1 size-[6px] rounded-full bg-plum" />}>
          No arrivals or no departures that night.
        </Row>
        <Row
          swatch={
            <span
              aria-hidden
              className="h-[22px] w-[60px] rounded-sm border border-hairline bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(149_139_123/0.16)_6px_7px)]"
            />
          }
        >
          Nights that have passed. They can’t be changed.
        </Row>
      </dl>

      <p className="mt-4 border-t border-hairline pt-3 text-[13px] font-medium text-ink">
        Where a booking came from
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        {CHANNELS.map((channel) => (
          <li key={channel} className="flex items-center gap-2 text-[13px] text-slate">
            <span className="grid size-[22px] place-items-center rounded-full bg-accent">
              <ChannelMark channel={channel} size={18} />
            </span>
            {CHANNEL_LABELS[channel]}
          </li>
        ))}
      </ul>
    </Popover>
  );
}
