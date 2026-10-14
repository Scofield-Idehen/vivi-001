import type { MemberRole } from './enums.ts';

/**
 * What each role may do inside its own operator's workspace.
 * The database already stops one operator seeing another; these checks decide
 * what a person may do within their own operator.
 */
export const PERMISSIONS = {
  'properties.read': ['admin', 'operations', 'guest_comms', 'accounts'],
  'properties.write': ['admin', 'operations'],
  'channels.manage': ['admin'],
  'workspace.read': ['admin', 'operations', 'guest_comms', 'accounts', 'field'],
  'workspace.manage': ['admin'],
  'members.manage': ['admin'],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: MemberRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly MemberRole[]).includes(role);
}
