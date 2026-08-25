import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config, isLocalHost, isQaMode } from './config.js';
import { db } from './db.js';
import { requireAdmin, requireUser } from './auth.js';
import { decryptSecret, encryptSecret } from './security/encryption.js';
import { currentQaGoogleScenario, qaGoogleFailure, qaGooglePeople } from './qa.js';
import { canonicalPhone, phoneIdentityKeys } from './contactDomain.js';
import { publishRealtimeEvent } from './realtime.js';
import { classifyGooglePhoneMatch, googlePhoneKey, type GoogleContactCandidate } from './googleContactReconciliation.js';
import { mergeContactsInTransaction } from './contactMerge.js';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/contacts';
const GOOGLE_PERSON_FIELDS = [
  'names', 'nicknames', 'photos', 'coverPhotos', 'emailAddresses', 'phoneNumbers',
  'addresses', 'organizations', 'birthdays', 'biographies', 'occupations',
  'relations', 'urls', 'userDefined', 'events', 'metadata',
].join(',');
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
  otherPhones: z.union([z.string().trim().max(1000), z.array(z.string().trim().max(30))]).optional(),
  email: z.string().email().optional().or(z.literal('')),
  emails: z.union([z.string().trim().max(2000), z.array(z.string().email())]).optional(),
  cpf: z.string().trim().max(30).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  addresses: z.union([z.string().trim().max(3000), z.array(z.string().trim().max(500))]).optional(),
  birthday: z.string().trim().max(30).optional().or(z.literal('')),
  nickname: z.string().trim().max(160).optional().or(z.literal('')),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  jobTitle: z.string().trim().max(160).optional().or(z.literal('')),
  occupation: z.string().trim().max(160).optional().or(z.literal('')),
  relations: z.union([z.string().trim().max(2000), z.array(z.string().trim().max(500))]).optional(),
  events: z.union([z.string().trim().max(2000), z.array(z.string().trim().max(500))]).optional(),
  customFields: z.union([z.string().trim().max(3000), z.array(z.string().trim().max(500))]).optional(),
  website: z.string().trim().max(500).optional().or(z.literal('')),
  notes: z.string().trim().max(5000).optional().or(z.literal('')),
  resourceName: z.string().trim().max(200).optional().or(z.literal('')),
});

