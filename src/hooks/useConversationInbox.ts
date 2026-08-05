import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mockConversations } from '../services/mockData';
import { EvolutionApiService } from '../services/evolutionApi';
import { ChatStatus, Conversation } from '../types';
import { ConversationFilter } from '../components/conversations/ConversationFilters';

export const conversationNeedsResponse = (conversation: Conversation) => (
  conversation.needsResponse
  ?? (conversation.status !== 'resolved' && !conversation.lastMessageFromMe && conversation.unreadCount > 0)
);

const normalizeSearchText = (value: string) => value
  .toLocaleLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const isPhoneOnlyName = (value?: string | null) => !value || /^\+?[\d\s().-]+$/.test(value.trim());

const phoneVariants = (value: string) => {
  const digits = value.replace(/\D/g, '');
  const variants = new Set([digits]);
  if (digits.startsWith('55') && digits.length === 13) {
    variants.add(`${digits.slice(0, 4)}${digits.slice(5)}`);
  } else if (digits.startsWith('55') && digits.length === 12) {
    variants.add(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  }
  return Array.from(variants).filter(Boolean);
};

type UseConversationInboxOptions = {
  instanceName: string;
  isMock: boolean;
  userId?: string;
  userRole?: string;
};

export const useConversationInbox = ({
  instanceName,
  isMock,
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

  const conversationsRef = useRef<Conversation[]>([]);
  const activeConversationIdRef = useRef('');
  const readOverridesRef = useRef(new Map<string, number>());
  const contactNameOverridesRef = useRef(new Map<string, string>());
  const loadingChatsRef = useRef(false);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const loadChats = useCallback(async (showLoading = true) => {
    // A Evolution pode levar vários segundos para responder. Não iniciamos
    // outra sincronização enquanto a anterior ainda está em andamento.
    if (loadingChatsRef.current) return;
    loadingChatsRef.current = true;
    if (showLoading) setLoadingChats(true);

    try {
      if (isMock) {
        setConversations(mockConversations);
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

      const previousActiveConversation = conversationsRef.current.find(
        (conversation) => conversation.id === activeConversationIdRef.current,
      );
      const previousActivePhone = previousActiveConversation?.contact.phone.replace(/\D/g, '');
      const mergedChats = realChats.map((conversation) => {
        const locallyReadAt = readOverridesRef.current.get(conversation.id);
        const phone = conversation.contact.phone.replace(/\D/g, '');
        const savedName = phoneVariants(phone)
          .map((variant) => contactNameOverridesRef.current.get(variant))
          .find(Boolean);
        const withNameOverride = savedName && !isPhoneOnlyName(savedName)
          ? { ...conversation, contact: { ...conversation.contact, name: savedName } }
          : conversation;
        return locallyReadAt && conversation.lastMessageAt && conversation.lastMessageAt <= locallyReadAt
          ? { ...withNameOverride, unreadCount: 0 }
          : withNameOverride;
      });

      setConversations(mergedChats);
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
      loadingChatsRef.current = false;
      if (showLoading) setLoadingChats(false);
    }
  }, [instanceName, isMock]);

  useEffect(() => {
    void loadChats();
    if (isMock) return undefined;

    const interval = window.setInterval(() => {
      void loadChats(false);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [isMock, loadChats]);

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
    markConversationAsRead,
    rememberContactName,
    capturingChat,
    assignmentFeedback,
    setAssignmentFeedback,
    captureActiveChat,
    releaseActiveChat,
    updateActiveChatStatus,
  };
};
