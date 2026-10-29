import { addDays, formatMoney, nightsBetween, parseMajorToMinor } from '@v01/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DateField } from '../../components/DateField.tsx';
import { SelectField, TextArea, TextField } from '../../components/fields.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useCreateReservation, useProperties, useWorkspace } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A booking made by the team: a direct or repeat guest, a stay that came by phone. It holds the
 * nights like any other booking; the price is for the record, nothing is charged yet. The nights
 * are refused if a booking or block already holds them.
 */
export function NewBookingSheet({
  today,
  onClose,
  propertyId: startProperty,
}: {
  today: string;
  onClose(): void;
  /** Opened from a home's page: that home, already chosen. */
  propertyId?: string;
}) {
  const { orgId } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const properties = useProperties(orgId);
  const create = useCreateReservation(orgId);
  const navigate = useNavigate();
  const currency = workspace.data?.settings.currency ?? 'GBP';

  const [propertyId, setPropertyId] = useState(startProperty ?? '');
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(addDays(today, 2));
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [total, setTotal] = useState('');
  const [checkInTime, setCheckInTime] = useState('');
  const [notes, setNotes] = useState('');

  const list = properties.data?.properties ?? [];
  const chosen = propertyId || list[0]?.id || '';
  const datesOk = DAY.test(checkIn) && DAY.test(checkOut) && checkOut > checkIn;
  let totalMinor: number | undefined;
  let totalError: string | undefined;
  if (total.trim()) {
    try {
      totalMinor = parseMajorToMinor(total.trim().replace(/[^\d.]/g, ''), currency);
    } catch {
      totalError = 'A price like 450 or 450.00.';
    }
  }
  const ready =
    Boolean(chosen) &&
    datesOk &&
    guestName.trim().length > 0 &&
    !totalError &&
    (checkInTime === '' || CLOCK.test(checkInTime));
  const nights = datesOk ? nightsBetween(checkIn, checkOut) : 0;

  return (
    <Sheet
      title="New booking"
      subtitle="A direct or repeat guest. It holds the nights like any other booking."
      onClose={onClose}
      busy={create.isPending}
      footer={
        <>
          <Button
            variant="primary"
            disabled={!ready || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  propertyId: chosen,
                  checkIn,
                  checkOut,
                  guestName: guestName.trim(),
                  ...(guestEmail.trim() ? { guestEmail: guestEmail.trim() } : {}),
                  ...(guestPhone.trim() ? { guestPhone: guestPhone.trim() } : {}),
                  adults: Math.max(1, Number(adults) || 1),
                  children: Math.max(0, Number(children) || 0),
                  ...(totalMinor !== undefined ? { totalMinor } : {}),
                  ...(checkInTime ? { checkInTime } : {}),
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                },
                { onSuccess: (r) => navigate(`/reservations/${r.id}`) },
              )
            }
          >
            Add booking
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SelectField
          label="Property"
          value={chosen}
          onChange={setPropertyId}
          options={list.map((p) => ({ value: p.id, label: p.name }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField
            label="Check-in"
            value={checkIn}
            today={today}
            onChange={(day) => {
              setCheckIn(day);
              if (!DAY.test(checkOut) || checkOut <= day) setCheckOut(addDays(day, Math.max(1, nights || 2)));
            }}
          />
          <DateField
            label="Check-out"
            value={checkOut}
            today={today}
            min={DAY.test(checkIn) ? addDays(checkIn, 1) : undefined}
            rangeFrom={DAY.test(checkIn) ? checkIn : null}
            onChange={setCheckOut}
            hint={datesOk ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : undefined}
            error={
              DAY.test(checkIn) && DAY.test(checkOut) && checkOut <= checkIn
                ? 'Check-out has to be after check-in.'
                : undefined
            }
          />
        </div>
        <TextField
          label="Guest's name"
          value={guestName}
          onChange={setGuestName}
          max={120}
          autoComplete="name"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            value={guestEmail}
            onChange={setGuestEmail}
            placeholder="name@example.com"
          />
          <TextField
            label="Phone"
            value={guestPhone}
            onChange={setGuestPhone}
            placeholder="+44 7700 900123"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Adults" value={adults} onChange={setAdults} />
          <TextField label="Children" value={children} onChange={setChildren} />
          <TextField
            label="Arriving at"
            value={checkInTime}
            onChange={setCheckInTime}
            placeholder="15:00"
            hint="Leave empty for the usual time."
          />
        </div>
        <TextField
          label={`Total price (${currency})`}
          value={total}
          onChange={setTotal}
          placeholder="450.00"
          error={totalError}
          hint={
            totalMinor !== undefined
              ? `${formatMoney({ amountMinor: totalMinor, currency })} for the record; nothing is charged here yet.`
              : 'For the record; nothing is charged here yet.'
          }
        />
        <TextArea label="Notes for the team" value={notes} onChange={setNotes} max={4000} rows={3} />
        {create.error ? (
          <Notice tone="urgent">
            {create.error instanceof ApiError ? create.error.message : 'That didn’t go through. Try again.'}
          </Notice>
        ) : null}
      </div>
    </Sheet>
  );
}
