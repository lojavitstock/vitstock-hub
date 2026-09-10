import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mockConversations } from '../services/mockData';
import { EvolutionApiService } from '../services/evolutionApi';
import { ChatStatus, Conversation, WhatsappInstance } from '../types';
import { ConversationFilter, matchesConversationFilter } from '../utils/conversationTagFilters';
import { canonicalPhoneDigits, phoneVariants } from '../utils/phone';
import { reconcileConversations, reconcileConversationsMonotonic } from '../utils/conversationReconciliation';
import { createInFlightRequestCoordinator } from '../utils/requestCoordinator';
import { reconcileRealtimeConversation } from '../utils/realtimeUpdates';
import { REALTIME_RECONNECTED_EVENT, REALTIME_SAFETY_INTERVAL_MS } from '../utils/realtimeConfig';
import { createMessageNotificationDeduper } from '../utils/messageNotification';
import { playNotificationSound } from '../utils/notificationSound';
import { conversationNeedsResponse } from '../utils/conversationState';
import { traceInboxOrderChanges, traceInboxOrderEvent, type InboxOrderTraceTrigger } from '../utils/inboxOrderDiagnostics';

export { conversationNeedsResponse } from '../utils/conversationState';

const UNANSWERED_ALERT_MS = 20 * 60 * 1000;

export const conversationNeedsAttention = (conversation: Conversation, now = Date.now()) => (
  conversationNeedsResponse(conversation)
  && Boolean(conversation.lastMessageAt && now - conversation.lastMessageAt >= UNANSWERED_ALERT_MS)
);

const normalizeSearchText = (value: string) => value
  .toLocaleLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const isPhoneOnlyName = (value?: string | null) => !value || /^\+?[\d\s().-]+$/.test(value.trim());

type UseConversationInboxOptions = {
  instanceName: string;
  isMock: boolean;
  connectionStatus: WhatsappInstance['status'];
  userId?: string;
  userRole?: string;
};

type ConversationActivityPatch = {
  lastMessage: string;
  lastMessageTimestamp: string;
  lastMessageAt: number;
  lastMessageFromMe: boolean;
  lastMessageKey?: Conversation['lastMessageKey'];
  unreadCount?: number;
  needsResponse?: boolean;
  moveToFront?: boolean;
};

