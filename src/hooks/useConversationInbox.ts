import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mockConversations } from '../services/mockData';
import { EvolutionApiService } from '../services/evolutionApi';
import { ChatStatus, Conversation, WhatsappInstance } from '../types';
import { ConversationFilter } from '../components/conversations/ConversationFilters';
import { phoneVariants } from '../utils/phone';
import { reconcileConversations } from '../utils/conversationReconciliation';
import { createInFlightRequestCoordinator } from '../utils/requestCoordinator';
import { reconcileRealtimeConversation } from '../utils/realtimeUpdates';
import { REALTIME_RECONNECTED_EVENT, REALTIME_SAFETY_INTERVAL_MS } from '../utils/realtimeConfig';

export const conversationNeedsResponse = (conversation: Conversation) => (
  conversation.needsResponse
  ?? (conversation.status !== 'resolved' && !conversation.lastMessageFromMe && conversation.unreadCount > 0)
);

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

  const loadChats = useCallback((showLoading = true) => {
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
      const previousActivePhone = previousActiveConversation?.contact.phone.replace(/\D/g, '');
      const mergedChats = realChats.map((conversation) => {
        const previousConversation = previousConversations.find((item) => item.id === conversation.id);
        const locallyReadAt = readOverridesRef.current.get(conversation.id);
        const phone = conversation.contact.phone.replace(/\D/g, '');
        const savedName = phoneVariants(phone)
          .map((variant) => contactNameOverridesRef.current.get(variant))
          .find(Boolean);
        const withNameOverride = savedName && isPhoneOnlyName(conversation.contact.name)
          ? { ...conversation, contact: { ...conversation.contact, name: savedName } }
          : conversation;
        const withReadOverride = locallyReadAt && conversation.lastMessageAt && conversation.lastMessageAt <= locallyReadAt
          ? { ...withNameOverride, unreadCount: 0 }
          : withNameOverride;
        if (previousConversation?.lastMessageAt
          && (!withReadOverride.lastMessageAt
            || previousConversation.lastMessageAt > withReadOverride.lastMessageAt)) {
          // Um snapshot antigo pode chegar depois de uma mensagem otimista ou
          // de um evento SSE. Preserve somente a atividade mais nova local;
          // os demais campos continuam vindo do backend.
          return {
            ...withReadOverride,
            lastMessage: previousConversation.lastMessage,
            lastMessageTimestamp: previousConversation.lastMessageTimestamp,
            lastMessageAt: previousConversation.lastMessageAt,
            lastMessageFromMe: previousConversation.lastMessageFromMe,
            lastMessageKey: previousConversation.lastMessageKey,
            unreadCount: previousConversation.unreadCount,
            needsResponse: previousConversation.needsResponse,
          };
        }
        return withReadOverride;
      });

      const reconciledConversations = reconcileConversations(previousConversations, mergedChats);
      if (reconciledConversations !== previousConversations) {
        conversationsRef.current = reconciledConversations;
        setConversations(reconciledConversations);
      }
      setActiveConversationId((previousId) => {
        if (mergedChats.some((conversation) => conversation.id === previousId)) return previousId;
        const replacement = previousActivePhone
          ? mergedChats.find((conversation) => conversation.contact.phone.replace(/\D/g, '') === previousActivePhone)
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
    void loadChats();
    if (isMock) return undefined;

    const unsubscribe = EvolutionApiService.subscribeToRealtimeEvents((event) => {
      if (event.type === REALTIME_RECONNECTED_EVENT) {
        if (document.visibilityState === 'visible') {
          void EvolutionApiService.getInstanceStatus(instanceName);
          void loadChats(false);
        }
        return;
      }
      // Statuses only affect the active timeline. The inbox has no message
      // delivery state to render, so refetching the complete list is wasted.
      if (event.type === 'message.status') return;
      if (event.type !== 'message.upsert' && event.type !== 'conversation.updated') return;

      const previousConversations = conversationsRef.current;
      const reconciledConversations = reconcileRealtimeConversation(previousConversations, event);
      if (reconciledConversations) {
        if (reconciledConversations !== previousConversations) {
          conversationsRef.current = reconciledConversations;
          setConversations(reconciledConversations);
        }
        return;
      }

      // Events without enough fields (or for a conversation not currently in
      // the list) retain the existing polling/refetch safety net.
      void loadChats(false);
    });
    const handleWhatsAppStatus = (event: Event) => {
      const status = (event as CustomEvent<'connected' | 'connecting' | 'disconnected'>).detail;
      if (status !== 'connected' && status !== 'connecting' && status !== 'disconnected') return;
      const previousStatus = whatsappStatusRef.current;
      whatsappStatusRef.current = status;
      if (status === 'connected' && previousStatus !== 'connected' && document.visibilityState === 'visible') {
        void loadChats(false);
      }
    };
    window.addEventListener('vitstock:whatsapp-status', handleWhatsAppStatus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadChats(false);
    }, REALTIME_SAFETY_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadChats(false);
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

  const activeChatLocked = Boolean(
    activeConversation?.assignedAttendant
      && activeConversation.assignedAttendant.id !== userId
      && userRole !== 'admin',
  );

  const normalizedConversationSearch = normalizeSearchText(conversationSearch.trim());
  const visibleConversations = useMemo(() => conversations.filter((conversation) => {
    const matchesFilter = filterTab === 'all'
      || (filterTab === 'unread' && conversation.unreadCount > 0)
      || (filterTab === 'unanswered' && conversationNeedsResponse(conversation))
      || (filterTab === 'delivery' && conversation.status === 'pending')
      || (filterTab === 'resolved' && conversation.status === 'resolved');
    if (!matchesFilter) return false;
    if (!normalizedConversationSearch) return true;
    return [conversation.contact.name, conversation.contact.phone]
      .some((value) => normalizeSearchText(value).includes(normalizedConversationSearch));
  }), [conversations, filterTab, normalizedConversationSearch]);

  const needsAttention = useCallback((conversation: Conversation) => conversationNeedsAttention(conversation, now), [now]);

  const markConversationAsRead = useCallback(async (conversation: Conversation) => {
    setConversations((previous) => previous.map((item) => item.id === conversation.id
      ? { ...item, unreadCount: 0 }
      : item));
    if (!conversation.lastMessageAt) return;

    readOverridesRef.current.set(conversation.id, conversation.lastMessageAt);
    try {
      await EvolutionApiService.markChatAsRead(conversation.id, conversation.lastMessageAt, conversation.lastMessageKey);
    } catch (error) {
      console.warn('[Atendimento] Não foi possível persistir a leitura:', error);
    }
  }, []);

  const rememberContactName = useCallback((phone: string, name: string) => {
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
      await loadChats(false);
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
          : conversation.needsResponse ?? conversation.unreadCount > 0,
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
    filterTab,
    setFilterTab,
    conversationSearch,
    setConversationSearch,
    visibleConversations,
    loadingChats,
    loadChats,
    updateConversationActivity,
    markConversationAsRead,
    rememberContactName,
    capturingChat,
    assignmentFeedback,
    setAssignmentFeedback,
    captureActiveChat,
    releaseActiveChat,
    updateActiveChatStatus,
    needsAttention,
  };
};
