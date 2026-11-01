import { z } from 'zod';
import { MEMBER_ROLES, STAFF_ROLES } from './enums.ts';

/**
 * The team: who belongs to a workspace, in which role, and who has been invited and not yet
 * signed in. An invitation is an email and a role; the first time that email signs in, it becomes
 * a membership. The sign-in email itself comes from Supabase (the invite template), so nothing
 * else needs to be set up for a colleague to get in.
 */

const Uuid = z.uuid();
const Timestamp = z.string();

export const NAME_MAX = 120;

/** What jobs a person does (1 Nov 2026). A clean goes only to cleaning; a repair only to maintenance. */
export const SKILLS = ['cleaning', 'maintenance'] as const;
export type Skill = (typeof SKILLS)[number];
export const SKILL_LABELS: Record<Skill, string> = { cleaning: 'Cleaning', maintenance: 'Maintenance' };

/** The skill a kind of task needs, if any (an inspection: anyone). */
export function skillFor(kind: string): Skill | null {
  return kind === 'cleaning' ? 'cleaning' : kind === 'maintenance' ? 'maintenance' : null;
}

export const InvitationSchema = z.object({
  id: Uuid,
  email: z.string(),
  /** The name the admin gave, shown until the person signs in and it becomes theirs. */
  name: z.string().nullable(),
  role: z.enum(MEMBER_ROLES),
  invitedBy: z.string().nullable(),
  /** The homes they will be limited to; null for every home. */
  propertyIds: z.array(Uuid).nullable(),
  skills: z.array(z.enum(SKILLS)),
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
  role: z.enum(STAFF_ROLES),
  /** Only these homes; leave out for every home. Never for an admin. */
  propertyIds: z.array(Uuid).max(1000).nullable().optional(),
  skills: z.array(z.enum(SKILLS)).max(2).optional(),
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
    role: z.enum(STAFF_ROLES).optional(),
    name: z.string().trim().min(1).max(NAME_MAX).optional(),
  })
  .refine((u) => u.role !== undefined || u.name !== undefined, 'Nothing to change');
export type MemberRoleUpdate = z.infer<typeof MemberRoleUpdateSchema>;

/** A person's own details. */
export const MeUpdateSchema = z.object({ fullName: z.string().trim().min(1).max(NAME_MAX) });
export type MeUpdate = z.infer<typeof MeUpdateSchema>;

/** How long an invitation stays open. */
export const INVITATION_DAYS = 14;

/**
 * Access by home (1 Nov 2026): limit a colleague to some homes, or give them every home again
 * (null). The database enforces it on every page. Admins always see every home.
 */
export const MemberHomesSchema = z.object({ propertyIds: z.array(Uuid).max(1000).nullable() });
export type MemberHomes = z.infer<typeof MemberHomesSchema>;

/** The jobs a colleague does. */
export const MemberSkillsSchema = z.object({ skills: z.array(z.enum(SKILLS)).max(2) });
export type MemberSkills = z.infer<typeof MemberSkillsSchema>;

/**
 * The people on the operator's Guesty account, to bring onto the team (1 Nov 2026). Adding one
 * makes their sign-in without emailing them: they can be given jobs at once, and sign in later.
 */
export const GuestyPersonSchema = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string().nullable(),
  /** Guesty's own tags, as written there. */
  tags: z.array(z.string()),
  skills: z.array(z.enum(SKILLS)),
  /** Their homes here; null for every home. */
  propertyIds: z.array(Uuid).nullable(),
  /** Already on the team here (by Guesty's link or the same email). */
  memberId: Uuid.nullable(),
  memberRole: z.enum(MEMBER_ROLES).nullable(),
});
export type GuestyPerson = z.infer<typeof GuestyPersonSchema>;

export const GuestyPeopleSchema = z.object({ people: z.array(GuestyPersonSchema) });
export type GuestyPeople = z.infer<typeof GuestyPeopleSchema>;

export const GuestyPeopleAddSchema = z.object({ ids: z.array(Uuid).min(1).max(200) });
export type GuestyPeopleAdd = z.infer<typeof GuestyPeopleAddSchema>;

export const GuestyPeopleAddedSchema = z.object({
  added: z.number().int(),
  /** Already on the team: their skills and homes from Guesty were added to what they had. */
  updated: z.number().int(),
  /** Left out, with the reason (no email, say). */
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
});
export type GuestyPeopleAdded = z.infer<typeof GuestyPeopleAddedSchema>;

/** Whether a colleague can be given a job: the skill it needs, and that home (the API checks the same). */
export function canTake(
  m: { role: string; skills: readonly string[]; propertyIds: readonly string[] | null },
  kind: string,
  propertyId: string | null,
): boolean {
  if (m.role === 'owner') return false;
  const skill = skillFor(kind);
  if (skill && !m.skills.includes(skill)) return false;
  return !propertyId || m.propertyIds === null || m.propertyIds.includes(propertyId);
}
