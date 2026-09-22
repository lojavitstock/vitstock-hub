export function normalizeManualNewMessagePhone(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{8,20}$/.test(digits)) return undefined;
  return {
    digits,
    remoteJid: `${digits}@s.whatsapp.net`,
    phone: `+${digits}`,
  };
}
