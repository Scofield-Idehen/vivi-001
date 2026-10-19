import { Link } from 'react-router';
import { PageHeader, SectionHeading, StatusDot } from '../../components/ui.tsx';
import { useConsoleSync } from '../../lib/api.ts';
import { dateTime, number, relativeTime, useNow } from '../../lib/format.ts';
import { cx, LoadError, Loading, tableHead, td, th } from './parts.tsx';

const SOURCE_LABELS = {
  outbox: 'Price or availability update',
  webhook: 'Channel message',
} as const;

/** "40 minutes", "3 hours", "2 days": a gap, in the largest unit that fits. */
function gapWords(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function Count({ value, urgent }: { value: number; urgent?: boolean }) {
  if (value === 0) return <span className="text-mist">0</span>;
  return <span className={urgent ? 'font-medium text-urgent' : 'text-ink'}>{number(value)}</span>;
}

export function ConsoleSync() {
  const sync = useConsoleSync();
  const now = useNow();

  if (sync.isPending) return <Loading>Loading sync health</Loading>;
  if (sync.error) return <LoadError error={sync.error} />;
  const { worker, rows, errors } = sync.data;
  const seenAgoMs = worker.lastSeenAt ? now - Date.parse(worker.lastSeenAt) : null;

  return (
    <>
      <PageHeader
        title="Sync health"
        description="What is waiting to go out to the channels, and what has come in from them, for every operator. Refreshed every 30 seconds."
      />

      <section aria-labelledby="the-worker" className="mb-10">
        <SectionHeading id="the-worker">The worker</SectionHeading>
        <div className="flex flex-col gap-2 rounded-xl bg-paper px-4 py-3.5 text-[14px]">
          {worker.lastSeenAt === null ? (
            <StatusDot status="neutral">The worker hasn’t run yet.</StatusDot>
          ) : worker.recovering ? (
            <StatusDot status="pending">
              Back after a gap and saving the bookings that arrived meanwhile. Nothing goes out to the
              channels until that is done.
            </StatusDot>
          ) : seenAgoMs !== null && seenAgoMs > 3 * 60_000 ? (
            <StatusDot status="urgent">
              Not seen for {relativeTime(worker.lastSeenAt, now)}. Channex keeps closing booked nights itself
              meanwhile; when the worker is back it saves those bookings before sending anything.
            </StatusDot>
          ) : (
            <StatusDot status="done">
              Running, last seen {relativeTime(worker.lastSeenAt, now)}
              {worker.startedAt ? `; started ${dateTime(worker.startedAt)}` : ''}.
            </StatusDot>
          )}
          {worker.lastRecovery ? (
            <p className="text-[13px] text-slate">
              Last recovery {dateTime(worker.lastRecovery.at)}: back after{' '}
              {gapWords(worker.lastRecovery.gapSeconds)}, {number(worker.lastRecovery.drained)} booking{' '}
              {worker.lastRecovery.drained === 1 ? 'change' : 'changes'} saved before anything was sent.
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="by-operator">
        <SectionHeading id="by-operator">By operator</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13.5px]">
            <thead>
              <tr className={tableHead}>
                <th scope="col" className={th}>
                  Operator
                </th>
                <th scope="col" className={cx(th, 'text-right')}>
                  Waiting to send
                </th>
                <th scope="col" className={cx(th, 'text-right')}>
                  Failed to send
                </th>
                <th scope="col" className={th}>
                  Last sent
                </th>
                <th scope="col" className={cx(th, 'text-right')}>
                  Messages waiting
                </th>
                <th scope="col" className={cx(th, 'text-right')}>
                  Failed to process
                </th>
                <th scope="col" className={cx(th, 'pr-0')}>
                  Last message in
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((r) => (
                <tr key={r.organisationId ?? 'unmatched'}>
                  <td className={td}>
                    {r.organisationId ? (
                      <Link
                        to={`/console/operators/${r.organisationId}`}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {r.organisationName}
                      </Link>
                    ) : (
                      <span className="text-slate">Not matched to an operator</span>
                    )}
                  </td>
                  <td className={cx(td, 'tnum text-right')}>
                    <Count value={r.outboxWaiting} />
                    {r.oldestWaitingAt ? (
                      <div className="text-[12px] text-mist">
                        oldest {relativeTime(r.oldestWaitingAt, now)}
                      </div>
                    ) : null}
                  </td>
                  <td className={cx(td, 'tnum text-right')}>
                    <Count value={r.outboxFailed} urgent />
                  </td>
                  <td className={cx(td, 'text-slate')}>
                    {r.lastSentAt ? relativeTime(r.lastSentAt, now) : '—'}
                  </td>
                  <td className={cx(td, 'tnum text-right')}>
                    <Count value={r.webhooksWaiting} />
                  </td>
                  <td className={cx(td, 'tnum text-right')}>
                    <Count value={r.webhooksFailed} urgent />
                  </td>
                  <td className={cx(td, 'pr-0 text-slate')}>
                    {r.lastWebhookAt ? relativeTime(r.lastWebhookAt, now) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="problems" className="mt-10">
        <SectionHeading id="problems">Recent problems</SectionHeading>
        {errors.length === 0 ? (
          <p className="border-y border-hairline py-3 text-[14px]">
            <StatusDot status="done">No sync problems</StatusDot>
          </p>
        ) : (
          <ul className="divide-y divide-hairline border-y border-hairline">
            {errors.map((e) => (
              <li
                key={`${e.source}-${e.at}-${e.organisationId ?? 'none'}`}
                className="flex flex-col gap-1.5 py-3 text-[13.5px]"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <StatusDot status="urgent">{SOURCE_LABELS[e.source]}</StatusDot>
                  <span className="text-slate">{e.organisationName ?? 'Not matched to an operator'}</span>
                  <span className="text-mist">
                    {dateTime(e.at)} · {e.attempts} {e.attempts === 1 ? 'attempt' : 'attempts'}
                  </span>
                </span>
                <span className="pl-[15px] font-mono text-[12.5px] leading-relaxed break-words text-slate">
                  {e.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
