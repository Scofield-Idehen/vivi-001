import { ChannexWebhookSchema, verifyChannexWebhook } from '@v01/channels';
import type { ApiDatabase } from '@v01/db';
import type { FastifyInstance } from 'fastify';
import { errorBody } from '../errors.ts';

/**
 * Channex webhook intake (integration step 5). It verifies the signature against the raw
 * body, stores the event, and replies at once. The worker does the real work: it pulls
 * the latest booking revision, saves it, and only then acknowledges it to Channex.
 *
 * Any failure to store returns a 5xx so Channex retries (up to 11 times over about 24 hours).
 */
export async function webhookRoutes(
  app: FastifyInstance,
  deps: { db: ApiDatabase; channexSecret: string | undefined },
) {
  await app.register(async (scope) => {
    // Keep the exact bytes: the signature covers the raw body, not re-serialised JSON.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body);
    });

    scope.post('/webhooks/channex', async (req, reply) => {
      if (!deps.channexSecret) {
        return reply
          .code(503)
          .send(errorBody('webhooks_disabled', 'Channex webhooks are not configured yet.'));
      }
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const check = verifyChannexWebhook({ rawBody, headers: req.headers, secret: deps.channexSecret });
      if (!check.ok) {
        req.log.warn({ reason: check.reason }, 'Rejected Channex webhook');
        return reply.code(401).send(errorBody('bad_signature', 'Webhook signature check failed.'));
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return reply.code(400).send(errorBody('bad_json', 'Webhook body is not valid JSON.'));
      }
      const event = ChannexWebhookSchema.safeParse(parsed);
      if (!event.success) {
        return reply.code(400).send(errorBody('bad_payload', 'Webhook body is missing its event name.'));
      }

      await deps.db.recordWebhook({
        provider: 'channex',
        event: event.data.event,
        externalPropertyId: event.data.property_id ?? null,
        payload: parsed,
      });
      return reply.code(200).send({ received: true });
    });
  });
}
