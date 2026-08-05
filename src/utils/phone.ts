export const normalizePhone = (value: string) => value.replace(/\D/g, '');

/**
 * Retorna as formas equivalentes de um telefone brasileiro para cruzar dados
 * da Evolution, do WhatsApp e do Google Contacts (com ou sem o 9º dígito/55).
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
