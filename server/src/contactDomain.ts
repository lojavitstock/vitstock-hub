export type PhoneNormalizationOptions = {
  /** Country context is required before assigning a country code to local digits. */
  defaultCountry?: 'BR' | string;
};

export type PhoneIdentity = {
  raw: string;
  digits: string;
  canonical: string | null;
  country: string | null;
  national: string | null;
  valid: boolean;
  ambiguous: boolean;
};

export function normalizeContactPhone(value: string) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Converts a phone into an E.164-like identity without guessing a country or
 * adding/removing Brazil's ninth digit. Legacy digits-only values remain
 * readable through normalizeContactPhone; new writes should use canonicalPhone.
 */
export function normalizePhoneIdentity(value: unknown, options: PhoneNormalizationOptions = {}): PhoneIdentity {
  const raw = String(value ?? '').trim();
  let digits = normalizeContactPhone(raw);
  const explicitInternational = raw.startsWith('+') || /^00\d/.test(raw);
  if (digits.startsWith('00')) digits = digits.slice(2);
  const defaultCountryValue = String(options.defaultCountry || '').trim().toUpperCase();
  const defaultCountry = defaultCountryValue === 'BR' || defaultCountryValue === '55'
    ? 'BR'
    : defaultCountryValue || null;

  if (!digits) return { raw, digits, canonical: null, country: null, national: null, valid: false, ambiguous: false };

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const national = digits.slice(2);
    return { raw, digits, canonical: `+${digits}`, country: 'BR', national, valid: true, ambiguous: national.length === 10 };
  }

  if (explicitInternational) {
    const country = digits.startsWith('55') ? 'BR' : digits.slice(0, Math.max(1, digits.length - 10));
    const national = country === 'BR' ? digits.slice(2) : null;
    return { raw, digits, canonical: digits.length >= 8 ? `+${digits}` : null, country, national, valid: digits.length >= 8, ambiguous: digits.length < 8 || national?.length === 10 };
  }

  if (defaultCountry === 'BR' && (digits.length === 10 || digits.length === 11)) {
    return { raw, digits, canonical: `+55${digits}`, country: 'BR', national: digits, valid: true, ambiguous: digits.length === 10 };
  }

  return {
    raw,
    digits,
    canonical: null,
    country: defaultCountry,
    national: defaultCountry === 'BR' ? digits : null,
    valid: false,
    ambiguous: digits.length >= 8,
  };
}

export function canonicalPhone(value: unknown, options: PhoneNormalizationOptions = { defaultCountry: 'BR' }) {
  return normalizePhoneIdentity(value, options).canonical;
}

/** Exact identity keys only. This intentionally does not infer a missing ninth digit. */
export function phoneIdentityKeys(value: unknown, options: PhoneNormalizationOptions = { defaultCountry: 'BR' }) {
  const identity = normalizePhoneIdentity(value, options);
  const canonicalDigits = identity.canonical?.replace(/\D/g, '') || '';
  // Keep the original digit representation as an exact lookup key as well.
  // This lets new canonical writes find legacy local values without inferring
  // a missing ninth digit or collapsing ambiguous 10/11-digit numbers.
  return Array.from(new Set([identity.canonical || '', canonicalDigits, identity.digits].filter(Boolean)));
}

export function formatPhoneForDisplay(value: unknown, options: PhoneNormalizationOptions = { defaultCountry: 'BR' }) {
  const identity = normalizePhoneIdentity(value, options);
  if (identity.country === 'BR' && identity.national && (identity.national.length === 10 || identity.national.length === 11)) {
    const area = identity.national.slice(0, 2);
    const number = identity.national.slice(2);
    return identity.national.length === 11
      ? `(${area}) ${number.slice(0, 5)}-${number.slice(5)}`
      : `(${area}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }
  return identity.canonical || identity.raw;
}

export function normalizeContactEmail(value: string) {
  return String(value || '').trim().toLowerCase();
}

export function splitContactValues(value: unknown) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[;,\n]/);
  return Array.from(new Set(values.map((item) => String(item).trim()).filter(Boolean)));
}

export type ContactImportRow = Record<string, string>;

/** Small, dependency-free CSV parser for the V1 import path. */
export function parseContactCsv(csv: string): ContactImportRow[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current.trim());
      current = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      current += char;
    }
  }
  if (current || row.length) {
    row.push(current.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  const headers = (rows.shift() || []).map((header) => header.trim().toLowerCase());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

export function orderedContactPair(first: string, second: string) {
  return first < second ? [first, second] as const : [second, first] as const;
}
