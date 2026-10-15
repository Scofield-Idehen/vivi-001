import { IconBrandAirbnb, IconBrandBooking, IconUser, type TablerIcon } from '@tabler/icons-react';
import type { Channel } from '@v01/shared';
import type { ReactNode } from 'react';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Where a booking came from, shown at the start of its bar (Alpha, 15 Oct 2026). The marks are drawn
 * in ink on a white circle, never in a channel's own colours: colour still means status.
 */
export const CHANNEL_MARKS: Record<Channel, { icon: TablerIcon } | { letter: string }> = {
  airbnb: { icon: IconBrandAirbnb },
  booking_com: { icon: IconBrandBooking },
  vrbo: { letter: 'V' },
  expedia: { letter: 'E' },
  direct: { icon: IconUser },
};

export type MarkTone = 'stay' | 'conflict' | 'block';

/** A white circle at the start of a bar, holding a channel's mark or a block's sign. */
export function Mark({ children, size, tone }: { children: ReactNode; size: number; tone: MarkTone }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-full',
        tone === 'stay' && 'bg-canvas text-ink',
        tone === 'conflict' && 'border border-urgent bg-canvas text-urgent',
        tone === 'block' && 'bg-canvas text-slate',
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

export function ChannelMark({
  channel,
  size,
  tone = 'stay',
}: {
  channel: Channel;
  size: number;
  tone?: 'stay' | 'conflict';
}) {
  const mark = CHANNEL_MARKS[channel];
  return (
    <Mark size={size} tone={tone}>
      {'icon' in mark ? (
        <mark.icon size={Math.round(size * 0.68)} stroke={1.9} />
      ) : (
        <span className="leading-none font-bold" style={{ fontSize: Math.max(9, Math.round(size * 0.5)) }}>
          {mark.letter}
        </span>
      )}
    </Mark>
  );
}
