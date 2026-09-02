import { apiRequest } from './api';
import type { QuickReply, QuickReplyScope } from '../types';

export type QuickReplyInput = {
  shortcut: string;
  title: string;
  body: string;
  scope?: QuickReplyScope;
  position?: number;
};

export async function fetchQuickReplies() {
  return apiRequest<{ quickReplies: QuickReply[] }>('/api/quick-replies');
}

export async function createQuickReply(input: QuickReplyInput) {
  return apiRequest<{ quickReply: QuickReply }>('/api/quick-replies', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateQuickReply(id: string, input: Partial<QuickReplyInput>) {
  return apiRequest<{ quickReply: QuickReply }>(`/api/quick-replies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function deleteQuickReply(id: string) {
  return apiRequest<{ removed: boolean; id: string }>(`/api/quick-replies/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function markQuickReplyUsed(id: string) {
  return apiRequest<{ quickReply: QuickReply }>(`/api/quick-replies/${encodeURIComponent(id)}/use`, { method: 'POST' });
}
