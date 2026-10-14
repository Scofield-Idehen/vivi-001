import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { appBrand } from '@v01/brand';
import type { ApiDatabase } from '@v01/db';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { TokenVerifier } from './auth.ts';
import { RequestScope } from './context.ts';
import type { Env } from './env.ts';
import { errorBody, HttpError } from './errors.ts';
import { consoleRoutes } from './routes/console.ts';
import { meRoutes } from './routes/me.ts';
import { propertyRoutes } from './routes/properties.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { workspaceRoutes } from './routes/workspace.ts';

export interface AppDeps {
  env: Env;
  db: ApiDatabase;
  verifyToken: TokenVerifier;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      deps.env.NODE_ENV === 'test'
        ? false
        : {
            level: deps.env.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
    // Every log line for a request carries this id, so a booking can be followed from webhook to calendar.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
    },
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, {
    origin: deps.env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    allowedHeaders: ['authorization', 'content-type', 'x-org-id', 'x-request-id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((error: FastifyError | HttpError, req, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const first = error.validation[0];
      const field = first?.instancePath?.replace(/^\//, '').replace(/\//g, '.') || 'request';
      return reply
        .code(400)
        .send(errorBody('invalid_request', `${field}: ${first?.message ?? 'is not valid'}`));
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send(errorBody('bad_request', error.message));
    }
    req.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send(errorBody('internal_error', 'Something went wrong. It has been logged.'));
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send(errorBody('not_found', 'No such endpoint.')));

  app.get('/health', async (_req, reply) => {
    try {
      await deps.db.ping();
      return { status: 'ok', database: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'unreachable' });
    }
  });

  // The staff app's look (Vivistays for now). Public, so the sign-in page can use it.
  app.get('/v1/app-brand', async () => appBrand);

  const scope = new RequestScope(deps.db, deps.verifyToken);
  meRoutes(app, { db: deps.db, scope });
  workspaceRoutes(app, { scope });
  propertyRoutes(app, { scope });
  consoleRoutes(app, { scope });
  await webhookRoutes(app, { db: deps.db, channexSecret: deps.env.CHANNEX_WEBHOOK_SECRET });

  return app;
}
