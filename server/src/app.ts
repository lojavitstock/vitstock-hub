import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { config, isAllowedFrontendOrigin } from './config.js';
import { db } from './db.js';
import { loadUser, registerAuthRoutes } from './auth.js';
import { registerEvolutionRoutes } from './evolution.js';
import { registerGoogleContactRoutes } from './google-contacts.js';
import { registerContactRoutes } from './contacts.js';
import { registerQaRoutes } from './qa.js';
import { registerConversationTagRoutes } from './conversationTags.js';

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
    if (isAllowedFrontendOrigin(origin)) return true;
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
  await registerContactRoutes(app);
  await registerConversationTagRoutes(app);
  await registerQaRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    const httpError = (error && typeof error === 'object' ? error : {}) as Error & { statusCode?: number; code?: string };
    const errorName = httpError.name || 'Error';
    const errorMessage = httpError.message || String(error);
    const errorCode = httpError.code;
    const errorStack = httpError.stack;
    const route = request.routeOptions?.url || request.url.split('?')[0];
    request.log.error({
      errorName,
      errorMessage,
      errorCode,
      errorStack,
      requestId: request.id,
      method: request.method,
      route,
    }, 'Erro não tratado');
    console.error('[API_ERROR]', JSON.stringify({
      errorName,
      errorMessage,
      errorCode,
      errorStack,
      requestId: request.id,
      method: request.method,
      route,
    }));
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
