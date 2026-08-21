import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Conversation, Message, WhatsappInstance } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';
import { phoneVariants } from '../utils/phone';
import { mergeConversationMessages } from '../utils/messageMerge';
import { createLatestRequestGuard } from '../utils/requestCoordinator';
import { reconcileRealtimeMessages } from '../utils/realtimeUpdates';
import { getNewIncomingMessageIds } from '../utils/messageActivity';
import { REALTIME_RECONNECTED_EVENT, REALTIME_SAFETY_INTERVAL_MS } from '../utils/realtimeConfig';
import { traceTimelineScroll } from '../utils/scrollTrace';
import { traceOutboundRealtimeAck } from '../utils/outboundTrace';
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
const MAX_SCROLL_STATES = 100;

type ConversationScrollState = {
  scrollTop: number;
  stickyToBottom: boolean;
};

type TimelineLayoutSnapshot = {
  conversationId: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchorId: string | null;
  anchorOffset: number;
};

type PendingPrepend = {
  conversationId: string;
  previousTop: number;
  previousHeight: number;
  previousMessageCount: number;
};

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
  const [isNearBottom, setIsNearBottom] = useState(true);
  const conversationsRef = useRef(conversations);
  const messagesRef = useRef<Message[]>([]);
  const messagesConversationIdRef = useRef('');
  const messageCacheRef = useRef(new Map<string, ConversationMessagesCacheEntry>());
  const latestTimestampRef = useRef<number | undefined>();
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const historyExpandedRef = useRef(false);
  const newMessagesCountByConversationRef = useRef(new Map<string, number>());
  const scrollStatesRef = useRef(new Map<string, ConversationScrollState>());
  const scrollGenerationRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const timelineLayoutRef = useRef<TimelineLayoutSnapshot | null>(null);
  const pendingPrependRef = useRef<PendingPrepend | null>(null);

  const traceScroll = useCallback((reason: string, conversationId = activeConversationId, details?: Record<string, string | number | boolean | null | undefined>) => {
    traceTimelineScroll({
      reason,
      conversationId,
      container: messagesContainerRef.current,
      stickyToBottom: stickToBottomRef.current,
      messageCount: messagesConversationIdRef.current === conversationId ? messagesRef.current.length : 0,
      details,
    });
  }, [activeConversationId]);

  const updateStickiness = useCallback((conversationId: string, stickyToBottom: boolean) => {
    stickToBottomRef.current = stickyToBottom;
    if (isNearBottomRef.current === stickyToBottom) return;
    isNearBottomRef.current = stickyToBottom;
    if (messagesConversationIdRef.current === conversationId) setIsNearBottom(stickyToBottom);
  }, []);

  const readTimelineLayout = useCallback((conversationId: string): TimelineLayoutSnapshot | null => {
    const container = messagesContainerRef.current;
    if (!container || !conversationId || messagesConversationIdRef.current !== conversationId) return null;
    const containerRect = container.getBoundingClientRect();
    const visibleMessage = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
      });
    return {
      conversationId,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      anchorId: visibleMessage?.dataset.messageId || null,
      anchorOffset: visibleMessage ? visibleMessage.getBoundingClientRect().top - containerRect.top : 0,
    };
  }, []);

  const reconcileTimelineLayout = useCallback((reason: string, conversationId = activeConversationId) => {
    const container = messagesContainerRef.current;
    if (!container || !conversationId || messagesConversationIdRef.current !== conversationId) return;
    const previous = timelineLayoutRef.current;
    const current = readTimelineLayout(conversationId);
    if (!current) return;
    if (!previous || previous.conversationId !== conversationId) {
      timelineLayoutRef.current = current;
      return;
    }

    const layoutChanged = previous.scrollHeight !== current.scrollHeight
      || previous.clientHeight !== current.clientHeight;
    if (!layoutChanged) {
      timelineLayoutRef.current = current;
      return;
    }

    const previousScrollTop = container.scrollTop;
    if (stickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
      updateStickiness(conversationId, true);
    } else if (previous.anchorId && previous.anchorId === current.anchorId) {
      container.scrollTop = Math.max(0, previous.scrollTop + (current.anchorOffset - previous.anchorOffset));
      updateStickiness(conversationId, false);
    } else {
      container.scrollTop = Math.min(previous.scrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
      updateStickiness(conversationId, false);
    }
    timelineLayoutRef.current = readTimelineLayout(conversationId) || current;
    traceScroll(reason, conversationId, {
      previousScrollTop,
      previousScrollHeight: previous.scrollHeight,
      currentScrollHeight: current.scrollHeight,
    });
  }, [activeConversationId, readTimelineLayout, traceScroll, updateStickiness]);

  const traceTimelineLayoutChange = useCallback((reason: string, messageId?: string) => {
    reconcileTimelineLayout(`layout.${reason}`, activeConversationId);
    traceScroll(reason, activeConversationId, { messageId: messageId || null });
  }, [activeConversationId, reconcileTimelineLayout, traceScroll]);

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

  const rememberScrollState = useCallback((conversationId: string, container: HTMLDivElement, stickyToBottom: boolean) => {
    if (!conversationId) return;
    const states = scrollStatesRef.current;
    states.delete(conversationId);
    states.set(conversationId, {
      scrollTop: container.scrollTop,
      stickyToBottom,
    });
    while (states.size > MAX_SCROLL_STATES) {
      const oldestConversationId = states.keys().next().value;
      if (typeof oldestConversationId !== 'string') break;
      states.delete(oldestConversationId);
    }
  }, []);

  const restoreScrollPosition = useCallback((conversationId: string, generation?: number) => {
    const container = messagesContainerRef.current;
    if (
      !container
      || !conversationId
      || messagesConversationIdRef.current !== conversationId
      || (generation !== undefined && scrollGenerationRef.current !== generation)
    ) return;
    const savedState = scrollStatesRef.current.get(conversationId);
    const previousScrollTop = container.scrollTop;
    if (!savedState || savedState.stickyToBottom) {
      updateStickiness(conversationId, true);
      container.scrollTop = container.scrollHeight;
      rememberScrollState(conversationId, container, true);
      timelineLayoutRef.current = readTimelineLayout(conversationId);
      traceScroll('scroll.restore.bottom', conversationId, { previousScrollTop, generation: generation ?? null });
      return;
    }

    updateStickiness(conversationId, false);
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.min(savedState.scrollTop, maxScrollTop);
    rememberScrollState(conversationId, container, false);
    timelineLayoutRef.current = readTimelineLayout(conversationId);
    traceScroll('scroll.restore.saved', conversationId, { previousScrollTop, savedScrollTop: savedState.scrollTop, generation: generation ?? null });
  }, [readTimelineLayout, rememberScrollState, traceScroll, updateStickiness]);

  const clearNewMessages = useCallback((conversationId = messagesConversationIdRef.current) => {
    if (!conversationId) return;
    newMessagesCountByConversationRef.current.delete(conversationId);
    if (messagesConversationIdRef.current === conversationId) setNewMessagesCount(0);
  }, []);

  const registerNewMessages = useCallback((conversationId: string, count: number, stickyAtArrival = stickToBottomRef.current) => {
    const previousCount = newMessagesCountByConversationRef.current.get(conversationId) || 0;
    if (
      count <= 0
      || stickyAtArrival
      || messagesConversationIdRef.current !== conversationId
    ) {
      return;
    }
    const nextCount = previousCount + count;
    newMessagesCountByConversationRef.current.set(conversationId, nextCount);
    setNewMessagesCount(nextCount);
  }, []);

  const scrollToBottom = useCallback((reason = 'scroll.jump.latest') => {
    const container = messagesContainerRef.current;
    // A send/load callback can outlive the conversation that scheduled it.
    // Never let it move the viewport of the newly selected conversation.
    if (container && messagesConversationIdRef.current === activeConversationId) {
      updateStickiness(activeConversationId, true);
      clearNewMessages();
      container.scrollTop = container.scrollHeight;
      rememberScrollState(activeConversationId, container, true);
      timelineLayoutRef.current = readTimelineLayout(activeConversationId);
      traceScroll(reason, activeConversationId);
    }
  }, [activeConversationId, clearNewMessages, readTimelineLayout, rememberScrollState, traceScroll, updateStickiness]);

  const captureScrollState = useCallback((conversationId: string) => {
    const container = messagesContainerRef.current;
    if (!container || !conversationId || messagesConversationIdRef.current !== conversationId) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const stickyToBottom = distanceFromBottom <= 120;
    const previousStickyState = scrollStatesRef.current.get(conversationId)?.stickyToBottom;
    updateStickiness(conversationId, stickyToBottom);
    rememberScrollState(conversationId, container, stickyToBottom);
    timelineLayoutRef.current = readTimelineLayout(conversationId);
    if (stickyToBottom) clearNewMessages();
    if (previousStickyState !== undefined && previousStickyState !== stickyToBottom) {
      traceScroll('scroll.sticky.changed', conversationId, { distanceFromBottom: Math.round(distanceFromBottom), previousStickyState });
    }
  }, [clearNewMessages, readTimelineLayout, rememberScrollState, traceScroll, updateStickiness]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return undefined;
    const scrollGeneration = ++scrollGenerationRef.current;
    const handleScroll = () => {
      if (messagesConversationIdRef.current !== activeConversationId || scrollGenerationRef.current !== scrollGeneration) return;
      captureScrollState(activeConversationId);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        if (messagesConversationIdRef.current !== activeConversationId || scrollGenerationRef.current !== scrollGeneration) return;
        reconcileTimelineLayout('resize.observer', activeConversationId);
      })
      : undefined;
    resizeObserver?.observe(container);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
    };
  }, [activeConversationId, captureScrollState, reconcileTimelineLayout]);

  useLayoutEffect(() => {
    if (!activeConversationId || messagesConversationIdRef.current !== activeConversationId) {
      timelineLayoutRef.current = null;
      pendingPrependRef.current = null;
      return;
    }

    const pendingPrepend = pendingPrependRef.current;
    const container = messagesContainerRef.current;
    if (
      pendingPrepend
      && pendingPrepend.conversationId === activeConversationId
      && container
      && messages.length > pendingPrepend.previousMessageCount
    ) {
      const previousScrollTop = container.scrollTop;
      const scrollHeightDelta = container.scrollHeight - pendingPrepend.previousHeight;
      container.scrollTop = Math.max(0, pendingPrepend.previousTop + scrollHeightDelta);
      updateStickiness(activeConversationId, false);
      rememberScrollState(activeConversationId, container, false);
      timelineLayoutRef.current = readTimelineLayout(activeConversationId);
      pendingPrependRef.current = null;
      traceScroll('history.prepend.restored', activeConversationId, {
        previousScrollTop,
        previousTop: pendingPrepend.previousTop,
        previousHeight: pendingPrepend.previousHeight,
        currentHeight: container.scrollHeight,
        scrollHeightDelta,
        loadedMessages: messages.length - pendingPrepend.previousMessageCount,
      });
      return;
    }
    reconcileTimelineLayout('timeline.commit', activeConversationId);
  }, [activeConversationId, historyExpanded, messages, readTimelineLayout, reconcileTimelineLayout, rememberScrollState, traceScroll, updateStickiness]);

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
    const scrollGeneration = scrollGenerationRef.current;
    const cachedEntry = readConversationMessagesCache(messageCacheRef.current, activeConversationId);
    const hasCachedMessages = Boolean(cachedEntry);
    const isConversationSwitch = messagesConversationIdRef.current !== activeConversationId;
    messagesConversationIdRef.current = activeConversationId;
    if (isConversationSwitch) {
      const savedState = scrollStatesRef.current.get(activeConversationId);
      const stickyToBottom = savedState?.stickyToBottom ?? true;
      updateStickiness(activeConversationId, stickyToBottom);
      timelineLayoutRef.current = null;
      if (stickyToBottom) {
        clearNewMessages(activeConversationId);
      } else {
        setNewMessagesCount(newMessagesCountByConversationRef.current.get(activeConversationId) || 0);
      }
      window.requestAnimationFrame(() => {
        traceScroll('conversation.switch', activeConversationId, { cached: hasCachedMessages, generation: scrollGeneration });
        restoreScrollPosition(activeConversationId, scrollGeneration);
        window.requestAnimationFrame(() => restoreScrollPosition(activeConversationId, scrollGeneration));
      });
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
      const stickyAtArrival = stickToBottomRef.current;
      const incomingIds = new Set(getNewIncomingMessageIds(previousMessages, recentMessages, trackIncoming));
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
          traceScroll('messages.snapshot.applied', activeConversationId, {
            receivedMessages: recentMessages.length,
            previousMessages: previousMessages.length,
            shouldScroll,
            trackIncoming,
          });
        }
      }
      if (trackIncoming) {
        registerNewMessages(
          activeConversationId,
          incomingIds.size,
          stickyAtArrival,
        );
      }
      writeConversationMessagesCache(messageCacheRef.current, activeConversationId, {
        messages: reconciledMessages,
        hasMoreMessages: nextHasMoreMessages,
        historyExpanded: historyExpandedRef.current,
        latestTimestamp: latestTimestampRef.current,
      });
      if (recentMessages.length === 0) return;
      if (shouldScroll) window.requestAnimationFrame(() => {
        if (
          scrollGenerationRef.current === scrollGeneration
          && messagesConversationIdRef.current === activeConversationId
          && stickToBottomRef.current
        ) scrollToBottom('messages.snapshot.bottom');
      });
    };

    const fetchConversationMessages = async (source = 'unknown') => {
      if (fetchInProgress) {
        traceScroll('messages.fetch.skipped', activeConversationId, { source });
        return;
      }
      fetchInProgress = true;
      const firstFetch = isInitialFetch;
      const requestId = requestGuard.begin();
      const savedState = scrollStatesRef.current.get(activeConversationId);
      const shouldScroll = isInitialFetch
        ? (savedState?.stickyToBottom ?? true)
        : stickToBottomRef.current;
      if (!hasCachedMessages && !savedState) updateStickiness(activeConversationId, shouldScroll);
      isInitialFetch = false;
      const conversation = conversationsRef.current.find((item) => item.id === activeConversationId);
      const phone = conversation?.isGroup ? '' : conversation?.contact.phone || activeConversationId;
      const reconcile = shouldReconcile;
      const afterTimestamp = reconcile
        ? Math.max(0, Date.now() - HISTORY_WINDOW_MS)
        : latestTimestampRef.current
          ? Math.max(0, latestTimestampRef.current - 1000)
          : undefined;
      let localMessagesAvailable = false;
      traceScroll('messages.fetch.started', activeConversationId, { source, reconcile, afterTimestamp: afterTimestamp ?? null });

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
        applyMessagesPage(page, shouldScroll, requestId, !firstFetch || hasCachedMessages);

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
            .then((reconciledPage) => {
              traceScroll('messages.reconciliation.received', activeConversationId, { source, receivedMessages: reconciledPage.messages.length });
              applyMessagesPage(reconciledPage, shouldScroll, reconciliationRequestId, hasCachedMessages);
            })
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
          traceScroll('realtime.reconnected', activeConversationId);
          void fetchConversationMessages('realtime.reconnected');
        }
        return;
      }
      if (event.type !== 'message.upsert' && event.type !== 'message.status') return;
      traceScroll(`realtime.${event.type}.received`, activeConversationId, { eventConversationId: event.message?.conversationId || event.remoteJid || null });
      traceOutboundRealtimeAck({
        conversationId: event.message?.conversationId || String(event.remoteJid || ''),
        clientMessageId: event.message?.metadata?.clientMessageId,
        evolutionMessageId: event.messageId || event.message?.id,
        status: event.message?.status || event.status,
      });
      const eventRemoteJid = String(event.remoteJid || '');
      const eventPhone = String(event.phone || '').replace(/\D/g, '');
      const matchingConversation = conversationsRef.current.find((item) => {
        const conversationPhone = item.isGroup ? '' : item.contact.phone.replace(/\D/g, '');
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
      const stickyAtArrival = stickToBottomRef.current;
      const incomingIds = new Set(getNewIncomingMessageIds(
        previousMessages,
        event.type === 'message.upsert' && event.message ? [event.message] : [],
        true,
      ));
      const reconciledMessages = reconcileRealtimeMessages(previousMessages, activeConversationId, event);
      if (reconciledMessages === null) {
        // Keep the existing safety net for the current minimal upsert payload.
        traceScroll(`realtime.${event.type}.fallback`, activeConversationId);
        void fetchConversationMessages(`realtime.${event.type}.fallback`);
        return;
      }
      if (reconciledMessages === previousMessages) return;

      traceScroll(`realtime.${event.type}.applied`, activeConversationId, {
        previousMessages: previousMessages.length,
        nextMessages: reconciledMessages.length,
      });

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
      if (event.type === 'message.upsert') {
        registerNewMessages(
          activeConversationId,
          incomingIds.size,
          stickyAtArrival,
        );
        if (stickyAtArrival) window.requestAnimationFrame(() => {
          if (
            scrollGenerationRef.current === scrollGeneration
            && messagesConversationIdRef.current === activeConversationId
            && stickToBottomRef.current
          ) scrollToBottom('realtime.message.bottom');
        });
      } else {
        window.requestAnimationFrame(() => {
          if (
            scrollGenerationRef.current === scrollGeneration
            && messagesConversationIdRef.current === activeConversationId
            && stickToBottomRef.current
          ) scrollToBottom('realtime.status.bottom');
        });
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
        void fetchConversationMessages('whatsapp.connected');
      }
    };
    window.addEventListener('vitstock:whatsapp-status', handleWhatsAppStatus);

    void fetchConversationMessages('initial');
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchConversationMessages('safety.poll');
    }, REALTIME_SAFETY_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void fetchConversationMessages('visibility.visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isSubscribed = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('vitstock:whatsapp-status', handleWhatsAppStatus);
      unsubscribe();
    };
  }, [activeConversationId, attendantLabel, connectionStatus, instanceName, isMock, registerNewMessages, restoreScrollPosition, scrollToBottom, traceScroll, updateStickiness]);


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
    const phone = conversation?.isGroup ? '' : conversation?.contact.phone || activeConversationId;
    const container = messagesContainerRef.current;
    const previousHeight = container?.scrollHeight || 0;
    const previousTop = container?.scrollTop || 0;
    loadingOlderRef.current = true;
    traceScroll('history.prepend.started', activeConversationId, { previousHeight, previousTop });
    updateStickiness(activeConversationId, false);
    if (container) rememberScrollState(activeConversationId, container, false);
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
          pendingPrependRef.current = {
            conversationId: activeConversationId,
            previousTop,
            previousHeight,
            previousMessageCount: previousMessages.length,
          };
          messagesRef.current = reconciledMessages;
          setMessages((currentMessages) => currentMessages === previousMessages
            ? reconciledMessages
            : mergeConversationMessages(currentMessages, page.messages));
        }
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
  }, [activeConversationId, attendantLabel, hasMoreMessages, instanceName, isMock, rememberScrollState, traceScroll, updateStickiness]);

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

  const visibleNewMessagesCount = messagesConversationIdRef.current === activeConversationId
    ? newMessagesCountByConversationRef.current.get(activeConversationId) || 0
    : 0;

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
    captureScrollState,
    traceTimelineLayoutChange,
    isNearBottom,
    newMessagesCount: visibleNewMessagesCount,
  };
};
