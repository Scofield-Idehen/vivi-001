import {
  IconArrowLeft,
  IconCalendarMonth,
  IconCopy,
  IconExternalLink,
  IconPencil,
} from '@tabler/icons-react';
import { CANCELLATION_REASON_MAX, can, nightsBetween, type Reservation } from '@v01/shared';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { TextArea } from '../../components/fields.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { PageLoading } from '../../components/Spinner.tsx';
import { Button, EmptyState, Notice, StatusDot } from '../../components/ui.tsx';
import {
  ApiError,
  useCancelReservation,
  useDoorCodes,
  useGuestLink,
  useReservation,
  useWorkspace,
} from '../../lib/api.ts';
import { config } from '../../lib/config.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { Facts, Missing } from '../properties/Section.tsx';
import { ClaimButton } from './ClaimButton.tsx';
import { Money } from './Money.tsx';
import { contactRoutes, dayLabel, partyLabel, stayTimes, whenLabel } from './model.ts';
import { MessageGuest, ReservationEditor, StatusLabel } from './parts.tsx';

function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-hairline py-8 first:border-t-0 first:pt-0">
      <h2 id={id} className="mb-4 font-semibold tracking-[-0.015em] text-[18px] leading-tight text-ink">
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

/**
 * The stay's door code from the smart locks: the digits once a lock holds them (for people who may
 * read codes), which locks, and from when to when. Nothing shows when no lock makes codes here.
 */
function DoorCodes({
  orgId,
  reservationId,
  timeZone,
}: {
  orgId: string;
  reservationId: string;
  timeZone: string;
}) {
  const codes = useDoorCodes(orgId, reservationId);
  const list = codes.data?.codes ?? [];
  if (list.length === 0) return null;
  const digits = list.find((c) => c.code)?.code ?? null;
  const when = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(iso));
  const first = list[0];
  const failed = list.filter((c) => c.status === 'failed');
  const waiting = list.filter((c) => c.status === 'pending');
  return (
    <section className="rounded-xl bg-paper px-4 py-3.5 text-[13.5px]">
      <p className="font-medium text-ink">Door code</p>
      {digits ? (
        <p className="mt-1 font-semibold tracking-[-0.015em] text-[26px] leading-none tracking-[0.08em] text-ink tnum">
          {digits}
        </p>
      ) : (
        <p className="mt-1 text-slate">
          {list.some((c) => c.status === 'set')
            ? 'On the locks. Only some roles see the digits.'
            : 'Not on the locks yet.'}
        </p>
      )}
      {first ? (
        <p className="mt-1 text-slate">
          {when(first.startsAt)} to {when(first.endsAt)}
        </p>
      ) : null}
      <ul className="mt-2 flex flex-col gap-1">
        {list.map((c) => (
          <li key={c.lockName}>
            <StatusDot status={c.status === 'set' ? 'done' : c.status === 'failed' ? 'urgent' : 'pending'}>
              {c.lockName}
              <span className="text-slate">
                {c.status === 'set'
                  ? ' · on the lock'
                  : c.status === 'failed'
                    ? ` · not sent: ${c.error ?? 'refused'}`
                    : ' · on its way'}
              </span>
            </StatusDot>
          </li>
        ))}
      </ul>
      {failed.length || waiting.length ? (
        <p className="mt-2 text-[12.5px] text-mist">Tried again every few minutes while the worker runs.</p>
      ) : null}
    </section>
  );
}

/** Cancelling a booking made here: a reason, then the nights are free. */
function CancelSheet({ orgId, r, onClose }: { orgId: string; r: Reservation; onClose(): void }) {
  const cancel = useCancelReservation(orgId, r.id);
  const [reason, setReason] = useState('');
  const ready = reason.trim().length > 0 && !cancel.isPending;
  return (
    <Sheet
      title="Cancel this booking"
      subtitle={`${r.guestName ?? 'The guest'}, ${dayLabel(r.checkIn)} to ${dayLabel(r.checkOut)}. The nights are free again the moment it is cancelled.`}
      onClose={onClose}
      busy={cancel.isPending}
      footer={
        <>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => cancel.mutate({ reason: reason.trim() }, { onSuccess: onClose })}
          >
            Cancel the booking
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Keep it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextArea
          label="Why"
          value={reason}
          onChange={setReason}
          max={CANCELLATION_REASON_MAX}
          rows={3}
          placeholder="The guest’s plans changed; rebooking in March."
        />
        {cancel.error ? (
          <Notice tone="urgent">
            {cancel.error instanceof ApiError ? cancel.error.message : 'That didn’t go through.'}
          </Notice>
        ) : null}
      </div>
    </Sheet>
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
  const [cancelling, setCancelling] = useState(false);
  const canMoney = can(entry.role, 'money.write');

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
          <h1 className="font-semibold tracking-[-0.015em] text-[26px] leading-[1.1] font-light text-ink md:text-[40px]">
            {r.guestName ?? 'Guest'}
          </h1>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-slate">
            <StatusLabel status={r.status} />
            {r.status === 'cancelled' ? null : <span>{whenLabel(r, r.today)}</span>}
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
          {r.status === 'confirmed' && r.checkIn <= r.today ? <ClaimButton reservationId={r.id} /> : null}
          {canEdit && r.channel === 'direct' && r.status !== 'cancelled' && !editing ? (
            <Button variant="quiet" className="action-urgent" onClick={() => setCancelling(true)}>
              Cancel booking
            </Button>
          ) : null}
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
            {r.cancelledBy ? ` by ${r.cancelledBy}` : ''}. The nights are free again.
            {r.cancellationReason ? <span className="block text-slate">{r.cancellationReason}</span> : null}
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
          <Money orgId={orgId} r={r} locale={locale} timeZone={timeZone} canWrite={canMoney} />
          {r.status === 'confirmed' ? (
            <DoorCodes orgId={orgId} reservationId={r.id} timeZone={timeZone} />
          ) : null}
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
      {cancelling ? <CancelSheet orgId={orgId} r={r} onClose={() => setCancelling(false)} /> : null}
    </div>
  );
}
