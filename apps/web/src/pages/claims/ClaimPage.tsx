import {
  IconArrowLeft,
  IconDownload,
  IconFile,
  IconFileTypePdf,
  IconMovie,
  IconPencil,
  IconPhoto,
  IconReceipt,
  IconTrash,
} from '@tabler/icons-react';
import {
  CHANNEL_LABELS,
  CLAIM_PLACE_LABELS,
  CLAIM_PLACES,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUSES,
  type Claim,
  type ClaimEvidencePhoto,
  type ClaimFileKind,
  type ClaimPlace,
  type ClaimStatus,
  can,
  type Expense,
  parseMajorToMinor,
  todayIn,
} from '@v01/shared';
import { type ReactNode, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { DateField } from '../../components/DateField.tsx';
import { MoneyField, SelectField, TextArea, TextField } from '../../components/fields.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  useAddClaimFiles,
  useClaim,
  useClaimItems,
  useRemoveClaimFile,
  useUpdateClaim,
  useWorkspace,
} from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { ChannelMark } from '../calendar/marks.tsx';
import { NotFound } from '../misc.tsx';
import { ExpenseSheet } from '../money/ExpenseSheet.tsx';
import { currencySymbol, minorToInput, moneyText } from '../properties/money.ts';
import { Countdown } from './ClaimsPage.tsx';
import { downloadEvidence } from './evidence.ts';

/**
 * One claim: the deadline first, then what was damaged and what it costs, the evidence (the
 * team's photos from before and after the stay, what they reported, and the files added here),
 * and where it stands. Download evidence puts it all in one zip for the channel or the guest.
 */

const at = (d: string) => new Date(`${d}T12:00:00`);
const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const FULL = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');
const size = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

function Section({
  id,
  title,
  sub,
  end,
  children,
}: {
  id: string;
  title: string;
  sub?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-hairline bg-canvas p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
            {title}
          </h2>
          {sub ? <p className="mt-0.5 text-[13px] text-slate">{sub}</p> : null}
        </div>
        {end}
      </div>
      {children}
    </section>
  );
}

function why(claim: Claim): string {
  const next = claim.nextCheckIn ? LONG.format(at(claim.nextCheckIn)) : null;
  if (claim.place === 'airbnb')
    return `Airbnb wants it within 14 days of check-out${next ? `, and before the next guest arrives (${next})` : ''}.`;
  if (claim.place === 'booking_com') return 'Booking.com takes damage claims up to 14 days after check-out.';
  return '14 days after check-out, unless your own terms say otherwise.';
}

