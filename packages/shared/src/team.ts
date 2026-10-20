import { z } from 'zod';
import { MEMBER_ROLES } from './enums.ts';

/**
 * The team: who belongs to a workspace, in which role, and who has been invited and not yet
 * signed in. An invitation is an email and a role; the first time that email signs in, it becomes
 * a membership. The sign-in email itself comes from Supabase (the invite template), so nothing
 * else needs to be set up for a colleague to get in.
 */

const Uuid = z.uuid();
const Timestamp = z.string();

export const NAME_MAX = 120;

export const InvitationSchema = z.object({
  id: Uuid,
  email: z.string(),
  /** The name the admin gave, shown until the person signs in and it becomes theirs. */
  name: z.string().nullable(),
  role: z.enum(MEMBER_ROLES),
  invitedBy: z.string().nullable(),
  createdAt: Timestamp,
  expiresAt: Timestamp.nullable(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const InvitationListSchema = z.object({ invitations: z.array(InvitationSchema) });
export type InvitationList = z.infer<typeof InvitationListSchema>;

export const InviteSchema = z.object({
  email: z.email('An email address like name@example.com').max(254),
  /** Their name, as the team knows them. */
  name: z.string().trim().min(1, 'Their name, so the team sees a person, not an address.').max(NAME_MAX),
  role: z.enum(MEMBER_ROLES),
});
export type Invite = z.infer<typeof InviteSchema>;

/** What happened to the email: Supabase sent its invitation, the person already had a sign-in, or nothing could be sent. */
export const INVITE_EMAIL_RESULTS = ['invited', 'existing', 'none'] as const;
export type InviteEmailResult = (typeof INVITE_EMAIL_RESULTS)[number];

export const InviteResultSchema = z.object({
  invitation: InvitationSchema,
  email: z.enum(INVITE_EMAIL_RESULTS),
  /** When nothing was sent: why, in the sender's own words, so the admin can act on it. */
  reason: z.string().nullable(),
});
export type InviteResult = z.infer<typeof InviteResultSchema>;

/** An admin changes a member's role, or corrects their name. */
export const MemberRoleUpdateSchema = z
  .object({
    role: z.enum(MEMBER_ROLES).optional(),
    name: z.string().trim().min(1).max(NAME_MAX).optional(),
  })
  .refine((u) => u.role !== undefined || u.name !== undefined, 'Nothing to change');
export type MemberRoleUpdate = z.infer<typeof MemberRoleUpdateSchema>;

/** A person's own details. */
export const MeUpdateSchema = z.object({ fullName: z.string().trim().min(1).max(NAME_MAX) });
export type MeUpdate = z.infer<typeof MeUpdateSchema>;

/** How long an invitation stays open. */
export const INVITATION_DAYS = 14;
