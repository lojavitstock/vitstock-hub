import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { isProduction } from './config.js';
import { hashPassword, verifyPassword } from './security/password.js';
import {
  createSessionToken,
  hashSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from './security/session.js';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

export async function loadUser(request: FastifyRequest) {
  request.user = null;
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;

  const result = await db.query<{
    id: string;
    company_id: string;
    company_name: string;
    name: string;
    email: string;
    role: 'admin' | 'attendant';
  }>(
    `SELECT u.id, u.company_id, c.name AS company_name, u.name, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN companies c ON c.id = u.company_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true`,
    [hashSessionToken(token)],
  );

  const user = result.rows[0];
  if (user) {
    request.user = {
      id: user.id,
      companyId: user.company_id,
      companyName: user.company_name,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ error: 'Não autenticado' });
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Credenciais inválidas' });

    const result = await db.query<{
      id: string;
      company_id: string;
      company_name: string;
      name: string;
      email: string;
      role: 'admin' | 'attendant';
      password_hash: string;
      must_change_password: boolean;
    }>(
      `SELECT u.id, u.company_id, c.name AS company_name, u.name, u.email, u.role, u.password_hash, u.must_change_password
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE lower(u.email) = lower($1) AND u.active = true LIMIT 1`,
      [parsed.data.email],
    );

    const user = result.rows[0];
    if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
      return reply.code(401).send({ error: 'E-mail ou senha incorretos' });
    }

    const token = createSessionToken();
    await db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
      [user.id, hashSessionToken(token), SESSION_MAX_AGE_SECONDS],
    );

    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return {
      user: {
        id: user.id,
        companyId: user.company_id,
        companyName: user.company_name,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.must_change_password,
      },
    };
  });

  app.post('/api/auth/logout', { preHandler: requireUser }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.post('/api/auth/change-password', { preHandler: requireUser }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A nova senha deve ter pelo menos 8 caracteres' });

    const currentUser = request.user!;
    const result = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1 AND company_id = $2 AND active = true',
      [currentUser.id, currentUser.companyId],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.password_hash))) {
      return reply.code(400).send({ error: 'A senha atual está incorreta' });
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return reply.code(400).send({ error: 'A nova senha deve ser diferente da atual' });
    }

    await db.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = false, updated_at = now()
       WHERE id = $2 AND company_id = $3`,
      [await hashPassword(parsed.data.newPassword), currentUser.id, currentUser.companyId],
    );

    return { changed: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (request) => ({ user: request.user }));
}
