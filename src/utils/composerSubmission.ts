import type { Message } from '../types';

export type ComposerSubmissionSnapshot = {
  text: string;
  replyTarget: Message | null;
  isInternalNote: boolean;
};

/**
 * Captures all mutable Composer state before a send clears the UI. The reply
 * target belongs to this exact submission and is never read again afterward.
 */
export const captureComposerSubmission = ({
  text,
  replyTarget,
  isInternalNote,
}: {
  text: string;
  replyTarget: Message | null;
  isInternalNote: boolean;
}): ComposerSubmissionSnapshot => ({
  text: text.trim(),
  replyTarget: isInternalNote ? null : replyTarget,
  isInternalNote,
});

/** A failed request may restore its draft only if nothing newer replaced it. */
export const canRestoreComposerDraft = (currentRevision: number, clearedRevision: number) => (
  currentRevision === clearedRevision
);

export const writeConversationDraft = (drafts: Map<string, string>, conversationId: string, text: string) => {
  if (text) drafts.set(conversationId, text);
  else drafts.delete(conversationId);
};

export const readConversationDraft = (drafts: ReadonlyMap<string, string>, conversationId: string) => (
  drafts.get(conversationId) || ''
);

export const scheduleComposerFocus = (
  focus: () => void,
  schedule: (callback: FrameRequestCallback) => number = window.requestAnimationFrame,
) => schedule(() => focus());

export const insertComposerText = ({
  value,
  inserted,
  start,
  end,
}: {
  value: string;
  inserted: string;
  start: number;
  end: number;
}) => ({
  value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
  cursor: start + inserted.length,
});
