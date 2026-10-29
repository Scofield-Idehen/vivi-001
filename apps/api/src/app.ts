import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { appBrand } from '@v01/brand';
import type { ApiDatabase } from '@v01/db';
import { type LockProvider, SecretBox, TTLockProvider } from '@v01/integrations';
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
import { type InviteMailer, NO_INVITE_MAILER, SupabaseInviteMailer } from './invites.ts';
import { NO_PHOTO_STORE, type PhotoStore, SupabasePhotoStore } from './photos.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { channelRoutes } from './routes/channels.ts';
import { channexRoutes } from './routes/channex.ts';
import { cleaningRoutes } from './routes/cleaning.ts';
import { consoleRoutes } from './routes/console.ts';
import { fieldRoutes } from './routes/fields.ts';
import { guestRoutes } from './routes/guest.ts';
import { inboxRoutes } from './routes/inbox.ts';
import { lockRoutes } from './routes/locks.ts';
import { meRoutes } from './routes/me.ts';
import { memberRoutes } from './routes/members.ts';
import { overviewRoutes } from './routes/overview.ts';
import { propertyRoutes } from './routes/properties.ts';
import { reservationRoutes } from './routes/reservations.ts';
import { taskRoutes } from './routes/tasks.ts';
import { todayRoutes } from './routes/today.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { workspaceRoutes } from './routes/workspace.ts';

export interface AppDeps {
  env: Env;
  db: ApiDatabase;
  verifyToken: TokenVerifier;
  /** Defaults to Supabase Storage when it is configured. */
  photos?: PhotoStore;
  /** The field team's photos: a private bucket. Defaults to `photos` in tests. */
  taskPhotos?: PhotoStore;
  /** Defaults to Supabase Auth's invitation email when the service key is configured. */
  mailer?: InviteMailer;
  /** The clock, so tests can fix today for the guest page. */
  now?: () => Date;
  /** Defaults to TTLock when V-01's TTLock application is configured. */
  locks?: LockProvider | null;
}

function photoStoreFrom(env: Env, bucket: string): PhotoStore {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return NO_PHOTO_STORE;
  return new SupabasePhotoStore({
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    bucket,
  });
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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
  const box = deps.env.FIELD_SECRET_KEY ? new SecretBox(deps.env.FIELD_SECRET_KEY) : undefined;
  meRoutes(app, { db: deps.db, scope });
  workspaceRoutes(app, { scope });
  const photos = deps.photos ?? photoStoreFrom(deps.env, deps.env.PHOTO_BUCKET);
  const taskPhotos = deps.taskPhotos ?? deps.photos ?? photoStoreFrom(deps.env, deps.env.TASK_PHOTO_BUCKET);
  propertyRoutes(app, {
    scope,
    photos,
    box,
    bucket: deps.env.PHOTO_BUCKET,
  });
  fieldRoutes(app, { scope, box });
  calendarRoutes(app, { scope });
  reservationRoutes(app, { scope });
  cleaningRoutes(app, { scope });
  channexRoutes(app, { scope });
  channelRoutes(app, { scope });
  todayRoutes(app, { scope });
  overviewRoutes(app, { scope, now: deps.now });
  taskRoutes(app, { scope, photos: taskPhotos, bucket: deps.env.TASK_PHOTO_BUCKET, box });
  inboxRoutes(app, { scope });
  const lockProvider =
    deps.locks !== undefined
      ? deps.locks
      : deps.env.TTLOCK_CLIENT_ID && deps.env.TTLOCK_CLIENT_SECRET
        ? new TTLockProvider({
            clientId: deps.env.TTLOCK_CLIENT_ID,
            clientSecret: deps.env.TTLOCK_CLIENT_SECRET,
            baseUrl: deps.env.TTLOCK_API_URL,
          })
        : null;
  lockRoutes(app, { scope, provider: lockProvider, box });
  memberRoutes(app, {
    scope,
    mailer:
      deps.mailer ??
      (deps.env.SUPABASE_URL && deps.env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseInviteMailer({
            supabaseUrl: deps.env.SUPABASE_URL,
            serviceKey: deps.env.SUPABASE_SERVICE_ROLE_KEY,
          })
        : NO_INVITE_MAILER),
    // The app's address, for the link in the invitation: the first allowed browser origin.
    appUrl: (deps.env.CORS_ORIGINS.split(',')[0] ?? 'http://localhost:5173').trim().replace(/\/$/, ''),
  });
  guestRoutes(app, { db: deps.db, scope, box, now: deps.now });
  consoleRoutes(app, { scope });
  await webhookRoutes(app, { db: deps.db, channexSecret: deps.env.CHANNEX_WEBHOOK_SECRET });

  return app;
}
