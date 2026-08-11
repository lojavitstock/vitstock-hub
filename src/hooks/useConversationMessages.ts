import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, Message, WhatsappInstance } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';
import { phoneVariants } from '../utils/phone';
import { mergeConversationMessages } from '../utils/messageMerge';
import { createLatestRequestGuard } from '../utils/requestCoordinator';
import { reconcileRealtimeMessages } from '../utils/realtimeUpdates';
import { REALTIME_RECONNECTED_EVENT, REALTIME_SAFETY_INTERVAL_MS } from '../utils/realtimeConfig';
import {
  readConversationMessagesCache,
  type ConversationMessagesCacheEntry,
  writeConversationMessagesCache,
} from '../utils/conversationMessagesCache';

type UseConversationMessagesOptions = {
  activeConversationId: string;
  conversations: Conversation[];
  instanceName: string;
  attendantLabel: string;
  isMock: boolean;
  connectionStatus: WhatsappInstance['status'];
};

const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export { mergeConversationMessages } from '../utils/messageMerge';

export const useConversationMessages = ({
  activeConversationId,
  conversations,
  instanceName,
  attendantLabel,
  isMock,
  connectionStatus,
}: UseConversationMessagesOptions) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const conversationsRef = useRef(conversations);
  const messagesRef = useRef<Message[]>([]);
  const messagesConversationIdRef = useRef('');
  const messageCacheRef = useRef(new Map<string, ConversationMessagesCacheEntry>());
  const latestTimestampRef = useRef<number | undefined>();
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const historyExpandedRef = useRef(false);
  const newMessagesCountRef = useRef(0);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    messagesRef.current = messages;
    if (!activeConversationId || isMock || messagesConversationIdRef.current !== activeConversationId) return;
    const cached = messageCacheRef.current.get(activeConversationId);
    if (!cached) return;
    writeConversationMessagesCache(messageCacheRef.current, activeConversationId, {
      messages,
      hasMoreMessages: cached?.hasMoreMessages ?? false,
      historyExpanded: cached?.historyExpanded ?? historyExpandedRef.current,
      latestTimestamp: cached?.latestTimestamp ?? latestTimestampRef.current,
    });
  }, [activeConversationId, isMock, messages]);

  const clearNewMessages = useCallback(() => {
    if (newMessagesCountRef.current === 0) return;
    newMessagesCountRef.current = 0;
    setNewMessagesCount(0);
  }, []);

  const registerNewMessages = useCallback((count: number) => {
    if (count <= 0 || stickToBottomRef.current) return;
    const nextCount = newMessagesCountRef.current + count;
    newMessagesCountRef.current = nextCount;
    setNewMessagesCount(nextCount);
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      stickToBottomRef.current = true;
      clearNewMessages();
      container.scrollTop = container.scrollHeight;
    }
  }, [clearNewMessages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return undefined;
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const nearBottom = distanceFromBottom <= 120;
      stickToBottomRef.current = nearBottom;
      if (nearBottom) clearNewMessages();
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
  }, [activeConversationId, clearNewMessages]);

  useEffect(() => {
    if (!activeConversationId || isMock || connectionStatus !== 'connected') {
      messagesConversationIdRef.current = '';
      setLoadingMessages(false);
      setBackgroundRefreshing(false);
      return;
    }

    let isSubscribed = true;
    let isInitialFetch = true;
    let shouldReconcile = true;
    let fetchInProgress = false;
    let reconciliationInProgress = false;
    const requestGuard = createLatestRequestGuard();
    const cachedEntry = readConversationMessagesCache(messageCacheRef.current, activeConversationId);
    const hasCachedMessages = Boolean(cachedEntry);
    const isConversationSwitch = messagesConversationIdRef.current !== activeConversationId;
    messagesConversationIdRef.current = activeConversationId;
    if (isConversationSwitch) {
      stickToBottomRef.current = true;
      clearNewMessages();
    }
    if (cachedEntry) {
      messagesRef.current = cachedEntry.messages;
      latestTimestampRef.current = cachedEntry.latestTimestamp;
      historyExpandedRef.current = cachedEntry.historyExpanded;
      setMessages(cachedEntry.messages);
      setHasMoreMessages(cachedEntry.hasMoreMessages);
      setHistoryExpanded(cachedEntry.historyExpanded);
    } else {
      setMessages([]);
      messagesRef.current = [];
      latestTimestampRef.current = undefined;
      setHasMoreMessages(false);
      historyExpandedRef.current = false;
      setHistoryExpanded(false);
    }
    setLoadingMessages(!hasCachedMessages);
    setBackgroundRefreshing(hasCachedMessages);

    const applyMessagesPage = (
      page: { messages: Message[]; hasMore: boolean },
      shouldScroll: boolean,
      requestId: number,
      trackIncoming = false,
    ) => {
      if (!isSubscribed || !requestGuard.isLatest(requestId)) return;
      const cutoff = Date.now() - HISTORY_WINDOW_MS;
      const recentMessages = historyExpandedRef.current
        ? page.messages
        : page.messages.filter((message) => !message.timestampMs || message.timestampMs >= cutoff);
      const hasHiddenHistory = !historyExpandedRef.current && page.messages.some(
        (message) => Boolean(message.timestampMs && message.timestampMs < cutoff),
      );
      const nextHasMoreMessages = page.hasMore || hasHiddenHistory;
      setHasMoreMessages(nextHasMoreMessages);
      const previousMessages = messagesRef.current;
      const previousMessageIds = new Set(previousMessages.map((message) => message.id));
      const incomingIds = trackIncoming
        ? new Set(recentMessages
          .filter((message) => (
            message.sender === 'contact'
            && !message.isInternalNote
            && !previousMessageIds.has(message.id)
          ))
          .map((message) => message.id))
        : new Set<string>();
      let reconciledMessages = previousMessages;
      if (recentMessages.length > 0) {
        latestTimestampRef.current = Math.max(
          latestTimestampRef.current || 0,
          ...recentMessages.map((message) => message.timestampMs || 0),
        );
        reconciledMessages = mergeConversationMessages(previousMessages, recentMessages);
        if (reconciledMessages !== previousMessages) {
          messagesRef.current = reconciledMessages;
          setMessages((currentMessages) => currentMessages === previousMessages
            ? reconciledMessages
            : mergeConversationMessages(currentMessages, recentMessages));
        }
      }
      if (incomingIds.size > 0) registerNewMessages(incomingIds.size);
      writeConversationMessagesCache(messageCacheRef.current, activeConversationId, {
        messages: reconciledMessages,
        hasMoreMessages: nextHasMoreMessages,
        historyExpanded: historyExpandedRef.current,
        latestTimestamp: latestTimestampRef.current,
      });
      if (recentMessages.length === 0) return;
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
      const shouldScroll = isInitialFetch
        ? (isConversationSwitch || !hasCachedMessages || distanceFromBottom <= 120)
        : distanceFromBottom <= 120;
      if (!hasCachedMessages) stickToBottomRef.current = shouldScroll;
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
        applyMessagesPage(page, shouldScroll, requestId, !firstFetch);

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
            .then((reconciledPage) => applyMessagesPage(reconciledPage, shouldScroll, reconciliationRequestId, false))
            .catch(() => undefined)
            .finally(() => {
              reconciliationInProgress = false;
              if (isSubscribed && firstFetch && hasCachedMessages) setBackgroundRefreshing(false);
              if (isSubscribed && firstFetch && !localMessagesAvailable) setLoadingMessages(false);
            });
        }
      } catch {
        // A temporary provider/network failure should not erase the messages already rendered.
        if (firstFetch && isSubscribed) {
          setLoadingMessages(false);
          setBackgroundRefreshing(false);
        }
      } finally {
        fetchInProgress = false;
        // When local messages exist, the loading state ends immediately. If
        // the local cache is empty, keep it until the background reconciliation
        // finishes so a genuinely new conversation still has clear feedback.
        if (firstFetch && (!reconcile || localMessagesAvailable)) setLoadingMessages(false);
        if (firstFetch && hasCachedMessages && !reconciliationInProgress) setBackgroundRefreshing(false);
      }
    };

    const unsubscribe = EvolutionApiService.subscribeToRealtimeEvents((event) => {
      if (event.type === REALTIME_RECONNECTED_EVENT) {
        if (document.visibilityState === 'visible') {
          void EvolutionApiService.getInstanceStatus(instanceName);
          shouldReconcile = true;
          void fetchConversationMessages();
        }
        return;
      }
      if (event.type !== 'message.upsert' && event.type !== 'message.status') return;
      const eventRemoteJid = String(event.remoteJid || '');
      const eventPhone = String(event.phone || '').replace(/\D/g, '');
      const matchingConversation = conversationsRef.current.find((item) => {
        const conversationPhone = item.contact.phone.replace(/\D/g, '');
        const samePhone = Boolean(eventPhone && conversationPhone
          && phoneVariants(eventPhone).some((variant) => phoneVariants(conversationPhone).includes(variant)));
        return item.id === eventRemoteJid
          || item.id === event.message?.conversationId
          || samePhone;
      });
      const eventConversationId = matchingConversation?.id
        || (eventRemoteJid && messageCacheRef.current.has(eventRemoteJid) ? eventRemoteJid : undefined);
      const isActiveConversation = eventConversationId === activeConversationId
        || eventRemoteJid === activeConversationId
        || event.message?.conversationId === activeConversationId;

      if (!isActiveConversation && eventConversationId) {
        const cachedEntry = readConversationMessagesCache(messageCacheRef.current, eventConversationId);
        if (!cachedEntry) return;
        const reconciledCachedMessages = reconcileRealtimeMessages(cachedEntry.messages, eventConversationId, event);
        if (reconciledCachedMessages === null || reconciledCachedMessages === cachedEntry.messages) return;
        const eventTimestamp = Number(event.message?.timestampMs ?? event.timestampMs ?? 0);
        writeConversationMessagesCache(messageCacheRef.current, eventConversationId, {
          ...cachedEntry,
          messages: reconciledCachedMessages,
          latestTimestamp: Number.isFinite(eventTimestamp) && eventTimestamp > 0
            ? Math.max(cachedEntry.latestTimestamp || 0, eventTimestamp)
            : cachedEntry.latestTimestamp,
        });
        return;
      }

      if (!isActiveConversation) return;

      const previousMessages = messagesRef.current;
      const reconciledMessages = reconcileRealtimeMessages(previousMessages, activeConversationId, event);
      if (reconciledMessages === null) {
        // Keep the existing safety net for the current minimal upsert payload.
        void fetchConversationMessages();
        return;
      }
      if (reconciledMessages === previousMessages) return;

      messagesRef.current = reconciledMessages;
      const eventTimestamp = Number(event.message?.timestampMs ?? event.timestampMs ?? 0);
      if (Number.isFinite(eventTimestamp) && eventTimestamp > 0) {
        latestTimestampRef.current = Math.max(latestTimestampRef.current || 0, eventTimestamp);
      }
      const cachedEntry = messageCacheRef.current.get(activeConversationId);
      writeConversationMessagesCache(messageCacheRef.current, activeConversationId, {
        messages: reconciledMessages,
        hasMoreMessages: cachedEntry?.hasMoreMessages ?? false,
        historyExpanded: cachedEntry?.historyExpanded ?? historyExpandedRef.current,
        latestTimestamp: latestTimestampRef.current,
      });
      setMessages((currentMessages) => {
        if (currentMessages === previousMessages) return reconciledMessages;
        return reconcileRealtimeMessages(currentMessages, activeConversationId, event) || currentMessages;
      });
      const incomingMessage = event.type === 'message.upsert'
        && event.message?.sender === 'contact'
        && !event.message?.isInternalNote;
      if (incomingMessage && !stickToBottomRef.current) {
        registerNewMessages(1);
      } else {
        window.setTimeout(() => {
          if (stickToBottomRef.current) scrollToBottom();
        }, 0);
      }
    });
    let previousWhatsappStatus: 'connected' | 'connecting' | 'disconnected' = 'connecting';
    const handleWhatsAppStatus = (event: Event) => {
      const status = (event as CustomEvent<'connected' | 'connecting' | 'disconnected'>).detail;
      if (status !== 'connected' && status !== 'connecting' && status !== 'disconnected') return;
      const wasConnected = previousWhatsappStatus === 'connected';
      previousWhatsappStatus = status;
      if (status === 'connected' && !wasConnected && document.visibilityState === 'visible') {
        shouldReconcile = true;
        void fetchConversationMessages();
      }
    };
    window.addEventListener('vitstock:whatsapp-status', handleWhatsAppStatus);

    void fetchConversationMessages();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchConversationMessages();
    }, REALTIME_SAFETY_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void fetchConversationMessages();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isSubscribed = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('vitstock:whatsapp-status', handleWhatsAppStatus);
      unsubscribe();
    };
  }, [activeConversationId, attendantLabel, connectionStatus, instanceName, isMock, registerNewMessages, scrollToBottom]);

  useEffect(() => {
    historyExpandedRef.current = historyExpanded;
    if (!activeConversationId || isMock || messagesConversationIdRef.current !== activeConversationId) return;
    const cached = messageCacheRef.current.get(activeConversationId);
    if (!cached) return;
    writeConversationMessagesCache(messageCacheRef.current, activeConversationId, {
      ...cached,
      historyExpanded,
    });
  }, [activeConversationId, historyExpanded, isMock]);

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
      const previousMessages = messagesRef.current;
      let nextMessages = previousMessages;
      if (page.messages.length > 0) {
        const reconciledMessages = mergeConversationMessages(previousMessages, page.messages);
        nextMessages = reconciledMessages;
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
      writeConversationMessagesCache(messageCacheRef.current, activeConversationId, {
        messages: nextMessages,
        hasMoreMessages: page.hasMore,
        historyExpanded: true,
        latestTimestamp: latestTimestampRef.current,
      });
    } catch {
      // O histórico atual permanece visível quando a página anterior falhar.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [activeConversationId, attendantLabel, hasMoreMessages, instanceName, isMock]);

  const cachedActiveEntry = activeConversationId
    ? messageCacheRef.current.get(activeConversationId)
    : undefined;
  const activeStateMatchesSelection = !isMock && messagesConversationIdRef.current === activeConversationId;
  const visibleMessages = isMock || activeStateMatchesSelection
    ? messages
    : cachedActiveEntry?.messages || [];
  const visibleHasMoreMessages = activeStateMatchesSelection
    ? hasMoreMessages
    : cachedActiveEntry?.hasMoreMessages || false;
  const visibleHistoryExpanded = activeStateMatchesSelection
    ? historyExpanded
    : cachedActiveEntry?.historyExpanded || false;
  const visibleLoadingMessages = isMock
    ? false
    : activeStateMatchesSelection
    ? loadingMessages
    : !cachedActiveEntry;
  const visibleBackgroundRefreshing = isMock
    ? false
    : activeStateMatchesSelection
    ? backgroundRefreshing
    : Boolean(cachedActiveEntry);
  const visibleLoadingOlderMessages = activeStateMatchesSelection
    ? loadingOlderMessages
    : false;

  return {
    messages: visibleMessages,
    hasMoreMessages: visibleHasMoreMessages,
    loadingMessages: visibleLoadingMessages,
    backgroundRefreshing: visibleBackgroundRefreshing,
    historyExpanded: visibleHistoryExpanded,
    loadingOlderMessages: visibleLoadingOlderMessages,
    loadOlderMessages,
    setMessages,
    messagesContainerRef,
    scrollToBottom,
    newMessagesCount,
  };
};