type GoogleDate = { year?: number; month?: number; day?: number };
type GooglePerson = {
  resourceName?: string;
  etag?: string;
  names?: Array<{ displayName?: string; givenName?: string; middleName?: string; familyName?: string }>;
  nicknames?: Array<{ value?: string; type?: string }>;
  phoneNumbers?: Array<{ value?: string; type?: string; formattedType?: string }>;
  emailAddresses?: Array<{ value?: string; type?: string; formattedType?: string }>;
  addresses?: Array<{ formattedValue?: string; streetAddress?: string; city?: string; region?: string; postalCode?: string; country?: string; type?: string; formattedType?: string }>;
  organizations?: Array<{ name?: string; title?: string; department?: string; type?: string; current?: boolean }>;
  birthdays?: Array<{ date?: GoogleDate; text?: string }>;
  biographies?: Array<{ value?: string; contentType?: string }>;
  occupations?: Array<{ value?: string }>;
  relations?: Array<{ person?: string; type?: string; formattedType?: string }>;
  urls?: Array<{ value?: string; type?: string; formattedType?: string }>;
  userDefined?: Array<{ key?: string; value?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
  events?: Array<{ date?: GoogleDate; type?: string; formattedType?: string }>;
  metadata?: Record<string, unknown>;
  coverPhotos?: Array<{ url?: string; default?: boolean }>;
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

function storagePhone(value: string) {
  return canonicalPhone(value, { defaultCountry: 'BR' }) || '';
}

/** Compatibility aliases for provider matching; never use these for contact identity or merges. */
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

export function resolveGoogleCallbackUrl(frontendUrl: string, configuredRedirectUri?: string) {
  if (configuredRedirectUri) return configuredRedirectUri;
  if (isLocalHost(frontendUrl)) return 'http://localhost:3001/api/google/callback';
  throw new Error('GOOGLE_REDIRECT_URI é obrigatório fora do ambiente local');
}

function callbackUrl() {
  return resolveGoogleCallbackUrl(config.FRONTEND_URL, config.GOOGLE_REDIRECT_URI);
}

function settingsGoogleRedirect(result: 'connected' | 'error' | 'mock-connected') {
  return `${config.FRONTEND_URL}/configuracoes?tab=integracoes&google=${result}`;
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
  if (isQaMode) throw new Error('QA_MODE bloqueou chamada Google externa');
  const response = await fetch(`https://people.googleapis.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const provider = await response.json().catch(() => null) as {
      error?: { status?: unknown; message?: unknown; errors?: Array<{ reason?: unknown }> };
    } | null;
    const providerError = provider?.error;
    const providerReason = typeof providerError?.status === 'string'
      ? providerError.status
      : typeof providerError?.errors?.[0]?.reason === 'string'
        ? providerError.errors[0].reason
        : undefined;
    const providerMessage = typeof providerError?.message === 'string' ? providerError.message : undefined;
    const error = new Error(`Google People API respondeu ${response.status}`) as Error & {
      status: number;
      providerReason?: string;
      providerMessage?: string;
    };
    error.status = response.status;
    error.providerReason = providerReason;
    error.providerMessage = providerMessage;
    throw error;
  }
  return response;
}

async function accessTokenForCompany(companyId: string) {
  if (isQaMode) throw new Error('QA_MODE usa somente o mock local do Google');
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
  if (!response.ok) {
    const provider = await response.json().catch(() => null) as { error?: unknown } | null;
    const error = new Error('Não foi possível renovar o acesso ao Google') as Error & { status: number; providerCode?: string };
    error.status = response.status;
    if (typeof provider?.error === 'string') error.providerCode = provider.error;
    throw error;
  }
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
    const query = new URLSearchParams({ personFields: GOOGLE_PERSON_FIELDS, pageSize: '1000' });
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

async function listGoogleContactsForCompany(companyId: string, forceRefresh = false) {
  if (forceRefresh) googleContactsCache.delete(companyId);
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

function personAddresses(person: GooglePerson) {
  return (person.addresses || []).map((address) => {
    if (address.formattedValue?.trim()) return address.formattedValue.trim();
    return [address.streetAddress, address.city, address.region, address.postalCode, address.country]
      .filter(Boolean)
      .join(', ')
      .trim();
  }).filter(Boolean);
}

function personEmailValues(person: GooglePerson) {
  return Array.from(new Set((person.emailAddresses || []).map((item) => item.value?.trim() || '').filter(Boolean)));
}

function formatGoogleDate(value?: GoogleDate) {
  if (!value?.month || !value.day) return '';
  const month = String(value.month).padStart(2, '0');
  const day = String(value.day).padStart(2, '0');
  return value.year ? `${value.year}-${month}-${day}` : `${month}-${day}`;
}

function personBirthday(person: GooglePerson) {
  return formatGoogleDate(person.birthdays?.[0]?.date);
}

function personOrganization(person: GooglePerson) {
  const organization = person.organizations?.find((item) => item.current !== false) || person.organizations?.[0];
  return {
    company: organization?.name?.trim() || '',
    jobTitle: organization?.title?.trim() || '',
  };
}

function personWebsite(person: GooglePerson) {
  return person.urls?.find((item) => item.value?.trim())?.value?.trim() || '';
}

function personNotes(person: GooglePerson) {
  return person.biographies?.map((item) => item.value?.trim() || '').filter(Boolean).join('\n\n') || '';
}

function personNickname(person: GooglePerson) {
  return person.nicknames?.find((item) => item.value?.trim())?.value?.trim() || '';
}

function personOccupation(person: GooglePerson) {
  return person.occupations?.find((item) => item.value?.trim())?.value?.trim() || '';
}

function personRelations(person: GooglePerson) {
  return (person.relations || []).map((item) => [item.type || item.formattedType, item.person].filter(Boolean).join(': ')).filter(Boolean).join('\n');
}

function personEvents(person: GooglePerson) {
  return (person.events || []).map((item) => {
    const date = formatGoogleDate(item.date);
    return [item.type || item.formattedType, date].filter(Boolean).join(': ');
  }).filter(Boolean).join('\n');
}

function personCustomFields(person: GooglePerson) {
  return (person.userDefined || [])
    .filter((item) => item.key && !['cpf', 'documento', 'document'].includes(item.key.trim().toLowerCase()))
    .map((item) => `${item.key}: ${item.value || ''}`)
    .join('\n');
}

function personDisplayName(person: GooglePerson) {
  const name = person.names?.[0];
  return name?.displayName?.trim() || [name?.givenName, name?.middleName, name?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function splitFormValues(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : (value || '').split(/[;,\n]/);
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function splitLabeledLines(value: string | string[] | undefined) {
  const lines = Array.isArray(value) ? value : (value || '').split(/\r?\n/);
  return lines.map((item) => item.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf(':');
    return separator > 0
      ? { key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }
      : { key: 'other', value: line };
  }).filter((item) => item.value);
}

function parseBirthday(value: string) {
  const clean = value.trim();
  if (!clean) return undefined;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const brazilian = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brazilian) return { year: Number(brazilian[3]), month: Number(brazilian[2]), day: Number(brazilian[1]) };
  const partial = clean.match(/^(\d{2})[-\/]?(\d{2})$/);
  if (partial) return { month: Number(partial[1]), day: Number(partial[2]) };
  return undefined;
}

function contactFieldsFromPerson(person: GooglePerson) {
  const phones = personPhoneValues(person);
  const emails = personEmailValues(person);
  const organization = personOrganization(person);
  return {
    name: personDisplayName(person),
    phone: phones[0] || '',
    otherPhones: phones.slice(1),
    email: emails[0] || '',
    emails,
    cpf: personCpf(person),
    address: personAddress(person),
    addresses: personAddresses(person),
    birthday: personBirthday(person),
    nickname: personNickname(person),
    company: organization.company,
    jobTitle: organization.jobTitle,
    occupation: personOccupation(person),
    relations: personRelations(person),
    events: personEvents(person),
    customFields: personCustomFields(person),
    website: personWebsite(person),
    notes: personNotes(person),
    resourceName: person.resourceName || '',
    etag: person.etag || '',
    avatarUrl: person.photos?.find((photo) => !photo.default)?.url || '',
    googleData: person,
  };
}

export function buildGooglePhonePlan(input: {
  requestedPhone: string;
  otherPhones: string[];
  existingPhone?: string;
  preserveExistingPhone: boolean;
}) {
  const primaryPhone = input.preserveExistingPhone && input.existingPhone
    ? input.existingPhone
    : input.requestedPhone;
  const phones = Array.from(new Set([
    primaryPhone,
    ...(primaryPhone !== input.requestedPhone ? [input.requestedPhone] : []),
    ...input.otherPhones,
  ].filter(Boolean)));
  return {
    primaryPhone,
    secondaryPhone: phones.find((phone) => phone !== primaryPhone) || null,
    phones,
  };
}

async function upsertLocalContact(companyId: string, person: GooglePerson) {
  const phone = storagePhone(person.phoneNumbers?.[0]?.value || '');
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
    [companyId, name, phone, person.emailAddresses?.[0]?.value || null, person.photos?.find((photo) => !photo.default)?.url || null, personCpf(person) || null, personAddress(person) || null, personPhoneValues(person).find((value) => storagePhone(value) !== phone) || null, person.resourceName || null],
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
      const phone = storagePhone(phoneValue.value || '');
      if (!phone) continue;
      unique.set(phone, {
        name,
        phone,
        email: person.emailAddresses?.[0]?.value || null,
        avatarUrl: person.photos?.find((photo) => !photo.default)?.url || null,
        cpf: personCpf(person) || null,
        address: personAddress(person) || null,
        secondaryPhone: personPhoneValues(person).find((value) => storagePhone(value) !== phone) || null,
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

type GoogleUpsertSummary = {
  imported: number;
  created: number;
  reconciled: number;
  updated: number;
  conflicts: number;
  affectedContactIds: string[];
};

type ExistingGoogleMatch = {
  id: string;
  name: string;
  phone: string;
  manual_override: Record<string, unknown> | null;
  source: string | null;
  google_resource_name: string | null;
  has_whatsapp_identity: boolean;
  has_whatsapp_phone: boolean;
  conversation_count: number;
};

type SqlExecutor = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
};

async function applyGoogleFieldsToContact(
  executor: SqlExecutor,
  companyId: string,
  contactId: string,
  row: ExistingGoogleMatch,
  fields: ReturnType<typeof contactFieldsFromPerson>,
  requestedPhone: string,
  requestedDigits: string[],
) {
  const manualOverride = (row.manual_override || {}) as Record<string, string>;
  const preservePhone = manualOverride.phone === 'manual';
  const preserveEmail = manualOverride.email === 'manual';
  let phoneConflict = false;
  if (row.phone) {
    const phoneOwner = await executor.query(
      `SELECT id FROM contacts
       WHERE company_id = $1 AND id <> $3
         AND (regexp_replace(phone, '\\D', '', 'g') = ANY($2::text[])
              OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.company_id = contacts.company_id AND cp.contact_id = contacts.id AND cp.normalized_phone = ANY($2::text[])))
       LIMIT 1`, [companyId, requestedDigits, contactId],
    );
    phoneConflict = phoneOwner.rows.length > 0;
  }
  const phonePlan = buildGooglePhonePlan({
    requestedPhone,
    otherPhones: fields.otherPhones,
    existingPhone: row.phone,
    preserveExistingPhone: preservePhone || phoneConflict,
  });
  const primaryPhone = preservePhone || phoneConflict
    ? phonePlan.primaryPhone
    : (storagePhone(phonePlan.primaryPhone) || phonePlan.primaryPhone);
  const plannedPhones = Array.from(new Set(phonePlan.phones.map((phone) => storagePhone(phone) || phone)));
  const secondaryPhone = plannedPhones.find((phone) => phone !== primaryPhone) || null;
  await executor.query(
    `UPDATE contacts SET
       name = CASE WHEN manual_override ? 'name' THEN name ELSE $2 END,
       phone = CASE WHEN manual_override ? 'phone' THEN phone ELSE $3 END,
       email = CASE WHEN manual_override ? 'email' THEN email ELSE $4 END,
       avatar_url = COALESCE($5, avatar_url), cpf = CASE WHEN manual_override ? 'cpf' THEN cpf ELSE $6 END,
       address = CASE WHEN manual_override ? 'address' THEN address ELSE $7 END,
       secondary_phone = CASE WHEN manual_override ? 'phone' THEN secondary_phone ELSE $8 END,
       google_resource_name = $9, source = CASE WHEN source = 'hub' THEN source ELSE 'google' END,
       nickname = CASE WHEN manual_override ? 'nickname' THEN nickname ELSE $10 END,
       birthday = CASE WHEN manual_override ? 'birthday' THEN birthday ELSE $11 END,
       company = CASE WHEN manual_override ? 'company' THEN company ELSE $12 END,
       job_title = CASE WHEN manual_override ? 'jobTitle' THEN job_title ELSE $13 END,
       website = CASE WHEN manual_override ? 'website' THEN website ELSE $14 END,
       notes = CASE WHEN manual_override ? 'notes' THEN notes ELSE $15 END,
       google_etag = $16, google_data = $17, google_synced_at = now(), updated_at = now(), version = version + 1
     WHERE company_id = $1 AND id = $18`,
    [companyId, fields.name, primaryPhone, fields.email || null, fields.avatarUrl || null, fields.cpf || null, fields.address || null, secondaryPhone, fields.resourceName || null, fields.nickname || null, fields.birthday || null, fields.company || null, fields.jobTitle || null, fields.website || null, fields.notes || null, fields.etag || null, fields.googleData, contactId],
  );
  if (!preservePhone) await executor.query('UPDATE contact_phones SET is_primary = false, updated_at = now() WHERE contact_id = $1', [contactId]);
  if (!preserveEmail) await executor.query('UPDATE contact_emails SET is_primary = false, updated_at = now() WHERE contact_id = $1', [contactId]);
  for (const [index, phone] of plannedPhones.entries()) {
    await executor.query(
      `INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source)
       VALUES ($1, $2, $3, $4, $5, 'google')
       ON CONFLICT (contact_id, normalized_phone) DO UPDATE SET
         phone = EXCLUDED.phone,
         is_primary = EXCLUDED.is_primary,
         source = CASE WHEN contact_phones.source = 'whatsapp' THEN contact_phones.source ELSE 'google' END,
         updated_at = now()`,
      [companyId, contactId, phone, normalizePhone(storagePhone(phone) || phone), index === 0 && !preservePhone],
    );
  }
  for (const [index, email] of fields.emails.entries()) {
    await executor.query(
      `INSERT INTO contact_emails (company_id, contact_id, email, normalized_email, is_primary, source)
       VALUES ($1, $2, $3, $4, $5, 'google')
       ON CONFLICT (contact_id, normalized_email) DO UPDATE SET email = EXCLUDED.email, is_primary = EXCLUDED.is_primary, source = 'google', updated_at = now()`,
      [companyId, contactId, email, email.toLowerCase(), index === 0 && !preserveEmail],
    );
  }
}

async function upsertFullLocalContacts(companyId: string, people: GooglePerson[]): Promise<GoogleUpsertSummary> {
  let imported = 0;
  let created = 0;
  let reconciled = 0;
  let updated = 0;
  let conflicts = 0;
  const affectedContactIds: string[] = [];
  const reconciliationAudits: Array<{ contactId: string; beforeName: string; afterName: string; resourceName: string }> = [];
  const peopleByPhone = new Map<string, Set<string>>();
  people.forEach((person, index) => {
    const personKey = person.resourceName || `anonymous:${index}`;
    for (const phoneValue of person.phoneNumbers || []) {
      const phone = storagePhone(phoneValue.value || '');
      const key = phone ? googlePhoneKey(phone) : '';
      if (!key) continue;
      const resourceNames = peopleByPhone.get(key) || new Set<string>();
      resourceNames.add(personKey);
      peopleByPhone.set(key, resourceNames);
    }
  });

  for (const person of people) {
    const fields = contactFieldsFromPerson(person);
    if (!fields.name || !fields.phone) continue;
    const requestedPhone = storagePhone(fields.phone);
    if (!requestedPhone) continue;
    const requestedDigits = phoneIdentityKeys(requestedPhone, { defaultCountry: 'BR' }).filter((value) => /^\d+$/.test(value));
    const existing = await db.query<ExistingGoogleMatch>(
      `SELECT c.id, c.name, c.phone, c.manual_override, c.source, c.google_resource_name,
          EXISTS (SELECT 1 FROM contact_channel_identities ci WHERE ci.company_id = c.company_id AND ci.contact_id = c.id AND ci.channel = 'whatsapp') AS has_whatsapp_identity,
          EXISTS (SELECT 1 FROM contact_phones cpw WHERE cpw.company_id = c.company_id AND cpw.contact_id = c.id AND cpw.source = 'whatsapp') AS has_whatsapp_phone,
          (SELECT COUNT(*)::int FROM conversations cv WHERE cv.company_id = c.company_id AND cv.contact_id = c.id) AS conversation_count
       FROM contacts c
       WHERE c.company_id = $1 AND c.archived_at IS NULL AND c.merged_into_contact_id IS NULL
         AND (c.google_resource_name = $2
          OR regexp_replace(c.phone, '\\D', '', 'g') = ANY($3::text[])
          OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.company_id = c.company_id AND cp.contact_id = c.id AND cp.normalized_phone = ANY($3::text[])))`,
      [companyId, person.resourceName || '', requestedDigits],
    );
    const googlePersonCount = peopleByPhone.get(googlePhoneKey(requestedPhone))?.size || 1;
    const candidates: GoogleContactCandidate[] = existing.rows.map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      manualOverride: candidate.manual_override,
      hasWhatsappIdentity: candidate.has_whatsapp_identity,
      hasWhatsappPhone: candidate.has_whatsapp_phone,
      googleResourceName: candidate.google_resource_name,
      conversationCount: candidate.conversation_count,
    }));
    const decision = classifyGooglePhoneMatch({ candidates, googlePersonCount, resourceName: person.resourceName });
    if (decision === 'ambiguous') {
      conflicts += 1;
      continue;
    }
    const linkedRow = existing.rows.find((candidate) => candidate.google_resource_name === person.resourceName);
    const provisionalRow = existing.rows.find((candidate) => candidate.id !== linkedRow?.id
      && candidate.source === 'hub'
      && !candidate.google_resource_name
      && (candidate.has_whatsapp_identity || candidate.has_whatsapp_phone)
      && !Object.keys(candidate.manual_override || {}).length);
    const row = decision === 'safe_reconcile_linked' ? provisionalRow : (linkedRow || existing.rows[0]);
    const redundantGoogleRow = decision === 'safe_reconcile_linked' ? linkedRow : undefined;
    let contactId = row?.id;
    if (!contactId) {
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO contacts (company_id, name, phone, email, avatar_url, cpf, address, secondary_phone,
          google_resource_name, source, nickname, birthday, company, job_title, website, notes,
          google_etag, google_data, google_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'google', $10, $11, $12, $13, $14, $15, $16, $17, now())
         ON CONFLICT (company_id, phone) DO NOTHING
         RETURNING id`,
        [companyId, fields.name, requestedPhone, fields.email || null, fields.avatarUrl || null, fields.cpf || null, fields.address || null, fields.otherPhones[0] || null, fields.resourceName || null, fields.nickname || null, fields.birthday || null, fields.company || null, fields.jobTitle || null, fields.website || null, fields.notes || null, fields.etag || null, fields.googleData],
      );
      contactId = inserted.rows[0]?.id;
      if (contactId) created += 1;
    }
    if (!contactId) {
      conflicts += 1;
      continue;
    }
    if (decision === 'safe_reconcile_linked' && redundantGoogleRow) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await applyGoogleFieldsToContact(client, companyId, contactId, row!, fields, requestedPhone, requestedDigits);
        const merge = await mergeContactsInTransaction(client, {
          companyId,
          sourceContactId: redundantGoogleRow.id,
          targetContactId: contactId,
          performedBy: null,
          fieldSnapshot: {
            sourceId: redundantGoogleRow.id,
            targetId: contactId,
            reason: 'google_whatsapp_legacy_reconciliation',
            resourceName: person.resourceName || null,
          },
        });
        if (!merge) throw new Error('Legacy Google/WhatsApp merge became unsafe before commit');
        await client.query(
          `INSERT INTO contact_audit_logs (company_id, contact_id, actor_user_id, action, before_data, after_data)
           VALUES ($1, $2, NULL, 'contact.google_whatsapp_reconciled', $3::jsonb, $4::jsonb)`,
          [companyId, contactId, JSON.stringify({ name: row!.name, source: 'hub', conversations: row!.conversation_count }), JSON.stringify({ name: fields.name, googleResourceName: fields.resourceName, mergedGoogleContactId: redundantGoogleRow.id })],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      imported += 1;
      reconciled += 1;
      affectedContactIds.push(contactId);
      continue;
    }
    await applyGoogleFieldsToContact({ query: (text, values) => db.query(text, values) }, companyId, contactId, row!, fields, requestedPhone, requestedDigits);
    imported += 1;
    affectedContactIds.push(contactId);
    if (decision === 'safe_reconcile') {
      reconciled += 1;
      reconciliationAudits.push({ contactId, beforeName: row?.name || '', afterName: fields.name, resourceName: fields.resourceName });
    }
    if (decision === 'linked') updated += 1;
  }
  if (reconciliationAudits.length) {
    await db.query(
      `INSERT INTO contact_audit_logs (company_id, contact_id, actor_user_id, action, before_data, after_data)
       SELECT $1, item.contact_id, NULL, 'contact.google_reconciled', item.before_data, item.after_data
       FROM jsonb_to_recordset($2::jsonb) AS item(contact_id uuid, before_data jsonb, after_data jsonb)`,
      [companyId, JSON.stringify(reconciliationAudits.map((audit) => ({
        contact_id: audit.contactId,
        before_data: { name: audit.beforeName, source: 'whatsapp_provisional' },
        after_data: { name: audit.afterName, googleResourceName: audit.resourceName },
      })))],
    );
  }
  return { imported, created, reconciled, updated, conflicts, affectedContactIds: Array.from(new Set(affectedContactIds)) };
}

