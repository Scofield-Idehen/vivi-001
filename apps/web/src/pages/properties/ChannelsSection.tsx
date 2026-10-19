import { IconCheck } from '@tabler/icons-react';
import type { ChannexState, PropertyDetail } from '@v01/shared';
import { useEffect } from 'react';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, StatusDot } from '../../components/ui.tsx';
import { ApiError, useConnectChannex } from '../../lib/api.ts';
import { V01 } from '../../lib/format.ts';
import { Section } from './Section.tsx';

const WHEN = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const when = (iso: string | null) => (iso ? WHEN.format(new Date(iso)) : '');

/**
 * The property's place in Channex (integration step 3). Connecting makes it there, in the
 * operator's own group; nothing reaches any channel until its listings are linked (step 7).
 */
function ChannelManager({
  state,
  orgId,
  propertyId,
  canManage,
  refresh,
}: {
  state: ChannexState;
  orgId: string;
  propertyId: string;
  canManage: boolean;
  refresh(): void;
}) {
  const connect = useConnectChannex(orgId, propertyId);
  // The worker is on it: look again every few seconds until it is done.
  useEffect(() => {
    if (state.status !== 'connecting') return;
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [state.status, refresh]);

  const line =
    state.status === 'connected' ? (
      <span className="flex flex-col gap-1">
        <StatusDot status="done">
          Connected to Channex{state.finishedAt ? `, ${when(state.finishedAt)}` : ''}. Its Airbnb, Booking.com
          and Vrbo listings can be linked to it next.
        </StatusDot>
        {state.autoClose === true ? (
          <StatusDot status="done">
            Channex closes a booked night by itself, so nothing is sold twice even while {V01} is catching up
            or down. Checked {state.autoCloseCheckedAt ? when(state.autoCloseCheckedAt) : 'today'}.
          </StatusDot>
        ) : state.autoClose === false ? (
          <StatusDot status="urgent">
            Channex had stopped closing booked nights itself; the worker is turning it back on.
          </StatusDot>
        ) : (
          <StatusDot status="pending">
            Whether Channex closes booked nights itself hasn’t been checked yet; the worker looks daily.
          </StatusDot>
        )}
      </span>
    ) : state.status === 'connecting' ? (
      <span className="inline-flex items-center gap-2">
        <Spinner size={16} />
        <span>
          Connecting to Channex, asked for by {state.requestedBy ?? 'the team'}
          {state.attempts > 1 ? `; attempt ${state.attempts}` : ''}.
          {state.error ? ` Last try: ${state.error}` : ''}
        </span>
      </span>
    ) : state.status === 'failed' ? (
      <StatusDot status="urgent">
        Couldn’t connect to Channex after {state.attempts} {state.attempts === 1 ? 'try' : 'tries'}
        {state.error ? `: ${state.error}` : ''}
      </StatusDot>
    ) : (
      <StatusDot status="neutral">
        Not in Channex yet. Connecting makes it there; nothing is sent to any channel.
      </StatusDot>
    );

  const error = connect.error;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl bg-paper px-4 py-3.5 text-[14px]">
      <div className="min-w-0">
        {line}
        {error ? (
          <p role="alert" className="mt-1 text-[12.5px] text-urgent">
            {error instanceof ApiError ? error.message : 'That didn’t go through. Try again.'}
          </p>
        ) : null}
      </div>
      {canManage && (state.status === 'not_connected' || state.status === 'failed') ? (
        <Button variant="primary" disabled={connect.isPending} onClick={() => connect.mutate()}>
          {state.status === 'failed' ? 'Try again' : 'Connect to Channex'}
        </Button>
      ) : null}
    </div>
  );
}

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

export function ChannelsSection({
  d,
  orgId,
  canManage,
  refresh,
}: {
  d: PropertyDetail;
  orgId: string;
  /** The role can connect channels: admins. */
  canManage: boolean;
  /** Loads the property again, to see what the worker has done. */
  refresh(): void;
}) {
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
      <ChannelManager
        state={d.channex}
        orgId={orgId}
        propertyId={d.id}
        canManage={canManage}
        refresh={refresh}
      />
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
