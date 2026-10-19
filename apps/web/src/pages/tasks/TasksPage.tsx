import {
  IconAlertTriangle,
  IconCamera,
  IconCheck,
  IconEyeglass,
  IconSparkles,
  IconTool,
  IconX,
  type TablerIcon,
} from '@tabler/icons-react';
import {
  can,
  TASK_KIND_LABELS,
  TASK_KINDS,
  type Task,
  type TaskKind,
  type TaskView,
  type TeamMember,
} from '@v01/shared';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SelectField, TextArea, TextField, Toggle } from '../../components/fields.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, Notice, PageHeader, type Status, StatusDot } from '../../components/ui.tsx';
import {
  ApiError,
  useAddTaskPhotos,
  useCreateTask,
  useProperties,
  useRemoveTaskPhoto,
  useReportDamage,
  useTask,
  useTasks,
  useTaskTemplates,
  useTeam,
  useUpdateTask,
  useUpdateTaskTemplate,
} from '../../lib/api.ts';
import { plural, shortDate } from '../../lib/format.ts';
import { PHOTO_ACCEPT } from '../../lib/images.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

const KIND_ICON: Record<TaskKind, TablerIcon> = {
  cleaning: IconSparkles,
  maintenance: IconTool,
  inspection: IconEyeglass,
};

const STATUS_DOT: Record<Task['status'], Status> = {
  open: 'neutral',
  in_progress: 'pending',
  done: 'done',
  cancelled: 'neutral',
};

/** "Today", "Tomorrow", "Thu 22 Oct". */
function dayWord(day: string, today: string): string {
  if (day === today) return 'Today';
  const diff = Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < -1) return `${-diff} days ago`;
  const date = new Date(`${day}T12:00:00`);
  return `${new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(date)} ${shortDate(`${day}T12:00:00`)}`;
}

/** The one line under a task's title: when it has to be done by, and what's around it. */
function whenLine(t: Task): string {
  const parts: string[] = [];
  if (t.dueTime) parts.push(`by ${t.dueTime}`);
  if (t.guestLeavesAt) parts.push(`guest leaves ${t.guestLeavesAt}`);
  if (t.nextArrivalAt) parts.push(`next guest ${t.nextArrivalAt}`);
  return parts.join(' · ');
}

function progress(t: Task): string | null {
  if (t.checklist.length === 0) return null;
  const done = t.checklist.filter((c) => c.done).length;
  return `${done} of ${t.checklist.length}`;
}

