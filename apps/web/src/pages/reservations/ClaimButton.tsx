import { IconFileAlert } from '@tabler/icons-react';
import { can } from '@v01/shared';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui.tsx';
import { useStartClaim } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';

/** On a stay that has begun: start its damage claim, or open the one there is. */
export function ClaimButton({ reservationId }: { reservationId: string }) {
  const { orgId, entry } = useCurrentWorkspace();
  const start = useStartClaim(orgId);
  const navigate = useNavigate();
  if (!can(entry.role, 'claims.write')) return null;
  return (
    <Button
      disabled={start.isPending}
      title={start.error ? 'That didn’t go through. Try again.' : undefined}
      onClick={() => start.mutate(reservationId, { onSuccess: (c) => navigate(`/claims/${c.id}`) })}
    >
      <IconFileAlert size={16} stroke={1.75} aria-hidden className="text-slate" />
      Damage claim
    </Button>
  );
}