async function publishGoogleContactUpdates(companyId: string, contactIds: string[]) {
  if (!contactIds.length) return;
  const conversations = await db.query<{ remoteJid: string; phone: string; name: string }>(
    `SELECT cv.evolution_remote_jid AS "remoteJid", c.phone, c.name
     FROM conversations cv JOIN contacts c ON c.id = cv.contact_id AND c.company_id = cv.company_id
     WHERE cv.company_id = $1 AND cv.contact_id = ANY($2::uuid[])`, [companyId, contactIds],
  );
  for (const conversation of conversations.rows) {
    if (!conversation.remoteJid || !conversation.name) continue;
    publishRealtimeEvent(companyId, 'conversation.updated', {
      remoteJid: conversation.remoteJid,
      phone: conversation.phone,
      contactName: conversation.name,
    });
  }
}

export async function syncGoogleContactsForCompany(companyId: string) {
  const people = await listGoogleContactsForCompany(companyId, true);
  const upsertResult = await upsertFullLocalContacts(companyId, people);
  await publishGoogleContactUpdates(companyId, upsertResult.affectedContactIds);
  const resourceNames = people.map((person) => person.resourceName).filter((value): value is string => Boolean(value));
  await db.query(
    `UPDATE contacts
     SET google_resource_name = NULL,
         google_etag = NULL,
         google_data = '{}'::jsonb,
         google_synced_at = NULL,
         source = CASE WHEN source = 'google' THEN 'hub' ELSE source END,
         updated_at = now()
     WHERE company_id = $1
       AND google_resource_name IS NOT NULL
       AND NOT (google_resource_name = ANY($2::text[]))`,
    [companyId, resourceNames],
  );
  return { ...upsertResult, total: people.length };
}

