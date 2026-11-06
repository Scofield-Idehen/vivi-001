import { IconMessageCircle } from '@tabler/icons-react';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useSlackStatus, useSlackTest } from '../../lib/api.ts';

/**
 * Slack for job messages (2 Nov 2026): the team hears about a job the moment it's given to them, a
 * reminder on the day if it hasn't started, and the office hears when one runs late. People are
 * found on Slack by the email they sign in to ViVi OS with.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

export function SlackSection({ orgId }: { orgId: string }) {
  const status = useSlackStatus(orgId);
  const test = useSlackTest(orgId);
  const s = status.data;
  return (
    <section id="slack" aria-labelledby="slack-heading" className="scroll-mt-6 lg:col-span-2">
      <h2 id="slack-heading" className="mb-1 text-[15px] font-medium">
        Slack
      </h2>
      <p className="mb-3 max-w-[640px] text-[13px] text-slate">
        Cleaners and maintenance hear about a job on Slack the moment it’s given to them, and get a reminder
        on the day if it hasn’t started. Whoever made a job hears if it runs an hour late. People are found on
        Slack by the email they sign in to ViVi OS with.
      </p>
      <div className="flex max-w-[640px] flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3 text-[14px]">
        <span className="flex items-center gap-2 text-ink">
          <IconMessageCircle size={18} stroke={1.75} className="text-slate" />
          {s?.connected
            ? `Connected to ${s.team}`
            : s?.error
              ? `Not working: ${s.error}`
              : 'Not connected yet. ViVi OS support adds the Slack app.'}
        </span>
        {s?.connected ? (
          <Button onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isSuccess ? 'Sent, check Slack' : 'Send me a test message'}
          </Button>
        ) : null}
      </div>
      {test.error ? (
        <div className="mt-3 max-w-[640px]">
          <Notice tone="urgent">{explain(test.error)}</Notice>
        </div>
      ) : null}
    </section>
  );
}
