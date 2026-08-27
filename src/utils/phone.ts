export const normalizePhone = (value: string) => value.replace(/\D/g, '');

export type PhoneIdentity = {
  raw: string;
  digits: string;
  canonical: string | null;
  country: string | null;
  national: string | null;
  valid: boolean;
  ambiguous: boolean;
};

/** Exact contact identity normalization. It intentionally does not infer a ninth digit. */
export const normalizePhoneIdentity = (value: string | undefined, defaultCountry = 'BR'): PhoneIdentity => {
  const raw = String(value || '').trim();
  let digits = normalizePhone(raw);
  const explicitInternational = raw.startsWith('+') || /^00\d/.test(raw);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return { raw, digits, canonical: null, country: null, national: null, valid: false, ambiguous: false };
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return { raw, digits, canonical: `+${digits}`, country: 'BR', national: digits.slice(2), valid: true, ambiguous: digits.length === 12 };
  }
  if (explicitInternational) {
    const country = digits.startsWith('55') ? 'BR' : null;
    const national = country === 'BR' ? digits.slice(2) : null;
    return { raw, digits, canonical: digits.length >= 8 ? `+${digits}` : null, country, national, valid: digits.length >= 8, ambiguous: digits.length < 8 || national?.length === 10 };
  }
  if (defaultCountry === 'BR' && (digits.length === 10 || digits.length === 11)) {
    return { raw, digits, canonical: `+55${digits}`, country: 'BR', national: digits, valid: true, ambiguous: digits.length === 10 };
  }
  return { raw, digits, canonical: null, country: defaultCountry || null, national: defaultCountry === 'BR' ? digits : null, valid: false, ambiguous: digits.length >= 8 };
};

export const phoneIdentityKeys = (value: string, defaultCountry = 'BR') => {
  const identity = normalizePhoneIdentity(value, defaultCountry);
  const canonicalDigits = identity.canonical?.replace(/\D/g, '') || '';
  return Array.from(new Set([identity.canonical || '', canonicalDigits, identity.digits].filter(Boolean)));
};

/** Canonical digit key used to correlate provider phone aliases. */
export const canonicalPhoneDigits = (value: string | undefined, defaultCountry = 'BR') => {
  const raw = String(value || '');
  const lower = raw.trim().toLowerCase();
  if (lower.endsWith('@lid') || lower.endsWith('@g.us')) return '';
  const identity = normalizePhoneIdentity(raw, defaultCountry);
  return identity.canonical?.replace(/\D/g, '') || normalizePhone(raw);
};

export type ContactPhoneValue = { phone?: string; is_primary?: boolean };

/**
 * Keeps one display value per canonical phone identity. Primary values win;
 * otherwise the complete canonical representation is preferred over a
 * legacy/national alias. The original rows remain untouched in storage.
 */
export const dedupeContactPhones = <T extends ContactPhoneValue>(phones: T | T[]): T[] => {
  const values = Array.isArray(phones) ? phones : [phones];
  const selected = new Map<string, { value: T; rank: number }>();
  values.forEach((value) => {
    const raw = String(value.phone || '').trim();
    if (!raw) return;
    const identity = normalizePhoneIdentity(raw);
    const key = identity.canonical || identity.digits;
    if (!key) return;
    const digits = normalizePhone(raw);
    const isCanonicalRepresentation = Boolean(identity.canonical && (
      raw === identity.canonical
      || (digits.length === 12 || digits.length === 13)
    ));
    const rank = (value.is_primary ? 4 : 0) + (isCanonicalRepresentation ? 2 : 0);
    const previous = selected.get(key);
    if (!previous || rank > previous.rank) selected.set(key, { value, rank });
  });
  return Array.from(selected.values()).map(({ value }) => value);
};

export const formatPhoneForDisplay = (value: string | undefined, defaultCountry = 'BR') => {
  const identity = normalizePhoneIdentity(value, defaultCountry);
  if (identity.country === 'BR' && identity.national && (identity.national.length === 10 || identity.national.length === 11)) {
    const area = identity.national.slice(0, 2);
    const number = identity.national.slice(2);
    return identity.national.length === 11
      ? `(${area}) ${number.slice(0, 5)}-${number.slice(5)}`
      : `(${area}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }
  return identity.canonical || identity.raw;
};

/**
 * Compatibility aliases for provider/channel routing. These variants are not
 * contact identities and must never authorize a contact merge.
 */
export const phoneVariants = (value: string) => {
  const digits = normalizePhone(value);
  const variants = new Set<string>();
  const add = (candidate: string) => { if (candidate) variants.add(candidate); };
  add(digits);
  if (digits.startsWith('0') && digits.length > 10) add(digits.slice(1));
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
  return Array.from(variants);
};
