import { can } from '@v01/shared';
import { Link } from 'react-router';
import { PageHeader, type Status, StatusDot } from '../components/ui.tsx';
import { useProperties, useWorkspace } from '../lib/api.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';

interface Milestone {
  id: string;
  status: Status;
  label: React.ReactNode;
  when: string;
}

export function Today() {
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const canSeeProperties = can(entry.role, 'properties.read');
  const properties = useProperties(canSeeProperties ? orgId : null);

  const timeZone = workspace.data?.settings.timeZone ?? 'Europe/London';
  const today = new Intl.DateTimeFormat(workspace.data?.settings.locale ?? 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date());

  const count = properties.data?.properties.length ?? 0;
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
            <Link to="/properties" className="underline-offset-4 hover:underline">
              Add your properties
            </Link>
          ) : (
            'Properties are being added'
          ),
          when: 'Phase 0',
        },
    {
      id: 'channels',
      status: 'pending',
      label: 'Connect the channel accounts and map every listing',
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

  return (
    <>
      <PageHeader
        title={today}
        description={`${entry.organisationName}. Arrivals, departures, cleans due, unanswered messages and sync problems will show here once bookings flow in.`}
      />
      <section aria-labelledby="switch-off">
        <h2 id="switch-off" className="mb-3 text-[15px] font-medium">
          Getting to switch-off
        </h2>
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