/** One task in the list: the whole card is the click target. */
function TaskCard({ t, today, onOpen, crew }: { t: Task; today: string; onOpen(): void; crew: boolean }) {
  const Icon = KIND_ICON[t.kind];
  const late = t.status !== 'done' && t.status !== 'cancelled' && t.dueOn < today;
  const steps = progress(t);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the title inside is the button; this only widens its target
    <li
      onClick={onOpen}
      className={cx(
        'flex cursor-pointer gap-3.5 rounded-2xl border border-hairline bg-canvas px-4 transition-colors hover:bg-linen',
        crew ? 'py-4' : 'py-3',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full',
          t.status === 'done' ? 'bg-done/15 text-done' : 'bg-paper text-ink',
        )}
      >
        {t.status === 'done' ? <IconCheck size={18} stroke={2} /> : <Icon size={18} stroke={1.75} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cx(
              'truncate text-ink',
              crew ? 'text-[16px] font-medium' : 'text-[14.5px] font-medium',
            )}
          >
            <button type="button" onClick={onOpen} className="text-left">
              {t.propertyName}
            </button>
          </p>
          {steps && t.status !== 'done' ? (
            <span className="shrink-0 text-[12.5px] text-mist tnum">{steps}</span>
          ) : null}
        </div>
        <p className={cx('truncate', crew ? 'text-[14px] text-slate' : 'text-[13.5px] text-slate')}>
          {t.title}
          {whenLine(t) ? <span className="text-mist"> · {whenLine(t)}</span> : null}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]">
          <StatusDot status={late ? 'urgent' : STATUS_DOT[t.status]}>
            <span className={late ? 'text-urgent' : 'text-slate'}>
              {t.status === 'done'
                ? `Done${t.doneBy ? ` by ${t.doneBy}` : ''}`
                : t.status === 'in_progress'
                  ? 'Started'
                  : late
                    ? `Due ${dayWord(t.dueOn, today).toLowerCase()}`
                    : 'To do'}
            </span>
          </StatusDot>
          {!crew ? (
            <span className="text-mist">{t.assignee ? t.assignee.name : 'Nobody assigned'}</span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

/** Looking at one task: tick the list, start, finish; the office also moves and assigns it. */
function TaskSheet({
  taskId,
  orgId,
  office,
  team,
  onClose,
}: {
  taskId: string;
  orgId: string;
  office: boolean;
  team: TeamMember[];
  onClose(): void;
}) {
  const task = useTask(orgId, taskId);
  const update = useUpdateTask(orgId);
  const [notes, setNotes] = useState<string | null>(null);
  const t = task.data;
  const patch = (body: Parameters<typeof update.mutate>[0] extends infer P ? Omit<P, 'taskId'> : never) =>
    update.mutate({ taskId, ...body });
  const tick = (i: number) => {
    if (!t) return;
    patch({ checklist: t.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c)) });
  };
  const live = t && t.status !== 'done' && t.status !== 'cancelled';

  return (
    <Sheet
      title={t ? t.title : 'Task'}
      subtitle={t ? `${t.propertyName} · ${TASK_KIND_LABELS[t.kind]}` : undefined}
      onClose={onClose}
      busy={update.isPending}
      footer={
        t ? (
          <>
            {live ? (
              <Button
                variant="primary"
                className="!h-11 flex-1 sm:flex-none sm:!px-6"
                disabled={update.isPending}
                onClick={() => patch({ status: 'done', ...(notes !== null ? { notes } : {}) })}
              >
                Mark done
              </Button>
            ) : t.status === 'done' ? (
              <Button
                variant="secondary"
                disabled={update.isPending}
                onClick={() => patch({ status: 'open' })}
              >
                Reopen
              </Button>
            ) : null}
            {live && t.status === 'open' ? (
              <Button
                variant="secondary"
                className="!h-11"
                disabled={update.isPending}
                onClick={() => patch({ status: 'in_progress' })}
              >
                Start
              </Button>
            ) : null}
            {office && live ? (
              <Button
                variant="quiet"
                disabled={update.isPending}
                onClick={() => patch({ status: 'cancelled' })}
              >
                Cancel task
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {task.isPending ? (
        <span className="inline-flex items-center gap-2 text-[14px] text-slate">
          <Spinner size={16} /> Loading
        </span>
      ) : task.error || !t ? (
        <Notice tone="urgent">{explain(task.error)}</Notice>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl bg-paper px-4 py-3 text-[14px] leading-relaxed text-ink">
            <p>
              <Link to={`/properties/${t.propertyId}`} className="font-medium">
                {t.propertyName}
              </Link>
            </p>
            <p className="text-slate">
              {dayWord(t.dueOn, new Date().toISOString().slice(0, 10))}
              {t.dueTime ? `, by ${t.dueTime}` : ''}
              {t.guestLeavesAt ? ` · guest leaves ${t.guestLeavesAt}` : ''}
              {t.nextArrivalAt ? ` · next guest arrives ${t.nextArrivalAt}` : ''}
            </p>
            <p className="text-slate">
              {t.assignee ? t.assignee.name : 'Nobody assigned yet'}
              {t.status === 'done' && t.doneBy ? ` · done by ${t.doneBy}` : ''}
            </p>
          </div>

          {t.checklist.length ? (
            <section>
              <h3 className="mb-2 text-[13px] text-slate">Checklist · {progress(t)}</h3>
              <ul className="divide-y divide-hairline rounded-xl border border-hairline">
                {t.checklist.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: items have no id and two can read the same
                  <li key={`${i}-${c.text}`}>
                    <label className="flex cursor-pointer items-center gap-3.5 px-4 py-3 text-[15px] text-ink hover:bg-linen">
                      <input
                        type="checkbox"
                        checked={c.done}
                        disabled={!live || update.isPending}
                        onChange={() => tick(i)}
                        className="size-5 shrink-0 accent-ink"
                      />
                      <span className={c.done ? 'text-mist line-through' : ''}>{c.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <TextArea
            label="Notes"
            value={notes ?? t.notes ?? ''}
            onChange={setNotes}
            max={4000}
            rows={3}
            placeholder="Anything the office should know: what you found, what's left."
          />
          {notes !== null && notes !== (t.notes ?? '') ? (
            <div className="-mt-3">
              <Button variant="secondary" disabled={update.isPending} onClick={() => patch({ notes })}>
                Save notes
              </Button>
            </div>
          ) : null}

          <TaskPhotos t={t} orgId={orgId} live={Boolean(live)} />

          {live ? <ReportDamage t={t} orgId={orgId} /> : null}

          {office ? (
            <section className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Day"
                value={t.dueOn}
                onChange={(v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && patch({ dueOn: v })}
              />
              <TextField
                label="By (time)"
                value={t.dueTime ?? ''}
                placeholder="15:00"
                onChange={(v) =>
                  v === ''
                    ? patch({ dueTime: null })
                    : /^([01]\d|2[0-3]):[0-5]\d$/.test(v) && patch({ dueTime: v })
                }
              />
              <SelectField
                label="Assigned to"
                value={t.assignee?.id ?? ''}
                onChange={(v) => patch({ assigneeId: v || null })}
                options={[
                  { value: '', label: 'Nobody yet' },
                  ...team.map((m) => ({ value: m.id, label: m.name })),
                ]}
              />
            </section>
          ) : null}

          {update.error ? <Notice tone="urgent">{explain(update.error)}</Notice> : null}
        </div>
      )}
    </Sheet>
  );
}

/** The crew's photos on a job: proof of a clean, or what they found. Big targets; the camera on a phone. */
function TaskPhotos({ t, orgId, live }: { t: Task; orgId: string; live: boolean }) {
  const add = useAddTaskPhotos(orgId, t.id);
  const remove = useRemoveTaskPhoto(orgId, t.id);
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  return (
    <section>
      <h3 className="mb-2 text-[13px] text-slate">Photos{t.photos.length ? ` · ${t.photos.length}` : ''}</h3>
      <div className="flex flex-wrap gap-2">
        {t.photos.map((p) => (
          <figure key={p.id} className="relative size-24 overflow-hidden rounded-xl bg-paper">
            <img src={p.url} alt="" className="size-full object-cover" />
            {live ? (
              <button
                type="button"
                aria-label="Remove photo"
                disabled={remove.isPending}
                onClick={() => remove.mutate(p.id)}
                className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full bg-ink/70 text-canvas hover:bg-ink"
              >
                <IconX size={14} stroke={2} />
              </button>
            ) : null}
          </figure>
        ))}
        {live ? (
          <button
            type="button"
            disabled={add.isPending}
            onClick={() => input.current?.click()}
            className="inline-flex size-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-hairline text-[12.5px] text-slate hover:bg-linen disabled:opacity-50"
          >
            {add.isPending ? <Spinner size={18} /> : <IconCamera size={22} stroke={1.5} aria-hidden />}
            {add.isPending ? 'Adding' : 'Add photo'}
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) add.mutate(files, { onSuccess: (r) => setProblems(r.problems) });
        }}
      />
      {problems.length ? (
        <p role="alert" className="mt-2 text-[12.5px] text-urgent">
          {problems.join(' ')}
        </p>
      ) : null}
    </section>
  );
}

/** From a job, the crew tells the office what's broken; it becomes a maintenance task to assign. */
function ReportDamage({ t, orgId }: { t: Task; orgId: string }) {
  const report = useReportDamage(orgId, t.id);
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState('');
  if (report.isSuccess) {
    return (
      <StatusDot status="done">
        Reported. The office will see it as a maintenance job at {t.propertyName}.
      </StatusDot>
    );
  }
  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <IconAlertTriangle size={16} stroke={1.75} aria-hidden />
          Report damage
        </Button>
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-hairline p-4">
      <TextArea
        label="What's wrong?"
        value={what}
        onChange={setWhat}
        max={4000}
        rows={3}
        placeholder="What it is and where: the shower screen is cracked along the bottom edge."
      />
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={!what.trim() || report.isPending}
          onClick={() => report.mutate({ what: what.trim() })}
        >
          Send to the office
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {report.error ? <Notice tone="urgent">{explain(report.error)}</Notice> : null}
    </section>
  );
}

/** Making a task by hand. */
function NewTaskSheet({
  orgId,
  team,
  today,
  onClose,
}: {
  orgId: string;
  team: TeamMember[];
  today: string;
  onClose(): void;
}) {
  const properties = useProperties(orgId);
  const templates = useTaskTemplates(orgId);
  const create = useCreateTask(orgId);
  const [propertyId, setPropertyId] = useState('');
  const [kind, setKind] = useState<TaskKind>('cleaning');
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState(today);
  const [dueTime, setDueTime] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [notes, setNotes] = useState('');
  const template = templates.data?.templates.find((x) => x.kind === kind);
  const list = properties.data?.properties ?? [];
  const chosen = propertyId || list[0]?.id || '';
  const ready =
    Boolean(chosen) &&
    /^\d{4}-\d{2}-\d{2}$/.test(dueOn) &&
    (dueTime === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime));

  return (
    <Sheet
      title="New task"
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
                  kind,
                  ...(title.trim() ? { title: title.trim() } : {}),
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                  dueOn,
                  ...(dueTime ? { dueTime } : {}),
                  assigneeId: assigneeId || null,
                },
                { onSuccess: onClose },
              )
            }
          >
            Add task
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
        <div className="flex flex-wrap gap-2">
          {TASK_KINDS.map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={k === kind}
                className={cx(
                  'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13.5px]',
                  k === kind ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:bg-linen',
                )}
              >
                <Icon size={16} stroke={1.75} aria-hidden />
                {TASK_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
        <TextField
          label="Title"
          value={title}
          onChange={setTitle}
          max={120}
          placeholder={template?.title ?? ''}
          hint="Left empty, the kind's usual title is used."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Day" value={dueOn} onChange={setDueOn} hint="2026-11-05" />
          <TextField
            label="By (time)"
            value={dueTime}
            onChange={setDueTime}
            placeholder="15:00"
            hint="Leave empty for by the end of the day."
          />
        </div>
        <SelectField
          label="Assigned to"
          value={assigneeId}
          onChange={setAssigneeId}
          options={[
            { value: '', label: 'Nobody yet; anyone on the crew can take it' },
            ...team.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
        <TextArea
          label="Notes"
          value={notes}
          onChange={setNotes}
          max={4000}
          rows={3}
          placeholder="What needs doing, and anything to watch for."
        />
        {template?.checklist.length ? (
          <div className="rounded-xl bg-paper px-4 py-3 text-[13px] text-slate">
            <p className="mb-1 text-ink">Checklist it starts with ({template.checklist.length})</p>
            <p className="leading-relaxed">{template.checklist.join(' · ')}</p>
          </div>
        ) : null}
        {create.error ? <Notice tone="urgent">{explain(create.error)}</Notice> : null}
      </div>
    </Sheet>
  );
}

/** What each kind of task starts with, and whether the clean is made at every check-out. */
function TemplatesSheet({ orgId, onClose }: { orgId: string; onClose(): void }) {
  const templates = useTaskTemplates(orgId);
  const update = useUpdateTaskTemplate(orgId);
  const [drafts, setDrafts] = useState<Record<string, { title: string; checklist: string }>>({});
  return (
    <Sheet
      title="Task settings"
      subtitle="What each kind of task starts with"
      onClose={onClose}
      busy={update.isPending}
    >
      {templates.isPending ? (
        <span className="inline-flex items-center gap-2 text-[14px] text-slate">
          <Spinner size={16} /> Loading
        </span>
      ) : (
        <div className="flex flex-col gap-8">
          {templates.data?.templates.map((tpl) => {
            const draft = drafts[tpl.kind] ?? { title: tpl.title, checklist: tpl.checklist.join('\n') };
            const changed = draft.title !== tpl.title || draft.checklist !== tpl.checklist.join('\n');
            const set = (patch: Partial<typeof draft>) =>
              setDrafts((d) => ({ ...d, [tpl.kind]: { ...draft, ...patch } }));
            return (
              <section key={tpl.kind} className="flex flex-col gap-4">
                <h3 className="text-[15px] font-medium text-ink">{TASK_KIND_LABELS[tpl.kind]}</h3>
                {tpl.kind === 'cleaning' ? (
                  <div className="-my-2">
                    <Toggle
                      label="A clean at every check-out"
                      description="The worker makes one for each booking, due by the next guest's arrival, assigned to the property's usual cleaner."
                      checked={tpl.automatic}
                      onChange={(automatic) => update.mutate({ kind: tpl.kind, automatic })}
                    />
                  </div>
                ) : null}
                <TextField label="Title" value={draft.title} onChange={(title) => set({ title })} max={120} />
                <TextArea
                  label="Checklist, one line each"
                  value={draft.checklist}
                  onChange={(checklist) => set({ checklist })}
                  max={8000}
                  rows={6}
                />
                {changed ? (
                  <div>
                    <Button
                      variant="secondary"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          kind: tpl.kind,
                          title: draft.title.trim() || tpl.title,
                          checklist: draft.checklist
                            .split('\n')
                            .map((l) => l.trim())
                            .filter(Boolean),
                        })
                      }
                    >
                      Save {TASK_KIND_LABELS[tpl.kind].toLowerCase()}
                    </Button>
                  </div>
                ) : null}
              </section>
            );
          })}
          {update.error ? <Notice tone="urgent">{explain(update.error)}</Notice> : null}
        </div>
      )}
    </Sheet>
  );
}

const VIEWS: { id: TaskView; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Next two weeks' },
  { id: 'open', label: 'All open' },
  { id: 'done', label: 'Done' },
];

/**
 * Tasks (design roadmap, Phase 2). The office sees every job, filters by property and person,
 * makes and assigns. The field team sees "My jobs": theirs and anyone's to take, on a phone,
 * with big targets and no filters.
 */
export function TasksPage() {
  const { orgId, entry } = useCurrentWorkspace();
  const [params, setParams] = useSearchParams();
  const crew = entry.role === 'field';
  const office = can(entry.role, 'tasks.manage');
  const view = (VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'today') as TaskView;
  const propertyId = params.get('property') ?? undefined;
  const assigneeId = params.get('person') ?? undefined;
  const open = params.get('task');
  const panel = params.get('panel');

  const list = useTasks(orgId, { view, propertyId, assigneeId });
  const team = useTeam(orgId);
  const properties = useProperties(office ? orgId : null);
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key !== 'task' && key !== 'panel' });
  };

  const today = list.data?.today ?? new Date().toISOString().slice(0, 10);
  const tasks = list.data?.tasks ?? [];
  const counts = list.data?.counts;
  const groups = new Map<string, Task[]>();
  for (const t of tasks) groups.set(t.dueOn, [...(groups.get(t.dueOn) ?? []), t]);

  return (
    <>
      <PageHeader
        title={crew ? 'My jobs' : 'Tasks'}
        description={
          crew
            ? 'Your jobs, and any nobody has taken yet. Open one to see the checklist; mark it done when it is.'
            : 'Cleans, maintenance and inspections for the field team. A clean is made at every check-out.'
        }
        action={
          office ? (
            <div className="flex items-center gap-3">
              <Button variant="quiet" onClick={() => setParam('panel', 'settings')}>
                Task settings
              </Button>
              <Button variant="primary" onClick={() => setParam('panel', 'new')}>
                New task
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div role="tablist" className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => {
            const n =
              v.id === 'today'
                ? counts?.today
                : v.id === 'upcoming'
                  ? counts?.upcoming
                  : v.id === 'open'
                    ? counts?.open
                    : undefined;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={v.id === view}
                onClick={() => setParam('view', v.id === 'today' ? null : v.id)}
                className={cx(
                  'h-9 rounded-full px-3.5 text-[13.5px] transition-colors',
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
        {office ? (
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Property"
              value={propertyId ?? ''}
              onChange={(e) => setParam('property', e.target.value || null)}
              className="h-9 rounded-lg border border-hairline bg-canvas px-2.5 text-[13.5px] text-ink"
            >
              <option value="">Every property</option>
              {(properties.data?.properties ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Person"
              value={assigneeId ?? ''}
              onChange={(e) => setParam('person', e.target.value || null)}
              className="h-9 rounded-lg border border-hairline bg-canvas px-2.5 text-[13.5px] text-ink"
            >
              <option value="">Everyone</option>
              {(team.data?.members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {list.isPending ? (
        <span className="inline-flex items-center gap-2 text-[14px] text-slate">
          <Spinner size={16} /> Loading tasks
        </span>
      ) : list.error ? (
        <Notice tone="urgent">{explain(list.error)}</Notice>
      ) : tasks.length === 0 ? (
        <p className="max-w-[56ch] text-[14.5px] leading-relaxed text-slate">
          {view === 'today'
            ? crew
              ? 'Nothing for you today.'
              : 'Nothing due today. Cleans appear here as check-outs come up.'
            : view === 'done'
              ? 'Nothing finished in the last 30 days.'
              : 'Nothing here.'}
        </p>
      ) : (
        <div className="flex max-w-[760px] flex-col gap-6">
          {[...groups.entries()].map(([day, items]) => (
            <section key={day} aria-label={dayWord(day, today)}>
              <h2
                className={cx(
                  'mb-2 text-[13px]',
                  day < today && view !== 'done' ? 'text-urgent' : 'text-slate',
                )}
              >
                {dayWord(day, today)} · {plural(items.length, 'job')}
              </h2>
              <ul className="flex flex-col gap-2">
                {items.map((t) => (
                  <TaskCard
                    key={t.id}
                    t={t}
                    today={today}
                    crew={crew}
                    onOpen={() => setParam('task', t.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {open ? (
        <TaskSheet
          taskId={open}
          orgId={orgId}
          office={office}
          team={team.data?.members ?? []}
          onClose={() => setParam('task', null)}
        />
      ) : null}
      {panel === 'new' && office ? (
        <NewTaskSheet
          orgId={orgId}
          team={team.data?.members ?? []}
          today={today}
          onClose={() => setParam('panel', null)}
        />
      ) : null}
      {panel === 'settings' && office ? (
        <TemplatesSheet orgId={orgId} onClose={() => setParam('panel', null)} />
      ) : null}
    </>
  );
}
