import { WorkerDatabase } from '@v01/db';
import { createTestDatabase, seedOperator, type TestDatabase } from '@v01/db/testing';
import { MemorySlack } from '@v01/integrations';
import { addDays } from '@v01/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runNudges } from '../src/nudges.ts';

/** The scheduled Slack run: missed "new job" messages, the day's reminders, and late jobs to the office. */

let t: TestDatabase;
let worker: WorkerDatabase;
let op: { orgId: string; userId: string };
let home: string;
let cleaner: string;
const slack = new MemorySlack({ 'cleaner@example.test': 'U_CLEAN', 'ops@example.test': 'U_OPS' });
// 11:00 in London on a fixed day: after the 8:00 reminders start.
const now = new Date('2026-11-04T11:00:00Z');
const today = '2026-11-04';

async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: t.ownerUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function job(dueOn: string, dueTime: string | null, assignee: string | null, createdBy: string | null) {
  const [row] = await owner<{ id: string }>(
    `insert into app.tasks (organisation_id, property_id, kind, title, due_on, due_time, assignee_user_id, created_by)
     values ($1, $2, 'cleaning', 'Check-out clean', $3, $4, $5, $6) returning id`,
    [op.orgId, home, dueOn, dueTime, assignee, createdBy],
  );
  return row!.id;
}

beforeAll(async () => {
  t = await createTestDatabase();
  op = await seedOperator(t.ownerUrl, {
    name: 'Northwind Stays',
    slug: 'northwind',
    userEmail: 'ops@example.test',
  });
  worker = new WorkerDatabase(t.workerUrl);
  const [p] = await owner<{ id: string }>(
    `insert into app.properties (organisation_id, name, country_code, max_guests, managed_by)
     values ($1, 'Harbour View Lodge', 'GB', 4, 'v01') returning id`,
    [op.orgId],
  );
  home = p!.id;
  const [u] = await owner<{ id: string }>(
    `insert into app.app_users (id, email) values (gen_random_uuid(), 'cleaner@example.test') returning id`,
  );
  cleaner = u!.id;
  await owner(
    `insert into app.memberships (organisation_id, user_id, role, skills) values ($1, $2, 'field', array['cleaning'])`,
    [op.orgId, cleaner],
  );
});

afterAll(async () => {
  await worker?.close();
  await t?.drop();
});

describe('the scheduled Slack run', () => {
  it('sends missed job messages, today’s reminders and late jobs, each once', async () => {
    // An automatic clean for today, nobody told: a "new job" and, not started, a reminder.
    const todays = await job(today, '15:00', cleaner, null);
    // Yesterday's job made by the office, not done: the office hears it's late.
    const late = await job(addDays(today, -1), null, cleaner, op.userId);
    await owner(`update app.tasks set created_at = now() - interval '3 days' where id = $1`, [late]);

    const first = await runNudges(worker, slack, { appUrl: 'https://app.example', now });
    const texts = slack.sent.map((m) => `${m.userId}: ${m.text.split('\n')[0]}`);
    expect(texts).toContain(
      'U_CLEAN: New job for you. Clean at Harbour View Lodge: Check-out clean, Wed 4 Nov, by 15:00.',
    );
    expect(texts.some((x) => x.startsWith('U_CLEAN: Reminder: today'))).toBe(true);
    expect(texts.some((x) => x.startsWith('U_OPS: Running late') && x.includes('cleaner@example.test'))).toBe(
      true,
    );
    expect(first.sent).toBe(3);
    const [n] = await owner<{ n: number }>(
      'select count(*)::int as n from app.task_nudges where task_id in ($1, $2) and sent_at is not null',
      [todays, late],
    );
    expect(n!.n).toBe(3);

    // The next run sends nothing new.
    const again = await runNudges(worker, slack, { appUrl: 'https://app.example', now });
    expect(again.sent).toBe(0);
    expect(slack.sent).toHaveLength(3);
  });

  it('leaves done jobs alone, and waits for the job’s time before calling it late', async () => {
    const before = slack.sent.length;
    const done = await job(today, null, cleaner, op.userId);
    await owner(
      `update app.tasks set status = 'done', created_at = now() - interval '3 days' where id = $1`,
      [done],
    );
    const later = await job(today, '10:30', null, op.userId);
    await owner(`update app.tasks set created_at = now() - interval '3 days' where id = $1`, [later]);
    // 11:00: only 30 minutes past 10:30, so not late yet.
    await runNudges(worker, slack, { appUrl: 'https://app.example', now });
    expect(slack.sent).toHaveLength(before);
    // 11:31: now it is.
    await runNudges(worker, slack, { appUrl: 'https://app.example', now: new Date('2026-11-04T11:31:00Z') });
    expect(slack.sent).toHaveLength(before + 1);
    expect(slack.sent.at(-1)!.text).toContain('Running late');
  });
});
