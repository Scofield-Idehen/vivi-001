import { guestyListings, owners, properties, type Tx } from '@v01/db';
import type { GuestyOwner } from '@v01/integrations';
import { eq, sql } from 'drizzle-orm';
import type { WorkerDeps } from '../deps.ts';
import type { GuestyReader } from './snapshot.ts';

/**
 * Owners from Guesty (1 Nov 2026). Each Guesty owner becomes a ViVi OS owner, matched on a later run
 * by Guesty's id (or, the first time, by email to an owner the team already added by hand), and
 * every listing Guesty says they own becomes their home here. One owner can own many homes.
 *
 * A home already given to an owner by hand in ViVi OS keeps that owner; the run says so. A home
 * Guesty gives to two owners goes to the first, and the run says so too. Names, company, email
 * and phone follow Guesty; the fee and notes are only set the first time, so the team's own
 * changes are kept.
 */

export interface OwnerImportSummary {
  seen: number;
  created: number;
  updated: number;
  /** Homes given to an owner, or moved to another, by this run. */
  homesLinked: number;
  warnings: string[];
}

export const emptyOwnerSummary = (): OwnerImportSummary => ({
  seen: 0,
  created: 0,
  updated: 0,
  homesLinked: 0,
  warnings: [],
});

const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export function ownerName(o: GuestyOwner): string | null {
  return (
    (
      clean(o.fullName) ??
      clean([o.firstName, o.lastName].filter(Boolean).join(' ')) ??
      clean(o.email) ??
      null
    )?.slice(0, 120) ?? null
  );
}

/** Guesty's commission as a percentage (20 is 20%) in hundredths of a percent, when it makes sense. */
export function feeOf(o: GuestyOwner): number {
  const c = o.businessInformation?.ownerCommission;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 100) return 0;
  return Math.round(c * 100);
}

/**
 * Saves the owners and their homes. `propertyOf` maps a Guesty listing id to the ViVi OS home.
 */
export async function saveGuestyOwners(
  tx: Tx,
  orgId: string,
  list: GuestyOwner[],
  propertyOf: Map<string, string>,
): Promise<OwnerImportSummary> {
  const summary = emptyOwnerSummary();
  const existing = await tx.select().from(owners);
  const byGuesty = new Map(
    existing.filter((o) => o.guestyOwnerId).map((o) => [o.guestyOwnerId as string, o]),
  );
  const byEmail = new Map(
    existing.filter((o) => !o.guestyOwnerId && o.email).map((o) => [(o.email as string).toLowerCase(), o]),
  );
  const guestyOwned = new Set(existing.filter((o) => o.guestyOwnerId).map((o) => o.id));
  const homes = await tx
    .select({ id: properties.id, name: properties.name, ownerId: properties.ownerId })
    .from(properties);
  const home = new Map(homes.map((h) => [h.id, h]));
  const ownerNameOf = new Map(existing.map((o) => [o.id, o.name]));
  /** Home → the Guesty owner this run gave it to. */
  const claimed = new Map<string, string>();

  for (const g of list) {
    summary.seen += 1;
    const name = ownerName(g);
    if (!name) {
      summary.warnings.push(`A Guesty owner (${g._id}) has no name or email; left out.`);
      continue;
    }
    const fields = {
      name,
      company: clean(g.businessInformation?.businessName)?.slice(0, 120) ?? null,
      email: clean(g.email)?.toLowerCase().slice(0, 254) ?? null,
      phone: clean(g.phone)?.slice(0, 40) ?? null,
    };
    let id: string;
    const known = byGuesty.get(g._id) ?? (fields.email ? byEmail.get(fields.email) : undefined);
    if (known) {
      await tx
        .update(owners)
        .set({ ...fields, guestyOwnerId: g._id })
        .where(eq(owners.id, known.id));
      id = known.id;
      summary.updated += 1;
    } else {
      const [row] = await tx
        .insert(owners)
        .values({
          organisationId: orgId,
          ...fields,
          feeBasisPoints: feeOf(g),
          notes: clean(g.notes)?.slice(0, 2000) ?? null,
          guestyOwnerId: g._id,
        })
        .returning({ id: owners.id });
      if (!row) throw new Error('Saving an owner returned nothing.');
      id = row.id;
      summary.created += 1;
    }
    guestyOwned.add(id);
    ownerNameOf.set(id, name);

    for (const listingId of new Set(g.listings ?? [])) {
      const propertyId = propertyOf.get(listingId);
      const h = propertyId ? home.get(propertyId) : undefined;
      if (!propertyId || !h) continue;
      const first = claimed.get(propertyId);
      if (first && first !== id) {
        summary.warnings.push(
          `${h.name}: Guesty lists ${ownerNameOf.get(first)} and ${name} as owners; kept ${ownerNameOf.get(first)}.`,
        );
        continue;
      }
      claimed.set(propertyId, id);
      if (h.ownerId === id) continue;
      if (h.ownerId && !guestyOwned.has(h.ownerId)) {
        summary.warnings.push(
          `${h.name}: Guesty says ${name}, but it was given to ${ownerNameOf.get(h.ownerId) ?? 'another owner'} here; left as it is.`,
        );
        continue;
      }
      await tx.update(properties).set({ ownerId: id }).where(eq(properties.id, propertyId));
      h.ownerId = id;
      summary.homesLinked += 1;
    }
  }
  return summary;
}

/** Guesty listing id → ViVi OS home, from earlier imports. */
export async function importedHomes(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx
    .select({ listingId: guestyListings.guestyListingId, propertyId: guestyListings.propertyId })
    .from(guestyListings);
  return new Map(rows.map((r) => [r.listingId, r.propertyId]));
}

class RolledBack extends Error {}

/**
 * Owners only, for a workspace whose homes are already imported: `pnpm guesty:import --owners-only`.
 * Reads Guesty first, then saves in one short transaction.
 */
export async function importGuestyOwners(
  deps: Pick<WorkerDeps, 'db' | 'log'>,
  options: { orgId: string; guesty: Pick<GuestyReader, 'owners'>; dryRun?: boolean },
): Promise<OwnerImportSummary> {
  const list: GuestyOwner[] = [];
  for await (const o of options.guesty.owners()) list.push(o);
  let summary = emptyOwnerSummary();
  try {
    await deps.db.withOrg({ orgId: options.orgId }, async (tx) => {
      const [lock] = (
        await tx.execute<{ ok: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtext(${`guesty-import:${options.orgId}`})) as ok`,
        )
      ).rows;
      if (!lock?.ok)
        throw new Error('A Guesty import for this workspace is running. Let it finish, then try again.');
      summary = await saveGuestyOwners(tx, options.orgId, list, await importedHomes(tx));
      if (options.dryRun) throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  deps.log.info(
    { orgId: options.orgId, owners: summary.seen, homes: summary.homesLinked },
    'Guesty owners imported',
  );
  return summary;
}
