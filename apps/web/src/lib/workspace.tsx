import { type Me, SUPPORT_ROLE, type WorkspaceRole } from '@v01/shared';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

/** A workspace the person can open: as a member, or as V-01 staff on an open support grant. */
export interface WorkspaceEntry {
  organisationId: string;
  organisationName: string;
  role: WorkspaceRole;
  /** Set for V-01 support access: read-only, and it ends at `expiresAt`. */
  support: { grantId: string; expiresAt: string } | null;
}

interface WorkspaceState {
  orgId: string;
  entry: WorkspaceEntry;
  entries: WorkspaceEntry[];
  choose(orgId: string): void;
}

interface WorkspaceContextValue {
  current: WorkspaceState | null;
  entries: WorkspaceEntry[];
  choose(orgId: string): void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
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

/** Memberships first, then support grants for operators the person is not a member of. */
export function workspaceEntries(me: Me): WorkspaceEntry[] {
  const members: WorkspaceEntry[] = me.memberships.map((m) => ({ ...m, support: null }));
  const memberIds = new Set(members.map((m) => m.organisationId));
  const support: WorkspaceEntry[] = me.supportAccess
    .filter((s) => !memberIds.has(s.organisationId))
    .map((s) => ({
      organisationId: s.organisationId,
      organisationName: s.organisationName,
      role: SUPPORT_ROLE,
      support: { grantId: s.grantId, expiresAt: s.expiresAt },
    }));
  return [...members, ...support];
}

/** The operator the person is working in. Remembered per browser; defaults to their first. */
export function WorkspaceProvider({ entries, children }: { entries: WorkspaceEntry[]; children: ReactNode }) {
  const [chosen, setChosen] = useState<string | null>(remembered);
  const value = useMemo<WorkspaceContextValue>(() => {
    const choose = (orgId: string) => {
      remember(orgId);
      setChosen(orgId);
    };
    const entry = entries.find((e) => e.organisationId === chosen) ?? entries[0];
    return {
      entries,
      choose,
      current: entry ? { orgId: entry.organisationId, entry, entries, choose } : null,
    };
  }, [chosen, entries]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace hooks must be used inside WorkspaceProvider');
  return value;
}

/** The workspace being worked in. Only for screens inside a workspace. */
export function useCurrentWorkspace(): WorkspaceState {
  const { current } = useWorkspaceContext();
  if (!current) throw new Error('No workspace is open');
  return current;
}

/** Every workspace the person can open, and a way to switch, for screens outside a workspace too. */
export function useWorkspaces(): WorkspaceContextValue {
  return useWorkspaceContext();
}
