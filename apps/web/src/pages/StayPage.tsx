import { IconExternalLink, IconMapPin, IconPhone } from '@tabler/icons-react';
import { CHECK_IN_METHOD_LABELS, type GuestField, type GuestStay } from '@v01/shared';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Spinner } from '../components/Spinner.tsx';
import { ApiError, useGuestStay } from '../lib/api.ts';
import { config } from '../lib/config.ts';

/**
 * The guest's page for their stay (design roadmap: guests "get check-in details"). Opened from the
 * private link the team sends; no sign-in. One column, large type, the operator's name and accent:
 * what guests need, in the order they need it. Lock codes and the Wi-Fi password appear only from
 * the day of arrival until the day they leave.
 */

const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const long = (day: string) => LONG.format(new Date(`${day}T12:00:00`));
const short = (day: string) => SHORT.format(new Date(`${day}T12:00:00`));

/** Which card a guest-visible field belongs on, from its name. */
function placeOf(f: GuestField): 'code' | 'wifi_name' | 'wifi_password' | 'instructions' | 'other' {
  const n = f.name.toLowerCase();
  if (/wi-?fi/.test(n)) return /pass|password|key|code/.test(n) ? 'wifi_password' : 'wifi_name';
  if (f.kind === 'secret' && /lock|door|code|key ?safe|pin|alarm/.test(n)) return 'code';
  if (f.kind === 'link' && /check-?in|arrival|instruction|directions|guide/.test(n)) return 'instructions';
  return 'other';
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-paper px-5 py-4">
      <h2 className="mb-2 font-serif text-[20px] font-normal leading-tight text-ink">{title}</h2>
      <div className="flex flex-col gap-2 text-[16px] leading-relaxed text-ink">{children}</div>
    </section>
  );
}

/** A code, big and easy to read from a phone at the door; or where and when it will appear. */
function Code({ label, value, from }: { label: string; value: string | null; from: string | null }) {
  return (
    <div className="rounded-xl bg-canvas px-4 py-3">
      <p className="text-[13px] text-slate">{label}</p>
      {value ? (
        <p className="mt-0.5 font-serif text-[30px] leading-none tracking-[0.08em] text-ink tnum">{value}</p>
      ) : (
        <p className="mt-0.5 text-[15px] text-slate">
          {from ? `Appears here on ${long(from)}.` : 'No longer shown now the stay has ended.'}
        </p>
      )}
    </div>
  );
}

function Rules({ p }: { p: GuestStay['property'] }) {
  const lines = [
    p.petsAllowed ? 'Pets are welcome.' : 'No pets.',
    p.smokingAllowed ? 'Smoking allowed.' : 'No smoking inside.',
    p.eventsAllowed ? 'Events allowed.' : 'No parties or events.',
    p.childrenAllowed ? null : 'Not suitable for children.',
    p.quietHoursStart && p.quietHoursEnd ? `Quiet hours ${p.quietHoursStart} to ${p.quietHoursEnd}.` : null,
    `Up to ${p.maxGuests} guests.`,
  ].filter((l): l is string => Boolean(l));
  return (
    <>
      <ul className="flex flex-col gap-1">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {p.houseRules ? <p className="whitespace-pre-line text-slate">{p.houseRules}</p> : null}
    </>
  );
}

