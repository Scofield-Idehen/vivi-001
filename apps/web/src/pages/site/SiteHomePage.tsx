import { IconArrowLeft, IconCheck, IconLock, IconPhoto, IconX } from '@tabler/icons-react';
import type { SiteHome, SiteQuote } from '@v01/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Spinner } from '../../components/Spinner.tsx';
import { ApiError, useSiteBook, useSiteHome, useSiteQuote } from '../../lib/api.ts';
import { cx, facts, money, plural, SiteFrame, StayCalendar, Stepper, shortDay } from './parts.tsx';
import { partyFrom } from './SitePage.tsx';

/**
 * A home on the booking website (2 Nov 2026): photos, what it's like, its rules, and the box to
 * book it. The box goes dates → guests → price → the guest's details → Stripe's page, where the
 * card is authorised; V-01 charges it once the booking is saved. On a phone the box sits under the
 * home's name; on a wide screen it stays beside the description.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Check your connection and try again.';

function Gallery({ photos, name }: { photos: SiteHome['photos']; name: string }) {
  const [all, setAll] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!all) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAll(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [all]);
  if (!photos.length) return <div className="aspect-[16/9] rounded-2xl bg-linen sm:aspect-[21/9]" />;
  const [first, ...rest] = photos;
  return (
    <>
      {/* Phone: swipe through. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:hidden">
        {photos.map((p, i) => (
          <img
            key={p.url}
            src={p.url}
            alt={p.caption ?? `${name}, photo ${i + 1}`}
            className="aspect-[4/3] w-[86%] shrink-0 snap-center rounded-2xl object-cover"
          />
        ))}
      </div>
      {/* Wider: one large and up to four small, laid out for how many there are. */}
      <div
        className={cx(
          'relative hidden gap-2 sm:grid sm:aspect-[21/9]',
          photos.length === 1 && 'sm:grid-cols-1',
          photos.length === 2 && 'sm:grid-cols-2',
          (photos.length === 3 || photos.length === 4) && 'sm:grid-cols-3 sm:grid-rows-2',
          photos.length >= 5 && 'sm:grid-cols-4 sm:grid-rows-2',
        )}
      >
        <img
          src={first?.url}
          alt={first?.caption ?? name}
          className={cx(
            'size-full rounded-2xl object-cover',
            photos.length >= 3 && 'col-span-2 row-span-2 rounded-r-none',
            photos.length === 2 && 'rounded-r-none',
          )}
        />
        {rest.slice(0, photos.length >= 5 ? 4 : photos.length === 2 ? 1 : 2).map((p, i, shown) => (
          <img
            key={p.url}
            src={p.url}
            alt={p.caption ?? `${name}, photo ${i + 2}`}
            className={cx(
              'size-full object-cover',
              shown.length === 1 && 'rounded-r-2xl',
              shown.length === 2 && (i === 0 ? 'rounded-tr-2xl' : 'rounded-br-2xl'),
              shown.length === 4 && i === 1 && 'rounded-tr-2xl',
              shown.length === 4 && i === 3 && 'rounded-br-2xl',
            )}
          />
        ))}
        {photos.length > 1 ? (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="absolute right-3 bottom-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[14px] text-ink shadow"
          >
            <IconPhoto size={16} stroke={1.75} /> All {photos.length} photos
          </button>
        ) : null}
      </div>
      {all ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="All photos"
          className="fixed inset-0 z-50 overflow-y-auto bg-white"
        >
          <div className="sticky top-0 flex h-14 items-center justify-between border-b border-hairline bg-white px-4">
            <span className="text-[15px] font-medium text-ink">{name}</span>
            <button
              ref={close}
              type="button"
              aria-label="Close photos"
              onClick={() => setAll(false)}
              className="inline-flex size-10 items-center justify-center rounded-full hover:bg-linen"
            >
              <IconX size={20} stroke={1.75} />
            </button>
          </div>
          <div className="mx-auto flex max-w-[860px] flex-col gap-3 p-4">
            {photos.map((p, i) => (
              <figure key={p.url}>
                <img src={p.url} alt={p.caption ?? `${name}, photo ${i + 1}`} className="w-full rounded-xl" />
                {p.caption ? (
                  <figcaption className="mt-1 text-[13px] text-slate">{p.caption}</figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Breakdown({ q, currency }: { q: Extract<SiteQuote, { ok: true }>; currency: string }) {
  const lines: [string, number][] = [
    [`${plural(q.nights, 'night')}`, q.nightsMinor],
    ...(q.cleaningMinor ? ([['Cleaning fee', q.cleaningMinor]] as [string, number][]) : []),
    ...(q.extraGuestsMinor ? ([['Extra guests', q.extraGuestsMinor]] as [string, number][]) : []),
    ...(q.serviceMinor ? ([['Service fee', q.serviceMinor]] as [string, number][]) : []),
  ];
  return (
    <dl className="flex flex-col gap-1.5 text-[15px]">
      {lines.map(([label, amount]) => (
        <div key={label} className="flex justify-between gap-3 text-slate">
          <dt>{label}</dt>
          <dd className="tnum text-ink">{money(amount, currency)}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-3 border-t border-hairline pt-2 font-semibold text-ink">
        <dt>Total</dt>
        <dd className="tnum">{money(q.totalMinor, currency)}</dd>
      </div>
    </dl>
  );
}

function Input({
  label,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[14px] text-ink">
      {label}
      <input
        {...props}
        aria-invalid={Boolean(error)}
        className="h-11 rounded-xl border border-hairline bg-white px-3 text-[15px] outline-none focus:border-ink aria-[invalid=true]:border-urgent"
      />
      {error ? <span className="text-[13px] text-urgent">{error}</span> : null}
    </label>
  );
}

function BookBox({ slug, h }: { slug: string; h: SiteHome }) {
  const [params, setParams] = useSearchParams();
  const checkIn = params.get('checkIn');
  const checkOut = params.get('checkOut');
  const party = partyFrom(params);
  const [step, setStep] = useState<'stay' | 'details'>('stay');
  const set = (next: Record<string, string | number | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === 0 || v === '') p.delete(k);
      else p.set(k, String(v));
    }
    setParams(p, { replace: true });
  };
  const request = checkIn && checkOut ? { homeId: h.id, checkIn, checkOut, ...party } : null;
  const preview = params.get('preview');
  const quote = useSiteQuote(slug, request, preview);
  const navigate = useNavigate();
  const book = useSiteBook(slug, navigate);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', request: '' });
  const [accepted, setAccepted] = useState(false);
  const [tried, setTried] = useState(false);
  const q = quote.data;
  const ok = q?.ok ? q : null;
  const errors = {
    firstName: form.firstName.trim() ? undefined : 'Enter your first name',
    lastName: form.lastName.trim() ? undefined : 'Enter your last name',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? undefined : 'Enter your email address',
    terms: accepted ? undefined : 'Accept the terms to book',
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!request || Object.values(errors).some(Boolean)) return;
    book.mutate({ ...request, ...form, acceptTerms: true });
  };

  if (step === 'details' && request && ok) {
    return (
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <button type="button" onClick={() => setStep('stay')} className="action -ml-2.5 w-fit !h-8">
          <IconArrowLeft size={16} stroke={1.75} /> Change dates or guests
        </button>
        <div className="rounded-xl bg-canvas px-4 py-3 text-[14.5px] text-ink">
          <p className="font-medium">{h.name}</p>
          <p className="text-slate">
            {shortDay(request.checkIn)} to {shortDay(request.checkOut)},{' '}
            {plural(party.adults + party.children, 'guest')}
          </p>
        </div>
        <Breakdown q={ok} currency={h.currency} />
        <h3 className="mt-2 font-semibold text-[17px] text-ink">Your details</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Input
            label="First name"
            autoComplete="given-name"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            error={tried ? errors.firstName : undefined}
          />
          <Input
            label="Last name"
            autoComplete="family-name"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            error={tried ? errors.lastName : undefined}
          />
        </div>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={tried ? errors.email : undefined}
        />
        <Input
          label="Phone (optional)"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <label className="flex flex-col gap-1 text-[14px] text-ink">
          Anything we should know? (optional)
          <textarea
            rows={3}
            maxLength={1000}
            value={form.request}
            onChange={(e) => setForm({ ...form, request: e.target.value })}
            className="rounded-xl border border-hairline bg-white px-3 py-2 text-[15px] outline-none focus:border-ink"
          />
        </label>
        <div className="rounded-xl bg-canvas px-4 py-3 text-[13.5px] text-slate">
          <p className="font-medium text-ink">Cancellation: {h.cancellation.label}</p>
          <p>{h.cancellation.description}</p>
          {h.terms ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-ink">Booking terms</summary>
              <p className="mt-1 whitespace-pre-line">{h.terms}</p>
            </details>
          ) : null}
        </div>
        <label className="flex items-start gap-2.5 text-[14px] text-ink">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />
          <span>
            I accept the {h.terms ? 'booking terms and ' : ''}cancellation policy.
            {tried && errors.terms ? (
              <span className="block text-[13px] text-urgent">{errors.terms}</span>
            ) : null}
          </span>
        </label>
        {book.error ? (
          <p className="rounded-xl bg-urgent-tint px-3 py-2 text-[14px] text-urgent">{explain(book.error)}</p>
        ) : null}
        <button
          type="submit"
          disabled={book.isPending || !h.canPay}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[16px] font-medium text-white disabled:opacity-60"
        >
          <IconLock size={17} stroke={1.75} />
          {book.isPending ? 'Opening the payment page…' : `Pay ${money(ok.totalMinor, h.currency)}`}
        </button>
        <p className="text-[12.5px] text-slate">
          You’ll pay on Stripe’s secure page. Your card is only charged once your booking is confirmed.
        </p>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        {ok ? (
          <p className="text-[20px] text-ink">
            <span className="font-semibold">{money(ok.totalMinor, h.currency)}</span>
            <span className="text-[15px] text-slate"> for {plural(ok.nights, 'night')}</span>
          </p>
        ) : h.fromMinor ? (
          <p className="text-[20px] text-ink">
            <span className="text-[15px] text-slate">From </span>
            <span className="font-semibold">{money(h.fromMinor, h.currency)}</span>
            <span className="text-[15px] text-slate"> a night</span>
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-hairline text-[14px]">
        <div className="border-r border-hairline px-3 py-2">
          <p className="text-[12px] text-slate">Check-in</p>
          <p className="text-ink">{checkIn ? shortDay(checkIn) : 'Add date'}</p>
        </div>
        <div className="px-3 py-2">
          <p className="text-[12px] text-slate">Check-out</p>
          <p className="text-ink">{checkOut ? shortDay(checkOut) : 'Add date'}</p>
        </div>
      </div>
      <StayCalendar
        slug={slug}
        homeId={h.id}
        currency={h.currency}
        checkIn={checkIn}
        checkOut={checkOut}
        onChange={(s) => set({ checkIn: s.checkIn, checkOut: s.checkOut })}
        preview={preview}
      />
      <div className="divide-y divide-hairline border-y border-hairline">
        <Stepper
          label="Adults"
          hint="13 or older"
          value={party.adults}
          min={1}
          max={h.maxGuests}
          onChange={(adults) => set({ adults: adults === 1 ? null : adults })}
        />
        <Stepper
          label="Children"
          hint="2 to 12"
          value={party.children}
          min={0}
          max={h.childrenAllowed ? h.maxGuests : 0}
          onChange={(children) => set({ children })}
        />
        <Stepper
          label="Infants"
          hint="Under 2"
          value={party.infants}
          min={0}
          max={h.childrenAllowed ? 5 : 0}
          onChange={(infants) => set({ infants })}
        />
        {h.petsAllowed ? (
          <Stepper label="Pets" value={party.pets} min={0} max={3} onChange={(pets) => set({ pets })} />
        ) : null}
      </div>
      {quote.isFetching && !q ? <p className="text-[14px] text-slate">Checking those dates…</p> : null}
      {q && !q.ok ? (
        <p className="rounded-xl bg-pending-tint px-3 py-2 text-[14px] text-ink">{q.message}</p>
      ) : null}
      {ok ? <Breakdown q={ok} currency={h.currency} /> : null}
      <button
        type="button"
        disabled={!ok || !h.canPay}
        onClick={() => setStep('details')}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-5 text-[16px] font-medium text-white disabled:opacity-50"
      >
        {ok ? 'Book now' : 'Choose your dates'}
      </button>
      {h.preview ? (
        <p className="text-[13px] text-slate">Preview: guests book here once the home is on the website.</p>
      ) : !h.canPay ? (
        <p className="text-[13px] text-slate">Online booking opens soon. Contact us to book these dates.</p>
      ) : (
        <p className="text-center text-[13px] text-slate">
          You won’t be charged until you pay on the next step.
        </p>
      )}
    </div>
  );
}

export function SiteHomePage() {
  const { slug = '', homeId = '' } = useParams();
  const [params] = useSearchParams();
  const home = useSiteHome(slug, homeId, params.get('preview'));
  const [showAll, setShowAll] = useState(false);
  if (home.isPending)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner />
      </div>
    );
  if (home.isError || !home.data)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
        <p className="max-w-[40ch] text-[16px] text-slate">This home isn’t available to book here.</p>
        <Link to={`/book/${slug}`} className="text-[15px] text-accent underline">
          See all homes
        </Link>
      </div>
    );
  const h = home.data;
  const back = `/book/${slug}${params.toString() ? `?${params.toString()}` : ''}`;
  const amenities = showAll ? h.amenities : h.amenities.slice(0, 12);

  return (
    <SiteFrame slug={slug} brand={h.brand} testMode={h.testMode} preview={params.get('preview')}>
      <div className="pt-4 pb-3">
        <Link to={back} className="inline-flex items-center gap-1.5 text-[14px] text-slate hover:text-ink">
          <IconArrowLeft size={16} stroke={1.75} /> All homes
        </Link>
      </div>
      <Gallery photos={h.photos} name={h.name} />
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_400px] lg:grid-rows-[auto_1fr] lg:items-start">
        <header className="lg:col-start-1">
          <h1 className="font-semibold tracking-[-0.025em] text-[26px] leading-tight text-ink sm:text-[32px]">
            {h.name}
          </h1>
          {h.place ? <p className="mt-1 text-[15px] text-slate">{h.place}</p> : null}
          <p className="mt-2 text-[15px] text-ink">{facts(h).join(' · ')}</p>
        </header>
        <aside className="rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_28px_rgba(20,28,32,0.06)] lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <BookBox slug={slug} h={h} />
        </aside>
        <div className="flex flex-col gap-8 lg:col-start-1">
          {h.summary ? (
            <p className="max-w-[68ch] whitespace-pre-line text-[16px] leading-relaxed text-ink">
              {h.summary}
            </p>
          ) : null}
          {h.sections.map((s) => (
            <section key={s.title} className="border-t border-hairline pt-6">
              <h2 className="mb-2 font-semibold text-[19px] text-ink">{s.title}</h2>
              <p className="max-w-[68ch] whitespace-pre-line text-[15.5px] leading-relaxed text-ink">
                {s.text}
              </p>
            </section>
          ))}
          {h.amenities.length ? (
            <section className="border-t border-hairline pt-6">
              <h2 className="mb-3 font-semibold text-[19px] text-ink">What this home has</h2>
              <ul className="grid gap-x-6 gap-y-2 text-[15px] text-ink sm:grid-cols-2">
                {amenities.map((a) => (
                  <li key={a} className="flex items-center gap-2">
                    <IconCheck size={16} stroke={2} className="text-accent" /> {a}
                  </li>
                ))}
              </ul>
              {h.amenities.length > 12 ? (
                <button type="button" className="action mt-3 -ml-2.5" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${h.amenities.length}`}
                </button>
              ) : null}
            </section>
          ) : null}
          <section className="border-t border-hairline pt-6">
            <h2 className="mb-3 font-semibold text-[19px] text-ink">House rules</h2>
            <ul className="flex flex-col gap-1.5 text-[15px] text-ink">
              <li>Check in from {h.checkInTime}</li>
              <li>Check out by {h.checkOutTime}</li>
              {h.minNights > 1 ? <li>Stays of at least {h.minNights} nights</li> : null}
              {h.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
          <section className="border-t border-hairline pt-6">
            <h2 className="mb-2 font-semibold text-[19px] text-ink">Cancellation</h2>
            <p className="text-[15px] text-ink">
              {h.cancellation.label}: {h.cancellation.description}
            </p>
          </section>
        </div>
      </div>
    </SiteFrame>
  );
}
