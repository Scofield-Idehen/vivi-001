import type { PlatformRole, WorkspaceRole } from './enums.ts';

/**
 * What each role may do inside an operator's workspace.
 * The database already stops one operator seeing another; these checks decide
 * what a person may do within the workspace they are in.
 * `v01_support` (V-01 staff on a support grant) can only read.
 */
export const PERMISSIONS = {
  'properties.read': ['admin', 'operations', 'guest_comms', 'accounts', 'v01_support'],
  'properties.write': ['admin', 'operations'],
  'channels.manage': ['admin'],
  'workspace.read': ['admin', 'operations', 'guest_comms', 'accounts', 'field', 'v01_support'],
  'workspace.manage': ['admin'],
  'members.manage': ['admin'],
} as const satisfies Record<string, readonly WorkspaceRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly WorkspaceRole[]).includes(role);
}

/** What each V-01 staff role may do in the console. The database checks the same rules. */
export const PLATFORM_PERMISSIONS = {
  'console.read': ['owner', 'support', 'viewer'],
  /** Names and emails of an operator's team. */
  'console.team.read': ['owner', 'support'],
  /** Open an operator's workspace, read-only, for a limited time. */
  'support.open': ['owner', 'support'],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;

export function canPlatform(role: PlatformRole | null | undefined, permission: PlatformPermission): boolean {
  return (
    Boolean(role) &&
    (PLATFORM_PERMISSIONS[permission] as readonly PlatformRole[]).includes(role as PlatformRole)
  );
}
