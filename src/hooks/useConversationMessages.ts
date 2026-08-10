import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, Message } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';
import { phoneVariants } from '../utils/phone';
import { mergeConversationMessages } from '../utils/messageMerge';
import { createLatestRequestGuard } from '../utils/requestCoordinator';

type UseConversationMessagesOptions = {
  activeConversationId: string;
  conversations: Conversation[];
  instanceName: string;
  attendantLabel: string;
  isMock: boolean;
};

const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export { mergeConversationMessages } from '../utils/messageMerge';

export const useConversationMessages = ({
  activeConversationId,
  conversations,
  instanceName,
  attendantLabel,
  isMock,
}: UseConversationMessagesOptions) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const conversationsRef = useRef(conversations);
  const messagesRef = useRef<Message[]>([]);
  const latestTimestampRef = useRef<number | undefined>();
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      stickToBottomRef.current = true;
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return undefined;
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      stickToBottomRef.current = distanceFromBottom <= 120;
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        if (stickToBottomRef.current) container.scrollTop = container.scrollHeight;
      })
      : undefined;
    resizeObserver?.observe(container);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
    };
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId || isMock) {
      setLoadingMessages(false);
      return;
    }

    let isSubscribed = true;
    let isInitialFetch = true;
    let shouldReconcile = true;
    let fetchInProgress = false;
    let reconciliationInProgress = false;
    const requestGuard = createLatestRequestGuard();
    setMessages([]);
    messagesRef.current = [];
    latestTimestampRef.current = undefined;
    setHasMoreMessages(false);
    setLoadingMessages(Boolean(activeConversationId));
    setHistoryExpanded(false);
    historyExpandedRef.current = false;

    const applyMessagesPage = (
      page: { messages: Message[]; hasMore: boolean },
      shouldScroll: boolean,
      requestId: number,
    ) => {
      if (!isSubscribed || !requestGuard.isLatest(requestId)) return;
      const cutoff = Date.now() - HISTORY_WINDOW_MS;
      const recentMessages = historyExpandedRef.current
        ? page.messages
        : page.messages.filter((message) => !message.timestampMs || message.timestampMs >= cutoff);
      const hasHiddenHistory = !historyExpandedRef.current && page.messages.some(
        (message) => Boolean(message.timestampMs && message.timestampMs < cutoff),
      );
      setHasMoreMessages(page.hasMore || hasHiddenHistory);
      if (recentMessages.length === 0) return;
      latestTimestampRef.current = Math.max(
        latestTimestampRef.current || 0,
        ...recentMessages.map((message) => message.timestampMs || 0),
      );
      const previousMessages = messagesRef.current;
      const reconciledMessages = mergeConversationMessages(previousMessages, recentMessages);
      if (reconciledMessages !== previousMessages) {
        messagesRef.current = reconciledMessages;
        setMessages((currentMessages) => currentMessages === previousMessages
          ? reconciledMessages
          : mergeConversationMessages(currentMessages, recentMessages));
      }
      if (shouldScroll) window.setTimeout(() => {
        if (stickToBottomRef.current) scrollToBottom();
      }, 0);
    };

    const fetchConversationMessages = async () => {
      if (fetchInProgress) return;
      fetchInProgress = true;
      const firstFetch = isInitialFetch;
      const requestId = requestGuard.begin();
      const container = messagesContainerRef.current;
      const distanceFromBottom = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight
        : 0;
      const shouldScroll = isInitialFetch || distanceFromBottom <= 120;
      stickToBottomRef.current = shouldScroll;
      isInitialFetch = false;
      const conversation = conversationsRef.current.find((item) => item.id === activeConversationId);
      const phone = conversation?.contact.phone || activeConversationId;
      const reconcile = shouldReconcile;
      const afterTimestamp = reconcile
        ? Math.max(0, Date.now() - HISTORY_WINDOW_MS)
        : latestTimestampRef.current
          ? Math.max(0, latestTimestampRef.current - 1000)
          : undefined;
      let localMessagesAvailable = false;

      try {
        // A leitura local é deliberadamente rápida. A reconciliação com a
        // Evolution pode buscar centenas de mensagens e continua em segundo
        // plano, sem bloquear a abertura da conversa.
        const page = await EvolutionApiService.fetchConversationMessagesPage(
          instanceName,
          activeConversationId,
          phone,
          attendantLabel,
          false,
          undefined,
          afterTimestamp,
        );
        shouldReconcile = false;
        if (!isSubscribed) return;
        localMessagesAvailable = page.messages.length > 0;
        applyMessagesPage(page, shouldScroll, requestId);

        if (reconcile && !reconciliationInProgress) {
          reconciliationInProgress = true;
          const reconciliationRequestId = requestGuard.begin();
          void EvolutionApiService.fetchConversationMessagesPage(
            instanceName,
            activeConversationId,
            phone,
            attendantLabel,
            true,
            undefined,
            afterTimestamp,
          )
            .then((reconciledPage) => applyMessagesPage(reconciledPage, shouldScroll, reconciliationRequestId))
            .catch(() => undefined)
            .finally(() => {
              reconciliationInProgress = false;
              if (isSubscribed && firstFetch && !localMessagesAvailable) setLoadingMessages(false);
            });
        }
      } catch {
        // A temporary provider/network failure should not erase the messages already rendered.
        if (firstFetch && isSubscribed) setLoadingMessages(false);
      } finally {
        fetchInProgress = false;
        // When local messages exist, the loading state ends immediately. If
        // the local cache is empty, keep it until the background reconciliation
        // finishes so a genuinely new conversation still has clear feedback.
        if (firstFetch && (!reconcile || localMessagesAvailable)) setLoadingMessages(false);
      }
    };

    const unsubscribe = EvolutionApiService.subscribeToRealtimeEvents((event) => {
      if (event.type !== 'message.upsert' && event.type !== 'message.status') return;
      const eventRemoteJid = String(event.remoteJid || '');
      const eventPhone = String(event.phone || '').replace(/\D/g, '');
      const conversationPhone = conversationsRef.current
        .find((item) => item.id === activeConversationId)?.contact.phone.replace(/\D/g, '') || '';
      const samePhone = Boolean(eventPhone && conversationPhone
        && phoneVariants(eventPhone).some((variant) => phoneVariants(conversationPhone).includes(variant)));
      if (eventRemoteJid !== activeConversationId && !samePhone) return;
      void fetchConversationMessages();
    });

    void fetchConversationMessages();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchConversationMessages();
    }, 15000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void fetchConversationMessages();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isSubscribed = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribe();
    };
  }, [activeConversationId, attendantLabel, instanceName, isMock, scrollToBottom]);

  const historyExpandedRef = useRef(false);
  useEffect(() => {
    historyExpandedRef.current = historyExpanded;
  }, [historyExpanded]);

  const loadingOlderRef = useRef(false);
  const loadOlderMessages = useCallback(async () => {
    if (!activeConversationId || isMock || !hasMoreMessages || loadingOlderRef.current) return;
    const oldestTimestamp = messagesRef.current[0]?.timestampMs || Date.now();
    const conversation = conversationsRef.current.find((item) => item.id === activeConversationId);
    const phone = conversation?.contact.phone || activeConversationId;
    const container = messagesContainerRef.current;
    const previousHeight = container?.scrollHeight || 0;
    const previousTop = container?.scrollTop || 0;
    loadingOlderRef.current = true;
    setLoadingOlderMessages(true);
    setHistoryExpanded(true);
    historyExpandedRef.current = true;
    try {
      const page = await EvolutionApiService.fetchConversationMessagesPage(
        instanceName,
        activeConversationId,
        phone,
        attendantLabel,
        false,
        oldestTimestamp,
        undefined,
      );
      if (page.messages.length > 0) {
        const previousMessages = messagesRef.current;
        const reconciledMessages = mergeConversationMessages(previousMessages, page.messages);
        if (reconciledMessages !== previousMessages) {
          messagesRef.current = reconciledMessages;
          setMessages((currentMessages) => currentMessages === previousMessages
            ? reconciledMessages
            : mergeConversationMessages(currentMessages, page.messages));
        }
        window.requestAnimationFrame(() => {
          const nextContainer = messagesContainerRef.current;
          if (nextContainer) nextContainer.scrollTop = nextContainer.scrollHeight - previousHeight + previousTop;
        });
      }
      setHasMoreMessages(page.hasMore);
    } catch {
      // O histórico atual permanece visível quando a página anterior falhar.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [activeConversationId, attendantLabel, hasMoreMessages, instanceName, isMock]);

  return {
    messages,
    hasMoreMessages,
    loadingMessages,
    historyExpanded,
    loadingOlderMessages,
    loadOlderMessages,
    setMessages,
    messagesContainerRef,
    scrollToBottom,
  };
};
