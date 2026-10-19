import { IconExternalLink } from '@tabler/icons-react';
import {
  CHANNEL_LABELS,
  type ChannelAccount,
  LINKABLE_CHANNELS,
  type LinkableChannel,
  type PropertyDetail,
  type PropertyLink,
} from '@v01/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, Notice, StatusDot } from '../../components/ui.tsx';
import {
  ApiError,
  useAccountListings,
  useChannelAccounts,
  useLinkListing,
  usePauseListing,
  useUnlinkListing,
} from '../../lib/api.ts';
import { shortDate, V01 } from '../../lib/format.ts';
import { ChannelMark } from '../calendar/marks.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

/** Choosing a listing from a connected account, for one channel. */
function LinkPicker({
  channel,
  accounts,
  orgId,
  propertyId,
  onDone,
}: {
  channel: LinkableChannel;
  accounts: ChannelAccount[];
  orgId: string;
  propertyId: string;
  onDone(): void;
}) {
  const connected = accounts.filter((a) => a.channel === channel && a.status === 'connected');
  const [accountId, setAccountId] = useState<string | null>(connected[0]?.id ?? null);
  const listings = useAccountListings(orgId, accountId);
  const link = useLinkListing(orgId, propertyId);
  const free = (listings.data?.listings ?? []).filter((l) => !l.linkedPropertyId);

  if (connected.length === 0) {
    const any = accounts.some((a) => a.channel === channel);
    return (
      <p className="text-[13.5px] leading-relaxed text-slate">
        {any
          ? `The ${CHANNEL_LABELS[channel]} account isn't connected yet. `
          : `There is no ${CHANNEL_LABELS[channel]} account in this workspace yet. `}
        <Link to="/channels" className="action">
          Channels &amp; sync
        </Link>{' '}
        is where accounts are added and connected.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {connected.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {connected.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAccountId(a.id)}
              aria-pressed={a.id === accountId}
              className={cx(
                'h-8 rounded-full border px-3 text-[13px]',
                a.id === accountId
                  ? 'border-ink bg-ink text-canvas'
                  : 'border-hairline text-ink hover:bg-linen',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {listings.isPending ? (
        <span className="inline-flex items-center gap-2 text-[13.5px] text-slate">
          <Spinner size={14} /> Looking up the listings
        </span>
      ) : free.length === 0 ? (
        <p className="text-[13.5px] text-slate">
          Every listing Channex sees on this account is linked already, or it has none yet. The list refreshes
          hourly.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline rounded-xl border border-hairline">
          {free.map((l) => (
            <li key={l.externalListingId} className="flex items-center justify-between gap-4 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-ink">{l.title ?? `Listing ${l.externalListingId}`}</p>
                <p className="text-[12px] text-mist tnum">{l.externalListingId}</p>
              </div>
              <Button
                variant="primary"
                disabled={link.isPending}
                className="!h-8"
                onClick={() =>
                  accountId &&
                  link.mutate(
                    { channelAccountId: accountId, externalListingId: l.externalListingId },
                    { onSuccess: onDone },
                  )
                }
              >
                Link
              </Button>
            </li>
          ))}
        </ul>
      )}
      {link.error ? <Notice tone="urgent">{explain(link.error)}</Notice> : null}
      <div>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One channel's card: the listing it is linked to, or the way to link one. */
function ChannelCard({
  channel,
  link,
  accounts,
  d,
  orgId,
  canEdit,
}: {
  channel: LinkableChannel;
  link: PropertyLink | undefined;
  accounts: ChannelAccount[];
  d: PropertyDetail;
  orgId: string;
  canEdit: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState(false);
  const unlink = useUnlinkListing(orgId, d.id);
  const pause = usePauseListing(orgId, d.id);
  const label = CHANNEL_LABELS[channel];
  const inChannex = d.channex.status === 'connected';

  let body: React.ReactNode;
  if (link) {
    const name = link.title ?? `Listing ${link.externalListingId}`;
    body = (
      <>
        <p className="truncate text-[14.5px] text-ink" title={name}>
          {name}
        </p>
        <p className="mt-0.5 text-[12.5px] text-mist">
          {link.account} · <span className="tnum">{link.externalListingId}</span>
        </p>
        <div className="mt-3">
          {link.status === 'live' && link.channel === 'airbnb' && !link.publishedWanted ? (
            link.published === false ? (
              <StatusDot status="pending">Paused: taken off Airbnb, not taking bookings.</StatusDot>
            ) : (
              <span className="inline-flex items-center gap-2 text-[13.5px] text-slate">
                <Spinner size={14} /> Taking it off Airbnb
              </span>
            )
          ) : link.status === 'live' && link.channel === 'airbnb' && link.published === false ? (
            <span className="inline-flex items-center gap-2 text-[13.5px] text-slate">
              <Spinner size={14} /> Putting it back on Airbnb
            </span>
          ) : link.status === 'live' ? (
            <StatusDot status="done">
              Taking bookings through {V01}
              {link.liveFrom ? ` since ${shortDate(`${link.liveFrom}T12:00:00`)}` : ''}
            </StatusDot>
          ) : link.status === 'linking' ? (
            <span className="inline-flex items-center gap-2 text-[13.5px] text-slate">
              <Spinner size={14} /> Linking in Channex
              {link.requestedBy ? `, asked for by ${link.requestedBy}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-[13.5px] text-slate">
              <Spinner size={14} /> Unlinking
            </span>
          )}
          {link.lastError ? (
            <p role="alert" className="mt-1.5 text-[12.5px] text-urgent">
              {link.lastError}
            </p>
          ) : null}
          {link.channel === 'airbnb' && link.status === 'live' ? (
            <p className={cx('mt-1.5 text-[12.5px]', link.settingsError ? 'text-urgent' : 'text-mist')}>
              {link.settingsError
                ? `Fees and booking rules: ${link.settingsError}`
                : link.settingsSyncedAt
                  ? `Fees and booking rules sent ${shortDate(link.settingsSyncedAt)}.`
                  : 'Fees and booking rules go to Airbnb next.'}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {link.url ? (
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-canvas px-3 text-[13px] text-ink hover:bg-linen"
            >
              Open on {label}
              <IconExternalLink size={14} stroke={1.75} aria-hidden />
            </a>
          ) : null}
          {canEdit && link.status === 'live' && link.channel === 'airbnb' && !asking ? (
            <Button
              variant="quiet"
              disabled={pause.isPending || link.published !== link.publishedWanted}
              onClick={() =>
                pause.mutate({ linkId: link.id, action: link.publishedWanted ? 'pause' : 'resume' })
              }
            >
              {link.publishedWanted ? 'Pause on Airbnb' : 'Resume on Airbnb'}
            </Button>
          ) : null}
          {canEdit && link.status !== 'closing' ? (
            asking ? (
              <>
                <Button
                  variant="primary"
                  className="!h-8"
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(link.id, { onSuccess: () => setAsking(false) })}
                >
                  Unlink from {label}
                </Button>
                <Button variant="quiet" onClick={() => setAsking(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="quiet" onClick={() => setAsking(true)}>
                Unlink
              </Button>
            )
          ) : null}
        </div>
        {unlink.error || pause.error ? (
          <div className="mt-2">
            <Notice tone="urgent">{explain(unlink.error ?? pause.error)}</Notice>
          </div>
        ) : null}
      </>
    );
  } else if (picking) {
    body = (
      <LinkPicker
        channel={channel}
        accounts={accounts}
        orgId={orgId}
        propertyId={d.id}
        onDone={() => setPicking(false)}
      />
    );
  } else {
    body = (
      <>
        <p className="text-[13.5px] leading-relaxed text-slate">
          {d.managedBy === 'guesty'
            ? `Guesty runs the ${label} listing until the move-over.`
            : `Not linked. ${V01} sends nothing to ${label} for this property.`}
        </p>
        {canEdit && d.managedBy !== 'guesty' ? (
          <div className="mt-4">
            <Button
              onClick={() => setPicking(true)}
              disabled={!inChannex}
              title={inChannex ? undefined : 'Connect the property to Channex first.'}
            >
              Link a listing
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <li className="flex min-h-[172px] flex-col rounded-2xl border border-hairline bg-canvas p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <ChannelMark channel={channel} size={26} />
        <span className="text-[14px] font-medium text-ink">{label}</span>
        {link?.status === 'live' ? <span className="sr-only">, linked</span> : null}
      </div>
      <div className="min-w-0 flex-1">{body}</div>
    </li>
  );
}

/**
 * List on channels, V-01's way: a card per channel. A linked card names the listing, opens it on
 * the channel's site and can be unlinked; an unlinked one links a listing from a connected account.
 * Pausing a listing on the channel waits for Channex's answer (decisions, 19 Oct 2026).
 */
export function ChannelCards({
  d,
  orgId,
  canEdit,
  refresh,
}: {
  d: PropertyDetail;
  orgId: string;
  canEdit: boolean;
  refresh(): void;
}) {
  const accounts = useChannelAccounts(orgId);
  const busy = d.links.some(
    (l) =>
      l.status === 'linking' ||
      l.status === 'closing' ||
      (l.status === 'live' && l.published !== null && l.published !== l.publishedWanted),
  );
  // The worker is on it: look again every few seconds until it is done.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  return (
    <ul className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {LINKABLE_CHANNELS.map((channel) => (
        <ChannelCard
          key={channel}
          channel={channel}
          link={d.links.find((l) => l.channel === channel && l.status !== 'archived')}
          accounts={accounts.data?.accounts ?? []}
          d={d}
          orgId={orgId}
          canEdit={canEdit}
        />
      ))}
    </ul>
  );
}