type GoogleSyncError = {
  status: number;
  error: string;
  code: string;
  retryable: boolean;
};

/** Keeps provider/schema failures actionable without exposing internal errors. */
export function googleSyncErrorResponse(error: unknown): GoogleSyncError {
  const details = (error || {}) as { code?: unknown; status?: unknown; message?: unknown; providerCode?: unknown };
  const code = typeof details.code === 'string' ? details.code : '';
  const status = typeof details.status === 'number' ? details.status : 0;
  const message = typeof details.message === 'string' ? details.message.toLowerCase() : '';
  const providerCode = typeof details.providerCode === 'string' ? details.providerCode : '';

  if (code === '42703' || code === '42P01') {
    return {
      status: 503,
      error: 'O banco de contatos ainda não está atualizado para a sincronização Google.',
      code: 'GOOGLE_SCHEMA_OUTDATED',
      retryable: false,
    };
  }
  if (providerCode === 'invalid_grant' || status === 401 || status === 403 || message.includes('não conectado')) {
    return { status: 401, error: 'Sua conexão com o Google precisa ser renovada. Reconecte sua conta para continuar.', code: 'GOOGLE_AUTH_REQUIRED', retryable: false };
  }
  if (status === 429) {
    return { status: 429, error: 'O Google limitou temporariamente a sincronização. Tente novamente em alguns instantes.', code: 'GOOGLE_RATE_LIMITED', retryable: true };
  }
  if (message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) {
    return { status: 504, error: 'A sincronização Google demorou mais que o esperado. Tente novamente.', code: 'GOOGLE_SYNC_TIMEOUT', retryable: true };
  }
  return { status: 502, error: 'Não foi possível concluir a sincronização com o Google Contacts.', code: 'GOOGLE_SYNC_FAILED', retryable: true };
}

