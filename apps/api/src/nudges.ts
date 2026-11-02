import { type ApiDatabase, sendNudge } from '@v01/db';
import type { SlackSender } from '@v01/integrations';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Tells the team about their jobs on Slack (2 Nov 2026). The API sends `assigned` the moment a job
 * is given to someone; the scheduled run (apps/worker/scripts/nudges.ts) sends reminders, tells the
 * office about late jobs, and retries anything that failed. Every message is recorded once per job,
 * person and kind. A Slack failure is logged and never fails the change that caused it.
 */

/** After a job is given to someone: tell them, unless they gave it to themselves. Never throws. */
export async function nudgeAssigned(
  deps: { db: ApiDatabase; slack: SlackSender | null; appUrl: string; log: FastifyBaseLogger },
  input: { orgId: string; taskId: string; assigneeId: string | null; byUserId: string },
): Promise<void> {
  if (!deps.slack || !input.assigneeId || input.assigneeId === input.byUserId) return;
  const slack = deps.slack;
  try {
    await deps.db.withOrg({ orgId: input.orgId }, (tx) =>
      sendNudge(tx, slack, {
        orgId: input.orgId,
        taskId: input.taskId,
        userId: input.assigneeId as string,
        kind: 'assigned',
        appUrl: deps.appUrl,
      }),
    );
  } catch (error) {
    deps.log.warn({ err: error, task: input.taskId }, 'Slack message about a job failed');
  }
}
