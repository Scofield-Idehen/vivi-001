import { WorkerDatabase } from '@v01/db';
import { SlackBot } from '@v01/integrations';
import { runNudges } from '../src/nudges.ts';

/**
 * pnpm nudges — the scheduled Slack run (src/nudges.ts), every half hour in the day from GitHub
 * Actions (.github/workflows/nudges.yml), so it needs no always-on worker. Prints counts only.
 */

const token = process.env.SLACK_BOT_TOKEN;
const url = process.env.DATABASE_URL;
if (!token) {
  console.log('SLACK_BOT_TOKEN is not set: nothing to send.');
  process.exit(0);
}
if (!url) throw new Error('DATABASE_URL is not set.');

const db = new WorkerDatabase(url, { applicationName: 'v01-nudges' });
try {
  const counts = await runNudges(db, new SlackBot({ token }), {
    appUrl: process.env.APP_URL ?? 'https://vivi-os.web.app',
  });
  console.log(
    `Slack: ${counts.sent} sent, ${counts.already} already sent, ${counts.not_on_slack} not found on Slack, ${counts.failed} failed.`,
  );
} finally {
  await db.close();
}
