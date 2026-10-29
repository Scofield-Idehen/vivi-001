import { IconCopy, IconExternalLink } from '@tabler/icons-react';
import {
  CHANNEL_LABELS,
  type ChannelAccount,
  can,
  LINKABLE_CHANNELS,
  type LinkableChannel,
  type WorkspaceSync,
} from '@v01/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { SelectField, TextField } from '../components/fields.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { Button, Notice, PageHeader, SectionHeading, StatusDot } from '../components/ui.tsx';
import {
  ApiError,
  useAccountListings,
  useAddChannelAccount,
  useChannelAccounts,
  useConnectChannelAccount,
  useWorkspaceSync,
} from '../lib/api.ts';
import { dateTime, relativeTime, useNow, V01 } from '../lib/format.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';
import { ChannelMark } from './calendar/marks.tsx';

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

/** The authorisation link for Airbnb and Vrbo: shown once, with a copy button for the account's owner. */
function ConnectLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-linen px-3.5 py-2.5 text-[13.5px]">
      <span className="text-slate">
        Whoever signs in to this account opens this link and approves Channex:
      </span>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 action">
        Open the link <IconExternalLink size={14} stroke={1.75} aria-hidden />
      </a>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true));
        }}
        className="inline-flex items-center gap-1 text-[13px] action"
      >
        <IconCopy size={14} stroke={1.75} aria-hidden />
        {copied ? 'Copied' : 'Copy it to send'}
      </button>
    </div>
  );
}

