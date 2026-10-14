import { IconChevronRight } from '@tabler/icons-react';
import type { ConsoleOperator, ConsoleSync, ConsoleOverview as Overview } from '@v01/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader, SectionHeading, Stat, type Status, StatusDot } from '../../components/ui.tsx';
import { useConsoleOperators, useConsoleOverview, useConsoleSync } from '../../lib/api.ts';
import { number, plural, relativeTime, useNow, V01 } from '../../lib/format.ts';
import { LoadError, Loading, OperatorStatusDot, SyncStateDot } from './parts.tsx';

interface Attention {
  key: string;
  status: Status;
  text: ReactNode;
  to: string;
}

/** What a person should look at first, most urgent at the top. */
function attentionItems(
  overview: Overview,
  operators: ConsoleOperator[],
  sync: ConsoleSync | undefined,
): Attention[] {
  const items: Attention[] = [];
  for (const op of operators) {
    if (op.outboxFailed > 0) {
      items.push({
        key: `${op.id}-outbox`,
        status: 'urgent',
        text: `${op.name}: ${plural(op.outboxFailed, 'price or availability update')} failed`,
        to: '/console/sync',
      });
    }
    if (op.webhooksFailed > 0) {
      items.push({
        key: `${op.id}-webhooks`,
        status: 'urgent',
        text: `${op.name}: ${plural(op.webhooksFailed, 'channel message')} could not be processed`,
        to: '/console/sync',
      });
    }
  }
  const unmatched = sync?.rows.find((r) => r.organisationId === null);
  if (unmatched && unmatched.webhooksWaiting + unmatched.webhooksFailed > 0) {
    items.push({
      key: 'unmatched',
      status: unmatched.webhooksFailed > 0 ? 'urgent' : 'pending',
      text: `${plural(unmatched.webhooksWaiting + unmatched.webhooksFailed, 'channel message')} not matched to any property yet`,
      to: '/console/sync',
    });
  }
  if (overview.supportSessionsActive > 0) {
    items.push({
      key: 'support',
      status: 'pending',
      text: `${plural(overview.supportSessionsActive, 'support session')} open now`,
      to: '/console/support',
    });
  }
  for (const op of operators.filter((o) => o.status === 'onboarding')) {
    items.push({
      key: `${op.id}-onboarding`,
      status: 'pending',
      text:
        op.properties === 0
          ? `${op.name} is onboarding: no properties yet`
          : `${op.name} is onboarding: ${op.propertiesOnV01} of ${plural(op.properties, 'property', 'properties')} moved to ${V01}`,
      to: `/console/operators/${op.id}`,
    });
  }
  const rank: Record<Status, number> = { urgent: 0, pending: 1, neutral: 2, done: 3 };
  return items.sort((a, b) => rank[a.status] - rank[b.status]);
}

export function ConsoleOverview() {
  const overview = useConsoleOverview();
  const operators = useConsoleOperators();
  const sync = useConsoleSync();
  const now = useNow();

  if (overview.isPending) return <Loading>Loading the overview</Loading>;
  if (overview.error) return <LoadError error={overview.error} />;
  const o = overview.data;
  const failed = o.outboxFailed + o.webhooksFailed;
  const list = operators.data?.operators ?? [];
  const attention = attentionItems(o, list, sync.data);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Every operator on ${V01}, refreshed every 30 seconds. Last updated ${relativeTime(o.generatedAt, now)}.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Operators"
          value={number(o.operators)}
          foot={`${o.operatorsLive} live · ${o.operators - o.operatorsLive} onboarding`}
        />
        <Stat
          label="Properties"
          value={number(o.properties)}
          foot={`${number(o.propertiesOnV01)} run by ${V01} · ${number(o.properties - o.propertiesOnV01)} still on Guesty`}
        />
        <Stat
          label="Arrivals today"
          value={number(o.arrivalsToday)}
          foot={`${plural(o.departuresToday, 'departure')} · ${plural(o.bookingsLast7Days, 'new booking')} this week`}
        />
        <Stat
          label="Channel sync"
          value={failed > 0 ? `${number(failed)} failed` : 'Healthy'}
          status={failed > 0 ? 'urgent' : 'done'}
          foot={`${number(o.outboxWaiting)} waiting · last sent ${relativeTime(o.lastSentAt, now)}`}
        />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <section aria-labelledby="attention">
          <SectionHeading id="attention">Needs attention</SectionHeading>
          <ul className="divide-y divide-hairline border-y border-hairline">
            {attention.length === 0 ? (
              <li className="py-3 text-[14px]">
                <StatusDot status="done">Nothing needs attention</StatusDot>
              </li>
            ) : (
              attention.map((item) => (
                <li key={item.key}>
                  <Link
                    to={item.to}
                    className="group flex items-center justify-between gap-4 py-3 text-[14px] hover:text-ink"
                  >
                    <StatusDot status={item.status}>{item.text}</StatusDot>
                    <IconChevronRight
                      size={16}
                      stroke={1.75}
                      aria-hidden
                      className="shrink-0 text-mist transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>

        <section aria-labelledby="operators">
          <SectionHeading
            id="operators"
            action={
              <Link
                to="/console/operators"
                className="text-[13px] text-accent underline-offset-4 hover:underline"
              >
                All operators
              </Link>
            }
          >
            Operators
          </SectionHeading>
          {operators.error ? <LoadError error={operators.error} /> : null}
          <ul className="divide-y divide-hairline border-y border-hairline">
            {list.map((op) => (
              <li key={op.id}>
                <Link
                  to={`/console/operators/${op.id}`}
                  className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 py-3 text-[13.5px] hover:bg-linen/50 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]"
                >
                  <span className="min-w-0 truncate font-medium text-ink">{op.name}</span>
                  <span>
                    <OperatorStatusDot status={op.status} />
                  </span>
                  <span className="tnum whitespace-nowrap text-slate">
                    {op.properties === 0
                      ? 'No properties yet'
                      : `${op.propertiesOnV01} of ${op.properties} on ${V01}`}
                  </span>
                  <span>
                    <SyncStateDot {...op} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
