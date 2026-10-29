import {
  IconCalendarOff,
  IconCalendarPlus,
  IconChecklist,
  IconHome,
  IconMessage,
  IconPlus,
  IconTool,
} from '@tabler/icons-react';
import { addDays, can, type Permission, todayIn } from '@v01/shared';
import { type ComponentType, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  ApiError,
  useChangeCalendar,
  useProperties,
  useReportDamage,
  useReservation,
  useReservations,
  useTasks,
  useTeam,
  useWorkspace,
} from '../lib/api.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';
import { NewBookingSheet } from '../pages/reservations/NewBookingSheet.tsx';
import { NewTaskSheet } from '../pages/tasks/TasksPage.tsx';
import { DateField } from './DateField.tsx';
import { SelectField, TextArea, TextField } from './fields.tsx';
import { Sheet } from './Sheet.tsx';
import { Button, Notice } from './ui.tsx';

/**
 * "New", in the top bar (Alpha, 29 Oct 2026, after Guesty's "Add new", "slightly different"): what
 * people make most comes first, each opens over the page they're on, and from a home's page or a
 * booking's page the home (and the day) is already filled in. N opens it; the underlined letter picks.
 * Only what the person's role allows is listed; the field team gets "Report damage".
 */

type Item = 'booking' | 'task' | 'block' | 'message' | 'damage' | 'property';

const ITEMS: {
  id: Item;
  label: string;
  key: string;
  Icon: ComponentType<{ size?: number; stroke?: number; 'aria-hidden'?: boolean }>;
  allowed: Permission | ((role: string) => boolean);
}[] = [
  { id: 'booking', label: 'Booking', key: 'b', Icon: IconCalendarPlus, allowed: 'reservations.write' },
  { id: 'task', label: 'Task', key: 't', Icon: IconChecklist, allowed: 'tasks.manage' },
  { id: 'block', label: 'Block dates', key: 'd', Icon: IconCalendarOff, allowed: 'calendar.write' },
  { id: 'message', label: 'Message a guest', key: 'm', Icon: IconMessage, allowed: 'inbox.write' },
  { id: 'damage', label: 'Report damage', key: 'r', Icon: IconTool, allowed: (role) => role === 'field' },
  { id: 'property', label: 'Property', key: 'p', Icon: IconHome, allowed: 'properties.write' },
];

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    Boolean(el.closest('dialog[open]'))
  );
}

/** The label with its shortcut letter underlined. */
function Keyed({ label, k }: { label: string; k: string }) {
  const i = label.toLowerCase().indexOf(k);
  if (i < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <span className="underline decoration-mist underline-offset-2">{label[i]}</span>
      {label.slice(i + 1)}
    </>
  );
}

