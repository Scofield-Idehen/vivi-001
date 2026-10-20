import {
  IconArrowLeft,
  IconCalendarMonth,
  IconCopy,
  IconExternalLink,
  IconPencil,
} from '@tabler/icons-react';
import { can, formatMoney, nightsBetween, type Reservation } from '@v01/shared';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageLoading } from '../../components/Spinner.tsx';
import { Button, EmptyState, Notice } from '../../components/ui.tsx';
import { ApiError, useGuestLink, useReservation, useWorkspace } from '../../lib/api.ts';
import { config } from '../../lib/config.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { Facts, Missing } from '../properties/Section.tsx';
import { contactRoutes, dayLabel, partyLabel, stayTimes, whenLabel } from './model.ts';
import { ChannelName, MessageGuest, ReservationEditor, StatusLabel } from './parts.tsx';

function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-hairline py-8 first:border-t-0 first:pt-0">
      <h2 id={id} className="mb-4 font-serif text-[22px] leading-tight text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** "Wed 21 Oct 2026, from 13:00, agreed for this stay". */
function TimeLine({
  date,
  word,
  time,
  agreed,
}: {
  date: string;
  word: string;
  time: string;
  agreed: boolean;
}) {
  return (
    <>
      {dayLabel(date)}, {word} {time}
      {agreed ? <span className="text-slate">, agreed for this stay</span> : null}
    </>
  );
}

