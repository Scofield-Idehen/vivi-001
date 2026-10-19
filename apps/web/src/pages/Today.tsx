import { type AttentionItem, CHANNEL_LABELS, can, type TodayStay } from '@v01/shared';
import { Link, useNavigate } from 'react-router';
import { Spinner } from '../components/Spinner.tsx';
import { Notice, PageHeader, SectionHeading, type Status, StatusDot } from '../components/ui.tsx';
import { ApiError, useProperties, useToday, useWorkspace } from '../lib/api.ts';
import { plural, relativeTime, useNow, V01 } from '../lib/format.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';
import { ChannelMark } from './calendar/marks.tsx';

interface Milestone {
  id: string;
  status: Status;
  label: React.ReactNode;
  when: string;
}

/**
 * What needs a person, first. Each row is the click target (no underlines: decisions, 19 Oct 2026),
 * and takes the reader to where the problem is dealt with.
 */
function NeedsAttention({
  items,
  workerSeenAt,
  now,
}: {
  items: AttentionItem[];
  workerSeenAt: string | null;
  now: number;
}) {
  const navigate = useNavigate();
  if (items.length === 0) {
    return (
      <StatusDot status="done">
        Nothing needs you right now.
        {workerSeenAt
          ? ` ${V01} last synced with the channels ${relativeTime(workerSeenAt, now)}.`
          : ` ${V01}'s sync worker hasn't reported in yet.`}
      </StatusDot>
    );
  }
  return (
    <ul className="divide-y divide-hairline rounded-2xl border border-hairline">
      {items.map((item) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the title inside is the link; this only widens its target
        <li
          key={item.id}
          onClick={item.to ? () => navigate(item.to as string) : undefined}
          className={`flex gap-3 px-4 py-3 ${item.to ? 'cursor-pointer transition-colors hover:bg-linen first:rounded-t-2xl last:rounded-b-2xl' : ''}`}
        >
          <span
            aria-hidden
            className={`mt-[7px] size-[9px] shrink-0 rounded-full ${item.severity === 'urgent' ? 'bg-urgent' : 'bg-pending'}`}
          />
          <div className="min-w-0">
            <p className="text-[14.5px] font-medium text-ink">
              {item.to ? (
                <Link to={item.to} onClick={(e) => e.stopPropagation()}>
                  {item.title}
                </Link>
              ) : (
                item.title
              )}
            </p>
            {item.detail ? (
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-slate">{item.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Arrivals or departures: the property, who, and the time agreed when there is one. */
function Stays({ stays, kind }: { stays: TodayStay[]; kind: 'arriving' | 'leaving' }) {
  const navigate = useNavigate();
  if (stays.length === 0) {
    return <p className="text-[14px] text-slate">No one {kind} today.</p>;
  }
  return (
    <ul className="divide-y divide-hairline rounded-2xl border border-hairline">
      {stays.map((s) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the property name inside is the link; this only widens its target
        <li
          key={s.reservationId}
          onClick={() => navigate(`/reservations/${s.reservationId}`)}
          className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-linen"
        >
          <ChannelMark channel={s.channel} size={22} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] text-ink">
              <Link to={`/reservations/${s.reservationId}`} onClick={(e) => e.stopPropagation()}>
                {s.propertyName}
              </Link>
            </p>
            <p className="truncate text-[13px] text-slate">
              {s.guestName ?? CHANNEL_LABELS[s.channel]} · {plural(s.guests, 'guest')} ·{' '}
              {plural(s.nights, 'night')}
            </p>
          </div>
          <span className="shrink-0 text-[13.5px] text-mist tnum">{s.time ?? ''}</span>
        </li>
      ))}
    </ul>
  );
}

export function Today() {
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const today = useToday(orgId);
  const now = useNow();
  const canSeeProperties = can(entry.role, 'properties.read');
  const properties = useProperties(canSeeProperties ? orgId : null);

  const timeZone = workspace.data?.settings.timeZone ?? 'Europe/London';
  const title = new Intl.DateTimeFormat(workspace.data?.settings.locale ?? 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date());

  const count = properties.data?.properties.length ?? 0;
  const live = properties.data?.properties.filter((p) => p.managedBy === 'v01').length ?? 0;
  const milestones: Milestone[] = [
    {
      id: 'workspace',
      status: 'done',
      label: `Workspace set up for ${entry.organisationName}`,
      when: 'Phase 0',
    },
    canSeeProperties && count > 0
      ? {
          id: 'properties',
          status: 'done',
          label: `${count} ${count === 1 ? 'property' : 'properties'} added`,
          when: 'Phase 0',
        }
      : {
          id: 'properties',
          status: 'pending',
          label: canSeeProperties ? (
            <Link to="/properties">Add your properties</Link>
          ) : (
            'Properties are being added'
          ),
          when: 'Phase 0',
        },
    {
      id: 'channels',
      status: 'pending',
      label:
        live > 0
          ? `${live} of ${count} ${count === 1 ? 'property' : 'properties'} run through ${V01}; connect the channel accounts and link every listing`
          : 'Connect the channel accounts and link every listing',
      when: 'Phase 1',
    },
    { id: 'certification', status: 'pending', label: 'Channex certification', when: 'Week 7' },
    {
      id: 'switch-off',
      status: 'pending',
      label: 'Move every property across, then switch off Guesty',
      when: 'Week 17',
    },
  ];

  const d = today.data;
  return (
    <>
      <PageHeader
        title={title}
        description={
          d
            ? `${entry.organisationName}. ${plural(d.arrivals.length, 'arrival')}, ${plural(d.departures.length, 'departure')}, ${d.staying} ${d.staying === 1 ? 'stay' : 'stays'} in tonight${d.cleansDue.length ? `, ${plural(d.cleansDue.length, 'clean')} due` : ''}.`
            : entry.organisationName
        }
      />

      {today.isPending ? (
        <span className="inline-flex items-center gap-2 text-[14px] text-slate">
          <Spinner size={16} /> Loading today
        </span>
      ) : today.error ? (
        <Notice tone="urgent">
          {today.error instanceof ApiError ? today.error.message : 'Today couldn’t be loaded. Try again.'}
        </Notice>
      ) : d ? (
        <>
          <section aria-labelledby="attention" className="mb-10">
            <SectionHeading id="attention">
              Needs attention{d.attention.length ? ` (${d.attention.length})` : ''}
            </SectionHeading>
            <NeedsAttention items={d.attention} workerSeenAt={d.workerSeenAt} now={now} />
          </section>

          <div className="mb-10 grid gap-8 lg:grid-cols-2">
            <section aria-labelledby="arrivals">
              <SectionHeading id="arrivals">
                Arriving{d.arrivals.length ? ` (${d.arrivals.length})` : ''}
              </SectionHeading>
              <Stays stays={d.arrivals} kind="arriving" />
            </section>
            <section aria-labelledby="departures">
              <SectionHeading id="departures">
                Leaving{d.departures.length ? ` (${d.departures.length})` : ''}
              </SectionHeading>
              <Stays stays={d.departures} kind="leaving" />
            </section>
          </div>

          {canSeeProperties ? (
            <section aria-labelledby="cleans" className="mb-10">
              <SectionHeading id="cleans">
                Cleans due{d.cleansDue.length ? ` (${d.cleansDue.length})` : ''}
              </SectionHeading>
              {d.cleansDue.length === 0 ? (
                <p className="text-[14px] text-slate">Every property is clean.</p>
              ) : (
                <CleansDue cleans={d.cleansDue} now={now} />
              )}
            </section>
          ) : null}
        </>
      ) : null}

      <section aria-labelledby="switch-off">
        <SectionHeading id="switch-off">Getting to switch-off</SectionHeading>
        <ol className="max-w-[720px] divide-y divide-hairline border-y border-hairline">
          {milestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-6 py-3 text-[14px]">
              <StatusDot status={m.status}>{m.label}</StatusDot>
              <span className="shrink-0 text-[13px] text-mist">{m.when}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function CleansDue({
  cleans,
  now,
}: {
  cleans: { propertyId: string; propertyName: string; since: string | null }[];
  now: number;
}) {
  const navigate = useNavigate();
  return (
    <ul className="divide-y divide-hairline rounded-2xl border border-hairline">
      {cleans.map((c) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the property name inside is the link; this only widens its target
        <li
          key={c.propertyId}
          onClick={() => navigate(`/properties/${c.propertyId}`)}
          className="flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-linen"
        >
          <Link
            to={`/properties/${c.propertyId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[14.5px] text-ink"
          >
            {c.propertyName}
          </Link>
          <span className="shrink-0 text-[13px] text-mist">
            {c.since ? `dirty since ${relativeTime(c.since, now)}` : 'dirty'}
          </span>
        </li>
      ))}
    </ul>
  );
}
