import { z } from 'zod';
import { TASK_KIND_LABELS, type TaskKind } from './enums.ts';

/**
 * What the team hears on Slack about a job (2 Nov 2026). Short, plain, with the link to the job:
 * `assigned` when it's given to them, `reminder` on the day while it hasn't started, `overdue` to
 * the office when it runs past its time.
 */

export const NUDGE_KINDS = ['assigned', 'reminder', 'overdue'] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** The hour, where the operator is, from which the day's reminders go out. */
export const NUDGE_REMINDER_HOUR = 8;
/** How long past a job's time before the office is told. */
export const NUDGE_OVERDUE_MINUTES = 60;

export interface NudgeJob {
  id: string;
  kind: TaskKind;
  title: string;
  home: string;
  dueOn: string;
  dueTime: string | null;
  assignee?: string | null;
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const day = (d: string) => DAY.format(new Date(`${d}T12:00:00`));
const when = (j: NudgeJob) => `${day(j.dueOn)}${j.dueTime ? `, by ${j.dueTime.slice(0, 5)}` : ''}`;

export function nudgeText(kind: NudgeKind, job: NudgeJob, appUrl: string): string {
  const link = `${appUrl.replace(/\/$/, '')}/tasks?task=${job.id}`;
  const what = `${TASK_KIND_LABELS[job.kind]} at ${job.home}: ${job.title}`;
  if (kind === 'assigned') return `New job for you. ${what}, ${when(job)}.\n${link}`;
  if (kind === 'reminder')
    return `Reminder: today's job hasn't been started. ${what}, ${when(job)}.\n${link}`;
  return `Running late: ${what} was due ${when(job)} and isn't done${job.assignee ? ` (${job.assignee})` : ''}.\n${link}`;
}

export const SlackStatusSchema = z.object({
  connected: z.boolean(),
  /** The Slack workspace's name. */
  team: z.string().nullable(),
  /** Why it isn't working, when the token is set but Slack refuses it. */
  error: z.string().nullable(),
});
export type SlackStatus = z.infer<typeof SlackStatusSchema>;
