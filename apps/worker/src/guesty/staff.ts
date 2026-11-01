import { guestyStaff, type Tx } from '@v01/db';
import type { GuestyUser } from '@v01/integrations';
import { sql } from 'drizzle-orm';
import type { WorkerDeps } from '../deps.ts';
import { importedHomes } from './owners.ts';

/**
 * The people on the Guesty account (1 Nov 2026), staged for the team to choose from on the Team
 * page; nobody joins V-01 or gets an email from this. Guesty's tags give the skills: a tag with
 * "clean" in it is cleaning, one with "maint" is maintenance (Guesty's spelling varies). A user's
 * roles list the listings they work on; no listings means every home.
 */

export interface StaffImportSummary {
  seen: number;
  cleaners: number;
  maintenance: number;
  saved: number;
  warnings: string[];
}

const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export function skillsOf(tags: readonly string[]): ('cleaning' | 'maintenance')[] {
  const out = new Set<'cleaning' | 'maintenance'>();
  for (const t of tags) {
    if (/clean/i.test(t)) out.add('cleaning');
    if (/maint/i.test(t)) out.add('maintenance');
  }
  return [...out];
}

export function staffName(u: GuestyUser): string | null {
  return (
    (
      clean(u.fullName) ??
      clean([u.firstName, u.lastName].filter(Boolean).join(' ')) ??
      clean(u.email)
    )?.slice(0, 120) ?? null
  );
}

/** The V-01 homes for a user's roles; null for every home. Listings not imported are left out. */
export function homesOf(
  u: GuestyUser,
  propertyOf: Map<string, string>,
): { homes: string[] | null; unknown: number } {
  const roles = u.roles ?? [];
  if (roles.length === 0 || roles.some((r) => !r.listingIds || r.listingIds.length === 0))
    return { homes: null, unknown: 0 };
  const ids = new Set<string>();
  let unknown = 0;
  for (const r of roles)
    for (const l of r.listingIds ?? []) {
      const p = propertyOf.get(l);
      if (p) ids.add(p);
      else unknown += 1;
    }
  return { homes: [...ids], unknown };
}

export async function saveGuestyStaff(
  tx: Tx,
  orgId: string,
  list: GuestyUser[],
  propertyOf: Map<string, string>,
): Promise<StaffImportSummary> {
  const summary: StaffImportSummary = { seen: 0, cleaners: 0, maintenance: 0, saved: 0, warnings: [] };
  for (const u of list) {
    summary.seen += 1;
    const name = staffName(u);
    if (!name) {
      summary.warnings.push(`A Guesty user (${u._id}) has no name or email; left out.`);
      continue;
    }
    const tags = (u.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const skills = skillsOf(tags);
    if (skills.includes('cleaning')) summary.cleaners += 1;
    if (skills.includes('maintenance')) summary.maintenance += 1;
    const { homes, unknown } = homesOf(u, propertyOf);
    if (unknown) summary.warnings.push(`${name}: ${unknown} of their Guesty listings aren't homes here yet.`);
    const values = {
      fullName: name,
      email: clean(u.email)?.toLowerCase().slice(0, 254) ?? null,
      phone: clean(u.phone)?.slice(0, 40) ?? null,
      tags,
      skills,
      propertyIds: homes,
    };
    await tx
      .insert(guestyStaff)
      .values({ organisationId: orgId, guestyUserId: u._id, ...values })
      .onConflictDoUpdate({
        target: [guestyStaff.organisationId, guestyStaff.guestyUserId],
        set: { ...values, seenAt: sql`now()` },
      });
    summary.saved += 1;
  }
  return summary;
}

class RolledBack extends Error {}

/** `pnpm guesty:import --staff-only`: reads Guesty first, then saves in one short transaction. */
export async function importGuestyStaff(
  deps: Pick<WorkerDeps, 'db' | 'log'>,
  options: { orgId: string; guesty: { users(): AsyncIterable<GuestyUser> }; dryRun?: boolean },
): Promise<StaffImportSummary> {
  const list: GuestyUser[] = [];
  for await (const u of options.guesty.users()) list.push(u);
  let summary: StaffImportSummary = { seen: 0, cleaners: 0, maintenance: 0, saved: 0, warnings: [] };
  try {
    await deps.db.withOrg({ orgId: options.orgId }, async (tx) => {
      summary = await saveGuestyStaff(tx, options.orgId, list, await importedHomes(tx));
      if (options.dryRun) throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  deps.log.info({ orgId: options.orgId, people: summary.seen }, 'Guesty staff staged');
  return summary;
}