function Booked({ r, locale, timeZone }: { r: Reservation; locale: string; timeZone: string }) {
  const when = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(r.createdAt));
  const money = (minor: number) => formatMoney({ amountMinor: minor, currency: r.currency ?? 'GBP' }, locale);
  return (
    <div className="rounded-2xl bg-paper p-5">
      <p className="text-[13px] text-slate">Booked on</p>
      <p className="mt-1.5 text-[14.5px] text-ink">
        <ChannelName channel={r.channel} reference={r.channelReference} />
      </p>
      <dl className="mt-4 flex flex-col gap-2.5 border-t border-hairline pt-4 text-[13.5px]">
        <div className="flex justify-between gap-4">
          <dt className="text-slate">Booked</dt>
          <dd className="text-ink">{when}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate">Total</dt>
          <dd className="tnum text-ink">{r.totalMinor !== null ? money(r.totalMinor) : 'Not sent'}</dd>
        </div>
        {r.payoutMinor !== null ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate">Payout</dt>
            <dd className="tnum text-ink">{money(r.payoutMinor)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * One booking (design phase D1): the stay, the guest and the team's notes, with what the channel
 * sent beside them. Edit changes the guest's details, times agreed for this stay and the notes;
 * the dates, party and price change on the channel.
 */
/**
 * The guest's page for this stay: the private link the team sends. Copy it into a message on the
 * channel, or open it to see what the guest sees. Codes appear on it only from the day of arrival.
 */
function GuestPage({ orgId, reservationId }: { orgId: string; reservationId: string }) {
  const link = useGuestLink(orgId, reservationId, true);
  const [copied, setCopied] = useState(false);
  const href = link.data ? `${window.location.origin}${link.data.path}` : null;
  return (
    <section className="rounded-xl bg-paper px-4 py-3.5 text-[13.5px]">
      <p className="font-medium text-ink">The guest’s page</p>
      <p className="mt-1 leading-relaxed text-slate">
        Arrival time, address, check-in instructions, Wi-Fi and house rules, on a private link. The door code
        and Wi-Fi password appear on it from the day of arrival until the guest leaves.
      </p>
      {link.isPending ? null : link.error ? (
        <p className="mt-2 text-urgent">
          {link.error instanceof ApiError ? link.error.message : 'Couldn’t get the link.'}
        </p>
      ) : href ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="!h-9"
            onClick={() => {
              void navigator.clipboard?.writeText(href).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            <IconCopy size={15} stroke={1.75} aria-hidden />
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          {config.demo && link.data ? (
            <Link to={link.data.path} className="action">
              See what the guest sees
            </Link>
          ) : (
            <a href={href} target="_blank" rel="noreferrer" className="action">
              See what the guest sees
              <IconExternalLink size={14} stroke={1.75} aria-hidden />
            </a>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function ReservationPage() {
  const { id = '' } = useParams();
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const booking = useReservation(orgId, id);
  const canEdit = can(entry.role, 'reservations.write');
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const timeZone = workspace.data?.settings.timeZone ?? 'Europe/London';
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 4000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const back = (
    <Link to="/reservations" className="-ml-2.5 inline-flex items-center gap-1.5 text-[13px] action">
      <IconArrowLeft size={15} stroke={1.75} aria-hidden />
      Reservations
    </Link>
  );

  if (booking.isPending) return <PageLoading>Loading the booking</PageLoading>;
  if (booking.error || !booking.data) {
    const gone = booking.error instanceof ApiError && booking.error.status === 404;
    return (
      <EmptyState title={gone ? 'This booking isn’t here' : 'The booking could not be loaded'} action={back}>
        {gone
          ? `It may belong to another workspace than ${entry.organisationName}.`
          : 'Check your connection and try again.'}
      </EmptyState>
    );
  }

  const r = booking.data;
  const times = stayTimes(r);
  const nights = nightsBetween(r.checkIn, r.checkOut);

  return (
    <div>
      {back}
      <header className="mt-4 mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-hairline pb-6">
        <div className="min-w-0">
          <h1 className="font-serif text-[32px] leading-[1.1] font-light tracking-[-0.01em] text-ink md:text-[40px]">
            {r.guestName ?? 'Guest'}
          </h1>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-slate">
            <StatusLabel status={r.status} />
            <span>{whenLabel(r, r.today)}</span>
            <span>
              {r.propertyName}, {nights === 1 ? '1 night' : `${nights} nights`}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !editing ? (
            <Button onClick={() => setEditing(true)}>
              <IconPencil size={16} stroke={1.75} aria-hidden className="text-slate" />
              Edit
            </Button>
          ) : null}
          <MessageGuest reservation={r} routes={contactRoutes(r)} />
        </div>
      </header>

      <div className="mb-6 flex flex-col gap-3 empty:hidden">
        {r.status === 'conflict' ? (
          <Notice tone="urgent">
            This booking came in over another one, so it holds no nights. Sort it out with the guest and the
            channel, then cancel one of them there.
          </Notice>
        ) : null}
        {r.status === 'cancelled' && r.cancelledAt ? (
          <Notice tone="pending">
            Cancelled on{' '}
            {new Intl.DateTimeFormat(locale, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone,
            }).format(new Date(r.cancelledAt))}
            . The nights are free again.
          </Notice>
        ) : null}
        {saved ? <Notice tone="done">Saved.</Notice> : null}
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 max-w-[760px]">
          {editing ? (
            <ReservationEditor
              orgId={orgId}
              reservation={r}
              onCancel={() => setEditing(false)}
              onDone={(changed) => {
                setEditing(false);
                setSaved(changed);
              }}
            />
          ) : (
            <>
              <Part title="The stay">
                <Facts
                  items={[
                    {
                      label: 'Property',
                      value: (
                        <Link to={`/properties/${r.propertyId}`} className="-ml-2.5 action action-ink">
                          {r.propertyName}
                        </Link>
                      ),
                    },
                    {
                      label: 'Check-in',
                      value: (
                        <TimeLine
                          date={r.checkIn}
                          word="from"
                          time={times.checkIn}
                          agreed={times.checkInAgreed}
                        />
                      ),
                    },
                    {
                      label: 'Check-out',
                      value: (
                        <TimeLine
                          date={r.checkOut}
                          word="by"
                          time={times.checkOut}
                          agreed={times.checkOutAgreed}
                        />
                      ),
                    },
                    { label: 'Nights', value: nights },
                    { label: 'Guests', value: partyLabel(r) },
                  ]}
                />
              </Part>
              <Part title="Guest">
                <Facts
                  items={[
                    { label: 'Name', value: r.guestName ?? <Missing>Not given</Missing> },
                    {
                      label: 'Email',
                      value: r.guestEmail ? (
                        <a href={`mailto:${r.guestEmail}`} className="-ml-2.5 action action-ink">
                          {r.guestEmail}
                        </a>
                      ) : (
                        <Missing>Not given</Missing>
                      ),
                    },
                    {
                      label: 'Phone',
                      value: r.guestPhone ? (
                        <a
                          href={`tel:${r.guestPhone.replace(/[^\d+]/g, '')}`}
                          className="-ml-2.5 action action-ink tnum"
                        >
                          {r.guestPhone}
                        </a>
                      ) : (
                        <Missing>Not given</Missing>
                      ),
                    },
                  ]}
                />
              </Part>
              <Part title="Notes for the team">
                {r.notes ? (
                  <p className="max-w-[62ch] text-[14.5px] leading-relaxed whitespace-pre-line text-ink">
                    {r.notes}
                  </p>
                ) : (
                  <p className="text-[14px] text-mist">
                    No notes yet.
                    {canEdit ? ' Use Edit to add what the team should know about this stay.' : ''}
                  </p>
                )}
              </Part>
            </>
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-8 lg:self-start">
          <Booked r={r} locale={locale} timeZone={timeZone} />
          {canEdit && r.status === 'confirmed' ? <GuestPage orgId={orgId} reservationId={r.id} /> : null}
          <Link
            to={`/calendar?from=${r.checkIn}`}
            className="inline-flex items-center gap-2 px-1 text-[13.5px] action"
          >
            <IconCalendarMonth size={16} stroke={1.75} aria-hidden />
            See it on the Calendar
          </Link>
        </aside>
      </div>
    </div>
  );
}
