import {
  CHANNEL_LABELS,
  type Channel,
  OPERATOR_STATUS_LABELS,
  type OperatorStatus,
  SUPPORT_DURATIONS,
  SupportAccessStartSchema,
  type SupportGrant,
} from '@v01/shared';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Notice, type Status, StatusDot } from '../../components/ui.tsx';
import { ApiError, useStartSupportAccess } from '../../lib/api.ts';
import { clockTime } from '../../lib/format.ts';
import { useWorkspaces } from '../../lib/workspace.tsx';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Loading({ children = 'Loading' }: { children?: ReactNode }) {
  return <p className="text-[14px] text-mist">{children}</p>;
}

export function LoadError({ error }: { error: unknown }) {
  return (
    <Notice tone="urgent">
      {error instanceof ApiError ? error.message : 'Could not load this. Try again shortly.'}
    </Notice>
  );
}

export function OperatorStatusDot({ status }: { status: OperatorStatus }) {
  return (
    <StatusDot status={status === 'live' ? 'done' : 'pending'}>{OPERATOR_STATUS_LABELS[status]}</StatusDot>
  );
}

/** One line about an operator's channel sync, coloured only when something needs a person. */
export function syncState(o: {
  propertiesOnV01: number;
  outboxWaiting: number;
  outboxFailed: number;
  webhooksFailed: number;
}): { status: Status; label: string } {
  const failed = o.outboxFailed + o.webhooksFailed;
  if (failed > 0) return { status: 'urgent', label: `${failed} failed` };
  if (o.propertiesOnV01 === 0) return { status: 'neutral', label: 'Not syncing yet' };
  if (o.outboxWaiting > 0) return { status: 'pending', label: `${o.outboxWaiting} waiting` };
  return { status: 'done', label: 'In sync' };
}

export function SyncStateDot(props: Parameters<typeof syncState>[0]) {
  const { status, label } = syncState(props);
  return <StatusDot status={status}>{label}</StatusDot>;
}

/** Channels are named in a badge, never given a colour (design roadmap, principle 5). */
export function ChannelBadges({ channels }: { channels: Channel[] }) {
  if (channels.length === 0) return <span className="text-mist">None connected</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {channels.map((c) => (
        <Badge key={c}>{CHANNEL_LABELS[c]}</Badge>
      ))}
    </span>
  );
}

export function GrantStatus({ grant, now }: { grant: SupportGrant; now: number }) {
  if (grant.active && Date.parse(grant.expiresAt) > now) {
    return <StatusDot status="pending">Open until {clockTime(grant.expiresAt)}</StatusDot>;
  }
  return <StatusDot status="neutral">{grant.endedAt ? 'Ended' : 'Timed out'}</StatusDot>;
}

/** Steps into an operator's workspace: chooses it, then opens Today. */
export function useOpenWorkspace() {
  const { choose } = useWorkspaces();
  const navigate = useNavigate();
  return (orgId: string) => {
    choose(orgId);
    navigate('/today');
  };
}

export const tableHead = 'border-b border-hairline text-[12.5px] text-mist';
export const th = 'py-2.5 pr-4 text-left font-normal';
export const td = 'py-3 pr-4 align-middle';

/**
 * Asks why before opening an operator's workspace. The operator can read the reason,
 * the access is read-only, and it closes by itself.
 */
export function SupportAccessDialog({
  operator,
  onClose,
}: {
  operator: { id: string; name: string };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useStartSupportAccess(operator.id);
  const open = useOpenWorkspace();
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const minutesId = useId();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = SupportAccessStartSchema.safeParse({ reason, minutes });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the reason and the length of time.');
      return;
    }
    try {
      await start.mutateAsync(parsed.data);
      dialog.current?.close();
      open(operator.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open support access.');
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby={`${reasonId}-title`}
      className="m-auto w-[calc(100%-2rem)] max-w-[480px] rounded-xl border border-hairline bg-canvas p-0 text-ink"
    >
      <form onSubmit={submit} className="flex flex-col gap-5 p-6" noValidate>
        <div>
          <h2 id={`${reasonId}-title`} className="font-serif text-[24px] leading-tight font-normal">
            Open {operator.name}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-slate">
            You'll see their workspace read-only. {operator.name} can see who opened it, why, and for how
            long. Access closes by itself.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={reasonId} className="text-[13px] text-slate">
            Reason
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Ticket 142: guest says the booking for 12 Nov is missing"
            className="rounded-md border border-edge bg-white px-3 py-2 text-[14px] leading-relaxed text-ink placeholder:text-mist focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={minutesId} className="text-[13px] text-slate">
            For
          </label>
          <select
            id={minutesId}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="h-9 rounded-md border border-edge bg-white px-2.5 text-[14px] text-ink focus:border-accent focus:outline-none"
          >
            {SUPPORT_DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-urgent">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={start.isPending}>
            {start.isPending ? 'Opening' : 'Open workspace'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
