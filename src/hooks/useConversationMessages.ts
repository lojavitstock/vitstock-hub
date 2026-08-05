import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, Message } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';

type UseConversationMessagesOptions = {
  activeConversationId: string;
  conversations: Conversation[];
  instanceName: string;
  attendantLabel: string;
  isMock: boolean;
};

export const mergeConversationMessages = (current: Message[], incoming: Message[]) => {
  const byId = new Map<string, Message>();
  current.forEach((message) => byId.set(message.id, message));
  incoming.forEach((message) => byId.set(message.id, message));
  return Array.from(byId.values()).sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
};

export const useConversationMessages = ({
  activeConversationId,
  conversations,
  instanceName,
  attendantLabel,
  isMock,
}: UseConversationMessagesOptions) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const conversationsRef = useRef(conversations);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    if (!activeConversationId || isMock) return;

    let isSubscribed = true;
    let isInitialFetch = true;
    let shouldReconcile = true;
    setMessages([]);

    const fetchConversationMessages = async () => {
      const container = messagesContainerRef.current;
      const distanceFromBottom = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight
        : 0;
      const shouldScroll = isInitialFetch || distanceFromBottom <= 120;
      isInitialFetch = false;
      const conversation = conversationsRef.current.find((item) => item.id === activeConversationId);
      const phone = conversation?.contact.phone || activeConversationId;
      const reconcile = shouldReconcile;
      shouldReconcile = false;

      try {
        const incomingMessages = await EvolutionApiService.fetchConversationMessages(
          instanceName,
          activeConversationId,
          phone,
          attendantLabel,
          reconcile,
        );
        if (!isSubscribed || incomingMessages.length === 0) return;
        setMessages((previous) => mergeConversationMessages(previous, incomingMessages));
        if (shouldScroll) window.setTimeout(scrollToBottom, 0);
      } catch {
        // A temporary provider/network failure should not erase the messages already rendered.
      }
    };

    void fetchConversationMessages();
    const interval = window.setInterval(() => { void fetchConversationMessages(); }, 2000);
    return () => {
      isSubscribed = false;
      window.clearInterval(interval);
    };
  }, [activeConversationId, attendantLabel, instanceName, isMock, scrollToBottom]);

  return {
    messages,
    setMessages,
    messagesContainerRef,
    scrollToBottom,
  };
};
