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

const createAttendantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  password: z.string().min(8).max(256),
  role: z.enum(['attendant', 'admin']).default('attendant'),
});

const updateAttendantSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(180).optional(),
  password: z.string().min(8).max(256).optional(),
  role: z.enum(['attendant', 'admin']).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Nenhuma alteração informada' });

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

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ error: 'Não autenticado' });
  if (request.user.role !== 'admin') return reply.code(403).send({ error: 'Apenas administradores podem gerenciar a equipe' });
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

  app.get('/api/team/attendants', { preHandler: requireAdmin }, async (request) => {
    const result = await db.query<{
      id: string;
      name: string;
      email: string;
      role: 'admin' | 'attendant';
      active: boolean;
      online: boolean;
    }>(
      `SELECT u.id, u.name, u.email, u.role, u.active,
              EXISTS (
                SELECT 1 FROM sessions s
                WHERE s.user_id = u.id AND s.expires_at > now()
              ) AS online
       FROM users u
       WHERE u.company_id = $1
       ORDER BY u.active DESC, lower(u.name), lower(u.email)`,
      [request.user!.companyId],
    );

    return {
      attendants: result.rows.map((attendant) => ({
        id: attendant.id,
        name: attendant.name,
        email: attendant.email,
        role: attendant.role,
        active: attendant.active,
        online: attendant.online,
      })),
    };
  });

  app.post('/api/team/attendants', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createAttendantSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Informe nome, e-mail e uma senha de pelo menos 8 caracteres' });

    try {
      const passwordHash = await hashPassword(parsed.data.password);
      const result = await db.query<{
        id: string;
        name: string;
        email: string;
        role: 'admin' | 'attendant';
        active: boolean;
      }>(
        `INSERT INTO users (company_id, name, email, password_hash, role, active, must_change_password)
         VALUES ($1, $2, lower($3), $4, $5, true, true)
         RETURNING id, name, email, role, active`,
        [request.user!.companyId, parsed.data.name, parsed.data.email, passwordHash, parsed.data.role],
      );
      const attendant = result.rows[0];
      return reply.code(201).send({
        attendant: attendant ? { ...attendant, online: false } : undefined,
      });
    } catch (error: any) {
      if (error?.code === '23505') return reply.code(409).send({ error: 'Este e-mail já está cadastrado' });
      throw error;
    }
  });

  app.patch('/api/team/attendants/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = updateAttendantSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Informe ao menos uma alteração válida' });
    const memberId = String((request.params as { id?: string }).id || '').trim();
    if (!memberId) return reply.code(400).send({ error: 'Atendente inválido' });
    if (memberId === request.user!.id && parsed.data.active === false) return reply.code(400).send({ error: 'Você não pode desativar a própria conta' });
    if (memberId === request.user!.id && parsed.data.role && parsed.data.role !== 'admin') {
      return reply.code(400).send({ error: 'Você não pode remover seu próprio perfil de administrador' });
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    const addField = (field: string, value: unknown) => {
      fields.push(`${field} = $${values.length + 1}`);
      values.push(value);
    };
    if (parsed.data.name !== undefined) addField('name', parsed.data.name);
    if (parsed.data.email !== undefined) addField('email', parsed.data.email.toLowerCase());
    if (parsed.data.active !== undefined) addField('active', parsed.data.active);
    if (parsed.data.password !== undefined) addField('password_hash', await hashPassword(parsed.data.password));
    if (parsed.data.role !== undefined) addField('role', parsed.data.role);
    fields.push('updated_at = now()');
    values.push(memberId, request.user!.companyId);

    try {
      const result = await db.query(
        `UPDATE users SET ${fields.join(', ')}
         WHERE id = $${values.length - 1} AND company_id = $${values.length}
         RETURNING id, name, email, role, active`,
        values,
      );
      if (!result.rows[0]) return reply.code(404).send({ error: 'Atendente não encontrado' });
      return { attendant: { ...result.rows[0], online: false } };
    } catch (error: any) {
      if (error?.code === '23505') return reply.code(409).send({ error: 'Este e-mail já está cadastrado' });
      throw error;
    }
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (request) => ({ user: request.user }));
}