export const useConversationInbox = ({
  instanceName,
  isMock,
  connectionStatus,
  userId,
  userRole,
}: UseConversationInboxOptions) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [filterTab, setFilterTab] = useState<ConversationFilter>('all');
  const [conversationSearch, setConversationSearch] = useState('');
  const [loadingChats, setLoadingChats] = useState(false);
  const [capturingChat, setCapturingChat] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const conversationsRef = useRef<Conversation[]>([]);
  const activeConversationIdRef = useRef('');
  const readOverridesRef = useRef(new Map<string, number>());
  const contactNameOverridesRef = useRef(new Map<string, string>());
  const inboxRequestsRef = useRef(createInFlightRequestCoordinator<void>());
  const whatsappStatusRef = useRef<'connected' | 'connecting' | 'disconnected'>('connecting');
  const messageNotificationDeduperRef = useRef(createMessageNotificationDeduper());
  const avatarResolutionUntilRef = useRef(new Map<string, number>());

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const loadChats = useCallback((showLoading = true, trigger: InboxOrderTraceTrigger = showLoading ? 'initial_load' : 'unknown') => {
    if (!isMock && connectionStatus !== 'connected') return Promise.resolve();
    return inboxRequestsRef.current.run('inbox', async () => {
    // A Evolution pode levar vários segundos para responder. Não iniciamos
    // outra sincronização enquanto a anterior ainda está em andamento.
    if (showLoading) setLoadingChats(true);

    try {
      if (isMock) {
        const previousConversations = conversationsRef.current;
        const reconciledConversations = reconcileConversations(previousConversations, mockConversations);
        if (reconciledConversations !== previousConversations) {
          conversationsRef.current = reconciledConversations;
          setConversations(reconciledConversations);
        }
        setActiveConversationId((previousId) => (
          mockConversations.some((conversation) => conversation.id === previousId)
            ? previousId
            : mockConversations[0]?.id || ''
        ));
        return;
      }

      const realChats = await EvolutionApiService.fetchRealChats(instanceName);
      if (realChats.length === 0) {
        // A resposta vazia pode ocorrer enquanto a Evolution reorganiza o chat
        // depois do envio. Mantemos a lista atual para não fechar a conversa.
        return;
      }

      const previousConversations = conversationsRef.current;
      const previousActiveConversation = previousConversations.find(
        (conversation) => conversation.id === activeConversationIdRef.current,
      );
      const previousActivePhone = previousActiveConversation && !previousActiveConversation.isGroup
        ? canonicalPhoneDigits(previousActiveConversation.contact.phone)
        : undefined;
      const mergedChats = realChats.map((conversation) => {
        const locallyReadAt = readOverridesRef.current.get(conversation.id);
        const phone = conversation.isGroup ? '' : conversation.contact.phone.replace(/\D/g, '');
        const savedName = phoneVariants(phone)
          .map((variant) => contactNameOverridesRef.current.get(variant))
          .find(Boolean);
        const withNameOverride = savedName && isPhoneOnlyName(conversation.contact.name)
          ? { ...conversation, contact: { ...conversation.contact, name: savedName } }
          : conversation;
        return locallyReadAt && conversation.lastMessageAt && conversation.lastMessageAt <= locallyReadAt
          ? { ...withNameOverride, unreadCount: 0 }
          : withNameOverride;
      });

      const reconciledConversations = reconcileConversationsMonotonic(previousConversations, mergedChats);
      traceInboxOrderChanges(previousConversations, reconciledConversations, {
        snapshot: mergedChats,
        activeConversationId: activeConversationIdRef.current,
        trigger,
      });
      if (reconciledConversations !== previousConversations) {
        conversationsRef.current = reconciledConversations;
        setConversations(reconciledConversations);
      }
      setActiveConversationId((previousId) => {
        if (mergedChats.some((conversation) => conversation.id === previousId)) return previousId;
        const replacement = previousActivePhone
          ? mergedChats.find((conversation) => canonicalPhoneDigits(conversation.contact.phone) === previousActivePhone)
          : undefined;
        return replacement?.id || previousId || mergedChats[0].id;
      });
    } catch (error) {
      // Uma falha temporária não deve apagar a lista já renderizada.
      console.warn('[Atendimento] Não foi possível atualizar as conversas:', error);
    } finally {
      if (showLoading) setLoadingChats(false);
    }
    });
  }, [connectionStatus, instanceName, isMock]);

  const updateConversationActivity = useCallback((conversationId: string, activity: ConversationActivityPatch) => {
    const previous = conversationsRef.current;
    const index = previous.findIndex((conversation) => conversation.id === conversationId);
    if (index < 0) return;

    const { moveToFront, ...conversationFields } = activity;
    const nextConversation = { ...previous[index], ...conversationFields };
    const next = previous.slice();
    next[index] = nextConversation;
    if (moveToFront && index > 0) {
      next.splice(index, 1);
      next.unshift(nextConversation);
    }

    const reconciled = reconcileConversations(previous, next);
    if (reconciled === previous) return;
    conversationsRef.current = reconciled;
    setConversations(reconciled);
  }, []);

  useEffect(() => {
    if (!isMock && connectionStatus !== 'connected') return undefined;
    void loadChats(true, 'initial_load');
    if (isMock) return undefined;

    const unsubscribe = EvolutionApiService.subscribeToRealtimeEvents((event) => {
      if (event.type === 'message.upsert'
        && event.reaction !== true
        && messageNotificationDeduperRef.current.shouldNotify(event.message)) {
        playNotificationSound();
      }
      if (event.type === REALTIME_RECONNECTED_EVENT) {
        if (document.visibilityState === 'visible') {
          void EvolutionApiService.getInstanceStatus(instanceName);
          void loadChats(false, 'realtime_reconnect');
        }
        return;
      }
      // Statuses only affect the active timeline. The inbox has no message
      // delivery state to render, so refetching the complete list is wasted.
      if (event.type === 'message.status') return;
      if (event.type !== 'message.upsert' && event.type !== 'message.updated' && event.type !== 'conversation.updated') return;

      const previousConversations = conversationsRef.current;
      const reconciledConversations = reconcileRealtimeConversation(previousConversations, event);
      if (reconciledConversations) {
        traceInboxOrderChanges(previousConversations, reconciledConversations, {
          activeConversationId: activeConversationIdRef.current,
          trigger: event.type === 'message.upsert'
            ? 'message_upsert'
            : event.type === 'conversation.updated' ? 'conversation_updated' : 'unknown',
        });
        if (reconciledConversations !== previousConversations) {
          conversationsRef.current = reconciledConversations;
          setConversations(reconciledConversations);
        }
        return;
      }

      // Events without enough fields (or for a conversation not currently in
      // the list) retain the existing polling/refetch safety net.
      void loadChats(false, 'unknown');
    });
    const handleWhatsAppStatus = (event: Event) => {
      const status = (event as CustomEvent<'connected' | 'connecting' | 'disconnected'>).detail;
      if (status !== 'connected' && status !== 'connecting' && status !== 'disconnected') return;
      const previousStatus = whatsappStatusRef.current;
      whatsappStatusRef.current = status;
      if (status === 'connected' && previousStatus !== 'connected' && document.visibilityState === 'visible') {
        void loadChats(false, 'realtime_reconnect');
      }
    };
    window.addEventListener('vitstock:whatsapp-status', handleWhatsAppStatus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadChats(false, 'polling');
    }, REALTIME_SAFETY_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadChats(false, 'polling');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('vitstock:whatsapp-status', handleWhatsAppStatus);
      unsubscribe();
    };
  }, [connectionStatus, isMock, loadChats]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations],
  );

  const activeLease = activeConversation?.lease && activeConversation.lease.expiresAt > now
    ? activeConversation.lease
    : undefined;
  const activeChatLocked = Boolean(activeLease && activeLease.ownerUserId !== userId);

  const normalizedConversationSearch = normalizeSearchText(conversationSearch.trim());
  const visibleConversations = useMemo(() => conversations.filter((conversation) => {
    const matchesFilter = matchesConversationFilter(conversation, filterTab, conversationNeedsResponse);
    if (!matchesFilter) return false;
    if (!normalizedConversationSearch) return true;
    return [conversation.contact.name, conversation.groupName || '', conversation.contact.phone]
      .some((value) => normalizeSearchText(value).includes(normalizedConversationSearch));
  }), [conversations, filterTab, normalizedConversationSearch]);

  const needsAttention = useCallback((conversation: Conversation) => conversationNeedsAttention(conversation, now), [now]);

  const markConversationAsRead = useCallback(async (conversation: Conversation) => {
    const index = conversationsRef.current.findIndex((item) => item.id === conversation.id);
    traceInboxOrderEvent({
      event: 'mark_read_start',
      conversation,
      index,
      activeConversationId: activeConversationIdRef.current,
    });
    setConversations((previous) => {
      const next = previous.map((item) => item.id === conversation.id
        ? { ...item, unreadCount: 0 }
        : item);
      conversationsRef.current = next;
      return next;
    });
    if (!conversation.lastMessageAt) return;

    readOverridesRef.current.set(conversation.id, conversation.lastMessageAt);
    try {
      await EvolutionApiService.markChatAsRead(conversation.id, conversation.lastMessageAt, conversation.lastMessageKey);
      traceInboxOrderEvent({
        event: 'mark_read_success',
        conversation,
        index,
        activeConversationId: activeConversationIdRef.current,
      });
    } catch (error) {
      traceInboxOrderEvent({
        event: 'mark_read_failure',
        conversation,
        index,
        activeConversationId: activeConversationIdRef.current,
      });
      console.warn('[Atendimento] Não foi possível persistir a leitura:', error);
    }
  }, []);

  const resolveConversationAvatar = useCallback(async (conversationId: string) => {
    if (isMock || !conversationId) return;
    const nowMs = Date.now();
    const cachedUntil = avatarResolutionUntilRef.current.get(conversationId) || 0;
    if (cachedUntil > nowMs) return;
    // The backend owns the longer-lived provider cache. This short client
    // guard prevents a visible item from issuing the same request on every
    // render while still allowing a later retry after an unavailable URL.
    avatarResolutionUntilRef.current.set(conversationId, nowMs + 15 * 60_000);
    try {
      const result = await EvolutionApiService.resolveConversationAvatar(conversationId);
      if (result.source === 'whatsapp') avatarResolutionUntilRef.current.set(conversationId, Date.now() + 24 * 60 * 60_000);
      else if (result.source === 'google') avatarResolutionUntilRef.current.set(conversationId, Date.now() + 6 * 60 * 60_000);
      if (!result.avatar) return;
      setConversations((previous) => {
        const next = previous.map((conversation) => conversation.id === conversationId
          ? {
              ...conversation,
              avatarSource: result.source,
              contact: { ...conversation.contact, avatar: result.avatar || conversation.contact.avatar },
            }
          : conversation);
        conversationsRef.current = next;
        return next;
      });
    } catch {
      // Profile enrichment is optional and must never affect the inbox.
    }
  }, [isMock]);

  const rememberContactName = useCallback((phone: string, name: string) => {
    if (phone.toLowerCase().endsWith('@g.us')) return;
    const normalizedPhone = phone.replace(/\D/g, '');
    const normalizedName = name.trim();
    if (!normalizedPhone || isPhoneOnlyName(normalizedName)) return;
    phoneVariants(normalizedPhone).forEach((variant) => {
      contactNameOverridesRef.current.set(variant, normalizedName);
    });
    setConversations((previous) => previous.map((conversation) => (
      conversation.contact.phone.replace(/\D/g, '') === normalizedPhone
        ? { ...conversation, contact: { ...conversation.contact, name: normalizedName } }
        : conversation
    )));
  }, []);

  const captureActiveChat = useCallback(async () => {
    if (!activeConversation || isMock) return;
    setCapturingChat(true);
    setAssignmentFeedback('');
    try {
      const result = await EvolutionApiService.captureChat(activeConversation.id, activeConversation.contact.phone);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
        ...conversation,
        assignedAttendant: result.user,
        contact: {
          ...conversation.contact,
          tags: [{ id: `assigned-${result.user.id}`, name: result.user.name, color: '#A78BFA' }],
        },
      } : conversation));
      setAssignmentFeedback('Atendimento capturado.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível capturar o atendimento');
      await loadChats(false, 'manual_refresh');
    } finally {
      setCapturingChat(false);
    }
  }, [activeConversation, isMock, loadChats]);

  const releaseActiveChat = useCallback(async () => {
    if (!activeConversation || isMock) return;
    setCapturingChat(true);
    setAssignmentFeedback('');
    try {
      await EvolutionApiService.releaseChat(activeConversation.id, activeConversation.contact.phone);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
        ...conversation,
        assignedAttendant: undefined,
        contact: { ...conversation.contact, tags: [] },
      } : conversation));
      setAssignmentFeedback('Atendimento liberado para a equipe.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível liberar o atendimento');
    } finally {
      setCapturingChat(false);
    }
  }, [activeConversation, isMock]);

  const pullActiveConversationLease = useCallback(async () => {
    if (!activeConversation || isMock) return;
    setCapturingChat(true);
    setAssignmentFeedback('');
    try {
      const result = await EvolutionApiService.pullConversationLease(activeConversation.id, activeConversation.contact.phone);
      const expiresAt = Date.parse(result.lease.expiresAt);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
        ...conversation,
        lease: {
          ownerUserId: result.lease.ownerUserId,
          ownerName: result.lease.ownerName,
          expiresAt,
        },
      } : conversation));
      setAssignmentFeedback('Conversa puxada para voc\u00ea.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel puxar a conversa');
      await loadChats(false, 'manual_refresh');
    } finally {
      setCapturingChat(false);
    }
  }, [activeConversation, isMock, loadChats]);

  const updateActiveChatStatus = useCallback(async (status: ChatStatus) => {
    if (!activeConversation) return;

    const previousStatus = activeConversation.status;
    const previousNeedsResponse = conversationNeedsResponse(activeConversation);
    setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
      ...conversation,
      status,
      needsResponse: status === 'resolved'
        ? false
        : conversation.lastMessageFromMe
          ? false
          : conversation.needsResponse ?? conversation.lastMessageFromMe === false,
    } : conversation));
    setAssignmentFeedback('');

    const feedback = status === 'resolved'
      ? 'Conversa resolvida.'
      : status === 'pending'
        ? 'Conversa marcada como pendente.'
        : 'Conversa reaberta.';

    if (isMock) {
      setAssignmentFeedback(feedback);
      return;
    }

    try {
      await EvolutionApiService.updateChatStatus(activeConversation.id, status, activeConversation.contact.phone);
      setAssignmentFeedback(feedback);
    } catch (error) {
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
        ...conversation,
        status: previousStatus,
        needsResponse: previousNeedsResponse,
      } : conversation));
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível atualizar o status');
    }
  }, [activeConversation, isMock]);

  return {
    conversations,
    setConversations,
    activeConversation,
    activeConversationId,
    setActiveConversationId,
    activeChatLocked,
    activeLease,
    filterTab,
    setFilterTab,
    conversationSearch,
    setConversationSearch,
    visibleConversations,
    loadingChats,
    loadChats,
    updateConversationActivity,
    markConversationAsRead,
    resolveConversationAvatar,
    rememberContactName,
    capturingChat,
    assignmentFeedback,
    setAssignmentFeedback,
    captureActiveChat,
    releaseActiveChat,
    pullActiveConversationLease,
    updateActiveChatStatus,
    needsAttention,
  };
};