export type GoogleIntegrationState = 'not_connected' | 'connected' | 'reconnect_required' | 'syncing' | 'error';

export function googleIntegrationState(connection: { sync_status?: string } | null | undefined): GoogleIntegrationState {
  if (!connection) return 'not_connected';
  if (connection.sync_status === 'auth_required') return 'reconnect_required';
  if (connection.sync_status === 'syncing') return 'syncing';
  if (connection.sync_status === 'error') return 'error';
  return 'connected';
}

async function updateGoogleSyncState(
  companyId: string,
  status: 'never' | 'syncing' | 'success' | 'auth_required' | 'error',
  result?: { imported?: number; total?: number; error?: string },
) {
  await db.query(
    `UPDATE google_connections
     SET sync_status = $2,
         last_sync_at = CASE WHEN $2 = 'success' THEN now() ELSE last_sync_at END,
         last_sync_imported = CASE WHEN $2 = 'success' THEN $3 ELSE last_sync_imported END,
         last_sync_total = CASE WHEN $2 = 'success' THEN $4 ELSE last_sync_total END,
         last_sync_error = CASE WHEN $2 IN ('success', 'syncing') THEN NULL ELSE $5 END,
         updated_at = now()
     WHERE company_id = $1`,
    [companyId, status, result?.imported ?? null, result?.total ?? null, result?.error ?? null],
  );
}

function buildGooglePersonPayload(contact: z.infer<typeof googleContactFormSchema>) {
  const phoneValues = Array.from(new Set([
    normalizePhone(contact.phone),
    ...splitFormValues(contact.otherPhone).map(normalizePhone),
    ...splitFormValues(contact.otherPhones).map(normalizePhone),
  ].filter(Boolean)));
  const emailValues = Array.from(new Set([
    ...(contact.email ? [contact.email.trim()] : []),
    ...splitFormValues(contact.emails),
  ].filter(Boolean)));
  const birthday = parseBirthday(contact.birthday || '');
  const events = splitLabeledLines(contact.events).map((item) => {
    const date = parseBirthday(item.value);
    return date ? { type: item.key, date } : null;
  }).filter((item): item is { type: string; date: { year?: number; month: number; day: number } } => Boolean(item));
  const relations = splitLabeledLines(contact.relations).map((item) => ({ type: item.key, person: item.value }));
  const customFields = splitLabeledLines(contact.customFields)
    .filter((item) => !['cpf', 'documento', 'document'].includes(item.key.toLowerCase()))
    .map((item) => ({ key: item.key, value: item.value }));
  if (contact.cpf) customFields.unshift({ key: 'CPF', value: contact.cpf });
  const addressValues = Array.from(new Set([
    ...(contact.address ? [contact.address.trim()] : []),
    ...((Array.isArray(contact.addresses) ? contact.addresses : (contact.addresses || '').split(/\r?\n/))
      .map((value) => value.trim()).filter(Boolean)),
  ]));
  return {
    names: [{ givenName: contact.name }],
    nicknames: contact.nickname ? [{ value: contact.nickname }] : [],
    phoneNumbers: phoneValues.map((value, index) => ({ value: `+${value}`, type: index === 0 ? 'mobile' : 'other' })),
    emailAddresses: emailValues.map((value, index) => ({ value, type: index === 0 ? 'home' : 'other' })),
    addresses: addressValues.map((value, index) => ({ streetAddress: value, type: index === 0 ? 'home' : 'other' })),
    birthdays: birthday ? [{ date: birthday }] : [],
    occupations: contact.occupation ? [{ value: contact.occupation }] : [],
    relations,
    events,
    organizations: contact.company || contact.jobTitle ? [{ name: contact.company || undefined, title: contact.jobTitle || undefined, current: true }] : [],
    urls: contact.website ? [{ value: contact.website, type: 'home' }] : [],
    biographies: contact.notes ? [{ value: contact.notes, contentType: 'TEXT_PLAIN' }] : [],
    userDefined: customFields,
  };
}

export function buildGoogleContactUpdatePayload(
  existing: Pick<GooglePerson, 'resourceName' | 'etag' | 'metadata'>,
  payload: Record<string, unknown>,
) {
  return {
    ...payload,
    resourceName: existing.resourceName,
    etag: existing.etag,
    metadata: existing.metadata,
  };
}

type GoogleContactErrorResponse = {
  status: number;
  error: string;
  code: string;
  retryable?: boolean;
  conflict?: boolean;
};

