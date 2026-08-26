import { apiRequest } from './api';
import type { Tag } from '../types';

export async function fetchConversationTags() {
  return apiRequest<{ tags: Tag[]; colors: string[] }>('/api/conversation-tags');
}

export async function createConversationTag(name: string, color: string) {
  return apiRequest<{ tag: Tag }>('/api/conversation-tags', { method: 'POST', body: JSON.stringify({ name, color }) });
}

export async function updateConversationTag(tagId: string, input: { name?: string; color?: string }) {
  return apiRequest<{ tag: Tag }>(`/api/conversation-tags/${encodeURIComponent(tagId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteConversationTag(tagId: string) {
  return apiRequest<{ removed: boolean; tagId: string; usageCount: number }>(`/api/conversation-tags/${encodeURIComponent(tagId)}`, {
    method: 'DELETE',
  });
}

export async function addConversationTag(remoteJid: string, tagId: string) {
  return apiRequest<{ tags: Tag[] }>(`/api/evolution/chats/${encodeURIComponent(remoteJid)}/tags`, { method: 'POST', body: JSON.stringify({ tagId }) });
}

export async function removeConversationTag(remoteJid: string, tagId: string) {
  return apiRequest<{ tags: Tag[] }>(`/api/evolution/chats/${encodeURIComponent(remoteJid)}/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
}
