import { Link, useNavigate } from 'react-router';
import { PageHeader } from '../../components/ui.tsx';
import { useConsoleOperators } from '../../lib/api.ts';
import { plural, relativeTime, useNow, V01 } from '../../lib/format.ts';
import {
  ChannelBadges,
  cx,
  LoadError,
  Loading,
  OperatorStatusDot,
  SyncStateDot,
  tableHead,
  td,
  th,
} from './parts.tsx';

export function ConsoleOperators() {
  const navigate = useNavigate();
  const operators = useConsoleOperators();
  const now = useNow();

  if (operators.isPending) return <Loading>Loading operators</Loading>;
  if (operators.error) return <LoadError error={operators.error} />;
  const list = operators.data.operators;

  return (
    <>
      <PageHeader
        title="Operators"
        description={`${plural(list.length, 'operator')} on ${V01}. Open one to see its team, channels and support history.`}
      />

      {/* Phones get a list; wider screens get the full table. */}
      <ul className="divide-y divide-hairline border-y border-hairline md:hidden">
        {list.map((op) => (
          <li key={op.id}>
            <Link to={`/console/operators/${op.id}`} className="flex flex-col gap-1.5 py-3.5 text-[13.5px]">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[15px] font-medium text-ink">{op.name}</span>
                <OperatorStatusDot status={op.status} />
              </span>
              <span className="tnum text-slate">
                {op.properties === 0
                  ? 'No properties yet'
                  : `${op.propertiesOnV01} of ${plural(op.properties, 'property', 'properties')} on ${V01}`}{' '}
                · {plural(op.members, 'person', 'people')}
              </span>
              <SyncStateDot {...op} />
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className={tableHead}>
              <th scope="col" className={th}>
                Operator
              </th>
              <th scope="col" className={th}>
                Status
              </th>
              <th scope="col" className={th}>
                Properties on {V01}
              </th>
              <th scope="col" className={cx(th, 'text-right')}>
                Team
              </th>
              <th scope="col" className={cx(th, 'hidden lg:table-cell')}>
                Channels
              </th>
              <th scope="col" className={th}>
                Sync
              </th>
              <th scope="col" className={cx(th, 'pr-0')}>
                Last activity
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {list.map((op) => (
              <tr
                key={op.id}
                // The name is the link for keyboards and screen readers; the whole row works for a mouse.
                onClick={() => navigate(`/console/operators/${op.id}`)}
                className="cursor-pointer transition-colors hover:bg-linen"
              >
                <td className={td}>
                  <Link
                    to={`/console/operators/${op.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-ink"
                  >
                    {op.name}
                  </Link>
                  <div className="font-mono text-[12px] text-mist">{op.slug}</div>
                </td>
                <td className={td}>
                  <OperatorStatusDot status={op.status} />
                </td>
                <td className={cx(td, 'tnum text-slate')}>
                  {op.propertiesOnV01} of {op.properties}
                </td>
                <td className={cx(td, 'tnum text-right text-slate')}>{op.members}</td>
                <td className={cx(td, 'hidden lg:table-cell')}>
                  <ChannelBadges channels={op.channels} />
                </td>
                <td className={td}>
                  <SyncStateDot {...op} />
                </td>
                <td className={cx(td, 'pr-0 text-slate')}>{relativeTime(op.lastActivityAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
