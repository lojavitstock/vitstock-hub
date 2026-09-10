export type ServerAvatarSource = 'whatsapp' | 'google' | 'none';

const usableAvatar = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  ? value.trim()
  : null;

export function selectConversationAvatar(input: {
  snapshotWhatsAppAvatar?: unknown;
  storedWhatsAppAvatar?: unknown;
  googleAvatar?: unknown;
}) {
  const snapshot = usableAvatar(input.snapshotWhatsAppAvatar);
  if (snapshot) return { avatar: snapshot, source: 'whatsapp' as const };
  const storedWhatsApp = usableAvatar(input.storedWhatsAppAvatar);
  if (storedWhatsApp) return { avatar: storedWhatsApp, source: 'whatsapp' as const };
  const google = usableAvatar(input.googleAvatar);
  if (google) return { avatar: google, source: 'google' as const };
  return { avatar: null, source: 'none' as const };
}
