import type { Me } from '@v01/shared';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

type Membership = Me['memberships'][number];

interface WorkspaceState {
  orgId: string;
  membership: Membership;
  memberships: Membership[];
  choose(orgId: string): void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const STORAGE_KEY = 'v01.workspace';

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(orgId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, orgId);
  } catch {
    // Storage can be unavailable (private windows); the choice simply isn't remembered.
  }
}

/** The operator the person is working in. Remembered per browser; defaults to their first. */
export function WorkspaceProvider({
  memberships,
  children,
}: {
  memberships: Membership[];
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<string | null>(remembered);
  const value = useMemo<WorkspaceState | null>(() => {
    const membership = memberships.find((m) => m.organisationId === chosen) ?? memberships[0];
    if (!membership) return null;
    return {
      orgId: membership.organisationId,
      membership,
      memberships,
      choose(orgId) {
        remember(orgId);
        setChosen(orgId);
      },
    };
  }, [chosen, memberships]);
  if (!value) return null;
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useCurrentWorkspace(): WorkspaceState {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useCurrentWorkspace must be used inside WorkspaceProvider');
  return value;
}