export function StayPage() {
  const { key } = useParams();
  const stay = useGuestStay(key ?? null);
  const navigate = useNavigate();

  if (stay.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner size={28} />
      </main>
    );
  }
  if (stay.error || !stay.data) {
    const gone = stay.error instanceof ApiError && stay.error.status === 404;
    return (
      <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-3 px-5 text-center">
        <h1 className="font-serif text-[28px] font-normal text-ink">
          {gone ? 'This link isn’t for a current stay' : 'The page couldn’t be loaded'}
        </h1>
        <p className="text-[16px] text-slate">
          {gone
            ? 'It may have been for a booking that was changed or cancelled. Ask whoever sent it for a new link.'
            : 'Check your connection and try again.'}
        </p>
      </main>
    );
  }

  const s = stay.data;
  const p = s.property;
  const accent = s.brand.accentHex ?? '#1e4d4f';
  const fields = s.fields;
  const codes = fields.filter((f) => placeOf(f) === 'code');
  const wifiName = fields.find((f) => placeOf(f) === 'wifi_name');
  const wifiPassword = fields.find((f) => placeOf(f) === 'wifi_password');
  const instructions = fields.filter((f) => placeOf(f) === 'instructions');
  const others = fields.filter((f) => placeOf(f) === 'other');
  const address = [p.addressLine1, p.addressLine2, p.city, p.postcode].filter(Boolean);
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.join(', '))}`;
  const firstName = s.guestName?.split(' ')[0] ?? null;

  return (
    <main className="min-h-dvh bg-canvas pb-12" style={{ '--color-accent': accent } as React.CSSProperties}>
      <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-5 pt-6">
        {config.demo ? (
          <button type="button" onClick={() => navigate(-1)} className="action -ml-2.5 w-fit">
            Back to the booking (demo only)
          </button>
        ) : null}
        <header className="flex items-center gap-3">
          {s.brand.logoLightUrl ? (
            <img src={s.brand.logoLightUrl} alt="" className="h-7 w-auto" />
          ) : (
            <span className="text-[13px] font-medium tracking-wide text-slate">{s.brand.displayName}</span>
          )}
        </header>

        {p.photoUrl ? (
          <img src={p.photoUrl} alt="" className="aspect-[16/10] w-full rounded-2xl object-cover" />
        ) : null}

        <div>
          <h1 className="font-serif text-[30px] font-normal leading-[1.1] text-ink">{p.title ?? p.name}</h1>
          <p className="mt-2 text-[16px] text-slate">
            {firstName ? `${firstName}, your stay: ` : 'Your stay: '}
            <span className="text-ink">
              {short(s.checkIn)} to {short(s.checkOut)}
            </span>
            {` · ${s.nights} ${s.nights === 1 ? 'night' : 'nights'} · ${s.guests} ${s.guests === 1 ? 'guest' : 'guests'}`}
          </p>
          {s.phase === 'after' ? (
            <p className="mt-2 text-[15px] text-slate">Thank you for staying. We hope to see you again.</p>
          ) : null}
        </div>

        <Card title="Arriving">
          <p>
            Check in from <b className="font-medium">{s.checkInTime}</b> on {long(s.checkIn)}.
            {p.checkInMethod ? ` ${CHECK_IN_METHOD_LABELS[p.checkInMethod]}.` : ''}
          </p>
          {p.guestAccess ? <p className="whitespace-pre-line text-slate">{p.guestAccess}</p> : null}
          {codes.map((f) => (
            <Code key={f.name} label={f.name} value={f.value} from={s.codesFrom} />
          ))}
          {instructions.map((f) =>
            f.value ? (
              <a
                key={f.name}
                href={f.value}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-medium text-white"
              >
                {f.name}
                <IconExternalLink size={16} stroke={1.75} aria-hidden />
              </a>
            ) : null,
          )}
        </Card>

        {wifiName || wifiPassword ? (
          <Card title="Wi-Fi">
            {wifiName?.value ? (
              <p>
                Network <b className="font-medium">{wifiName.value}</b>
              </p>
            ) : null}
            {wifiPassword ? <Code label="Password" value={wifiPassword.value} from={s.codesFrom} /> : null}
          </Card>
        ) : null}

        {address.length ? (
          <Card title="Finding it">
            <p className="whitespace-pre-line">{address.join('\n')}</p>
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 w-fit items-center gap-2 rounded-xl border border-hairline bg-canvas px-4 text-[15px] font-medium text-ink"
            >
              <IconMapPin size={16} stroke={1.75} aria-hidden />
              Open in Maps
            </a>
            {p.gettingAround ? <p className="whitespace-pre-line text-slate">{p.gettingAround}</p> : null}
          </Card>
        ) : null}

        <Card title="House rules">
          <Rules p={p} />
        </Card>

        {others.length ? (
          <Card title="Good to know">
            {others.map((f) =>
              f.kind === 'link' && f.value ? (
                <a
                  key={f.name}
                  href={f.value}
                  target="_blank"
                  rel="noreferrer"
                  className="action -ml-2.5 w-fit"
                >
                  {f.name}
                  <IconExternalLink size={14} stroke={1.75} aria-hidden />
                </a>
              ) : (
                <div key={f.name}>
                  <p className="text-[13px] text-slate">{f.name}</p>
                  <p className="whitespace-pre-line">{f.value}</p>
                </div>
              ),
            )}
          </Card>
        ) : null}

        <Card title="Leaving">
          <p>
            Check out by <b className="font-medium">{s.checkOutTime}</b> on {long(s.checkOut)}.
          </p>
        </Card>

        {s.brand.phone || s.brand.email ? (
          <Card title="Need anything?">
            {s.brand.phone ? (
              <a
                href={`tel:${s.brand.phone.replace(/\s+/g, '')}`}
                className="inline-flex items-center gap-2 text-ink"
              >
                <IconPhone size={16} stroke={1.75} aria-hidden />
                {s.brand.phone}
              </a>
            ) : null}
            {s.brand.email ? (
              <a href={`mailto:${s.brand.email}`} className="text-ink">
                {s.brand.email}
              </a>
            ) : null}
            <p className="text-[14px] text-slate">{s.brand.displayName}</p>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
