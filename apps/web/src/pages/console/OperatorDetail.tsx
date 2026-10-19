import { IconArrowLeft } from '@tabler/icons-react';
import { canPlatform, ROLE_LABELS } from '@v01/shared';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, PageHeader, SectionHeading, Stat, StatusDot } from '../../components/ui.tsx';
import { useConsoleOperator, useMe } from '../../lib/api.ts';
import {
  dateTime,
  duration,
  number,
  plural,
  relativeTime,
  shortDate,
  useNow,
  V01,
} from '../../lib/format.ts';
import { useWorkspaces } from '../../lib/workspace.tsx';
import {
  ChannelBadges,
  cx,
  GrantStatus,
  LoadError,
  Loading,
  OperatorStatusDot,
  propertySplit,
  SupportAccessDialog,
  syncState,
  tableHead,
  td,
  th,
  useOpenWorkspace,
} from './parts.tsx';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 py-2.5 text-[14px]">
      <dt className="text-slate">{label}</dt>
      <dd className="min-w-0">{children ?? <span className="text-mist">Not set</span>}</dd>
    </div>
  );
}

export function ConsoleOperatorDetail() {
  const { orgId = '' } = useParams();
  const detail = useConsoleOperator(orgId);
  const platformRole = useMe().data?.platformRole ?? null;
  const { entries } = useWorkspaces();
  const openWorkspace = useOpenWorkspace();
  const [asking, setAsking] = useState(false);
  const now = useNow();

  const back = (
    <Link
      to="/console/operators"
      className="-ml-2.5 mb-4 inline-flex items-center gap-1.5 text-[13px] action"
    >
      <IconArrowLeft size={14} stroke={1.75} aria-hidden />
      Operators
    </Link>
  );

  if (detail.isPending) return <Loading>Loading the operator</Loading>;
  if (detail.error) {
    return (
      <>
        {back}
        <LoadError error={detail.error} />
      </>
    );
  }
  const { operator: op, team, support } = detail.data;
  const member = entries.find((e) => e.organisationId === op.id && !e.support);
  const supportOpen = entries.find((e) => e.organisationId === op.id && e.support);
  const sync = syncState(op);
  const invited = team?.filter((m) => m.status === 'invited').length ?? 0;
  const teamFoot = !team
    ? 'People with access'
    : invited
      ? `${plural(invited, 'invitation')} waiting`
      : 'No invitations waiting';

  let action: ReactNode = null;
  if (member || supportOpen) {
    action = (
      <Button variant="primary" onClick={() => openWorkspace(op.id)}>
        {member ? 'Open workspace' : 'Back to their workspace'}
      </Button>
    );
  } else if (canPlatform(platformRole, 'support.open')) {
    action = (
      <Button variant="primary" onClick={() => setAsking(true)}>
        Open with support access
      </Button>
    );
  }

  return (
    <>
      {back}
      <PageHeader
        title={op.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <OperatorStatusDot status={op.status} />
            <span className="text-mist">·</span>
            <span>
              On {V01} since {shortDate(op.createdAt)}
            </span>
            <span className="text-mist">·</span>
            <span>Last activity {relativeTime(op.lastActivityAt, now)}</span>
          </span>
        }
        action={action}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Properties" value={number(op.properties)} foot={propertySplit(op)} />
        <Stat label="Team" value={number(op.members)} foot={teamFoot} />
        <Stat
          label="Channel accounts"
          value={`${op.channelAccountsConnected} of ${op.channelAccounts}`}
          foot={op.channelAccounts === 0 ? 'None added yet' : 'connected'}
        />
        <Stat
          label="Channel sync"
          value={sync.label}
          status={sync.status}
          foot={`${number(op.outboxWaiting)} waiting to send`}
        />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="details">
          <SectionHeading id="details">Details</SectionHeading>
          <dl className="divide-y divide-hairline border-y border-hairline">
            <Row label="Legal name">{op.legalName}</Row>
            <Row label="Guests see">{op.displayName}</Row>
            <Row label="Channels">
              <ChannelBadges channels={op.channels} />
            </Row>
            <Row label="Currency">{op.currency}</Row>
            <Row label="Time zone">{op.timeZone}</Row>
            <Row label="Country">{op.countryCode}</Row>
            <Row label="Short name">
              <span className="font-mono text-[12.5px]">{op.slug}</span>
            </Row>
          </dl>
        </section>

        <section aria-labelledby="team">
          <SectionHeading id="team">Team</SectionHeading>
          {team === null ? (
            <p className="border-y border-hairline py-3 text-[14px] text-slate">
              Names and emails are shown to V-01 owners and support only.
            </p>
          ) : team.length === 0 ? (
            <p className="border-y border-hairline py-3 text-[14px] text-slate">
              No one has been invited yet.
            </p>
          ) : (
            <ul className="divide-y divide-hairline border-y border-hairline">
              {team.map((m) => (
                <li key={m.email} className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]">
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{m.fullName ?? m.email}</span>
                    {m.fullName ? (
                      <span className="block truncate text-[12.5px] text-mist">{m.email}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-slate">{ROLE_LABELS[m.role]}</span>
                    <span className="block text-[12.5px] text-mist">
                      {m.status === 'invited'
                        ? 'Invited, not signed in yet'
                        : `Seen ${relativeTime(m.lastSeenAt, now)}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="support" className="mt-10">
        <SectionHeading id="support">Support access</SectionHeading>
        <p className="mb-3 max-w-[70ch] text-[13.5px] leading-relaxed text-slate">
          V-01 staff can open this workspace read-only, for up to four hours, with a reason. {op.name} sees
          every visit on their Workspace page.
        </p>
        {support.length === 0 ? (
          <p className="border-y border-hairline py-3 text-[14px] text-slate">
            <StatusDot status="neutral">No support visits yet</StatusDot>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
              <thead>
                <tr className={tableHead}>
                  <th scope="col" className={th}>
                    Opened
                  </th>
                  <th scope="col" className={th}>
                    By
                  </th>
                  <th scope="col" className={th}>
                    Reason
                  </th>
                  <th scope="col" className={cx(th, 'text-right')}>
                    Pages
                  </th>
                  <th scope="col" className={cx(th, 'pr-0')}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {support.map((g) => (
                  <tr key={g.id}>
                    <td className={cx(td, 'whitespace-nowrap text-slate')}>
                      {dateTime(g.startedAt)}
                      <div className="text-[12.5px] text-mist">
                        {duration(g.startedAt, g.endedAt ?? g.expiresAt)}
                      </div>
                    </td>
                    <td className={cx(td, 'text-slate')}>{g.staffEmail}</td>
                    <td className={cx(td, 'max-w-[360px]')}>{g.reason}</td>
                    <td className={cx(td, 'tnum text-right text-slate')}>{g.requests}</td>
                    <td className={cx(td, 'pr-0 whitespace-nowrap')}>
                      <GrantStatus grant={g} now={now} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {asking ? <SupportAccessDialog operator={op} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