export function NewMenu() {
  const { orgId, entry } = useCurrentWorkspace();
  const role = entry.role;
  const items = ITEMS.filter((i) =>
    typeof i.allowed === 'function' ? i.allowed(role) : can(role, i.allowed),
  );
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Item | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useWorkspace(orgId);
  const today = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London');

  // Where the person is: a home's page, or a booking's page.
  const onProperty = /^\/properties\/([^/]+)$/.exec(location.pathname)?.[1];
  const onBooking = /^\/reservations\/([^/]+)$/.exec(location.pathname)?.[1] ?? null;
  const booking = useReservation(orgId, onBooking);
  const here = onProperty && onProperty !== 'new' ? onProperty : (booking.data?.propertyId ?? undefined);
  const taskDay = onBooking && booking.data ? booking.data.checkOut : undefined;

  const pick = (id: Item) => {
    setOpen(false);
    if (id === 'property') navigate('/properties/new');
    else setSheet(id);
  };

  // N opens the menu from anywhere but a field; then a letter picks, Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || sheet) return;
      // The bar is drawn twice (phone header, desktop bar); only the one on screen answers keys.
      if (!box.current || box.current.offsetParent === null) return;
      const k = e.key.toLowerCase();
      if (!open && k === 'n' && items.length) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (open) {
        if (e.key === 'Escape') setOpen(false);
        const hit = items.find((i) => i.key === k);
        if (hit) {
          e.preventDefault();
          pick(hit.id);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  if (!items.length) return null;

  return (
    <>
      <div ref={box} className="relative">
        <button
          type="button"
          aria-label="New (N)"
          title="New (N)"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
          className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium transition-colors ${open ? 'bg-ink text-canvas' : 'bg-linen text-ink hover:bg-edge/40'}`}
        >
          <IconPlus size={17} stroke={2} aria-hidden />
          <span className="max-[559px]:hidden">New</span>
        </button>
        {open ? (
          <div
            role="menu"
            aria-label="New"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
              const at = all.indexOf(document.activeElement as HTMLElement);
              all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
            }}
            className="absolute right-0 top-11 z-40 w-[248px] overflow-hidden rounded-xl border border-hairline bg-canvas py-1.5 shadow-[0_12px_32px_-12px_rgb(21_24_27/0.25)]"
          >
            {here ? (
              <p className="px-4 pt-1.5 pb-2 text-[12px] text-slate">For this home, where it applies</p>
            ) : null}
            {items.map(({ id, label, key, Icon }) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                onClick={() => pick(id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] text-ink outline-none hover:bg-paper focus-visible:bg-paper"
              >
                <Icon size={18} stroke={1.75} aria-hidden />
                <span className="flex-1">
                  <Keyed label={label} k={key} />
                </span>
                <kbd className="rounded border border-hairline px-1.5 font-sans text-[11px] text-mist uppercase">
                  {key}
                </kbd>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {sheet === 'booking' ? (
        <NewBookingSheet today={today} propertyId={here} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'task' ? (
        <TaskFromMenu
          orgId={orgId}
          today={today}
          propertyId={here}
          dueOn={taskDay}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'block' ? (
        <BlockDatesSheet orgId={orgId} today={today} propertyId={here} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'message' ? <MessageGuestSheet orgId={orgId} onClose={() => setSheet(null)} /> : null}
      {sheet === 'damage' ? <ReportDamageSheet orgId={orgId} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function TaskFromMenu(props: {
  orgId: string;
  today: string;
  propertyId?: string;
  dueOn?: string;
  onClose(): void;
}) {
  const team = useTeam(props.orgId);
  return <NewTaskSheet {...props} team={team.data?.members ?? []} />;
}

/** Block nights on one home: free nights only; bookings stay where they are. */
function BlockDatesSheet({
  orgId,
  today,
  propertyId,
  onClose,
}: {
  orgId: string;
  today: string;
  propertyId?: string;
  onClose(): void;
}) {
  const properties = useProperties(orgId);
  const save = useChangeCalendar(orgId);
  const list = properties.data?.properties ?? [];
  const [home, setHome] = useState(propertyId ?? '');
  const [first, setFirst] = useState(today);
  const [last, setLast] = useState(addDays(today, 1));
  const [owner, setOwner] = useState(false);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const chosen = home || list[0]?.id || '';
  const ok =
    Boolean(chosen) && /^\d{4}-\d{2}-\d{2}$/.test(first) && /^\d{4}-\d{2}-\d{2}$/.test(last) && last >= first;
  const reason = note.trim() || (owner ? 'Owner staying' : '');
  return (
    <Sheet
      title="Block dates"
      onClose={onClose}
      busy={save.isPending}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              disabled={!ok || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    propertyIds: [chosen],
                    firstNight: first,
                    lastNight: last,
                    blocked: true,
                    ...(reason ? { blockReason: reason } : {}),
                  },
                  {
                    onSuccess: (r) =>
                      setDone(
                        r.blockedNights
                          ? `${r.blockedNights} ${r.blockedNights === 1 ? 'night' : 'nights'} blocked${r.takenNights ? `; ${r.takenNights} already booked or blocked, left as they were` : ''}.`
                          : 'Nothing to block: those nights were already booked or blocked.',
                      ),
                  },
                )
              }
            >
              Block
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <SelectField
          label="Property"
          value={chosen}
          onChange={setHome}
          options={list.map((p) => ({ value: p.id, label: p.name }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField label="First night" value={first} today={today} min={today} onChange={setFirst} />
          <DateField
            label="Last night"
            value={last}
            today={today}
            min={first}
            rangeFrom={first}
            onChange={setLast}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { v: false, label: 'Blocked' },
            { v: true, label: 'Owner staying' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={owner === o.v}
              onClick={() => setOwner(o.v)}
              className={`h-9 rounded-full border px-4 text-[13.5px] ${owner === o.v ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:bg-linen'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <TextField
          label="Note"
          value={note}
          onChange={setNote}
          max={200}
          placeholder={owner ? 'Owner staying' : 'Painting the bedroom'}
          hint="Shown on the calendar."
        />
        <p className="text-[13px] text-slate">
          Booked nights stay as they are; only free nights are blocked.
        </p>
        {save.error ? <Notice tone="urgent">{explain(save.error)}</Notice> : null}
        {done ? <Notice tone="done">{done}</Notice> : null}
      </div>
    </Sheet>
  );
}

/** Find a guest staying now or coming, and open their conversation in the Inbox. */
function MessageGuestSheet({ orgId, onClose }: { orgId: string; onClose(): void }) {
  const [q, setQ] = useState('');
  const list = useReservations(orgId, 'upcoming', q);
  const navigate = useNavigate();
  const rows = (list.data?.reservations ?? []).filter((r) => r.status !== 'cancelled').slice(0, 30);
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  const at = (d: string) => new Date(`${d}T12:00:00`);
  return (
    <Sheet title="Message a guest" subtitle="Staying now or coming" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <TextField
          label="Search"
          value={q}
          onChange={setQ}
          placeholder="Guest, home or booking code"
          autoComplete="off"
        />
        {list.isPending ? null : rows.length === 0 ? (
          <p className="text-[14px] text-slate">No guest matches.</p>
        ) : (
          <ul className="divide-y divide-hairline border-y border-hairline">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate(`/inbox?booking=${r.id}`);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-1 py-3 text-left hover:bg-paper"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] text-ink">{r.guestName ?? 'Guest'}</span>
                    <span className="block truncate text-[13px] text-slate">{r.propertyName}</span>
                  </span>
                  <span className="shrink-0 text-[13px] text-slate tnum">
                    {fmt.format(at(r.checkIn))} – {fmt.format(at(r.checkOut))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** For the field team: pick one of their open jobs and say what's broken; the office gets a task. */
function ReportDamageSheet({ orgId, onClose }: { orgId: string; onClose(): void }) {
  const tasks = useTasks(orgId, { view: 'open', mine: '1' });
  const jobs = tasks.data?.tasks ?? [];
  const [jobId, setJobId] = useState('');
  const chosen = jobId || jobs[0]?.id || '';
  return (
    <Sheet title="Report damage" subtitle="The office gets it as a job" onClose={onClose}>
      {tasks.isPending ? null : jobs.length === 0 ? (
        <p className="text-[14px] text-slate">
          You have no open jobs to report from. Damage is reported from a job.
        </p>
      ) : (
        <DamageForm
          key={chosen}
          orgId={orgId}
          taskId={chosen}
          jobs={jobs.map((j) => ({ value: j.id, label: `${j.propertyName} · ${j.title}` }))}
          onPick={setJobId}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function DamageForm({
  orgId,
  taskId,
  jobs,
  onPick,
  onClose,
}: {
  orgId: string;
  taskId: string;
  jobs: { value: string; label: string }[];
  onPick(id: string): void;
  onClose(): void;
}) {
  const report = useReportDamage(orgId, taskId);
  const [what, setWhat] = useState('');
  return (
    <div className="flex flex-col gap-5">
      <SelectField label="From the job" value={taskId} onChange={onPick} options={jobs} />
      <TextArea
        label="What’s damaged"
        value={what}
        onChange={setWhat}
        max={4000}
        rows={4}
        placeholder="The shower screen is cracked along the bottom edge."
      />
      {report.error ? <Notice tone="urgent">{explain(report.error)}</Notice> : null}
      {report.isSuccess ? <Notice tone="done">Sent. The office has it as a job.</Notice> : null}
      <div className="flex gap-2">
        {report.isSuccess ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!what.trim() || report.isPending}
            onClick={() => report.mutate({ what: what.trim() })}
          >
            Send report
          </Button>
        )}
      </div>
    </div>
  );
}
