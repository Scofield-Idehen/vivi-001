import { IconMail, IconMessage, IconMessageCircle, IconPhone } from '@tabler/icons-react';
import {
  CHANNEL_LABELS,
  type Channel,
  NOTES_MAX,
  RESERVATION_STATUS_LABELS,
  type Reservation,
  type ReservationStatus,
} from '@v01/shared';
import { type FormEvent, useState } from 'react';
import { TextArea, TextField } from '../../components/fields.tsx';
import { Popover } from '../../components/Popover.tsx';
import { Button, Field, Notice, StatusDot } from '../../components/ui.tsx';
import { ApiError, useUpdateReservation } from '../../lib/api.ts';
import { ChannelMark } from '../calendar/marks.tsx';
import {
  type ContactRoute,
  channelMessages,
  formFrom,
  type ReservationForm,
  type ReservationFormErrors,
  STATUS_TONES,
  toUpdate,
} from './model.ts';

/** A channel's mark, as on the calendar's bars, and its name in words. */
export function ChannelName({ channel, reference }: { channel: Channel; reference?: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-full bg-accent">
        <ChannelMark channel={channel} size={18} />
      </span>
      <span>{CHANNEL_LABELS[channel]}</span>
      {reference ? <span className="font-mono text-[12.5px] text-slate">{reference}</span> : null}
    </span>
  );
}

export function StatusLabel({ status }: { status: ReservationStatus }) {
  return <StatusDot status={STATUS_TONES[status]}>{RESERVATION_STATUS_LABELS[status]}</StatusDot>;
}

const ROUTE_ICONS: Record<ContactRoute['kind'], typeof IconMail> = {
  email: IconMail,
  call: IconPhone,
  text: IconMessageCircle,
};

/** The ways to reach the guest now: an email, a call or a text, and where channel messages are. */
export function MessageGuest({ reservation, routes }: { reservation: Reservation; routes: ContactRoute[] }) {
  const first = reservation.guestName?.trim().split(/\s+/)[0] ?? 'the guest';
  const note = channelMessages(reservation.channel);
  return (
    <Popover
      title="Message the guest"
      label="Message guest"
      icon={<IconMessage size={16} stroke={1.75} aria-hidden className="shrink-0 text-slate" />}
      panelClassName="w-[300px] p-2"
    >
      {routes.length ? (
        <ul className="flex flex-col">
          {routes.map((route) => {
            const Icon = ROUTE_ICONS[route.kind];
            return (
              <li key={route.kind}>
                <a
                  href={route.href}
                  className="flex items-center gap-3 rounded-md px-2.5 py-2 text-[13.5px] text-ink transition-colors hover:bg-linen"
                >
                  <Icon size={17} stroke={1.75} aria-hidden className="shrink-0 text-slate" />
                  <span className="min-w-0">
                    <span className="block font-medium">{route.label}</span>
                    <span className="block truncate text-[12.5px] text-slate">{route.detail}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-2.5 py-2 text-[13px] leading-relaxed text-slate">
          There’s no email or phone number for {first} yet. Add them with Edit.
        </p>
      )}
      {note ? (
        <p className="mt-1 border-t border-hairline px-2.5 pt-2.5 pb-1.5 text-[12.5px] leading-snug text-mist">
          {note}
        </p>
      ) : null}
    </Popover>
  );
}

/**
 * Changes what the team may change on a booking: the guest's details, times agreed for this stay,
 * and notes. The dates, party and price stay as the channel sent them.
 */
export function ReservationEditor({
  orgId,
  reservation,
  onDone,
  onCancel,
}: {
  orgId: string;
  reservation: Reservation;
  /** Saved, or nothing to save. */
  onDone(saved: boolean): void;
  onCancel(): void;
}) {
  const [form, setForm] = useState<ReservationForm>(() => formFrom(reservation));
  const [errors, setErrors] = useState<ReservationFormErrors>({});
  const save = useUpdateReservation(orgId, reservation.id);
  const set = (patch: Partial<ReservationForm>) => setForm((current) => ({ ...current, ...patch }));
  const fromChannel = reservation.channel !== 'direct';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { update, errors: found } = toUpdate(form, reservation);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!update) {
      onDone(false);
      return;
    }
    save.mutate(update, { onSuccess: () => onDone(true) });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-[14px] font-medium text-ink">Guest</legend>
        <TextField
          label="Name"
          value={form.guestName}
          onChange={(guestName) => set({ guestName })}
          error={errors.guestName}
          autoComplete="off"
        />
        <Field
          label="Email"
          type="email"
          inputMode="email"
          value={form.guestEmail}
          onChange={(e) => set({ guestEmail: e.target.value })}
          error={errors.guestEmail}
          autoComplete="off"
        />
        <Field
          label="Phone"
          type="tel"
          inputMode="tel"
          value={form.guestPhone}
          onChange={(e) => set({ guestPhone: e.target.value })}
          error={errors.guestPhone}
          placeholder="+44 7700 900123"
          autoComplete="off"
        />
        {fromChannel ? (
          <p className="text-[12.5px] leading-snug text-mist">
            When {CHANNEL_LABELS[reservation.channel]} sends new details for this guest, they replace these.
            Anything it doesn’t send stays as you set it.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-[14px] font-medium text-ink">Times for this stay</legend>
        <p className="text-[12.5px] leading-snug text-mist">
          For an early arrival or a late departure you’ve agreed. Leave a time empty for the property’s usual
          one.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Check-in from"
            type="time"
            value={form.checkInTime}
            onChange={(e) => set({ checkInTime: e.target.value })}
            error={errors.checkInTime}
            hint={`Usually ${reservation.propertyCheckInTime}`}
          />
          <Field
            label="Check-out by"
            type="time"
            value={form.checkOutTime}
            onChange={(e) => set({ checkOutTime: e.target.value })}
            error={errors.checkOutTime}
            hint={`Usually ${reservation.propertyCheckOutTime}`}
          />
        </div>
      </fieldset>

      <TextArea
        label="Notes for the team"
        value={form.notes}
        onChange={(notes) => set({ notes })}
        max={NOTES_MAX}
        rows={4}
        hint="Only your team sees these. Guests and channels never do."
      />
      {errors.notes ? <p className="-mt-3 text-[12.5px] text-urgent">{errors.notes}</p> : null}

      {save.error ? (
        <Notice tone="urgent">
          {save.error instanceof ApiError ? save.error.message : 'The booking was not saved. Try again.'}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving' : 'Save'}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
