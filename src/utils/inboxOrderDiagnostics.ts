import type { Conversation } from '../types';

export type InboxOrderTraceTrigger =
  | 'initial_load'
  | 'polling'
  | 'realtime_reconnect'
  | 'message_upsert'
  | 'conversation_updated'
  | 'mark_read_response'
  | 'manual_refresh'
  | 'unknown';

export type InboxOrderTraceEvent = 'mark_read_start' | 'mark_read_success' | 'mark_read_failure';

type TraceConversation = Conversation & { updatedAt?: string };

const enabledByEnv = () => Boolean((import.meta as any).env?.VITE_INBOX_ORDER_DEBUG === 'true');

// FNV-1a keeps the browser trace deterministic without emitting a raw
// conversation ID, phone number or JID.
const shortHash = (value: unknown) => {
  let hash = 2166136261;
  for (const character of String(value ?? 'unknown')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `entity-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const traceConversation = (conversation?: Conversation) => conversation as TraceConversation | undefined;

const indexById = (conversations: Conversation[]) => new Map(conversations.map((conversation, index) => [conversation.id, index]));

const conversationById = (conversations: Conversation[]) => new Map(conversations.map((conversation) => [conversation.id, conversation]));

const emit = (payload: Record<string, unknown>, enabled?: boolean) => {
  if (!(enabled ?? enabledByEnv())) return false;
  console.info('[INBOX_ORDER_TRACE]', JSON.stringify(payload));
  return true;
};

/**
 * Emits one sanitized record per conversation whose array index actually
 * changed. `snapshot` supplies raw timestamps when reconciliation preserves a
 * previous Conversation object through structural sharing.
 */
export function traceInboxOrderChanges(
  previous: Conversation[],
  next: Conversation[],
  options: {
    snapshot?: Conversation[];
    activeConversationId?: string;
    trigger?: InboxOrderTraceTrigger;
    enabled?: boolean;
  } = {},
) {
  if (!(options.enabled ?? enabledByEnv())) return 0;
  const previousIndexes = indexById(previous);
  const nextIndexes = indexById(next);
  const previousById = conversationById(previous);
  const nextById = conversationById(next);
  const snapshotById = conversationById(options.snapshot || next);
  let count = 0;

  const ids = new Set([...previousIndexes.keys(), ...nextIndexes.keys()]);
  ids.forEach((id) => {
    const fromIndex = previousIndexes.get(id) ?? -1;
    const toIndex = nextIndexes.get(id) ?? -1;
    if (fromIndex === toIndex) return;
    const previousConversation = traceConversation(previousById.get(id));
    const nextConversation = traceConversation(snapshotById.get(id) || nextById.get(id));
    const payload = {
      event: 'reorder',
      entity: shortHash(id),
      fromIndex,
      toIndex,
      previousLastMessageTimestamp: previousConversation?.lastMessageTimestamp || undefined,
      nextLastMessageTimestamp: nextConversation?.lastMessageTimestamp || undefined,
      previousLastMessageAt: previousConversation?.lastMessageAt || undefined,
      nextLastMessageAt: nextConversation?.lastMessageAt || undefined,
      previousUpdatedAt: previousConversation?.updatedAt || undefined,
      nextUpdatedAt: nextConversation?.updatedAt || undefined,
      activeConversation: id === options.activeConversationId,
      trigger: options.trigger || 'unknown',
    };
    if (emit(payload, true)) count += 1;
  });
  return count;
}

export function traceInboxOrderEvent(input: {
  event: InboxOrderTraceEvent;
  conversation: Conversation;
  index: number;
  activeConversationId?: string;
  trigger?: InboxOrderTraceTrigger;
  enabled?: boolean;
}) {
  const conversation = traceConversation(input.conversation);
  return emit({
    event: input.event,
    entity: shortHash(input.conversation.id),
    index: input.index,
    lastMessageTimestamp: conversation?.lastMessageTimestamp || undefined,
    lastMessageAt: conversation?.lastMessageAt || undefined,
    updatedAt: conversation?.updatedAt || undefined,
    activeConversation: input.conversation.id === input.activeConversationId,
    trigger: input.trigger || 'mark_read_response',
  }, input.enabled);
}
