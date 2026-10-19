import { Link, useNavigate } from 'react-router';
import { Button, PageHeader, StatusDot } from '../../components/ui.tsx';
import { useEndSupportAccess, useMe, useSupportLog } from '../../lib/api.ts';
import { dateTime, duration, plural, useNow } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { cx, GrantStatus, LoadError, Loading, tableHead, td, th } from './parts.tsx';

export function ConsoleSupportLog() {
  const navigate = useNavigate();
  const log = useSupportLog();
  const end = useEndSupportAccess();
  const email = useSession().session?.user.email;
  const platformRole = useMe().data?.platformRole;
  const now = useNow();

  if (log.isPending) return <Loading>Loading the support log</Loading>;
  if (log.error) return <LoadError error={log.error} />;
  const grants = log.data.grants;

  return (
    <>
      <PageHeader
        title="Support log"
        description="Every time V-01 staff opened an operator's workspace, newest first. Access is read-only, needs a reason, and closes by itself. Each operator sees the visits to their own workspace."
      />
      {grants.length === 0 ? (
        <p className="border-y border-hairline py-3 text-[14px]">
          <StatusDot status="neutral">No one has used support access yet</StatusDot>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13.5px]">
            <thead>
              <tr className={tableHead}>
                <th scope="col" className={th}>
                  Opened
                </th>
                <th scope="col" className={th}>
                  Operator
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
              {grants.map((g) => {
                const open = g.active && Date.parse(g.expiresAt) > now;
                const canEnd = open && (g.staffEmail === email || platformRole === 'owner');
                return (
                  <tr
                    key={g.id}
                    onClick={() => navigate(`/console/operators/${g.organisationId}`)}
                    className="cursor-pointer transition-colors hover:bg-linen"
                  >
                    <td className={cx(td, 'whitespace-nowrap text-slate')}>
                      {dateTime(g.startedAt)}
                      <div className="text-[12.5px] text-mist">
                        {duration(g.startedAt, g.endedAt ?? g.expiresAt)}
                      </div>
                    </td>
                    <td className={td}>
                      <Link
                        to={`/console/operators/${g.organisationId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-ink"
                      >
                        {g.organisationName}
                      </Link>
                    </td>
                    <td className={cx(td, 'text-slate')}>{g.staffEmail}</td>
                    <td className={cx(td, 'max-w-[340px]')}>{g.reason}</td>
                    <td
                      className={cx(td, 'tnum text-right text-slate')}
                      title={plural(g.requests, 'request')}
                    >
                      {g.requests}
                    </td>
                    <td className={cx(td, 'pr-0 whitespace-nowrap')}>
                      <div className="flex items-center gap-3">
                        <GrantStatus grant={g} now={now} />
                        {canEnd ? (
                          <Button
                            variant="quiet"
                            className="text-[13px]"
                            disabled={end.isPending}
                            onClick={() => end.mutate(g.id)}
                          >
                            End now
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
