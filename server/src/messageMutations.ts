import { providerMessageKeyFromStoredMessage, validateProviderMessageKey, type ProviderMessageKey } from './providerMessageKey.js';

export const MESSAGE_MUTATION_ERROR_CODES = {
  notFound: 'MESSAGE_NOT_FOUND',
  notSentByHub: 'MESSAGE_NOT_SENT_BY_HUB',
  providerKeyMissing: 'MESSAGE_PROVIDER_KEY_MISSING',
  unsupportedType: 'MESSAGE_EDIT_UNSUPPORTED_TYPE',
  providerKeyUnsupported: 'MESSAGE_EDIT_PROVIDER_KEY_UNSUPPORTED',
  alreadyDeleted: 'MESSAGE_ALREADY_DELETED',
  editRejected: 'MESSAGE_EDIT_REJECTED',
  deleteRejected: 'MESSAGE_DELETE_REJECTED',
  providerTimeout: 'PROVIDER_TIMEOUT',
} as const;

export type MessageMutationErrorCode = typeof MESSAGE_MUTATION_ERROR_CODES[keyof typeof MESSAGE_MUTATION_ERROR_CODES];

export class MessageMutationError extends Error {
  readonly code: MessageMutationErrorCode;
  readonly statusCode: number;

  constructor(code: MessageMutationErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = 'MessageMutationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

type MutationRow = {
  evolution_message_id?: string | null;
  sender?: string | null;
  media_type?: string | null;
  metadata?: Record<string, any> | null;
  evolution_remote_jid?: string | null;
};

const storedProviderKey = (row: MutationRow): ProviderMessageKey => {
  const stored = row.metadata?.providerKey;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new MessageMutationError(
      MESSAGE_MUTATION_ERROR_CODES.providerKeyMissing,
      'A mensagem não possui uma chave válida da Evolution.',
    );
  }

  const validation = validateProviderMessageKey(providerMessageKeyFromStoredMessage({ metadata: { providerKey: stored } }));
  if (!validation.valid) {
    throw new MessageMutationError(
      MESSAGE_MUTATION_ERROR_CODES.providerKeyMissing,
      'A mensagem não possui uma chave válida da Evolution.',
    );
  }
  return validation.key;
};

const isDirectPn = (jid: string) => {
  const normalized = jid.trim().toLowerCase();
  return normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@c.us');
};

const isGroup = (jid: string) => jid.trim().toLowerCase().endsWith('@g.us');

const mutationNumber = (jid: string) => {
  const normalized = jid.trim();
  return isGroup(normalized) ? normalized : normalized.replace(/\D/g, '');
};

export const providerKeyForMessageMutation = (row: MutationRow) => storedProviderKey(row);

export const assertMessageMutationAllowed = (
  row: MutationRow,
  operation: 'edit' | 'delete',
  text?: string,
) => {
  if (row.sender !== 'attendant' || row.metadata?.sentByHub !== true) {
    throw new MessageMutationError(
      MESSAGE_MUTATION_ERROR_CODES.notSentByHub,
      'Somente mensagens enviadas pelo Hub podem ser alteradas.',
    );
  }
  if (row.metadata?.deletedForEveryone === true) {
    throw new MessageMutationError(
      MESSAGE_MUTATION_ERROR_CODES.alreadyDeleted,
      'A mensagem já foi apagada para todos.',
      409,
    );
  }

  const key = storedProviderKey(row);
  if (key.fromMe !== true) {
    throw new MessageMutationError(
      MESSAGE_MUTATION_ERROR_CODES.notSentByHub,
      'A mensagem não foi enviada pelo Hub.',
    );
  }
  const remoteJid = String(key.remoteJid || '').trim();
  if (!remoteJid) {
    throw new MessageMutationError(
      MESSAGE_MUTATION_ERROR_CODES.providerKeyMissing,
      'A mensagem não possui uma chave válida da Evolution.',
    );
  }

  if (operation === 'edit') {
    if (row.media_type) {
      throw new MessageMutationError(
        MESSAGE_MUTATION_ERROR_CODES.unsupportedType,
        'Somente mensagens de texto podem ser editadas.',
      );
    }
    if (!text?.trim()) {
      throw new MessageMutationError(
        MESSAGE_MUTATION_ERROR_CODES.unsupportedType,
        'A nova mensagem precisa conter texto.',
      );
    }
    // The v2.3.7 update contract accepts the basic key only. Keep the first
    // MVP restricted to direct PN chats until a provider-supported LID/group
    // edit path is proven against that installation.
    if (!isDirectPn(remoteJid)) {
      throw new MessageMutationError(
        MESSAGE_MUTATION_ERROR_CODES.providerKeyUnsupported,
        'A chave da Evolution não é segura para edição nesta conversa.',
      );
    }
  } else if (isGroup(remoteJid) && !key.participant) {
    throw new MessageMutationError(
      MESSAGE_MUTATION_ERROR_CODES.providerKeyUnsupported,
      'A mensagem de grupo não possui o participante necessário para exclusão.',
    );
  }

  return key;
};

/** Payload accepted by Evolution API 2.3.7 for POST /chat/updateMessage. */
export const evolutionEditMessagePayload = (row: MutationRow, text: string) => {
  const key = assertMessageMutationAllowed(row, 'edit', text);
  return {
    number: mutationNumber(String(key.remoteJid)),
    text: text.trim(),
    key: {
      id: key.id,
      remoteJid: key.remoteJid,
      fromMe: key.fromMe,
    },
  };
};

/** Payload accepted by Evolution API 2.3.7 for DELETE /chat/deleteMessageForEveryone. */
export const evolutionDeleteMessagePayload = (row: MutationRow) => {
  const key = assertMessageMutationAllowed(row, 'delete');
  return {
    id: key.id,
    remoteJid: key.remoteJid,
    fromMe: key.fromMe,
    ...(key.participant ? { participant: key.participant } : {}),
  };
};

export const editedMessageMetadata = (
  metadata: Record<string, any> | null | undefined,
  userId: string,
  editedAt: string,
) => ({
  ...(metadata || {}),
  editedAt,
  editedByUserId: userId,
});

export const deletedMessageMetadata = (
  metadata: Record<string, any> | null | undefined,
  userId: string,
  deletedAt: string,
) => ({
  ...(metadata || {}),
  deletedAt,
  deletedForEveryone: true,
  deletedByUserId: userId,
});

export const isProviderTimeout = (error: unknown) => (
  Boolean(error && typeof error === 'object' && (
    (error as { name?: unknown }).name === 'AbortError'
    || (error as { name?: unknown }).name === 'TimeoutError'
  ))
);
