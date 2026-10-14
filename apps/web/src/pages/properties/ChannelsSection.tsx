import { IconCheck } from '@tabler/icons-react';
import type { PropertyDetail } from '@v01/shared';
import { StatusDot } from '../../components/ui.tsx';
import { V01 } from '../../lib/format.ts';
import { Section } from './Section.tsx';

const CHANNELS = ['Airbnb', 'Booking.com', 'Vrbo'] as const;

/**
 * What reaches each channel once a property is connected. Channex carries prices, availability,
 * stay lengths and bookings to all three, and Airbnb's fees and booking rules; it doesn't carry
 * photos, descriptions or amenities to any of them (see docs/decisions.md, 14 Oct 2026).
 */
const SYNC: { what: string; synced: readonly (typeof CHANNELS)[number][] }[] = [
  { what: 'Prices and availability', synced: CHANNELS },
  { what: 'Bookings, both ways', synced: CHANNELS },
  { what: 'Shortest and longest stays', synced: CHANNELS },
  { what: 'Fees, instant book and house rules', synced: ['Airbnb'] },
  { what: 'Check-in times and cancellation policy', synced: ['Airbnb'] },
  { what: 'Photos, title, description and amenities', synced: [] },
];

export function ChannelsSection({ d }: { d: PropertyDetail }) {
  const state =
    d.managedBy === 'v01' ? (
      <StatusDot status="done">Run by {V01}: changes here reach the channels.</StatusDot>
    ) : d.managedBy === 'guesty' ? (
      <StatusDot status="pending">
        Still on Guesty. Guesty runs its listings until it moves over, and {V01} sends nothing meanwhile.
      </StatusDot>
    ) : (
      <StatusDot status="neutral">
        Not connected yet. {V01} sends nothing to any channel until its listings are connected.
      </StatusDot>
    );

  return (
    <Section
      id="channels"
      canEdit={false}
      description={`Guests book through Airbnb, Booking.com and Vrbo. This is what ${V01} keeps in step on each.`}
    >
      <p className="text-[14px]">{state}</p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-hairline text-[12.5px] text-mist">
              <th scope="col" className="py-2.5 pr-4 font-normal">
                What
              </th>
              {CHANNELS.map((channel) => (
                <th key={channel} scope="col" className="py-2.5 pr-4 font-normal">
                  {channel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {SYNC.map((row) => (
              <tr key={row.what}>
                <th scope="row" className="py-3 pr-4 font-normal text-ink">
                  {row.what}
                </th>
                {CHANNELS.map((channel) => (
                  <td key={channel} className="py-3 pr-4">
                    {row.synced.includes(channel) ? (
                      <span className="inline-flex items-center gap-1.5 text-ink">
                        <IconCheck size={15} stroke={2} aria-hidden className="text-done" />
                        Synced
                      </span>
                    ) : (
                      <span className="text-mist">Set on {channel}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 max-w-[64ch] text-[13px] leading-relaxed text-mist">
        Channex, which connects {V01} to the channels, doesn't carry photos, descriptions or amenities. Where
        it says "Set on", copy them from this page into the channel's own editor.
      </p>
    </Section>
  );
}
