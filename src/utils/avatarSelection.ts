export type ConversationAvatarSource = 'whatsapp' | 'google' | 'none';

type AvatarValue = string | null | undefined;

export type ConversationAvatarSelection = {
  avatar: string | null;
  source: ConversationAvatarSource;
};

const usableAvatar = (value: AvatarValue) => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
);

/**
 * Selects the avatar for an individual conversation without relying on merge
 * order. Provider snapshots and the WhatsApp-specific table always outrank a
 * Google/local contact avatar.
 */
export function selectConversationAvatar(input: {
  snapshotWhatsAppAvatar?: AvatarValue;
  storedWhatsAppAvatar?: AvatarValue;
  googleAvatar?: AvatarValue;
}): ConversationAvatarSelection {
  const snapshot = usableAvatar(input.snapshotWhatsAppAvatar);
  if (snapshot) return { avatar: snapshot, source: 'whatsapp' };

  const storedWhatsApp = usableAvatar(input.storedWhatsAppAvatar);
  if (storedWhatsApp) return { avatar: storedWhatsApp, source: 'whatsapp' };

  const google = usableAvatar(input.googleAvatar);
  if (google) return { avatar: google, source: 'google' };

  return { avatar: null, source: 'none' };
}
