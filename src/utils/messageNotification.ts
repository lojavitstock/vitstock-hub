import type { Message } from '../types';

const MAX_REMEMBERED_MESSAGE_IDS = 2000;

export const createMessageNotificationDeduper = () => {
  const seenIds = new Set<string>();
  const insertionOrder: string[] = [];

  return {
    shouldNotify(message?: Message) {
      if (!message || message.sender !== 'contact' || message.isInternalNote || !message.id) return false;
      if (seenIds.has(message.id)) return false;
      seenIds.add(message.id);
      insertionOrder.push(message.id);
      if (insertionOrder.length > MAX_REMEMBERED_MESSAGE_IDS) {
        const oldestId = insertionOrder.shift();
        if (oldestId) seenIds.delete(oldestId);
      }
      return true;
    },
  };
};