/** One account: its state, what Channex sees on it, and the way to connect it. */
function Account({ a, orgId, canManage }: { a: ChannelAccount; orgId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [hotelId, setHotelId] = useState('');
  const connect = useConnectChannelAccount(orgId);
  const listings = useAccountListings(orgId, open ? a.id : null);
  const now = useNow();
  const needsHotel = a.channel === 'booking_com' && !a.connection?.externalAccountId;

  const state =
    a.status === 'connected' ? (
      <StatusDot status="done">
        Connected
        {a.connection?.lastCheckedAt ? `, checked ${relativeTime(a.connection.lastCheckedAt, now)}` : ''}.{' '}
        {a.listingsLinked} of {a.listingsSeen} {a.listingsSeen === 1 ? 'listing' : 'listings'} linked.
      </StatusDot>
    ) : a.status === 'pending' ? (
      <span className="inline-flex items-center gap-2 text-[14px] text-slate">
        <Spinner size={14} />
        {a.connection?.channexChannelId
          ? a.channel === 'booking_com'
            ? 'Made in Channex; waiting for Booking.com to approve the connection.'
            : "Made in Channex; waiting for the account's owner to approve it."
          : 'Asked for; the worker is making the connection in Channex.'}
      </span>
    ) : a.status === 'error' ? (
      <StatusDot status="urgent">
        Couldn’t connect{a.connection?.lastError ? `: ${a.connection.lastError}` : ''}
      </StatusDot>
    ) : (
      <StatusDot status="neutral">Not connected. {V01} can’t reach this account’s listings yet.</StatusDot>
    );

  return (
    <li className="rounded-2xl border border-hairline bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelMark channel={a.channel} size={30} />
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink">{a.label}</p>
            <p className="text-[12.5px] text-mist">
              {CHANNEL_LABELS[a.channel]}
              {a.connection?.externalAccountId ? (
                <>
                  {' '}
                  · <span className="tnum">{a.connection.externalAccountId}</span>
                </>
              ) : null}
              {a.loginHolder ? ` · signs in: ${a.loginHolder}` : ''}
              {a.twoFactorHolder ? ` · code: ${a.twoFactorHolder}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {a.status === 'connected' ? (
            <Button onClick={() => setOpen((o) => !o)}>{open ? 'Hide listings' : 'Listings'}</Button>
          ) : null}
          {canManage && (a.status === 'disconnected' || a.status === 'error') && !needsHotel ? (
            <Button
              variant="primary"
              disabled={connect.isPending}
              onClick={() => connect.mutate({ id: a.id })}
            >
              {a.status === 'error' ? 'Try again' : 'Connect'}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 text-[14px]">{state}</div>
      {canManage && (a.status === 'disconnected' || a.status === 'error') && needsHotel ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (hotelId.trim()) connect.mutate({ id: a.id, hotelId: hotelId.trim() });
          }}
        >
          <div className="w-[220px]">
            <TextField
              label="Booking.com hotel id"
              value={hotelId}
              onChange={setHotelId}
              hint="In the extranet, top left, beside the property name."
            />
          </div>
          <Button variant="primary" type="submit" disabled={connect.isPending || !hotelId.trim()}>
            Connect
          </Button>
        </form>
      ) : null}
      {a.status === 'pending' && a.connection?.connectUrl ? (
        <ConnectLink url={a.connection.connectUrl} />
      ) : null}
      {connect.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(connect.error)}</Notice>
        </div>
      ) : null}
      {open ? (
        <div className="mt-4 border-t border-hairline pt-4">
          {listings.isPending ? (
            <span className="inline-flex items-center gap-2 text-[13.5px] text-slate">
              <Spinner size={14} /> Looking up the listings
            </span>
          ) : listings.error ? (
            <Notice tone="urgent">{explain(listings.error)}</Notice>
          ) : listings.data?.listings.length === 0 ? (
            <p className="text-[13.5px] text-slate">
              Channex sees no listings on this account yet. The list refreshes hourly.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {listings.data?.listings.map((l) => (
                <li
                  key={l.externalListingId}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-ink">
                      {l.title ?? `Listing ${l.externalListingId}`}
                    </p>
                    <p className="text-[12px] text-mist tnum">{l.externalListingId}</p>
                  </div>
                  {l.linkedPropertyId ? (
                    <Link to={`/properties/${l.linkedPropertyId}`} className="text-[13.5px] action">
                      {l.linkedPropertyName}
                    </Link>
                  ) : (
                    <span className="text-[13px] text-mist">Not linked to a property</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

function AddAccount({ orgId, onDone }: { orgId: string; onDone(): void }) {
  const add = useAddChannelAccount(orgId);
  const [channel, setChannel] = useState<LinkableChannel>('airbnb');
  const [label, setLabel] = useState('');
  const [loginHolder, setLoginHolder] = useState('');
  const [twoFactorHolder, setTwoFactorHolder] = useState('');
  return (
    <form
      className="rounded-2xl border border-hairline p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return;
        add.mutate(
          {
            channel,
            label: label.trim(),
            loginHolder: loginHolder.trim() || undefined,
            twoFactorHolder: twoFactorHolder.trim() || undefined,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <p className="text-[14.5px] font-medium text-ink">Add an account</p>
      <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-slate">
        One for each sign-in you have on a channel: Airbnb A and B, Booking.com A and B, Vrbo. Connecting it
        comes next, and sends nothing to the channel.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <SelectField<LinkableChannel>
          label="Channel"
          value={channel}
          onChange={setChannel}
          options={LINKABLE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }))}
        />
        <TextField label="Name" value={label} onChange={setLabel} max={60} placeholder="Airbnb A" />
        <TextField
          label="Who signs in"
          value={loginHolder}
          onChange={setLoginHolder}
          placeholder="Optional"
        />
        <TextField
          label="Who holds the 2-step code"
          value={twoFactorHolder}
          onChange={setTwoFactorHolder}
          placeholder="Optional"
        />
      </div>
      {add.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(add.error)}</Notice>
        </div>
      ) : null}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" type="submit" disabled={add.isPending || !label.trim()}>
          Add account
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Channels & sync: the workspace's channel accounts, what Channex sees on each, and what is waiting
 * to go out or came in. Linking a listing to a property happens on the property's page.
 */
export function ChannelsPage() {
  const { orgId, entry } = useCurrentWorkspace();
  const canManage = can(entry.role, 'channels.manage');
  const accounts = useChannelAccounts(orgId);
  const sync = useWorkspaceSync(orgId);
  const now = useNow();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Channels & sync"
        description={`Your Airbnb, Booking.com and Vrbo accounts, what ${V01} sees on each, and what is moving between you and the channels.`}
        action={
          canManage && !adding ? <Button onClick={() => setAdding(true)}>Add an account</Button> : undefined
        }
      />

      <section aria-labelledby="accounts" className="mb-10">
        <SectionHeading id="accounts">Accounts</SectionHeading>
        {adding ? (
          <div className="mb-4">
            <AddAccount orgId={orgId} onDone={() => setAdding(false)} />
          </div>
        ) : null}
        {accounts.isPending ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-slate">
            <Spinner size={16} /> Loading accounts
          </span>
        ) : accounts.error ? (
          <Notice tone="urgent">{explain(accounts.error)}</Notice>
        ) : accounts.data.accounts.length === 0 ? (
          <p className="max-w-[62ch] text-[14px] leading-relaxed text-slate">
            No accounts yet.{' '}
            {canManage
              ? 'Add one for each sign-in you have on a channel, then connect it; linking listings happens on each property’s page.'
              : 'An admin adds them.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {accounts.data.accounts.map((a) => (
              <Account key={a.id} a={a} orgId={orgId} canManage={canManage} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sync">
        <SectionHeading id="sync">Sync</SectionHeading>
        {sync.isPending ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-slate">
            <Spinner size={16} /> Loading
          </span>
        ) : sync.error ? (
          <Notice tone="urgent">{explain(sync.error)}</Notice>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-paper px-4 py-3.5">
                <p className="text-[12.5px] text-slate">Waiting to go out</p>
                <p className="mt-1 font-semibold tracking-[-0.015em] text-[20px] leading-none text-ink tnum">
                  {sync.data.outboxWaiting}
                </p>
                <p className="mt-1.5 text-[12.5px] text-mist">
                  {sync.data.oldestWaitingAt
                    ? `oldest ${relativeTime(sync.data.oldestWaitingAt, now)}`
                    : 'nothing waiting'}
                </p>
              </div>
              <div className="rounded-2xl bg-paper px-4 py-3.5">
                <p className="text-[12.5px] text-slate">Failed to send</p>
                <p
                  className={`mt-1 font-semibold tracking-[-0.015em] text-[20px] leading-none tnum ${sync.data.outboxFailed ? 'text-urgent' : 'text-ink'}`}
                >
                  {sync.data.outboxFailed}
                </p>
                <p className="mt-1.5 text-[12.5px] text-mist">
                  {sync.data.lastSentAt
                    ? `last sent ${relativeTime(sync.data.lastSentAt, now)}`
                    : 'nothing sent yet'}
                </p>
              </div>
              <div className="rounded-2xl bg-paper px-4 py-3.5">
                <p className="text-[12.5px] text-slate">Last booking in</p>
                <p className="mt-1 font-semibold tracking-[-0.015em] text-[20px] leading-none text-ink">
                  {sync.data.lastBookingAt ? relativeTime(sync.data.lastBookingAt, now) : '—'}
                </p>
                <p className="mt-1.5 text-[12.5px] text-mist">from any channel</p>
              </div>
              <CrossCheckTile check={sync.data.crossCheck} now={now} />
            </div>
            {sync.data.recent.length ? (
              <ul className="mt-6 divide-y divide-hairline border-y border-hairline text-[13.5px]">
                {sync.data.recent.map((r) => (
                  <li key={r.id} className="grid gap-x-6 gap-y-0.5 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)]">
                    <span className="text-mist">{dateTime(r.at)}</span>
                    <span className="min-w-0">
                      <StatusDot
                        status={
                          r.status === 'error'
                            ? 'urgent'
                            : r.status === 'fixed' || r.status === 'differences'
                              ? 'pending'
                              : 'done'
                        }
                      >
                        <span className="text-ink">{WHAT[r.kind] ?? r.kind}</span>
                        {r.propertyName ? <span className="text-slate"> · {r.propertyName}</span> : null}
                        {r.message ? <span className="text-slate"> · {r.message}</span> : null}
                      </StatusDot>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-[14px] text-slate">Nothing has moved yet.</p>
            )}
          </>
        )}
      </section>
    </>
  );
}

/**
 * The nightly cross-check: every property V-01 runs, compared with what Channex holds for the next
 * 90 nights. All matching is the quiet, expected state; a difference was sent again and is worth a look.
 */
function CrossCheckTile({ check, now }: { check: WorkspaceSync['crossCheck']; now: number }) {
  const checked = check.properties - check.unchecked;
  const trouble = check.differing + check.failed;
  return (
    <div className="rounded-2xl bg-paper px-4 py-3.5">
      <p className="text-[12.5px] text-slate">Checked against Channex</p>
      <p
        className={`mt-1 font-semibold tracking-[-0.015em] text-[20px] leading-none tnum ${trouble ? 'text-urgent' : 'text-ink'}`}
      >
        {check.properties === 0 ? '—' : trouble ? trouble : `${check.matching} of ${check.properties}`}
      </p>
      <p className="mt-1.5 text-[12.5px] text-mist">
        {check.properties === 0
          ? 'no property is live yet'
          : checked === 0
            ? 'not checked yet; the worker checks nightly'
            : trouble
              ? `${check.differing ? `${check.differing} differed and ${check.differing === 1 ? 'was' : 'were'} sent again` : ''}${check.differing && check.failed ? ', ' : ''}${check.failed ? `${check.failed} couldn’t be checked` : ''}`
              : `all match · ${check.lastCheckedAt ? relativeTime(check.lastCheckedAt, now) : ''}`}
      </p>
    </div>
  );
}

const WHAT: Record<string, string> = {
  availability: 'Availability sent',
  restrictions: 'Prices and stay rules sent',
  setup: 'Property connected to Channex',
  channel: 'Channel account',
  link: 'Listing link',
  safety: 'Safety check',
  cross_check: 'Checked against Channex',
  booking: 'Booking in',
};
