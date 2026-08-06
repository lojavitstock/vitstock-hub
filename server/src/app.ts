import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { config } from './config.js';
import { db } from './db.js';
import { loadUser, registerAuthRoutes } from './auth.js';
import { registerEvolutionRoutes } from './evolution.js';
import { registerGoogleContactRoutes } from './google-contacts.js';

export async function createApp() {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
    },
    bodyLimit: 2 * 1024 * 1024,
  });

  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!origin) return true;
    if (origin === config.FRONTEND_URL) return true;
    if (config.NODE_ENV !== 'production') {
      return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    }
    return false;
  };

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || isAllowedOrigin(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Origem não permitida por CORS'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);

  app.decorateRequest('user', null);
  app.addHook('onRequest', loadUser);
  app.addHook('onRequest', async (request, reply) => {
    const changesState = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
    if (!changesState || !request.url.startsWith('/api/')) return;

    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return reply.code(403).send({ error: 'Origem não autorizada' });
    }
  });

  app.get('/health', async (_request, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'unavailable' });
    }
  });

  await registerAuthRoutes(app);
  await registerEvolutionRoutes(app);
  await registerGoogleContactRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Erro não tratado');
    const httpError = error as Error & { statusCode?: number; code?: string };
    const databaseUnavailable = ['53300', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH'].includes(httpError.code || '')
      || /timeout exceeded when trying to connect/i.test(httpError.message || '');
    const isCorsError = /Origem não permitida por CORS|Origem não autorizada/i.test(httpError.message || '');
    const statusCode = databaseUnavailable
      ? 503
      : isCorsError
        ? 403
        : httpError.statusCode && httpError.statusCode >= 400 && httpError.statusCode < 500
          ? httpError.statusCode
          : 500;
    const message = databaseUnavailable
      ? 'Banco de dados temporariamente indisponível'
      : isCorsError
        ? 'Origem não autorizada'
        : statusCode === 500 ? 'Erro interno' : httpError.message;
    reply.code(statusCode).send({ error: message });
  });

  return app;
}
