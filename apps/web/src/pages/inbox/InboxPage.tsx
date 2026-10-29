import { IconArrowLeft, IconCheck, IconLink, IconSearch, IconSend, IconTemplate } from '@tabler/icons-react';
import {
  CHANNEL_LABELS,
  can,
  MESSAGE_MAX,
  MESSAGE_VIA_LABELS,
  type Message,
  type MessageTemplate,
  nightsBetween,
  type Thread,
  type ThreadView,
} from '@v01/shared';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Popover } from '../../components/Popover.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, EmptyState, Notice, PageHeader } from '../../components/ui.tsx';
import {
  ApiError,
  useGuestLink,
  useMessageTemplates,
  useReservationThread,
  useSendMessage,
  useThread,
  useThreads,
  useUpdateThread,
} from '../../lib/api.ts';
import { clockTime, relativeTime, shortDate, useNow } from '../../lib/format.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { ChannelMark } from '../calendar/marks.tsx';
import { TemplatesSheet } from './TemplatesSheet.tsx';

/**
 * The Inbox (design roadmap, Phase 2, D2): one conversation per booking, whichever site the guest
 * booked on. The list on the left, the conversation on the right; on a phone, one at a time. A
 * reply goes back where the guest is: their Airbnb or Booking.com chat (through Channex, once
 * connected), or email for a direct guest. The response timer counts from the guest's last
 * unanswered message, the way the sites' own clocks do.
 */

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

const VIEWS: { id: ThreadView; label: string }[] = [
  { id: 'awaiting', label: 'Needs a reply' },
  { id: 'open', label: 'Open' },
  { id: 'all', label: 'Every booking' },
];

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const day = (iso: string) => DAY.format(new Date(`${iso}T12:00:00`));

function stayLine(t: Thread): string {
  const nights = nightsBetween(t.checkIn, t.checkOut);
  return `${day(t.checkIn)} to ${day(t.checkOut)} · ${nights} ${nights === 1 ? 'night' : 'nights'}`;
}

/** "Waiting 2 h", "Waiting 3 days": since the guest's last unanswered message. */
function waiting(since: string, now: number): { text: string; late: boolean } {
  const ms = now - Date.parse(since);
  const hours = ms / 3_600_000;
  if (hours < 1) return { text: `Waiting ${Math.max(1, Math.round(ms / 60_000))} min`, late: false };
  if (hours < 24) return { text: `Waiting ${Math.floor(hours)} h`, late: false };
  const days = Math.floor(hours / 24);
  return { text: `Waiting ${days} ${days === 1 ? 'day' : 'days'}`, late: true };
}

/** Where a reply to this guest goes, in words. */
function replyLine(t: Thread, via: 'email' | 'sms' | null): string {
  const first = t.guestName?.trim().split(/\s+/)[0] ?? 'the guest';
  if (!t.via) return `No way to reach ${first} yet: add an email or phone number on the booking.`;
  if (t.via === 'email' || t.via === 'sms') {
    const way = via ?? t.via;
    return way === 'email' ? `By email to ${t.guestEmail}` : `By text to ${t.guestPhone}`;
  }
  return `Into ${first}’s ${MESSAGE_VIA_LABELS[t.via]}`;
}

