import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { requireUser } from './auth.js';
import { decryptSecret, encryptSecret } from './security/encryption.js';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/contacts';
const contactSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(30),
  email: z.string().email().optional().or(z.literal('')),
});
const contactStatusSchema = z.object({ phone: z.string().trim().min(8).max(30) });
const googleContactFormSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(30),
  otherPhone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  cpf: z.string().trim().max(30).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  resourceName: z.string().trim().max(200).optional().or(z.literal('')),
});

type GooglePerson = {
  resourceName?: string;
  etag?: string;
  names?: Array<{ displayName?: string; givenName?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  addresses?: Array<{ formattedValue?: string; streetAddress?: string; city?: string; region?: string; postalCode?: string; country?: string }>;
  userDefined?: Array<{ key?: string; value?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
};

function ensureConfigured(reply: FastifyReply) {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    reply.code(503).send({ error: 'Integração Google ainda não configurada' });
    return false;
  }
  return true;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

export function phoneVariants(value: string) {
  const digits = normalizePhone(value);
  const variants = new Set<string>();
  const add = (candidate: string) => {
    if (candidate) variants.add(candidate);
  };

  add(digits);
  if (digits.startsWith('0') && digits.length > 10) add(digits.slice(1));

  // O Google pode retornar números brasileiros com ou sem o código 55.
  if (digits.startsWith('55') && digits.length >= 12) {
    const local = digits.slice(2);
    add(local);
    add(`55${local}`);
    if (local.length === 11 && local[2] === '9') {
      add(local.slice(0, 2) + local.slice(3));
      add(`55${local.slice(0, 2)}${local.slice(3)}`);
    }
    if (local.length === 10) {
      add(`${local.slice(0, 2)}9${local.slice(2)}`);
      add(`55${local.slice(0, 2)}9${local.slice(2)}`);
    }
  } else if (digits.length === 11 || digits.length === 10) {
    const local = digits;
    add(`55${local}`);
    if (local.length === 11 && local[2] === '9') {
      add(local.slice(0, 2) + local.slice(3));
      add(`55${local.slice(0, 2)}${local.slice(3)}`);
    }
    if (local.length === 10) {
      add(`${local.slice(0, 2)}9${local.slice(2)}`);
      add(`55${local.slice(0, 2)}9${local.slice(2)}`);
    }
  }
  return variants;
}

function callbackUrl() {
  return config.FRONTEND_URL.includes('localhost')
    ? 'http://localhost:3001/api/google/callback'
    : 'https://vitstock-hub-api-production.up.railway.app/api/google/callback';
}

function signState(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', config.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readState(value: string) {
  const [body, signature] = value.split('.');
  if (!body || !signature) throw new Error('Estado OAuth inválido');
  const expected = createHmac('sha256', config.SESSION_SECRET).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Estado OAuth inválido');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { companyId: string; exp: number };
  if (parsed.exp < Date.now()) throw new Error('Autorização expirada');
  return parsed;
}

async function googleFetch(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`https://people.googleapis.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Google People API respondeu ${response.status}`);
  return response;
}

async function accessTokenForCompany(companyId: string) {
  const result = await db.query<{
    refresh_token_encrypted: string;
    access_token_encrypted: string | null;
    access_token_expires_at: Date | null;
  }>('SELECT refresh_token_encrypted, access_token_encrypted, access_token_expires_at FROM google_connections WHERE company_id = $1', [companyId]);
  const connection = result.rows[0];
  if (!connection) throw new Error('Google Contacts não conectado');

  if (connection.access_token_encrypted && connection.access_token_expires_at && connection.access_token_expires_at.getTime() > Date.now() + 60_000) {
    return decryptSecret(connection.access_token_encrypted);
  }

  const body = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    client_secret: config.GOOGLE_CLIENT_SECRET!,
    refresh_token: decryptSecret(connection.refresh_token_encrypted),
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('Não foi possível renovar o acesso ao Google');
  const tokens = await response.json() as { access_token: string; expires_in: number };
  await db.query(
    'UPDATE google_connections SET access_token_encrypted = $2, access_token_expires_at = now() + ($3 * interval \'1 second\'), updated_at = now() WHERE company_id = $1',
    [companyId, encryptSecret(tokens.access_token), tokens.expires_in],
  );
  return tokens.access_token;
}

async function listGoogleContacts(accessToken: string) {
  const people: GooglePerson[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ personFields: 'names,phoneNumbers,emailAddresses,addresses,userDefined,photos', pageSize: '1000' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await googleFetch(`/people/me/connections?${query}`, accessToken);
    const data = await response.json() as { connections?: GooglePerson[]; nextPageToken?: string };
    people.push(...(data.connections || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return people;
}

type GoogleContactsCacheEntry = { expiresAt: number; people: GooglePerson[] };
const googleContactsCache = new Map<string, GoogleContactsCacheEntry>();
const googleContactsInFlight = new Map<string, Promise<GooglePerson[]>>();

async function listGoogleContactsForCompany(companyId: string) {
  const cached = googleContactsCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.people;

  const current = googleContactsInFlight.get(companyId);
  if (current) return current;

  const request = (async () => {
    const token = await accessTokenForCompany(companyId);
    const people = await listGoogleContacts(token);
    // Evita baixar a agenda inteira novamente ao abrir o painel repetidas vezes.
    googleContactsCache.set(companyId, { people, expiresAt: Date.now() + 60_000 });
    return people;
  })();
  googleContactsInFlight.set(companyId, request);
  try {
    return await request;
  } finally {
    googleContactsInFlight.delete(companyId);
  }
}

function personAddress(person: GooglePerson) {
  const address = person.addresses?.[0];
  if (!address) return '';
  if (address.formattedValue?.trim()) return address.formattedValue.trim();
  return [address.streetAddress, address.city, address.region, address.postalCode, address.country]
    .filter(Boolean)
    .join(', ')
    .trim();
}

function personCpf(person: GooglePerson) {
  return person.userDefined?.find((item) => ['cpf', 'documento', 'document'].includes((item.key || '').trim().toLowerCase()))?.value?.trim() || '';
}

function personPhoneValues(person: GooglePerson) {
  return Array.from(new Set((person.phoneNumbers || []).map((item) => normalizePhone(item.value || '')).filter(Boolean)));
}

async function upsertLocalContact(companyId: string, person: GooglePerson) {
  const phone = normalizePhone(person.phoneNumbers?.[0]?.value || '');
  const name = person.names?.[0]?.displayName?.trim();
  if (!phone || !name) return false;
  await db.query(
    `INSERT INTO contacts (company_id, name, phone, email, avatar_url, cpf, address, secondary_phone, google_resource_name, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'google')
     ON CONFLICT (company_id, phone) DO UPDATE SET
       name = CASE WHEN contacts.source = 'hub' AND contacts.name !~ '^\\+?[0-9 ]+$' THEN contacts.name ELSE EXCLUDED.name END,
       email = COALESCE(EXCLUDED.email, contacts.email),
       avatar_url = COALESCE(EXCLUDED.avatar_url, contacts.avatar_url),
       cpf = COALESCE(EXCLUDED.cpf, contacts.cpf),
       address = COALESCE(EXCLUDED.address, contacts.address),
       secondary_phone = COALESCE(EXCLUDED.secondary_phone, contacts.secondary_phone),
       google_resource_name = EXCLUDED.google_resource_name,
       source = CASE WHEN contacts.source = 'hub' THEN contacts.source ELSE 'google' END,
       updated_at = now()`,
    [companyId, name, phone, person.emailAddresses?.[0]?.value || null, person.photos?.find((photo) => !photo.default)?.url || null, personCpf(person) || null, personAddress(person) || null, personPhoneValues(person).find((value) => value !== phone) || null, person.resourceName || null],
  );
  return true;
}

async function upsertLocalContacts(companyId: string, people: GooglePerson[]) {
  const unique = new Map<string, {
    name: string;
    phone: string;
    email: string | null;
    avatarUrl: string | null;
    cpf: string | null;
    address: string | null;
    secondaryPhone: string | null;
    resourceName: string | null;
  }>();

  for (const person of people) {
    const name = person.names?.[0]?.displayName?.trim();
    if (!name) continue;
    for (const phoneValue of person.phoneNumbers || []) {
      const phone = normalizePhone(phoneValue.value || '');
      if (!phone) continue;
      unique.set(phone, {
        name,
        phone,
        email: person.emailAddresses?.[0]?.value || null,
        avatarUrl: person.photos?.find((photo) => !photo.default)?.url || null,
        cpf: personCpf(person) || null,
        address: personAddress(person) || null,
        secondaryPhone: personPhoneValues(person).find((value) => value !== phone) || null,
        resourceName: person.resourceName || null,
      });
    }
  }

  const contacts = Array.from(unique.values());
  if (contacts.length === 0) return 0;
  await db.query(
    `INSERT INTO contacts (company_id, name, phone, email, avatar_url, cpf, address, secondary_phone, google_resource_name, source)
     SELECT $1, item.name, item.phone, item.email, item.avatar_url, item.cpf, item.address, item.secondary_phone, item.resource_name, 'google'
     FROM jsonb_to_recordset($2::jsonb) AS item(
       name text, phone text, email text, avatar_url text, cpf text, address text, secondary_phone text, resource_name text
     )
     ON CONFLICT (company_id, phone) DO UPDATE SET
       name = CASE WHEN contacts.source = 'hub' AND contacts.name !~ '^\\+?[0-9 ]+$' THEN contacts.name ELSE EXCLUDED.name END,
       email = COALESCE(EXCLUDED.email, contacts.email),
       avatar_url = COALESCE(EXCLUDED.avatar_url, contacts.avatar_url),
       cpf = COALESCE(EXCLUDED.cpf, contacts.cpf),
       address = COALESCE(EXCLUDED.address, contacts.address),
       secondary_phone = COALESCE(EXCLUDED.secondary_phone, contacts.secondary_phone),
       google_resource_name = EXCLUDED.google_resource_name,
       source = CASE WHEN contacts.source = 'hub' THEN contacts.source ELSE 'google' END,
       updated_at = now()`,
    [companyId, JSON.stringify(contacts.map((contact) => ({
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      avatar_url: contact.avatarUrl,
      cpf: contact.cpf,
      address: contact.address,
      secondary_phone: contact.secondaryPhone,
      resource_name: contact.resourceName,
    })))],
  );
  return contacts.length;
}

export async function syncGoogleContactsForCompany(companyId: string) {
  const people = await listGoogleContactsForCompany(companyId);
  const imported = await upsertLocalContacts(companyId, people);
  return { imported, total: people.length };
}

function buildGooglePersonPayload(contact: z.infer<typeof googleContactFormSchema>) {
  const phoneValues = Array.from(new Set([normalizePhone(contact.phone), normalizePhone(contact.otherPhone || '')].filter(Boolean)));
  return {
    names: [{ givenName: contact.name }],
    phoneNumbers: phoneValues.map((value, index) => ({ value: `+${value}`, type: index === 0 ? 'mobile' : 'other' })),
    emailAddresses: contact.email ? [{ value: contact.email }] : [],
    addresses: contact.address ? [{ streetAddress: contact.address, type: 'home' }] : [],
    userDefined: contact.cpf ? [{ key: 'CPF', value: contact.cpf }] : [],
  };
}

export async function registerGoogleContactRoutes(app: FastifyInstance) {
  app.get('/api/google/status', { preHandler: requireUser }, async (request) => {
    const result = await db.query<{ google_email: string | null; connected_at: Date }>(
      'SELECT google_email, connected_at FROM google_connections WHERE company_id = $1', [request.user!.companyId],
    );
    return { connected: Boolean(result.rows[0]), connection: result.rows[0] || null };
  });

  app.get('/api/google/connect', { preHandler: requireUser }, async (request, reply) => {
    if (!ensureConfigured(reply)) return;
    const state = signState({ companyId: request.user!.companyId, exp: Date.now() + 10 * 60_000, nonce: randomBytes(16).toString('hex') });
    const query = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID!, redirect_uri: callbackUrl(), response_type: 'code', scope: GOOGLE_SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` };
  });

  app.get('/api/google/callback', async (request, reply) => {
    if (!ensureConfigured(reply)) return;
    const parsed = z.object({ code: z.string(), state: z.string() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Retorno OAuth inválido' });
    const state = readState(parsed.data.state);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ code: parsed.data.code, client_id: config.GOOGLE_CLIENT_ID!, client_secret: config.GOOGLE_CLIENT_SECRET!, redirect_uri: callbackUrl(), grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!tokenResponse.ok) return reply.code(502).send({ error: 'Google recusou a autorização' });
    const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
    if (!tokens.refresh_token) return reply.code(400).send({ error: 'Google não retornou acesso offline; autorize novamente' });
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
    await db.query(
      `INSERT INTO google_connections (company_id, google_email, refresh_token_encrypted, access_token_encrypted, access_token_expires_at, scopes)
       VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'), $6)
       ON CONFLICT (company_id) DO UPDATE SET google_email = EXCLUDED.google_email, refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         access_token_encrypted = EXCLUDED.access_token_encrypted, access_token_expires_at = EXCLUDED.access_token_expires_at,
         scopes = EXCLUDED.scopes, updated_at = now()`,
      [state.companyId, profile.email || null, encryptSecret(tokens.refresh_token), encryptSecret(tokens.access_token), tokens.expires_in, (tokens.scope || GOOGLE_SCOPE).split(' ')],
    );
    return reply.redirect(`${config.FRONTEND_URL}/contatos?google=connected`);
  });

  app.post('/api/google/sync', { preHandler: requireUser }, async (request) => {
    return syncGoogleContactsForCompany(request.user!.companyId);
  });

  app.post('/api/google/contact-status', { preHandler: requireUser }, async (request, reply) => {
    const parsed = contactStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Telefone inválido' });
    try {
      const variants = phoneVariants(parsed.data.phone);
      const local = await db.query<{
        name: string;
        phone: string;
        email: string | null;
        cpf: string | null;
        address: string | null;
        secondary_phone: string | null;
        google_resource_name: string | null;
        source: string | null;
      }>(
        `SELECT name, phone, email, cpf, address, secondary_phone, google_resource_name, source
         FROM contacts
         WHERE company_id = $1
           AND (
             regexp_replace(phone, '\\D', '', 'g') = ANY($2::text[])
             OR regexp_replace(COALESCE(secondary_phone, ''), '\\D', '', 'g') = ANY($2::text[])
           )
         ORDER BY CASE WHEN source = 'google' OR google_resource_name IS NOT NULL THEN 0 ELSE 1 END
         LIMIT 1`,
        [request.user!.companyId, [...variants]],
      );
      const localContact = local.rows[0];
      if (localContact && (localContact.source === 'google' || localContact.google_resource_name)) {
        return {
          connected: true,
          saved: true,
          name: localContact.name,
          resourceName: localContact.google_resource_name,
          email: localContact.email || '',
          cpf: localContact.cpf || '',
          address: localContact.address || '',
          otherPhone: localContact.secondary_phone || '',
          phone: normalizePhone(parsed.data.phone),
        };
      }

      // Só acessa a agenda remota quando não há um contato sincronizado localmente.
      const connection = await db.query('SELECT 1 FROM google_connections WHERE company_id = $1 LIMIT 1', [request.user!.companyId]);
      const phone = normalizePhone(parsed.data.phone);
      return {
        connected: Boolean(connection.rows[0]),
        saved: false,
        name: null,
        resourceName: null,
        email: '',
        cpf: '',
        address: '',
        otherPhone: '',
        phone,
      };
    } catch (error) {
      request.log.warn({ err: error }, 'Não foi possível verificar contato no Google');
      return { connected: false, saved: false, name: null };
    }
  });

  app.post('/api/google/contact', { preHandler: requireUser }, async (request, reply) => {
    const parsed = googleContactFormSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Preencha nome e telefone para salvar o contato' });
    const contact = parsed.data;
    const phone = normalizePhone(contact.phone);
    const otherPhone = normalizePhone(contact.otherPhone || '');
    if (!phone || phone.length < 8) return reply.code(400).send({ error: 'Telefone principal inválido' });
    if (otherPhone && otherPhone === phone) return reply.code(400).send({ error: 'O outro telefone deve ser diferente do principal' });

    try {
      const token = await accessTokenForCompany(request.user!.companyId);
      const people = await listGoogleContacts(token);
      const variants = phoneVariants(phone);
      const existing = contact.resourceName
        ? people.find((person) => person.resourceName === contact.resourceName)
        : people.find((person) => person.phoneNumbers?.some((item) => variants.has(normalizePhone(item.value || ''))));
      const payload = buildGooglePersonPayload(contact);
      const response = existing?.resourceName
        ? await googleFetch(`/${existing.resourceName}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers,addresses,userDefined`, token, {
            method: 'PATCH',
            body: JSON.stringify({ ...payload, etag: existing.etag }),
          })
        : await googleFetch('/people:createContact', token, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      const person = await response.json() as GooglePerson;
      const resourceName = person.resourceName || existing?.resourceName || null;
      await db.query(
        `INSERT INTO contacts (company_id, name, phone, email, cpf, address, secondary_phone, avatar_url, google_resource_name, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'google')
         ON CONFLICT (company_id, phone) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           cpf = EXCLUDED.cpf,
           address = EXCLUDED.address,
           secondary_phone = EXCLUDED.secondary_phone,
           avatar_url = COALESCE(EXCLUDED.avatar_url, contacts.avatar_url),
           google_resource_name = EXCLUDED.google_resource_name,
           source = 'google',
           updated_at = now()`,
        [request.user!.companyId, contact.name, phone, contact.email || null, contact.cpf || null, contact.address || null, otherPhone || null, person.photos?.find((photo) => !photo.default)?.url || null, resourceName],
      );
      return reply.code(existing ? 200 : 201).send({ saved: true, name: contact.name, resourceName, phone, otherPhone });
    } catch (error) {
      request.log.warn({ err: error }, 'Não foi possível salvar contato no Google');
      return reply.code(502).send({ error: 'Não foi possível salvar o contato no Google Contacts' });
    }
  });

  app.get('/api/contacts', { preHandler: requireUser }, async (request) => {
    const result = await db.query(
      `SELECT id, name, phone, email, avatar_url, notes, cpf, address, secondary_phone, source, created_at
       FROM contacts WHERE company_id = $1 ORDER BY name`, [request.user!.companyId],
    );
    return { contacts: result.rows };
  });

  app.post('/api/contacts', { preHandler: requireUser }, async (request, reply) => {
    const parsed = contactSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Contato inválido' });
    const phone = normalizePhone(parsed.data.phone);
    const local = await db.query<{ id: string }>(
      `INSERT INTO contacts (company_id, name, phone, email, source) VALUES ($1, $2, $3, $4, 'hub')
       ON CONFLICT (company_id, phone) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, source = 'hub', updated_at = now()
       RETURNING id`, [request.user!.companyId, parsed.data.name, phone, parsed.data.email || null],
    );

    let googleSynced = false;
    try {
      const token = await accessTokenForCompany(request.user!.companyId);
      const people = await listGoogleContacts(token);
      const existing = people.find((person) => person.phoneNumbers?.some((item) => normalizePhone(item.value || '') === phone));
      let person: GooglePerson;
      if (existing?.resourceName) {
        const response = await googleFetch(`/${existing.resourceName}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers`, token, {
          method: 'PATCH', body: JSON.stringify({ etag: existing.etag, names: [{ givenName: parsed.data.name }], phoneNumbers: [{ value: `+${phone}` }], emailAddresses: parsed.data.email ? [{ value: parsed.data.email }] : [] }),
        });
        person = await response.json() as GooglePerson;
      } else {
        const response = await googleFetch('/people:createContact', token, {
          method: 'POST', body: JSON.stringify({ names: [{ givenName: parsed.data.name }], phoneNumbers: [{ value: `+${phone}` }], emailAddresses: parsed.data.email ? [{ value: parsed.data.email }] : [] }),
        });
        person = await response.json() as GooglePerson;
      }
      await db.query('UPDATE contacts SET google_resource_name = $2 WHERE id = $1', [local.rows[0]!.id, person.resourceName || null]);
      googleSynced = true;
    } catch (error) {
      request.log.warn({ err: error }, 'Contato salvo localmente, mas não sincronizado com Google');
    }
    return reply.code(201).send({ id: local.rows[0]!.id, googleSynced });
  });
}
