export function normalizeContactPhone(value: string) {
  return String(value || '').replace(/\D/g, '');
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
