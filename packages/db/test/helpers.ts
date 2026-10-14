import pg from 'pg';
import { properties, type Tx } from '../src/index.ts';

/** The Postgres error code, whether or not the driver error is wrapped by Drizzle. */
export function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const actual = pgCode(error);
    if (actual !== code) {
      throw new Error(`Expected Postgres error ${code}, got ${actual ?? 'none'}: ${String(error)}`);
    }
    return;
  }
  throw new Error(`Expected Postgres error ${code}, but the query succeeded`);
}

export const PG = {
  exclusionViolation: '23P01',
  insufficientPrivilege: '42501',
  /** Raised when a row fails a row-level security WITH CHECK. */
  rlsViolation: '42501',
} as const;

export async function insertProperty(tx: Tx, organisationId: string, name: string): Promise<string> {
  const [row] = await tx
    .insert(properties)
    .values({ organisationId, name, countryCode: 'GB', maxGuests: 4 })
    .returning({ id: properties.id });
  return row!.id;
}

/** Runs a query on a plain connection, outside any scope. */
export async function rawQuery<T extends pg.QueryResultRow>(
  url: string,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}