export function googleContactErrorResponse(error: unknown): GoogleContactErrorResponse {
  const details = (error || {}) as {
    code?: unknown;
    constraint?: unknown;
    status?: unknown;
    providerReason?: unknown;
  };
  const status = typeof details.status === 'number' ? details.status : 0;
  const providerReason = typeof details.providerReason === 'string' ? details.providerReason.toLowerCase() : '';

  if (details.code === '23505' && details.constraint === 'contacts_company_id_phone_key') {
    return {
      status: 409,
      error: 'O telefone informado já pertence a outro contato. Revise a duplicidade antes de salvar.',
      code: 'CONTACT_PHONE_CONFLICT',
      conflict: true,
    };
  }
  if (status === 412 || (status === 400 && (providerReason === 'failed_precondition' || providerReason === 'failedprecondition'))) {
    return {
      status: 409,
      error: 'O contato foi alterado no Google. Atualize os dados e tente novamente.',
      code: 'GOOGLE_CONTACT_CONFLICT',
      conflict: true,
    };
  }
  if (status === 400) {
    return { status: 400, error: 'Os dados enviados para o Google são inválidos. Revise o contato e tente novamente.', code: 'GOOGLE_CONTACT_INVALID' };
  }
  if (status === 401) {
    return { status: 401, error: 'Sua conexão com o Google precisa ser renovada. Reconecte sua conta para continuar.', code: 'GOOGLE_AUTH_REQUIRED' };
  }
  if (status === 403) {
    return { status: 403, error: 'A conta Google não tem permissão para editar este contato.', code: 'GOOGLE_PERMISSION_DENIED' };
  }
  if (status === 404) {
    return { status: 404, error: 'O contato não foi encontrado no Google. Sincronize novamente antes de editar.', code: 'GOOGLE_CONTACT_NOT_FOUND' };
  }
  if (status === 429) {
    return { status: 503, error: 'O Google está temporariamente indisponível. Tente novamente.', code: 'GOOGLE_RATE_LIMITED', retryable: true };
  }
  if (status >= 500) {
    return { status: 503, error: 'O Google está temporariamente indisponível. Tente novamente.', code: 'GOOGLE_UNAVAILABLE', retryable: true };
  }
  return { status: 502, error: 'Não foi possível salvar o contato no Google Contacts', code: 'GOOGLE_CONTACT_SAVE_FAILED', retryable: true };
}