function ThreadRow({ t, active, now, onOpen }: { t: Thread; active: boolean; now: number; onOpen(): void }) {
  const wait = t.awaitingSince ? waiting(t.awaitingSince, now) : null;
  const unread = t.unread > 0;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the name inside is the link; this only widens its target
    <li
      onClick={onOpen}
      className={cx(
        'flex cursor-pointer gap-3 rounded-xl px-3 py-3 transition-colors',
        active ? 'bg-paper' : 'hover:bg-linen',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'mt-0.5 grid size-9 shrink-0 place-items-center rounded-full',
          unread ? 'bg-accent text-white' : 'bg-paper text-ink',
        )}
      >
        <ChannelMark channel={t.channel} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <Link
            to={`/inbox?thread=${t.id}`}
            onClick={(e) => e.stopPropagation()}
            className={cx('truncate text-[14.5px] text-ink', unread ? 'font-semibold' : 'font-medium')}
          >
            {t.guestName ?? 'Guest'}
          </Link>
          <span className={cx('shrink-0 text-[12px] tnum', unread ? 'text-ink' : 'text-mist')}>
            {t.lastMessageAt ? relativeTime(t.lastMessageAt, now) : day(t.checkIn)}
          </span>
        </div>
        <p className="truncate text-[12.5px] text-slate">
          {t.propertyName} · {stayLine(t)}
        </p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className={cx('truncate text-[13px]', unread ? 'text-ink' : 'text-slate')}>
            {t.lastMessage
              ? `${t.lastMessage.direction === 'out' ? 'You: ' : ''}${t.lastMessage.body}`
              : 'Nothing written yet'}
          </p>
          {wait ? (
            <span
              className={cx(
                'shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium tnum',
                wait.late ? 'bg-urgent/12 text-urgent' : 'bg-pending/15 text-ink',
              )}
            >
              {wait.text}
            </span>
          ) : unread ? (
            <span
              role="img"
              aria-label={`${t.unread} unread`}
              className="size-2 shrink-0 rounded-full bg-accent"
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** One message: the guest's on the left, ours on the right, with where it is and when it went. */
function Bubble({ m, guestFirst }: { m: Message; guestFirst: string }) {
  const ours = m.direction === 'out';
  const state =
    m.status === 'sent'
      ? `Sent by ${MESSAGE_VIA_LABELS[m.via]} · ${clockTime(m.sentAt ?? m.at)}`
      : m.status === 'queued'
        ? 'Sending…'
        : m.status === 'waiting'
          ? `Waiting · ${m.note ?? 'nothing to send it with yet'}`
          : m.status === 'failed'
            ? `Couldn’t send · ${m.note ?? 'the sender refused it'}`
            : `${guestFirst} · ${clockTime(m.at)}`;
  return (
    <div className={cx('flex flex-col gap-1', ours ? 'items-end' : 'items-start')}>
      {m.automatic ? (
        <span className="text-[11.5px] text-mist">Automatic · {m.templateName ?? 'message'}</span>
      ) : null}
      <div
        className={cx(
          'max-w-[min(85%,560px)] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed [overflow-wrap:anywhere]',
          ours ? 'rounded-br-md bg-ink text-canvas' : 'rounded-bl-md bg-paper text-ink',
        )}
      >
        {m.body}
      </div>
      <p
        className={cx(
          'text-[11.5px]',
          m.status === 'failed' ? 'text-urgent' : m.status === 'waiting' ? 'text-slate' : 'text-mist',
        )}
      >
        {ours && m.sentBy ? `${m.sentBy} · ` : ''}
        {state}
      </p>
    </div>
  );
}

function DayMark({ iso }: { iso: string }) {
  return (
    <div className="my-2 flex items-center gap-3 text-[11.5px] text-mist">
      <span className="h-px flex-1 bg-hairline" />
      {shortDate(iso)}
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

function Conversation({
  orgId,
  threadId,
  canWrite,
  onBack,
}: {
  orgId: string;
  threadId: string;
  canWrite: boolean;
  onBack(): void;
}) {
  const detail = useThread(orgId, threadId);
  const send = useSendMessage(orgId);
  const update = useUpdateThread(orgId);
  const templates = useMessageTemplates(orgId);
  const [body, setBody] = useState('');
  const [via, setVia] = useState<'email' | 'sms' | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const t = detail.data?.thread;
  const link = useGuestLink(
    orgId,
    t?.reservationId ?? null,
    canWrite && t?.reservationStatus === 'confirmed',
  );

  // Opening it counts the guest's messages as read.
  const unread = t?.unread ?? 0;
  const markRead = update.mutate;
  useEffect(() => {
    if (unread > 0 && canWrite) markRead({ threadId, read: true });
  }, [threadId, unread, canWrite, markRead]);

  const count = detail.data?.messages.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest message whenever one arrives
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count, threadId]);

  // A different conversation starts with an empty box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the thread id is the signal
  useEffect(() => {
    setBody('');
    setVia(null);
  }, [threadId]);

  if (detail.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }
  if (detail.error || !detail.data || !t) {
    return (
      <div className="p-6">
        <Notice tone="urgent">{explain(detail.error)}</Notice>
      </div>
    );
  }
  const first = t.guestName?.trim().split(/\s+/)[0] ?? 'Guest';
  const messages = detail.data.messages;
  const direct = t.via === 'email' || t.via === 'sms';
  const bothWays = direct && Boolean(t.guestEmail) && Boolean(t.guestPhone);
  const chosen = bothWays ? (via ?? t.via) : t.via;
  const ready = canWrite && Boolean(t.via) && body.trim().length > 0 && !send.isPending;
  const stayUrl = link.data ? `${window.location.origin}${link.data.path}` : null;
  const saved = (templates.data?.templates ?? []).filter((x) => x.trigger === 'manual');

  const submit = () => {
    if (!ready) return;
    send.mutate(
      { threadId, body: body.trim(), ...(bothWays && chosen ? { via: chosen as 'email' | 'sms' } : {}) },
      { onSuccess: () => setBody('') },
    );
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };
  const insert = (text: string) => {
    setBody((b) => (b.trim() ? `${b.replace(/\s+$/, '')}\n${text}` : text));
    box.current?.focus();
  };

  const rows: ({ kind: 'day'; iso: string } | { kind: 'message'; m: Message })[] = [];
  let lastDay = '';
  for (const m of messages) {
    const d = m.at.slice(0, 10);
    if (d !== lastDay) {
      rows.push({ kind: 'day', iso: m.at });
      lastDay = d;
    }
    rows.push({ kind: 'message', m });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-2 border-b border-hairline px-4 py-3 md:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={onBack} className="action -ml-2.5 mb-1 lg:hidden">
              <IconArrowLeft size={15} stroke={1.75} aria-hidden />
              All conversations
            </button>
            <h2 className="truncate font-semibold tracking-[-0.015em] text-[18px] leading-tight text-ink">
              {t.guestName ?? 'Guest'}
            </h2>
            <p className="mt-0.5 flex flex-col gap-x-2 text-[13px] text-slate sm:flex-row sm:flex-wrap sm:items-center">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="grid size-[18px] place-items-center rounded-full bg-accent">
                  <ChannelMark channel={t.channel} size={15} />
                </span>
                {CHANNEL_LABELS[t.channel]}
              </span>
              <span className="hidden sm:inline">·</span>
              <span>{t.propertyName}</span>
              <span className="hidden sm:inline">·</span>
              <span>{stayLine(t)}</span>
              {t.reservationStatus === 'cancelled' ? (
                <span className="rounded-full bg-urgent/12 px-2 py-0.5 text-[11.5px] text-urgent">
                  Cancelled
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link to={`/reservations/${t.reservationId}`} className="action">
              Booking
            </Link>
            {canWrite ? (
              <Button
                variant="quiet"
                onClick={() => update.mutate({ threadId, status: t.status === 'done' ? 'open' : 'done' })}
                disabled={update.isPending}
              >
                {t.status === 'done' ? (
                  'Reopen'
                ) : (
                  <>
                    <IconCheck size={15} stroke={1.75} aria-hidden />
                    Done
                  </>
                )}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 md:px-5">
        {rows.length === 0 ? (
          <p className="my-auto text-center text-[14px] text-slate">
            Nothing written yet. Say hello below, or let the automatic messages start the conversation.
          </p>
        ) : (
          rows.map((r) =>
            r.kind === 'day' ? (
              <DayMark key={`day-${r.iso}`} iso={r.iso} />
            ) : (
              <Bubble key={r.m.id} m={r.m} guestFirst={first} />
            ),
          )
        )}
        <div ref={end} />
      </div>

      {canWrite ? (
        <div className="border-t border-hairline px-4 py-3 md:px-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-slate">
            <span className={cx(!t.via && 'text-urgent')}>
              {replyLine(t, chosen as 'email' | 'sms' | null)}
            </span>
            {bothWays ? (
              <button
                type="button"
                onClick={() => setVia(chosen === 'email' ? 'sms' : 'email')}
                className="action -mr-2.5 !h-7 text-[12.5px]"
              >
                {chosen === 'email' ? 'Text instead' : 'Email instead'}
              </button>
            ) : null}
          </div>
          <textarea
            ref={box}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MESSAGE_MAX))}
            onKeyDown={onKey}
            rows={3}
            disabled={!t.via}
            placeholder={t.via ? `Write to ${first}…` : 'Add a way to reach the guest first.'}
            aria-label="Your message"
            className="w-full resize-y rounded-xl border border-edge bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink placeholder:text-mist focus:border-accent focus:outline-none disabled:bg-paper"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {stayUrl ? (
                <button type="button" onClick={() => insert(stayUrl)} className="action -ml-2.5">
                  <IconLink size={15} stroke={1.75} aria-hidden />
                  Stay link
                </button>
              ) : null}
              {saved.length ? (
                <Popover
                  title="Saved replies"
                  label="Saved replies"
                  icon={<IconTemplate size={15} stroke={1.75} aria-hidden className="shrink-0 text-slate" />}
                  buttonClassName="action"
                  panelClassName="w-[320px] p-1.5"
                >
                  {(close) => (
                    <ul className="flex max-h-[320px] flex-col overflow-y-auto">
                      {saved.map((s: MessageTemplate) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => {
                              insert(s.body);
                              close();
                            }}
                            className="w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-linen"
                          >
                            <span className="block text-[13.5px] font-medium text-ink">{s.name}</span>
                            <span className="line-clamp-2 text-[12.5px] text-slate">{s.body}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Popover>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-[11.5px] text-mist sm:inline">Ctrl + Enter sends</span>
              <Button variant="primary" onClick={submit} disabled={!ready}>
                <IconSend size={15} stroke={1.75} aria-hidden />
                Send
              </Button>
            </div>
          </div>
          {send.error ? (
            <div className="mt-2">
              <Notice tone="urgent">{explain(send.error)}</Notice>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** From a booking's page: finds its thread, then opens it. */
function OpenBooking({ orgId, reservationId }: { orgId: string; reservationId: string }) {
  const thread = useReservationThread(orgId, reservationId);
  const navigate = useNavigate();
  useEffect(() => {
    if (thread.data) navigate(`/inbox?thread=${thread.data.id}`, { replace: true });
  }, [thread.data, navigate]);
  if (thread.error) return <Notice tone="urgent">{explain(thread.error)}</Notice>;
  return (
    <div className="flex justify-center py-16">
      <Spinner size={24} />
    </div>
  );
}

export function InboxPage() {
  const { orgId, entry } = useCurrentWorkspace();
  const [params, setParams] = useSearchParams();
  const canWrite = can(entry.role, 'inbox.write');
  const manage = can(entry.role, 'inbox.manage');
  const view = (VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'open') as ThreadView;
  const q = params.get('q') ?? '';
  const threadId = params.get('thread');
  const booking = params.get('booking');
  const panel = params.get('panel');
  const now = useNow();
  const list = useThreads(orgId, { view, ...(q ? { q } : {}) });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key !== 'thread' && key !== 'panel' });
  };

  if (booking) return <OpenBooking orgId={orgId} reservationId={booking} />;

  const threads = list.data?.threads ?? [];
  const counts = list.data?.counts;

  return (
    <>
      <div className={cx(threadId && 'hidden lg:block')}>
        <PageHeader
          title="Inbox"
          description="Every guest’s conversation, whichever site they booked on. A reply goes back where the guest is."
          action={
            manage ? (
              <Button variant="quiet" onClick={() => setParam('panel', 'templates')}>
                Automatic messages
              </Button>
            ) : undefined
          }
        />
      </div>

      <div
        className={cx(
          '-mx-2 flex overflow-hidden rounded-2xl border border-hairline bg-canvas lg:h-[calc(100dvh-14rem)] lg:min-h-[520px]',
          // On a phone the open conversation takes the screen, so the box to write in stays at the bottom.
          threadId ? 'h-[calc(100dvh-6rem)]' : 'min-h-[560px]',
        )}
      >
        <section
          aria-label="Conversations"
          className={cx(
            'flex w-full min-w-0 flex-col lg:w-[360px] lg:shrink-0 lg:border-r lg:border-hairline',
            threadId && 'hidden lg:flex',
          )}
        >
          <div className="flex flex-col gap-2.5 border-b border-hairline px-3 pt-3 pb-3">
            <div role="tablist" className="flex flex-wrap gap-1">
              {VIEWS.map((v) => {
                const n = v.id === 'awaiting' ? counts?.awaiting : v.id === 'open' ? counts?.open : undefined;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={v.id === view}
                    onClick={() => setParam('view', v.id === 'open' ? null : v.id)}
                    className={cx(
                      'h-8 rounded-full px-3 text-[13px] transition-colors',
                      v.id === view ? 'bg-ink text-canvas' : 'text-ink hover:bg-linen',
                    )}
                  >
                    {v.label}
                    {n ? (
                      <span className={cx('ml-1.5 tnum', v.id === view ? 'text-canvas/70' : 'text-mist')}>
                        {n}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <label className="relative block">
              <IconSearch
                size={15}
                stroke={1.75}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mist"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setParam('q', e.target.value || null)}
                placeholder="Guest, property or code"
                aria-label="Find a conversation"
                className="h-9 w-full rounded-lg border border-hairline bg-canvas pr-3 pl-9 text-[13.5px] text-ink placeholder:text-mist focus:border-accent focus:outline-none"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {list.isPending ? (
              <div className="flex justify-center py-10">
                <Spinner size={22} />
              </div>
            ) : list.error ? (
              <div className="p-2">
                <Notice tone="urgent">{explain(list.error)}</Notice>
              </div>
            ) : threads.length === 0 ? (
              <p className="px-3 py-10 text-center text-[13.5px] leading-relaxed text-slate">
                {q
                  ? 'No conversation matches that.'
                  : view === 'awaiting'
                    ? 'Nobody is waiting. Every guest has an answer.'
                    : view === 'open'
                      ? 'Nothing open. A conversation appears here when a guest writes or an automatic message goes out; every booking is under Every booking.'
                      : 'No bookings yet, so no conversations.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {threads.map((t) => (
                  <ThreadRow
                    key={t.id}
                    t={t}
                    now={now}
                    active={t.id === threadId}
                    onOpen={() => setParam('thread', t.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-label="Conversation" className={cx('min-w-0 flex-1', !threadId && 'hidden lg:block')}>
          {threadId ? (
            <Conversation
              orgId={orgId}
              threadId={threadId}
              canWrite={canWrite}
              onBack={() => setParam('thread', null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState title="Pick a conversation">
                Open one on the left. Guests waiting for a reply come first.
              </EmptyState>
            </div>
          )}
        </section>
      </div>

      {panel === 'templates' && manage ? (
        <TemplatesSheet orgId={orgId} onClose={() => setParam('panel', null)} />
      ) : null}
    </>
  );
}
