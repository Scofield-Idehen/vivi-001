import { appUsers } from '@v01/db';
import type { SlackSender } from '@v01/integrations';
import { SlackStatusSchema } from '@v01/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';

/**
 * Slack for the team's job messages (2 Nov 2026): whether it's connected, and a test message to
 * yourself, to check your Slack account is found by the email you sign in with.
 */
export function slackRoutes(app: FastifyInstance, deps: { scope: RequestScope; slack: SlackSender | null }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/v1/workspace/slack', { schema: { response: { 200: SlackStatusSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'workspace.read', async () => {
      if (!deps.slack) return { connected: false, team: null, error: null };
      try {
        return { connected: true, team: await deps.slack.team(), error: null };
      } catch (error) {
        return {
          connected: false,
          team: null,
          error: error instanceof Error ? error.message : 'Slack failed',
        };
      }
    }),
  );

  typed.post('/v1/workspace/slack/test', { schema: { response: { 200: SlackStatusSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'workspace.read', async (tx, ctx) => {
      if (!deps.slack) throw new HttpError(503, 'slack_off', 'Slack isn’t connected yet.');
      const [me] = await tx
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(eq(appUsers.id, ctx.userId));
      const id = me ? await deps.slack.userIdByEmail(me.email) : null;
      if (!id)
        throw new HttpError(
          404,
          'not_on_slack',
          `No one in your Slack uses ${me?.email ?? 'your email'}. Job messages find people by the email they sign in to V-01 with.`,
        );
      await deps.slack.dm(id, 'This is V-01. Job messages for you will arrive here.');
      return { connected: true, team: await deps.slack.team(), error: null };
    }),
  );
}