export async function registerGoogleContactRoutes(app: FastifyInstance) {
  app.get('/api/google/status', { preHandler: requireUser }, async (request) => {
    const result = await db.query<{
      google_email: string | null;
      connected_at: Date;
      sync_status: string;
      last_sync_at: Date | null;
      last_sync_imported: number | null;
      last_sync_total: number | null;
      last_sync_error: string | null;
    }>(
      `SELECT google_email, connected_at, sync_status, last_sync_at,
              last_sync_imported, last_sync_total, last_sync_error
       FROM google_connections WHERE company_id = $1`, [request.user!.companyId],
    );
    const connection = result.rows[0] || null;
    return {
      connected: Boolean(connection),
      state: googleIntegrationState(connection),
      connection,
    };
  });

  app.get('/api/google/connect', { preHandler: requireAdmin }, async (request, reply) => {
    if (isQaMode) {
      await db.query(
        `INSERT INTO google_connections (company_id, google_email, refresh_token_encrypted, access_token_encrypted, access_token_expires_at, scopes)
         VALUES ($1, 'qa-google@example.test', $2, $3, now() + interval '1 day', $4)
         ON CONFLICT (company_id) DO UPDATE SET google_email = EXCLUDED.google_email, sync_status = 'never', last_sync_error = NULL, updated_at = now()`,
        [request.user!.companyId, encryptSecret('qa-refresh-token'), encryptSecret('qa-access-token'), ['qa-mock']],
      );
      return { url: settingsGoogleRedirect('mock-connected') };
    }
    if (!ensureConfigured(reply)) return;
    const state = signState({ companyId: request.user!.companyId, exp: Date.now() + 10 * 60_000, nonce: randomBytes(16).toString('hex') });
    const query = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID!, redirect_uri: callbackUrl(), response_type: 'code', scope: GOOGLE_SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` };
  });

  app.get('/api/google/callback', async (request, reply) => {
    if (isQaMode) return reply.redirect(settingsGoogleRedirect('mock-connected'));
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) return reply.redirect(settingsGoogleRedirect('error'));
    try {
      const parsed = z.object({ code: z.string(), state: z.string() }).safeParse(request.query);
      if (!parsed.success) return reply.redirect(settingsGoogleRedirect('error'));
      const state = readState(parsed.data.state);
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({ code: parsed.data.code, client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, redirect_uri: callbackUrl(), grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!tokenResponse.ok) return reply.redirect(settingsGoogleRedirect('error'));
      const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
      if (!tokens.refresh_token) return reply.redirect(settingsGoogleRedirect('error'));
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
      await db.query(
        `INSERT INTO google_connections (company_id, google_email, refresh_token_encrypted, access_token_encrypted, access_token_expires_at, scopes)
         VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'), $6)
         ON CONFLICT (company_id) DO UPDATE SET google_email = EXCLUDED.google_email, refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
           access_token_encrypted = EXCLUDED.access_token_encrypted, access_token_expires_at = EXCLUDED.access_token_expires_at,
           scopes = EXCLUDED.scopes, sync_status = CASE WHEN google_connections.sync_status = 'success' THEN 'success' ELSE 'never' END,
           last_sync_error = NULL, updated_at = now()`,
        [state.companyId, profile.email || null, encryptSecret(tokens.refresh_token), encryptSecret(tokens.access_token), tokens.expires_in, (tokens.scope || GOOGLE_SCOPE).split(' ')],
      );
      return reply.redirect(settingsGoogleRedirect('connected'));
    } catch (error) {
      request.log.warn({ err: error }, 'Google OAuth callback failed');
      return reply.redirect(settingsGoogleRedirect('error'));
    }
  });

  app.post('/api/google/sync', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      await updateGoogleSyncState(request.user!.companyId, 'syncing');
      if (isQaMode) {
        const failure = qaGoogleFailure();
        if (failure) {
          await updateGoogleSyncState(request.user!.companyId, failure.status === 401 ? 'auth_required' : 'error', { error: failure.message });
          return reply.code(failure.status || 504).send({ error: failure.message, qaMock: true });
        }
        const people = qaGooglePeople() as GooglePerson[];
        const scenario = currentQaGoogleScenario();
        const importedPeople = scenario === 'partial' ? people.slice(0, 1) : people;
        const upsertResult = await upsertFullLocalContacts(request.user!.companyId, importedPeople);
        await publishGoogleContactUpdates(request.user!.companyId, upsertResult.affectedContactIds);
        const resourceNames = importedPeople
          .map((person) => person.resourceName)
          .filter((value): value is string => Boolean(value));
        await db.query(
          `UPDATE contacts
           SET google_resource_name = NULL, google_etag = NULL, google_data = '{}'::jsonb,
               google_synced_at = NULL,
               source = CASE WHEN source = 'google' THEN 'hub' ELSE source END,
               updated_at = now()
           WHERE company_id = $1
             AND google_resource_name IS NOT NULL
             AND NOT (google_resource_name = ANY($2::text[]))`,
          [request.user!.companyId, resourceNames],
        );
        const result = {
          imported: upsertResult.imported,
          total: people.length,
          created: upsertResult.created,
          reconciled: upsertResult.reconciled,
          updated: upsertResult.updated,
          conflicts: upsertResult.conflicts,
          scenario,
          fullSync: scenario === 'sync-token-expired' || scenario === 'external-delete',
          partial: scenario === 'partial',
          errors: scenario === 'partial' ? [{ resourceName: people[1]?.resourceName || 'people/qa-new', error: 'Contato QA rejeitado parcialmente' }] : [],
        };
        await updateGoogleSyncState(request.user!.companyId, 'success', result);
        return result;
      }
      const result = await syncGoogleContactsForCompany(request.user!.companyId);
      await updateGoogleSyncState(request.user!.companyId, 'success', result);
      return result;
    } catch (error) {
      const response = googleSyncErrorResponse(error);
      await updateGoogleSyncState(request.user!.companyId, response.code === 'GOOGLE_AUTH_REQUIRED' ? 'auth_required' : 'error', { error: response.error }).catch((statusError) => request.log.warn({ err: statusError }, 'Google sync status update failed'));
      request.log.warn({
        code: response.code,
        providerStatus: typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : undefined,
        providerCode: typeof (error as { providerCode?: unknown })?.providerCode === 'string' ? (error as { providerCode: string }).providerCode : undefined,
      }, 'Google Contacts sync failed');
      return reply.code(response.status).send(response);
    }
  });

  app.delete('/api/google/disconnect', { preHandler: requireAdmin }, async (request) => {
    await db.query('DELETE FROM google_connections WHERE company_id = $1', [request.user!.companyId]);
    googleContactsCache.delete(request.user!.companyId);
    return { disconnected: true };
  });

  app.post('/api/google/contact-status', { preHandler: requireUser }, async (request, reply) => {
    const parsed = contactStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Telefone inválido' });
    try {
      const variants = new Set(phoneIdentityKeys(parsed.data.phone, { defaultCountry: 'BR' }).map(normalizePhone));
      const local = await db.query<{
        name: string;
        phone: string;
        email: string | null;
        cpf: string | null;
        address: string | null;
        secondary_phone: string | null;
        google_resource_name: string | null;
        source: string | null;
        nickname: string | null;
        birthday: string | null;
        company: string | null;
        job_title: string | null;
        website: string | null;
        notes: string | null;
        google_etag: string | null;
        google_data: GooglePerson;
      }>(
        `SELECT name, phone, email, cpf, address, secondary_phone, google_resource_name, source,
                nickname, birthday, company, job_title, website, notes, google_etag, google_data
         FROM contacts
         WHERE company_id = $1
           AND (
             regexp_replace(phone, '\\D', '', 'g') = ANY($2::text[])
             OR regexp_replace(COALESCE(secondary_phone, ''), '\\D', '', 'g') = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.contact_id = contacts.id AND cp.normalized_phone = ANY($2::text[]))
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
          addresses: Array.isArray(localContact.google_data?.addresses)
            ? personAddresses(localContact.google_data)
            : localContact.address ? [localContact.address] : [],
          otherPhone: localContact.secondary_phone || '',
          otherPhones: Array.isArray(localContact.google_data?.phoneNumbers)
            ? personPhoneValues(localContact.google_data).filter((value) => !variants.has(value))
            : [],
          emails: Array.isArray(localContact.google_data?.emailAddresses)
            ? personEmailValues(localContact.google_data)
            : localContact.email ? [localContact.email] : [],
          birthday: localContact.birthday || '',
          nickname: localContact.nickname || '',
          company: localContact.company || '',
          jobTitle: localContact.job_title || '',
          occupation: personOccupation(localContact.google_data || {}),
          relations: personRelations(localContact.google_data || {}),
          events: personEvents(localContact.google_data || {}),
          customFields: personCustomFields(localContact.google_data || {}),
          website: localContact.website || '',
          notes: localContact.notes || '',
          etag: localContact.google_etag || '',
          googleData: localContact.google_data || {},
          phone: storagePhone(parsed.data.phone) || normalizePhone(parsed.data.phone),
        };
      }

      // Só acessa a agenda remota quando não há um contato sincronizado localmente.
      const connection = await db.query('SELECT 1 FROM google_connections WHERE company_id = $1 LIMIT 1', [request.user!.companyId]);
      const phone = storagePhone(parsed.data.phone) || normalizePhone(parsed.data.phone);
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
    if (isQaMode) {
      const failure = qaGoogleFailure();
      if (failure) return reply.code(failure.status || 504).send({ error: failure.message, qaMock: true });
      const phone = storagePhone(contact.phone) || normalizePhone(contact.phone);
      const person = {
        ...buildGooglePersonPayload(contact),
        resourceName: contact.resourceName || `people/qa-${phone}`,
        etag: `qa-etag-${Date.now()}`,
      } as GooglePerson;
      const upsertResult = await upsertFullLocalContacts(request.user!.companyId, [person]);
      await publishGoogleContactUpdates(request.user!.companyId, upsertResult.affectedContactIds);
      const saved = contactFieldsFromPerson(person);
      return { saved: true, qaMock: true, name: saved.name, resourceName: person.resourceName, phone, otherPhone: saved.otherPhones[0] || '' };
    }
    const phone = storagePhone(contact.phone) || normalizePhone(contact.phone);
    const otherPhones = Array.from(new Set([
      ...splitFormValues(contact.otherPhone).map((value) => storagePhone(value) || normalizePhone(value)),
      ...splitFormValues(contact.otherPhones).map((value) => storagePhone(value) || normalizePhone(value)),
    ].filter(Boolean))).filter((value) => normalizePhone(value) !== normalizePhone(phone));
    const otherPhone = otherPhones[0] || '';
    if (!phone || phone.length < 8) return reply.code(400).send({ error: 'Telefone principal inválido' });
    const emailValues = Array.from(new Set([
      ...(contact.email ? [contact.email.trim()] : []),
      ...splitFormValues(contact.emails),
    ].filter(Boolean)));
    const phoneDigits = phoneIdentityKeys(phone, { defaultCountry: 'BR' }).filter((value) => /^\d+$/.test(value));

    try {
      const resourceLocal = contact.resourceName
        ? await db.query<{ id: string; phone: string }>('SELECT id, phone FROM contacts WHERE company_id = $1 AND google_resource_name = $2 LIMIT 1', [request.user!.companyId, contact.resourceName])
        : { rows: [] as Array<{ id: string; phone: string }> };
      const phoneLocal = await db.query<{ id: string }>(
        `SELECT c.id FROM contacts c
         WHERE c.company_id = $1
           AND (regexp_replace(c.phone, '\\D', '', 'g') = ANY($2::text[])
                OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.company_id = c.company_id AND cp.contact_id = c.id AND cp.normalized_phone = ANY($2::text[])))
         ORDER BY c.id LIMIT 1`, [request.user!.companyId, phoneDigits],
      );
      if (resourceLocal.rows[0] && phoneLocal.rows[0] && resourceLocal.rows[0].id !== phoneLocal.rows[0].id) {
        return reply.code(409).send({ error: 'O telefone informado já pertence a outro contato. Revise a duplicidade antes de salvar.', conflict: true });
      }
      const token = await accessTokenForCompany(request.user!.companyId);
      const people = await listGoogleContactsForCompany(request.user!.companyId, true);
      const variants = new Set(phoneIdentityKeys(phone, { defaultCountry: 'BR' }).map(normalizePhone));
      const existing = contact.resourceName
        ? people.find((person) => person.resourceName === contact.resourceName)
        : people.find((person) => person.phoneNumbers?.some((item) => variants.has(normalizePhone(item.value || ''))));
      if (contact.resourceName && !existing) {
        return reply.code(404).send({ error: 'O contato não foi encontrado no Google. Sincronize novamente antes de editar.' });
      }
      const payload = buildGooglePersonPayload(contact);
      const response = existing?.resourceName
        ? await googleFetch(`/${existing.resourceName}:updateContact?updatePersonFields=names,nicknames,emailAddresses,phoneNumbers,addresses,organizations,birthdays,biographies,occupations,relations,events,urls,userDefined&personFields=${encodeURIComponent(GOOGLE_PERSON_FIELDS)}`, token, {
            method: 'PATCH',
            body: JSON.stringify(buildGoogleContactUpdatePayload(existing, payload)),
          })
        : await googleFetch(`/people:createContact?personFields=${encodeURIComponent(GOOGLE_PERSON_FIELDS)}`, token, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      const person = await response.json() as GooglePerson;
      const resourceName = person.resourceName || existing?.resourceName || null;
      const savedFromGoogle = contactFieldsFromPerson({
        ...person,
        ...(!person.names?.length ? { names: [{ displayName: contact.name }] } : {}),
        ...(!person.phoneNumbers?.length ? { phoneNumbers: [{ value: phone }] } : {}),
      });
      const saved = {
        ...savedFromGoogle,
        name: contact.name,
        phone,
        otherPhones,
        email: emailValues[0] || '',
        emails: emailValues,
        cpf: contact.cpf || '',
        address: contact.address || '',
        birthday: contact.birthday || '',
        nickname: contact.nickname || '',
        company: contact.company || '',
        jobTitle: contact.jobTitle || '',
        occupation: contact.occupation || '',
        relations: contact.relations || '',
        events: contact.events || '',
        customFields: contact.customFields || '',
        website: contact.website || '',
        notes: contact.notes || '',
        googleData: { ...person, ...payload, resourceName, etag: person.etag || existing?.etag || null },
      };
      let savedContactId = resourceLocal.rows[0]?.id || phoneLocal.rows[0]?.id;
      if (savedContactId) {
        await db.query(
          `UPDATE contacts SET name = $2, phone = $3, email = $4, cpf = $5, address = $6, secondary_phone = $7,
             avatar_url = COALESCE($8, avatar_url), google_resource_name = $9, source = 'google', nickname = $10,
             birthday = $11, company = $12, job_title = $13, website = $14, notes = $15, google_etag = $16,
             google_data = $17, google_synced_at = now(), updated_at = now(), version = version + 1 WHERE id = $1 AND company_id = $18`,
          [savedContactId, contact.name, phone, emailValues[0] || null, contact.cpf || null, contact.address || null, otherPhone || null, saved.avatarUrl || null, resourceName, saved.nickname || contact.nickname || null, saved.birthday || contact.birthday || null, saved.company || contact.company || null, saved.jobTitle || contact.jobTitle || null, saved.website || contact.website || null, saved.notes || contact.notes || null, person.etag || existing?.etag || null, saved.googleData, request.user!.companyId],
        );
      } else {
        const inserted = await db.query<{ id: string }>(
          `INSERT INTO contacts (company_id, name, phone, email, cpf, address, secondary_phone, avatar_url,
             google_resource_name, source, nickname, birthday, company, job_title, website, notes, google_etag, google_data, google_synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'google', $10, $11, $12, $13, $14, $15, $16, $17, now()) RETURNING id`,
          [request.user!.companyId, contact.name, phone, emailValues[0] || null, contact.cpf || null, contact.address || null, otherPhone || null, saved.avatarUrl || null, resourceName, saved.nickname || contact.nickname || null, saved.birthday || contact.birthday || null, saved.company || contact.company || null, saved.jobTitle || contact.jobTitle || null, saved.website || contact.website || null, saved.notes || contact.notes || null, person.etag || existing?.etag || null, saved.googleData],
        );
        savedContactId = inserted.rows[0]!.id;
      }
      if (savedContactId) {
        await db.query('UPDATE contact_phones SET is_primary = false, updated_at = now() WHERE contact_id = $1', [savedContactId]);
        await db.query('UPDATE contact_emails SET is_primary = false, updated_at = now() WHERE contact_id = $1', [savedContactId]);
        for (const [index, value] of [phone, ...otherPhones].entries()) {
          await db.query(
            `INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source)
             VALUES ($1, $2, $3, $4, $5, 'google')
             ON CONFLICT (contact_id, normalized_phone) DO UPDATE SET phone = EXCLUDED.phone, is_primary = EXCLUDED.is_primary, source = 'google', updated_at = now()`,
            [request.user!.companyId, savedContactId, value, normalizePhone(storagePhone(value) || value), index === 0],
          );
        }
        for (const [index, value] of emailValues.entries()) {
          await db.query(
            `INSERT INTO contact_emails (company_id, contact_id, email, normalized_email, is_primary, source)
             VALUES ($1, $2, $3, $4, $5, 'google')
             ON CONFLICT (contact_id, normalized_email) DO UPDATE SET email = EXCLUDED.email, is_primary = EXCLUDED.is_primary, source = 'google', updated_at = now()`,
            [request.user!.companyId, savedContactId, value, value.toLowerCase(), index === 0],
          );
        }
      }
      googleContactsCache.delete(request.user!.companyId);
      return reply.code(existing ? 200 : 201).send({ saved: true, ...saved, name: contact.name, resourceName, phone, otherPhone, otherPhones, emails: emailValues });
    } catch (error: any) {
      request.log.warn({ err: error }, 'Não foi possível salvar contato no Google');
      const response = googleContactErrorResponse(error);
      return reply.code(response.status).send(response);
    }
  });

}
