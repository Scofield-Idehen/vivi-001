import { type NudgeKind, nudgeText } from '@v01/shared';
import { and, eq } from 'drizzle-orm';
import type { Tx } from './client.ts';
import { appUsers, properties, taskNudges, tasks } from './schema/index.ts';

/**
 * Sending one Slack message about a job, recorded once per job, person and kind (2 Nov 2026). Used
 * by the API (the moment a job is assigned) and the scheduled run (reminders, late jobs, retries).
 */

/** What sending needs from Slack; the Slack client in @v01/integrations has it. */
export interface NudgeSlack {
  userIdByEmail(email: string): Promise<string | null>;
  dm(userId: string, text: string): Promise<void>;
}

export async function sendNudge(
  tx: Tx,
  slack: NudgeSlack,
  input: {
    orgId: string;
    taskId: string;
    userId: string;
    kind: NudgeKind;
    appUrl: string;
    assignee?: string | null;
  },
): Promise<'sent' | 'already' | 'not_on_slack' | 'gone'> {
  const [already] = await tx
    .select({ id: taskNudges.id, sentAt: taskNudges.sentAt })
    .from(taskNudges)
    .where(
      and(
        eq(taskNudges.taskId, input.taskId),
        eq(taskNudges.userId, input.userId),
        eq(taskNudges.kind, input.kind),
      ),
    );
  if (already?.sentAt) return 'already';
  const [job] = await tx
    .select({
      id: tasks.id,
      kind: tasks.kind,
      title: tasks.title,
      dueOn: tasks.dueOn,
      dueTime: tasks.dueTime,
      status: tasks.status,
      home: properties.name,
    })
    .from(tasks)
    .innerJoin(properties, eq(properties.id, tasks.propertyId))
    .where(eq(tasks.id, input.taskId));
  const [person] = await tx
    .select({ email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, input.userId));
  if (!job || !person || job.status === 'done' || job.status === 'cancelled') return 'gone';
  const record = async (sentAt: Date | null, error: string | null) => {
    if (already) await tx.update(taskNudges).set({ sentAt, error }).where(eq(taskNudges.id, already.id));
    else
      await tx.insert(taskNudges).values({
        organisationId: input.orgId,
        taskId: input.taskId,
        userId: input.userId,
        kind: input.kind,
        sentAt,
        error,
      });
  };
  try {
    const slackId = await slack.userIdByEmail(person.email);
    if (!slackId) {
      await record(null, 'Not found on Slack by their email');
      return 'not_on_slack';
    }
    await slack.dm(
      slackId,
      nudgeText(input.kind, { ...job, kind: job.kind, assignee: input.assignee ?? null }, input.appUrl),
    );
    await record(new Date(), null);
    return 'sent';
  } catch (error) {
    await record(null, error instanceof Error ? error.message.slice(0, 300) : 'Slack failed');
    throw error;
  }
}