/** The deadline, where it goes, and where it stands. */
function Standing({ claim, write, locale }: { claim: Claim; write: boolean; locale: string }) {
  const { orgId } = useCurrentWorkspace();
  const update = useUpdateClaim(orgId, claim.id);
  const workspace = useWorkspace(orgId);
  const today = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London');
  const [moving, setMoving] = useState(false);
  const [deadline, setDeadline] = useState(claim.deadline);
  const [reference, setReference] = useState(claim.filedReference ?? '');
  const [received, setReceived] = useState(minorToInput(claim.receivedMinor, claim.currency));
  const [outcome, setOutcome] = useState(claim.outcome ?? '');
  let receivedMinor: number | null | undefined = null;
  try {
    receivedMinor = received.trim()
      ? parseMajorToMinor(received.replace(/[^\d.]/g, ''), claim.currency)
      : null;
  } catch {
    receivedMinor = undefined;
  }
  const setStatus = (status: ClaimStatus) => update.mutate({ status });
  return (
    <Section
      id="standing"
      title={
        claim.status === 'open'
          ? `File by ${FULL.format(at(claim.deadline))}`
          : CLAIM_STATUS_LABELS[claim.status]
      }
      sub={
        claim.status === 'open'
          ? why(claim)
          : claim.filedOn
            ? `Filed ${FULL.format(at(claim.filedOn))}`
            : null
      }
      end={claim.status === 'open' ? <Countdown deadline={claim.deadline} today={today} size="lg" /> : null}
    >
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Where it stands</legend>
          {CLAIM_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!write || update.isPending}
              aria-pressed={claim.status === s}
              onClick={() => setStatus(s)}
              className={`h-9 rounded-full border px-4 text-[13.5px] transition-colors disabled:cursor-default ${claim.status === s ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink enabled:hover:bg-linen'}`}
            >
              {CLAIM_STATUS_LABELS[s]}
            </button>
          ))}
        </fieldset>

        <div className="flex flex-col gap-4">
          {write ? (
            <SelectField
              label="Filed with"
              value={claim.place}
              onChange={(v) => update.mutate({ place: v as ClaimPlace })}
              options={CLAIM_PLACES.map((p) => ({ value: p, label: CLAIM_PLACE_LABELS[p] }))}
            />
          ) : (
            <p className="text-[14px] text-ink">
              <span className="block text-[13px] text-slate">Filed with</span>
              {CLAIM_PLACE_LABELS[claim.place]}
            </p>
          )}
          {write ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <TextField
                  label="Their reference"
                  value={reference}
                  onChange={setReference}
                  max={120}
                  placeholder="The case number they give you"
                />
              </div>
              {reference !== (claim.filedReference ?? '') ? (
                <Button onClick={() => update.mutate({ filedReference: reference })}>Save</Button>
              ) : null}
            </div>
          ) : claim.filedReference ? (
            <p className="text-[14px] text-ink">
              <span className="block text-[13px] text-slate">Their reference</span>
              {claim.filedReference}
            </p>
          ) : null}
        </div>

        {write ? (
          moving ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full max-w-[260px]">
                <DateField label="Deadline" value={deadline} today={today} onChange={setDeadline} />
              </div>
              <Button
                variant="primary"
                onClick={() => update.mutate({ deadline }, { onSuccess: () => setMoving(false) })}
              >
                Save
              </Button>
              <Button variant="quiet" onClick={() => setMoving(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div>
              <button type="button" className="action -ml-2.5" onClick={() => setMoving(true)}>
                Change the deadline
              </button>
            </div>
          )
        ) : null}

        {claim.status === 'paid' || claim.status === 'closed' || claim.receivedMinor !== null ? (
          <div className="flex flex-col gap-4 border-t border-hairline pt-5">
            {write ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <MoneyField
                    label="Received"
                    value={received}
                    onChange={setReceived}
                    symbol={currencySymbol(claim.currency, locale)}
                    error={receivedMinor === undefined ? 'An amount like 120 or 120.50.' : undefined}
                  />
                </div>
                {receivedMinor !== undefined && receivedMinor !== claim.receivedMinor ? (
                  <Button onClick={() => update.mutate({ receivedMinor })}>Save</Button>
                ) : null}
              </div>
            ) : (
              <p className="text-[14px] text-ink">
                <span className="block text-[13px] text-slate">Received</span>
                {claim.receivedMinor === null ? '—' : moneyText(claim.receivedMinor, claim.currency, locale)}
              </p>
            )}
            {write ? (
              <div className="flex flex-col gap-2">
                <TextArea
                  label="Outcome"
                  value={outcome}
                  onChange={setOutcome}
                  max={2000}
                  rows={2}
                  placeholder="Paid in part: the rug, not the chair."
                />
                {outcome !== (claim.outcome ?? '') ? (
                  <div>
                    <Button onClick={() => update.mutate({ outcome })}>Save</Button>
                  </div>
                ) : null}
              </div>
            ) : claim.outcome ? (
              <p className="text-[14px] text-ink">
                <span className="block text-[13px] text-slate">Outcome</span>
                {claim.outcome}
              </p>
            ) : null}
          </div>
        ) : null}
        {update.error ? <Notice tone="urgent">{explain(update.error)}</Notice> : null}
      </div>
    </Section>
  );
}

/** What happened, in a sentence or two, for whoever reads the claim. */
function Summary({ claim, write }: { claim: Claim; write: boolean }) {
  const { orgId } = useCurrentWorkspace();
  const update = useUpdateClaim(orgId, claim.id);
  const [text, setText] = useState(claim.summary ?? '');
  if (!write)
    return claim.summary ? <p className="text-[14.5px] leading-relaxed text-ink">{claim.summary}</p> : null;
  return (
    <div className="flex flex-col gap-2">
      <TextArea
        label="What happened"
        value={text}
        onChange={setText}
        max={4000}
        rows={3}
        placeholder="Wine spilt on the living-room rug and a dining chair broken during the stay."
      />
      {text !== (claim.summary ?? '') ? (
        <div>
          <Button disabled={update.isPending} onClick={() => update.mutate({ summary: text })}>
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Items({ claim, write, locale }: { claim: Claim; write: boolean; locale: string }) {
  const { orgId } = useCurrentWorkspace();
  const { add, change, remove } = useClaimItems(orgId, claim.id);
  const [what, setWhat] = useState('');
  const [amount, setAmount] = useState('');
  const [editing, setEditing] = useState<{ id: string; what: string; amount: string } | null>(null);
  const symbol = currencySymbol(claim.currency, locale);
  const m = (minor: number) => moneyText(minor, claim.currency, locale);
  const parse = (v: string) => {
    if (!v.trim()) return undefined;
    try {
      return parseMajorToMinor(v.replace(/[^\d.]/g, ''), claim.currency);
    } catch {
      return undefined;
    }
  };
  const minor = parse(amount);
  const error = add.error ?? change.error ?? remove.error;
  return (
    <Section id="items" title="What was damaged" sub="Each thing, and what it costs to put right.">
      {claim.items.length ? (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {claim.items.map((i) =>
            editing?.id === i.id ? (
              <li key={i.id} className="flex flex-wrap items-end gap-2 py-3">
                <div className="min-w-[200px] flex-1">
                  <TextField
                    label="What"
                    value={editing.what}
                    onChange={(v) => setEditing({ ...editing, what: v })}
                    max={300}
                  />
                </div>
                <div className="w-[140px]">
                  <MoneyField
                    label="Cost"
                    value={editing.amount}
                    onChange={(v) => setEditing({ ...editing, amount: v })}
                    symbol={symbol}
                  />
                </div>
                <Button
                  variant="primary"
                  disabled={!editing.what.trim() || parse(editing.amount) === undefined || change.isPending}
                  onClick={() =>
                    change.mutate(
                      {
                        itemId: i.id,
                        description: editing.what.trim(),
                        amountMinor: parse(editing.amount) ?? 0,
                      },
                      { onSuccess: () => setEditing(null) },
                    )
                  }
                >
                  Save
                </Button>
                <Button variant="quiet" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </li>
            ) : (
              <li key={i.id} className="flex items-center justify-between gap-4 py-3 text-[14.5px]">
                <span className="min-w-0 text-ink">{i.description}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 text-ink tnum">{m(i.amountMinor)}</span>
                  {write ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Change ${i.description}`}
                        onClick={() =>
                          setEditing({
                            id: i.id,
                            what: i.description,
                            amount: minorToInput(i.amountMinor, claim.currency),
                          })
                        }
                        className="flex size-8 items-center justify-center rounded-full text-slate hover:bg-linen hover:text-ink"
                      >
                        <IconPencil size={16} stroke={1.75} aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${i.description}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(i.id)}
                        className="flex size-8 items-center justify-center rounded-full text-slate hover:bg-linen hover:text-urgent"
                      >
                        <IconTrash size={16} stroke={1.75} aria-hidden />
                      </button>
                    </>
                  ) : null}
                </span>
              </li>
            ),
          )}
          <li className="flex items-center justify-between gap-4 py-3 text-[15px] font-semibold">
            <span className="text-ink">Total claimed</span>
            <span className={`text-ink tnum ${write ? 'mr-[72px]' : ''}`}>{m(claim.claimedMinor)}</span>
          </li>
        </ul>
      ) : (
        <p className="text-[14px] text-slate">Nothing listed yet.</p>
      )}
      {write ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!what.trim() || minor === undefined) return;
            add.mutate(
              { description: what.trim(), amountMinor: minor },
              {
                onSuccess: () => {
                  setWhat('');
                  setAmount('');
                },
              },
            );
          }}
        >
          <div className="min-w-[200px] flex-1">
            <TextField
              label="Add a line"
              value={what}
              onChange={setWhat}
              max={300}
              placeholder="Coffee table glass"
            />
          </div>
          <div className="w-[140px]">
            <MoneyField label="Cost" value={amount} onChange={setAmount} symbol={symbol} />
          </div>
          <Button type="submit" disabled={!what.trim() || minor === undefined || add.isPending}>
            Add
          </Button>
        </form>
      ) : null}
      {error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(error)}</Notice>
        </div>
      ) : null}
    </Section>
  );
}

/** Money already spent putting it right, recorded as expenses for this claim. */
function Costs({ claim, locale }: { claim: Claim; locale: string }) {
  const { entry } = useCurrentWorkspace();
  const [open, setOpen] = useState<Expense | 'new' | null>(null);
  const write = can(entry.role, 'expenses.write');
  const m = (minor: number) => moneyText(minor, claim.currency, locale);
  const total = claim.costs.reduce((sum, e) => sum + e.amountMinor, 0);
  if (!write && !claim.costs.length) return null;
  return (
    <Section
      id="costs"
      title="Spent putting it right"
      sub="Expenses recorded for this claim, with their receipts. They go in the download too."
      end={write ? <Button onClick={() => setOpen('new')}>Record a cost</Button> : undefined}
    >
      {open ? (
        <ExpenseSheet
          key={open === 'new' ? 'new' : open.id}
          expense={open === 'new' ? undefined : open}
          start={{ propertyId: claim.propertyId, claimId: claim.id, category: 'repairs' }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {claim.costs.length ? (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {claim.costs.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                disabled={!write}
                onClick={() => setOpen(e)}
                className="flex w-full items-center justify-between gap-4 py-2.5 text-left text-[14px] enabled:hover:bg-paper"
              >
                <span className="min-w-0">
                  <span className="block truncate text-ink">{e.description}</span>
                  <span className="block truncate text-[12.5px] text-slate">
                    {LONG.format(at(e.spentOn))}
                    {e.vendor ? ` · ${e.vendor}` : ''}
                    {e.receipt ? ' · receipt kept' : ' · no receipt yet'}
                  </span>
                </span>
                <span className="shrink-0 text-ink tnum">{m(e.amountMinor)}</span>
              </button>
            </li>
          ))}
          <li className="flex items-center justify-between py-2.5 text-[14.5px] font-semibold">
            <span className="text-ink">Spent so far</span>
            <span className="text-ink tnum">{m(total)}</span>
          </li>
        </ul>
      ) : (
        <p className="text-[13.5px] text-slate">
          Nothing recorded yet. Record repairs and replacements as you pay for them.
        </p>
      )}
    </Section>
  );
}

function PhotoGrid({ photos, empty }: { photos: ClaimEvidencePhoto[]; empty: string }) {
  if (!photos.length) return <p className="text-[13.5px] text-slate">{empty}</p>;
  return (
    <ul className="grid grid-cols-2 gap-2">
      {photos.map((p) => (
        <li key={p.id}>
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="group block overflow-hidden rounded-lg border border-hairline"
          >
            <img
              src={p.url}
              alt={p.stamp ?? `${p.taskTitle}, ${p.taskDay}`}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          </a>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-slate">
            {p.stamp ?? `${LONG.format(at(p.taskDay))} · ${p.takenBy ?? 'The team'}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function FileIcon({ contentType }: { contentType: string }) {
  const Icon =
    contentType === 'application/pdf'
      ? IconFileTypePdf
      : contentType.startsWith('video/')
        ? IconMovie
        : contentType.startsWith('image/')
          ? IconPhoto
          : IconFile;
  return <Icon size={20} stroke={1.75} aria-hidden className="shrink-0 text-slate" />;
}

function Evidence({ claim, write }: { claim: Claim; write: boolean }) {
  const { orgId } = useCurrentWorkspace();
  const addFiles = useAddClaimFiles(orgId, claim.id);
  const removeFile = useRemoveClaimFile(orgId, claim.id);
  const photosInput = useRef<HTMLInputElement>(null);
  const receiptsInput = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const pick = (kind: ClaimFileKind) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) addFiles.mutate({ files, kind }, { onSuccess: setProblems });
  };
  return (
    <Section
      id="evidence"
      title="Evidence"
      sub="The team's photos from the cleans either side of the stay, what they reported, and anything you add."
    >
      {claim.reports.length ? (
        <div className="mb-5 flex flex-col gap-2">
          {claim.reports.map((r) => (
            <Link
              key={r.taskId}
              to={`/tasks?task=${r.taskId}`}
              className="block rounded-xl border-l-2 border-pending bg-paper px-4 py-3 transition-colors hover:bg-linen"
            >
              <p className="text-[12.5px] text-slate">
                Reported {LONG.format(at(r.day))}
                {r.by ? ` by ${r.by}` : ''}
              </p>
              <p className="mt-0.5 text-[14.5px] text-ink">{r.what ?? 'Damage reported.'}</p>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[14px] font-semibold text-ink">Before the stay</h3>
          <PhotoGrid photos={claim.before} empty="No photos from the clean before they arrived." />
        </div>
        <div>
          <h3 className="mb-2 text-[14px] font-semibold text-ink">After the stay</h3>
          <PhotoGrid photos={claim.after} empty="No photos from the team since they left." />
        </div>
      </div>

      <div className="mt-6 border-t border-hairline pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[14px] font-semibold text-ink">Added to this claim</h3>
          {write ? (
            <div className="flex flex-wrap gap-2">
              <input
                ref={photosInput}
                type="file"
                multiple
                hidden
                accept="image/*,video/mp4,video/quicktime"
                onChange={pick('photo')}
              />
              <input
                ref={receiptsInput}
                type="file"
                multiple
                hidden
                accept="application/pdf,image/*"
                onChange={pick('receipt')}
              />
              <Button disabled={addFiles.isPending} onClick={() => photosInput.current?.click()}>
                <IconPhoto size={16} stroke={1.75} aria-hidden /> Photos or videos
              </Button>
              <Button disabled={addFiles.isPending} onClick={() => receiptsInput.current?.click()}>
                <IconReceipt size={16} stroke={1.75} aria-hidden /> Receipts or invoices
              </Button>
            </div>
          ) : null}
        </div>
        {addFiles.isPending ? (
          <p className="mb-3 inline-flex items-center gap-2 text-[13.5px] text-slate">
            <Spinner size={14} /> Uploading, kept exactly as they are
          </p>
        ) : null}
        {problems.length ? (
          <div className="mb-3">
            <Notice tone="urgent">{problems.join(' ')}</Notice>
          </div>
        ) : null}
        {claim.files.length ? (
          <ul className="divide-y divide-hairline border-y border-hairline">
            {claim.files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md hover:bg-paper"
                >
                  {f.contentType.startsWith('image/') && f.contentType !== 'image/heic' ? (
                    <img
                      src={f.url}
                      alt=""
                      className="size-10 shrink-0 rounded-md border border-hairline object-cover"
                    />
                  ) : (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-hairline">
                      <FileIcon contentType={f.contentType} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-ink">{f.fileName}</span>
                    <span className="block text-[12.5px] text-slate">
                      {f.kind === 'receipt'
                        ? 'Receipt or invoice'
                        : f.kind === 'photo'
                          ? 'Photo or video'
                          : 'File'}{' '}
                      · {size(f.bytes)}
                      {f.uploadedBy ? ` · ${f.uploadedBy}` : ''}
                    </span>
                  </span>
                </a>
                {write ? (
                  <button
                    type="button"
                    aria-label={`Remove ${f.fileName}`}
                    disabled={removeFile.isPending}
                    onClick={() => {
                      if (window.confirm(`Remove ${f.fileName} from this claim?`)) removeFile.mutate(f.id);
                    }}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate hover:bg-linen hover:text-urgent"
                  >
                    <IconTrash size={16} stroke={1.75} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-slate">
            Nothing added yet. Receipts, repair quotes and your own photos or videos are kept exactly as
            uploaded.
          </p>
        )}
      </div>
    </Section>
  );
}

export function ClaimPage() {
  const { id } = useParams();
  const { orgId, entry } = useCurrentWorkspace();
  const claim = useClaim(orgId, id ?? null);
  const workspace = useWorkspace(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const write = can(entry.role, 'claims.write');
  const [zipping, setZipping] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  if (claim.error instanceof ApiError && claim.error.status === 404) return <NotFound />;
  const c = claim.data;
  return (
    <>
      <Link to="/claims" className="action -ml-2.5 mb-4 inline-flex items-center gap-1">
        <IconArrowLeft size={15} stroke={1.75} aria-hidden /> Claims
      </Link>
      {claim.isPending ? (
        <Spinner size={16} />
      ) : !c ? (
        <Notice tone="urgent">{explain(claim.error)}</Notice>
      ) : (
        <>
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
            <div className="min-w-0">
              <p className="mb-1 text-[13.5px] text-slate">Damage claim · {CLAIM_STATUS_LABELS[c.status]}</p>
              <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-ink">
                {c.guestName ?? 'Guest'} at {c.propertyName}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] text-slate">
                <ChannelMark channel={c.channel} size={18} />
                {CHANNEL_LABELS[c.channel]}
                {c.channelReference ? ` ${c.channelReference}` : ''} · {LONG.format(at(c.checkIn))} –{' '}
                {LONG.format(at(c.checkOut))}
                <Link to={`/reservations/${c.reservationId}`} className="action">
                  Booking
                </Link>
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="primary"
                disabled={zipping !== null}
                onClick={async () => {
                  setZipping('Gathering');
                  setMissing([]);
                  try {
                    setMissing(
                      await downloadEvidence(c, locale, (done, total) => setZipping(`${done} of ${total}`)),
                    );
                  } finally {
                    setZipping(null);
                  }
                }}
              >
                {zipping ? <Spinner size={14} /> : <IconDownload size={16} stroke={1.75} aria-hidden />}
                {zipping ? zipping : 'Download evidence'}
              </Button>
              <span className="text-[12px] text-mist">A zip: summary, photos, receipts</span>
            </div>
          </header>
          {missing.length ? (
            <div className="mb-6">
              <Notice tone="pending">
                Downloaded, but these couldn’t be fetched and aren’t in it: {missing.join(', ')}.
              </Notice>
            </div>
          ) : null}

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Items claim={c} write={write} locale={locale} />
              <Costs claim={c} locale={locale} />
              <Evidence claim={c} write={write} />
            </div>
            <div className="order-first flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:order-none">
              <Standing key={`${c.id}-${c.status}`} claim={c} write={write} locale={locale} />
              {write || c.summary ? (
                <Section id="summary" title="In short">
                  <Summary claim={c} write={write} />
                </Section>
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
