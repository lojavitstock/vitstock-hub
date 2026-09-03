import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  Search, 
  Send, 
  Paperclip, 
  Mic, 
  MoreVertical, 
  Tag as TagIcon, 
  UserCheck, 
  CheckCircle, 
  Mail, 
  Zap, 
  Kanban,
  RefreshCw,
  WifiOff,
  MessageSquare,
  Plus,
  Phone,
  UserPlus,
  Pencil,
  Save,
  X,
  Building2,
  Globe,
  Archive,
} from 'lucide-react';
import { Conversation, Message, QuickReply, Tag, WhatsappInstance } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';
import { useAuth } from '../auth/AuthContext';
import { ConversationTagRail } from '../components/conversations/ConversationTagRail';
import { ConversationList } from '../components/conversations/ConversationList';
import { ContactPhoto } from '../components/conversations/ContactPhoto';
import { MessageTimeline } from '../components/conversations/MessageTimeline';
import { MessageComposer, MessageComposerHandle } from '../components/conversations/MessageComposer';
import { formatPhoneForDisplay } from '../utils/phone';
import { formatMessageTimestamp } from '../components/conversations/conversationFormatters';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { conversationNeedsResponse, useConversationInbox } from '../hooks/useConversationInbox';
import { useContactPanel } from '../hooks/useContactPanel';
import { toQuotedMessage } from '../utils/quotedMessage';
import { canRestoreComposerDraft, captureComposerSubmission, readConversationDraft, scheduleComposerFocus, writeConversationDraft } from '../utils/composerSubmission';
import { createOutboundTrace, createReplyTraceId, traceReplySendFailure } from '../utils/outboundTrace';
import { findConversationForContactChat, normalizeContactChatPhone } from '../utils/contactChatNavigation';
import { addConversationTag, createConversationTag, deleteConversationTag, fetchConversationTags, removeConversationTag, updateConversationTag } from '../services/conversationTagsApi';
import { normalizeConversationTags } from '../utils/conversationTags';
import { isMediaBase64SizeAllowed, isMediaFileSizeAllowed } from '../utils/mediaLimits';
import { outboundErrorMessage } from '../utils/outboundError';
import { fetchQuickReplies, markQuickReplyUsed } from '../services/quickRepliesApi';
import { mockQuickReplies } from '../services/mockData';
import {
  classifyAttachmentFile,
  createAttachmentId,
  MAX_ATTACHMENTS_PER_MESSAGE,
  selectAttachmentFiles,
  type AttachmentDraft,
  type ComposerMediaType,
} from '../utils/composerAttachment';
import {
  canReactToMessage,
  nextHubReactionEmoji,
  withOptimisticHubReaction,
  type CommonReactionEmoji,
} from '../utils/messageReactionActions';

export const AtendimentoPage: React.FC = () => {
  const instanceName = 'vitstock_atendimento';
  const isMock = import.meta.env.VITE_USE_MOCK_DATA === 'true';
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const attendantLabel = user
    ? `${user.name} • ${user.companyName || 'Vitstock'}`
    : 'Atendente • Vitstock';

  const attendantName = user?.name || 'Atendente';
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsappInstance['status']>('connecting');
  const whatsappConnected = whatsappStatus === 'connected';
  const composerRef = useRef<MessageComposerHandle>(null);
  const composerTextRef = useRef('');
  const composerDraftsRef = useRef(new Map<string, string>());
  const composerDraftRevisionRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  const autoReadMarkersRef = useRef(new Map<string, string>());
  const handleComposerTextChange = useCallback((value: string) => {
    composerTextRef.current = value;
    composerDraftRevisionRef.current += 1;
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    writeConversationDraft(composerDraftsRef.current, conversationId, value);
  }, []);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<AttachmentDraft[]>([]);
  const attachmentDraftsRef = useRef<AttachmentDraft[]>([]);
  const [mediaSendProgress, setMediaSendProgress] = useState<{ current: number; total: number } | null>(null);
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Estado para Nova Conversa por Telefone
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [startingNewChat, setStartingNewChat] = useState(false);
  const [pendingContactChatId, setPendingContactChatId] = useState<string | null>(null);
  const pendingContactChatRef = useRef<Conversation | null>(null);
  const [conversationTags, setConversationTags] = useState<Tag[]>([]);
  const [showConversationTagMenu, setShowConversationTagMenu] = useState(false);
  const conversationTagMenuRef = useRef<HTMLDivElement>(null);

  const revokeAttachmentPreview = useCallback((draft: AttachmentDraft) => {
    if (draft.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(draft.previewUrl);
    }
  }, []);

  const replaceAttachmentDrafts = useCallback((next: AttachmentDraft[]) => {
    const nextIds = new Set(next.map((draft) => draft.id));
    attachmentDraftsRef.current.forEach((draft) => {
      if (!nextIds.has(draft.id)) revokeAttachmentPreview(draft);
    });
    attachmentDraftsRef.current = next;
    setAttachmentDrafts(next);
  }, [revokeAttachmentPreview]);

  const clearAttachmentDrafts = useCallback(() => replaceAttachmentDrafts([]), [replaceAttachmentDrafts]);

  const removeAttachmentDraft = useCallback((attachmentId: string) => {
    const removed = attachmentDraftsRef.current.find((draft) => draft.id === attachmentId);
    const next = attachmentDraftsRef.current.filter((draft) => draft.id !== attachmentId);
    if (removed?.captionEligible && next.length > 0 && !next.some((draft) => draft.captionEligible)) {
      next[0] = { ...next[0], captionEligible: true };
    }
    replaceAttachmentDrafts(next);
  }, [replaceAttachmentDrafts]);

  useEffect(() => () => {
    attachmentDraftsRef.current.forEach(revokeAttachmentPreview);
    attachmentDraftsRef.current = [];
  }, [revokeAttachmentPreview]);

  const {
    conversations,
    setConversations,
    activeConversation: activeConv,
    activeConversationId: activeConvId,
    setActiveConversationId: setActiveConvId,
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
    capturingChat,
    assignmentFeedback,
    setAssignmentFeedback,
    captureActiveChat,
    releaseActiveChat,
    pullActiveConversationLease,
    updateActiveChatStatus,
    needsAttention,
    rememberContactName,
  } = useConversationInbox({
    instanceName,
    isMock,
    connectionStatus: whatsappStatus,
    userId: user?.id,
    userRole: user?.role,
  });

  const activeConversationTags = useMemo(
    () => normalizeConversationTags(activeConv, conversationTags),
    [activeConv, conversationTags],
  );

  useEffect(() => {
    const previousConversationId = activeConversationIdRef.current;
    if (previousConversationId && previousConversationId !== activeConvId) {
      writeConversationDraft(composerDraftsRef.current, previousConversationId, composerTextRef.current);
    }
    activeConversationIdRef.current = activeConvId;
    setReplyTo(null);
    setQuickReplyOpen(false);
    setShowConversationTagMenu(false);
    clearAttachmentDrafts();
  }, [activeConvId, clearAttachmentDrafts]);

  useEffect(() => {
    if (isMock) {
      setQuickReplies(mockQuickReplies);
      return undefined;
    }
    if (!user?.id) {
      setQuickReplies([]);
      return undefined;
    }
    let mounted = true;
    void fetchQuickReplies()
      .then((result) => {
        if (mounted) setQuickReplies(Array.isArray(result.quickReplies) ? result.quickReplies : []);
      })
      .catch(() => {
        if (mounted) setQuickReplies([]);
      });
    return () => { mounted = false; };
  }, [isMock, user?.id]);

  const handleQuickReplyUse = useCallback((reply: QuickReply) => {
    if (isMock) {
      setQuickReplies((current) => current.map((item) => item.id === reply.id ? { ...item, usageCount: item.usageCount + 1 } : item));
      return;
    }
    void markQuickReplyUsed(reply.id)
      .then((result) => {
        if (result.quickReply) setQuickReplies((current) => current.map((item) => item.id === reply.id ? result.quickReply : item));
      })
      .catch(() => {
        // A falha no contador não deve impedir a inserção da mensagem.
      });
  }, [isMock]);

  const handleCreateQuickReply = useCallback(() => {
    setQuickReplyOpen(false);
    navigate('/configuracoes?tab=quickReplies&action=new&from=atendimento');
  }, [navigate]);

  useEffect(() => {
    if (!whatsappConnected) setQuickReplyOpen(false);
  }, [whatsappConnected]);

  const handleToggleInternalNote = useCallback((value: boolean) => {
    if (value) clearAttachmentDrafts();
    setQuickReplyOpen(false);
    setIsInternalNote(value);
  }, [clearAttachmentDrafts]);

  useEffect(() => {
    if (!showConversationTagMenu) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !conversationTagMenuRef.current?.contains(target)) {
        setShowConversationTagMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowConversationTagMenu(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showConversationTagMenu]);

  useEffect(() => {
    if (!activeConvId || whatsappStatus !== 'connected') return;
    composerRef.current?.setText(readConversationDraft(composerDraftsRef.current, activeConvId));
  }, [activeConvId, whatsappStatus]);

  useEffect(() => {
    if (!whatsappConnected) {
      setConversationTags([]);
      setShowConversationTagMenu(false);
      return undefined;
    }
    if (isMock) return undefined;
    let mounted = true;
    void fetchConversationTags()
      .then((result) => {
        if (mounted) setConversationTags(Array.isArray(result.tags) ? result.tags : []);
      })
      .catch(() => {
        if (mounted) setConversationTags([]);
      });
    return () => { mounted = false; };
  }, [isMock, whatsappConnected]);

  useEffect(() => {
    if (!isMock || !whatsappConnected) return;
    const seededTags = conversations.flatMap((conversation) => conversation.conversationTags || []);
    setConversationTags((previous) => {
      const byId = new Map(previous.map((tag) => [tag.id, tag]));
      seededTags.forEach((tag) => byId.set(tag.id, {
        ...tag,
        usageCount: conversations.filter((conversation) => (conversation.conversationTags || []).some((item) => item.id === tag.id)).length,
      }));
      if (!Array.from(byId.values()).some((tag) => tag.systemKey === 'traffic')) {
        byId.set('mock-traffic', {
          id: 'mock-traffic',
          name: 'Tráfego',
          color: '#F97316',
          systemKey: 'traffic',
          usageCount: conversations.filter((conversation) => Boolean(conversation.trafficSource)).length,
        });
      }
      return Array.from(byId.values());
    });
  }, [conversations, isMock, whatsappConnected]);

  useEffect(() => {
    if (!activeConv || activeConv.unreadCount <= 0) return;
    const marker = activeConv.lastMessageKey?.id || String(activeConv.lastMessageAt || 'unknown');
    if (autoReadMarkersRef.current.get(activeConv.id) === marker) return;
    autoReadMarkersRef.current.set(activeConv.id, marker);
    void markConversationAsRead(activeConv);
  }, [activeConv, markConversationAsRead]);

  const {
    showContactInfo,
    setShowContactInfo,
    businessProfile,
    loadingBusinessProfile,
    savingGoogleContact,
    googleContactFeedback,
    googleContactStatus,
    googleMatchedName,
    showGoogleContactForm,
    setShowGoogleContactForm,
    googleContactForm,
    setGoogleContactForm,
    openGoogleContactForm,
    saveGoogleContactForm,
  } = useContactPanel({
    activeConversation: activeConv,
    isMock,
    setConversations,
    rememberContactName,
  });

  useEffect(() => {
    let mounted = true;
    const syncStatus = (event: Event) => {
      const status = (event as CustomEvent<WhatsappInstance['status']>).detail;
      if (status === 'connected' || status === 'connecting' || status === 'disconnected') {
        setWhatsappStatus(status);
      }
    };
    const refreshStatus = () => {
      void EvolutionApiService.getInstanceStatus(instanceName)
        .then((status) => {
          if (mounted) setWhatsappStatus(status.status);
        })
        .catch(() => undefined);
    };
    window.addEventListener('vitstock:whatsapp-status', syncStatus);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshStatus();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    refreshStatus();
    return () => {
      mounted = false;
      window.removeEventListener('vitstock:whatsapp-status', syncStatus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [instanceName]);

  useEffect(() => {
    const startChat = (location.state as { startChat?: { phone?: string; name?: string; remoteJid?: string; contactId?: string } } | null)?.startChat;
    if ((!startChat?.phone && !startChat?.remoteJid) || whatsappStatus !== 'connected' || loadingChats) return;
    const existing = findConversationForContactChat(conversations, startChat);
    if (existing) {
      pendingContactChatRef.current = null;
      setPendingContactChatId(null);
      setActiveConvId(existing.id);
      void markConversationAsRead(existing);
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    if (!startChat.phone) return;
    const cleanPhone = normalizeContactChatPhone(startChat.phone);
    if (cleanPhone.length < 8) {
      pendingContactChatRef.current = null;
      setPendingContactChatId(null);
      setAssignmentFeedback('O contato não possui um número de WhatsApp válido.');
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    const jid = startChat.remoteJid || `${cleanPhone}@s.whatsapp.net`;
    const pendingConversation: Conversation = {
      id: jid,
      contact: {
        id: startChat.contactId || jid,
        name: startChat.name?.trim() || `+${cleanPhone}`,
        phone: `+${cleanPhone}`,
        avatar: '',
        tags: [],
        createdAt: new Date().toISOString().split('T')[0],
      },
      lastMessage: 'Nenhuma mensagem ainda',
      lastMessageTimestamp: '',
      lastMessageAt: 0,
      lastMessageFromMe: false,
      unreadCount: 0,
      needsResponse: false,
      status: 'open',
      department: '',
    };
    pendingContactChatRef.current = pendingConversation;
    setConversations((previous) => previous.some((conversation) => conversation.id === jid)
      ? previous
      : [pendingConversation, ...previous]);
    setPendingContactChatId(jid);
    setActiveConvId(jid);
    setAssignmentFeedback('Nova conversa pronta. Digite uma mensagem para iniciar o atendimento.');
    navigate(location.pathname, { replace: true, state: null });
  }, [conversations, loadingChats, location.pathname, location.state, markConversationAsRead, navigate, setActiveConvId, setAssignmentFeedback, setConversations, whatsappStatus]);

  useEffect(() => {
    if (!pendingContactChatId || conversations.some((conversation) => conversation.id === pendingContactChatId)) return;
    const pendingConversation = pendingContactChatRef.current;
    if (pendingConversation?.id === pendingContactChatId) {
      setConversations((previous) => previous.some((conversation) => conversation.id === pendingContactChatId)
        ? previous
        : [pendingConversation, ...previous]);
    }
  }, [conversations, pendingContactChatId, setConversations]);


  /* // Carregar conversas ao iniciar e manter atualizado a cada 4 segundos
  useEffect(() => {
    return;

    if (isMock) return;

    const interval = setInterval(() => {
      loadChats(false); // Atualização silenciosa em segundo plano
    }, 4000);

    return () => clearInterval(interval);
  }, [isMock]); */

  const attachmentInputRef = React.useRef<HTMLInputElement>(null);
  const {
    messages,
    setMessages,
    hasMoreMessages,
    loadingMessages,
    historyExpanded,
    loadingOlderMessages,
    loadOlderMessages,
    messagesContainerRef,
    scrollToBottom,
    captureScrollState,
    traceTimelineLayoutChange,
    isNearBottom,
    newMessagesCount,
  } = useConversationMessages({
    activeConversationId: activeConvId,
    conversations,
    instanceName,
    attendantLabel,
    isMock,
    connectionStatus: whatsappStatus,
  });


  // Rolar para a última mensagem automaticamente quando a conversa mudar ou chegar mensagem nova
  /* const loadChats = async (showLoading = true) => {
    if (showLoading) setLoadingChats(true);
    if (isMock) {
      setConversations(mockConversations);
      setActiveConvId(mockConversations[0]?.id || '');
    } else {
      const realChats = await EvolutionApiService.fetchRealChats(instanceName);
      if (realChats.length > 0) {
        const previousActiveConversation = conversationsRef.current.find((conversation) => conversation.id === activeConvIdRef.current);
        const previousActivePhone = previousActiveConversation?.contact.phone.replace(/\D/g, '');
        const mergedChats = realChats.map((conversation) => {
          const locallyReadAt = readOverridesRef.current.get(conversation.id);
          return locallyReadAt && conversation.lastMessageAt && conversation.lastMessageAt <= locallyReadAt
            ? { ...conversation, unreadCount: 0 }
            : conversation;
        });
        setConversations(mergedChats);
        setActiveConvId((previousId) => {
          if (mergedChats.some((conversation) => conversation.id === previousId)) return previousId;
          const replacement = previousActivePhone
            ? mergedChats.find((conversation) => conversation.contact.phone.replace(/\D/g, '') === previousActivePhone)
            : undefined;
          return replacement?.id || previousId || mergedChats[0].id;
        });
      } else {
        // Uma resposta vazia pode ocorrer enquanto a Evolution reorganiza o chat após o envio.
        // Mantemos a lista atual para não fechar a conversa ativa por engano.
        setConversations((previous) => previous.length > 0 ? previous : []);
      }
    }
    if (showLoading) setLoadingChats(false);
  }; */


  /* useEffect(() => {
    if (!activeConv || isMock || !isPhoneOnlyName(activeConv.contact.name)) return;
    let mounted = true;
    EvolutionApiService.fetchBusinessProfile(activeConv.contact.phone).then((profile) => {
      if (!mounted || !profile) return;
      const normalizedProfile = extractBusinessProfile(profile);
      if (!normalizedProfile.name) return;
      setBusinessProfile(normalizedProfile);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id && isPhoneOnlyName(conversation.contact.name) ? {
        ...conversation,
        contact: { ...conversation.contact, name: normalizedProfile.name },
      } : conversation));
    });
    return () => { mounted = false; };
  }, [activeConvId, isMock]); */

  /* const markConversationAsRead = async (conversation: Conversation) => {
    setConversations((previous) => previous.map((item) => item.id === conversation.id ? { ...item, unreadCount: 0 } : item));
    if (!conversation.lastMessageAt) return;

    readOverridesRef.current.set(conversation.id, conversation.lastMessageAt);
    try {
      await EvolutionApiService.markChatAsRead(conversation.id, conversation.lastMessageAt, conversation.lastMessageKey);
    } catch (error) {
      console.warn('[Atendimento] NÃ£o foi possÃ­vel persistir a leitura:', error);
    }
  };

  const captureActiveChat = async () => {
    if (!activeConv || isMock) return;
    setCapturingChat(true);
    setAssignmentFeedback('');
    try {
      const result = await EvolutionApiService.captureChat(activeConv.id, activeConv.contact.phone);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
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
  };

  const releaseActiveChat = async () => {
    if (!activeConv || isMock) return;
    setCapturingChat(true);
    setAssignmentFeedback('');
    try {
      await EvolutionApiService.releaseChat(activeConv.id, activeConv.contact.phone);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        assignedAttendant: undefined,
        contact: {
          ...conversation.contact,
          tags: [],
        },
      } : conversation));
      setAssignmentFeedback('Atendimento liberado para a equipe.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível liberar o atendimento');
    } finally {
      setCapturingChat(false);
    }
  };

  const updateActiveChatStatus = async (status: ChatStatus) => {
    if (!activeConv) return;

    const previousStatus = activeConv.status;
    const previousNeedsResponse = conversationNeedsResponse(activeConv);
    setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
      ...conversation,
      status,
      needsResponse: status === 'resolved'
        ? false
        : conversation.lastMessageFromMe
          ? false
          : conversation.needsResponse ?? conversation.unreadCount > 0,
    } : conversation));
    setAssignmentFeedback('');

    if (isMock) {
      setAssignmentFeedback(status === 'resolved' ? 'Conversa resolvida.' : status === 'pending' ? 'Conversa marcada como pendente.' : 'Conversa reaberta.');
      return;
    }

    try {
      await EvolutionApiService.updateChatStatus(activeConv.id, status, activeConv.contact.phone);
      setAssignmentFeedback(status === 'resolved' ? 'Conversa resolvida.' : status === 'pending' ? 'Conversa marcada como pendente.' : 'Conversa reaberta.');
    } catch (error) {
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        status: previousStatus,
        needsResponse: previousNeedsResponse,
      } : conversation));
      setAssignmentFeedback(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel atualizar o status');
    }
  };

  */
  /* const saveContactToGoogle = async () => {
    if (!activeConv) return;
    setSavingGoogleContact(true);
    setGoogleContactFeedback('');
    try {
      const result = await apiRequest<{ googleSynced: boolean }>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({
          name: activeConv.contact.name,
          phone: activeConv.contact.phone,
        }),
      });
    setGoogleContactStatus(result.googleSynced ? 'saved' : 'unavailable');
      setGoogleMatchedName(result.googleSynced ? activeConv.contact.name : null);
      setGoogleContactFeedback(result.googleSynced ? 'Contato atualizado no Google Contacts.' : 'Salvo no Hub. Conecte o Google Contacts para sincronizar.');
    } catch (error) {
      setGoogleContactFeedback(error instanceof Error ? error.message : 'Não foi possível salvar o contato');
    } finally {
      setSavingGoogleContact(false);
    }
  };

  const openGoogleContactForm = () => {
    if (!activeConv) return;
    setGoogleContactFeedback('');
    setGoogleContactForm((current) => ({
      ...current,
      name: current.name || (googleMatchedName && !/^\+?[0-9 ]+$/.test(googleMatchedName) ? googleMatchedName : ''),
      phone: activeConv.contact.phone,
    }));
    setShowGoogleContactForm(true);
  };

  const saveGoogleContactForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeConv || !googleContactForm.name.trim() || !googleContactForm.phone.trim()) return;
    setSavingGoogleContact(true);
    setGoogleContactFeedback('');
    try {
      const result = await apiRequest<{ saved: boolean; name: string; resourceName: string | null; phone: string; otherPhone: string }>('/api/google/contact', {
        method: 'POST',
        body: JSON.stringify(googleContactForm),
      });
      setGoogleContactStatus('saved');
      setGoogleMatchedName(result.name);
      setShowGoogleContactForm(false);
      setGoogleContactFeedback('Contato salvo no Google Contacts.');
      setGoogleContactForm((current) => ({ ...current, resourceName: result.resourceName || current.resourceName }));
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        contact: { ...conversation.contact, name: googleContactForm.name, phone: googleContactForm.phone },
      } : conversation));
    } catch (error) {
      setGoogleContactFeedback(error instanceof Error ? error.message : 'Não foi possível salvar o contato');
    } finally {
      setSavingGoogleContact(false);
    }
  };

  useEffect(() => {
    if (!showContactInfo || !activeConv) return;
    let mounted = true;
    setLoadingBusinessProfile(true);
    setBusinessProfile(null);
    setGoogleContactStatus('checking');
    setGoogleMatchedName(null);
    setGoogleContactFeedback('');
    apiRequest<{ connected: boolean; saved: boolean; name: string | null; resourceName: string | null; email: string; cpf: string; address: string; otherPhone: string }>('/api/google/contact-status', {
      method: 'POST',
      body: JSON.stringify({ phone: activeConv.contact.phone }),
    }).then((status) => {
      if (mounted) {
        setGoogleContactStatus(!status.connected ? 'unavailable' : status.saved ? 'saved' : 'not_saved');
        setGoogleMatchedName(status.saved ? status.name : null);
        setGoogleContactForm({
          name: status.saved && status.name ? status.name : (/^\+?[0-9 ]+$/.test(activeConv.contact.name) ? '' : activeConv.contact.name),
          phone: activeConv.contact.phone,
          otherPhone: status.otherPhone || '',
          email: status.email || '',
          cpf: status.cpf || '',
          address: status.address || '',
          resourceName: status.resourceName || '',
        });
      }
    }).catch(() => {
      if (mounted) {
        setGoogleContactStatus('unavailable');
        setGoogleContactForm({
          name: /^\+?[0-9 ]+$/.test(activeConv.contact.name) ? '' : activeConv.contact.name,
          phone: activeConv.contact.phone,
          otherPhone: '', email: '', cpf: '', address: '', resourceName: '',
        });
      }
    });
    EvolutionApiService.fetchBusinessProfile(activeConv.contact.phone)
      .then((profile) => {
        if (!mounted || !profile) return;
        const normalizedProfile = extractBusinessProfile(profile);
        setBusinessProfile(normalizedProfile);
        if (normalizedProfile.name && isPhoneOnlyName(activeConv.contact.name)) {
          setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
            ...conversation,
            contact: { ...conversation.contact, name: normalizedProfile.name },
          } : conversation));
        }
      })
      .finally(() => { if (mounted) setLoadingBusinessProfile(false); });
    return () => { mounted = false; setShowGoogleContactForm(false); };
  }, [showContactInfo, activeConvId]);

  */
  const restoreFailedOptimisticActivity = (conversation: Conversation, optimisticMessageId: string) => {
    setConversations((previous) => previous.map((item) => {
      if (item.id !== conversation.id || item.lastMessageKey?.id !== optimisticMessageId) return item;
      return {
        ...item,
        lastMessage: conversation.lastMessage,
        lastMessageTimestamp: conversation.lastMessageTimestamp,
        lastMessageAt: conversation.lastMessageAt,
        lastMessageFromMe: conversation.lastMessageFromMe,
        lastMessageKey: conversation.lastMessageKey,
        unreadCount: conversation.unreadCount,
        needsResponse: conversation.needsResponse,
        status: conversation.status,
      };
    }));
  };

  const handleReplyMessage = useCallback((message: Message) => {
    if (message.isInternalNote) return;
    setReplyTo(message);
    setIsInternalNote(false);
    setQuickReplyOpen(false);
    scheduleComposerFocus(() => composerRef.current?.focus());
  }, []);

  const handleReactMessage = useCallback(async (message: Message, emoji: CommonReactionEmoji) => {
    if (!activeConv || !canReactToMessage(message)) {
      setAssignmentFeedback('Aguarde a confirmação da mensagem antes de reagir.');
      return;
    }
    if (activeChatLocked) {
      setAssignmentFeedback(`Atendimento em andamento por ${activeLease?.ownerName || 'outro atendente'}.`);
      return;
    }
    if (!isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de reagir.');
      return;
    }

    const reactionToSend = nextHubReactionEmoji(message, emoji);
    const optimisticUpdatedAt = Date.now();
    const targetMessageId = message.id;
    const providerMessageId = message.rawKey.id.trim();
    const originalMetadata = message.metadata;
    setAssignmentFeedback('');
    setMessages((previous) => previous.map((item) => (
      item.id === targetMessageId
        ? withOptimisticHubReaction(item, reactionToSend, {
            actorId: user?.id,
            actorName: attendantName,
            updatedAt: optimisticUpdatedAt,
          })
        : item
    )));

    if (isMock) return;
    try {
      const result = await EvolutionApiService.sendMessageReaction({
        number: activeConv.contact.phone,
        remoteJid: activeConv.id,
        messageId: providerMessageId,
        emoji: reactionToSend,
      });
      if (activeConversationIdRef.current !== activeConv.id || !result.message?.metadata) return;
      setMessages((previous) => previous.map((item) => (
        item.id === targetMessageId
          ? { ...item, metadata: result.message.metadata }
          : item
      )));
    } catch (error) {
      if (activeConversationIdRef.current === activeConv.id) {
        setMessages((previous) => previous.map((item) => {
          const optimisticReaction = item.metadata?.reactions?.find((reaction) => (
            reaction.reactorKey === '__vitstock_self__' && reaction.updatedAt === optimisticUpdatedAt
          ));
          const optimisticRemoval = reactionToSend === null && !item.metadata?.reactions?.some((reaction) => (
            reaction.reactorKey === '__vitstock_self__'
          ));
          if (item.id !== targetMessageId || (!optimisticReaction && !optimisticRemoval)) return item;
          return { ...item, metadata: originalMetadata };
        }));
      }
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível enviar a reação.');
    }
  }, [activeChatLocked, activeConv, activeLease?.ownerName, attendantName, isMock, setAssignmentFeedback, setMessages, user?.id, whatsappStatus]);

  const handleCreateConversationTag = useCallback(async (name: string, color: string) => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    if (isMock) {
      const tag: Tag = { id: `mock-conversation-tag-${Date.now()}`, name: normalizedName, color, usageCount: 0 };
      setConversationTags((previous) => previous.some((item) => item.name.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase())
        ? previous
        : [...previous, tag]);
      return;
    }
    try {
      const result = await createConversationTag(normalizedName, color);
      if (result.tag) {
        setConversationTags((previous) => previous.some((item) => item.id === result.tag.id)
          ? previous.map((item) => item.id === result.tag.id ? result.tag : item)
          : [...previous, result.tag]);
      }
      setAssignmentFeedback('Tag criada.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível criar a tag.');
      throw error;
    }
  }, [isMock, setAssignmentFeedback]);

  const handleUpdateConversationTag = useCallback(async (tagId: string, input: { name?: string; color?: string }) => {
    if (isMock) {
      setConversationTags((previous) => previous.map((tag) => tag.id === tagId ? { ...tag, ...input } : tag));
      setConversations((previous) => previous.map((conversation) => ({
        ...conversation,
        conversationTags: (conversation.conversationTags || []).map((tag) => tag.id === tagId ? { ...tag, ...input } : tag),
      })));
      setAssignmentFeedback('Tag atualizada.');
      return;
    }
    try {
      const result = await updateConversationTag(tagId, input);
      if (!result.tag) throw new Error('Não foi possível atualizar a tag.');
      setConversationTags((previous) => previous.map((tag) => tag.id === tagId ? result.tag : tag));
      setConversations((previous) => previous.map((conversation) => ({
        ...conversation,
        conversationTags: (conversation.conversationTags || []).map((tag) => tag.id === tagId ? result.tag : tag),
      })));
      setAssignmentFeedback('Tag atualizada.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível atualizar a tag.');
      throw error;
    }
  }, [isMock, setAssignmentFeedback, setConversations]);

  const handleDeleteConversationTag = useCallback(async (tagId: string) => {
    if (isMock) {
      setConversationTags((previous) => previous.filter((tag) => tag.id !== tagId));
      setConversations((previous) => previous.map((conversation) => ({
        ...conversation,
        conversationTags: (conversation.conversationTags || []).filter((tag) => tag.id !== tagId),
      })));
      if (filterTab === `tag:${tagId}`) setFilterTab('all');
      setAssignmentFeedback('Tag excluída.');
      return;
    }
    try {
      await deleteConversationTag(tagId);
      setConversationTags((previous) => previous.filter((tag) => tag.id !== tagId));
      setConversations((previous) => previous.map((conversation) => ({
        ...conversation,
        conversationTags: (conversation.conversationTags || []).filter((tag) => tag.id !== tagId),
      })));
      if (filterTab === `tag:${tagId}`) setFilterTab('all');
      setAssignmentFeedback('Tag excluída.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível excluir a tag.');
      throw error;
    }
  }, [filterTab, isMock, setAssignmentFeedback, setConversations, setFilterTab]);

  const toggleConversationTag = useCallback(async (tag: Tag) => {
    if (!activeConv) return;
    const conversationId = activeConv.id;
    const assigned = (activeConv.conversationTags || []).some((item) => item.id === tag.id);
    if (isMock) {
      setConversations((previous) => previous.map((conversation) => conversation.id === conversationId
        ? {
            ...conversation,
            conversationTags: assigned
              ? (conversation.conversationTags || []).filter((item) => item.id !== tag.id)
              : [...(conversation.conversationTags || []), tag],
          }
        : conversation));
      setConversationTags((previous) => previous.map((item) => item.id === tag.id
        ? { ...item, usageCount: Math.max(0, (item.usageCount || 0) + (assigned ? -1 : 1)) }
        : item));
      return;
    }
    try {
      const result = assigned
        ? await removeConversationTag(conversationId, tag.id)
        : await addConversationTag(conversationId, tag.id);
      const nextTags = Array.isArray(result.tags) ? result.tags : [];
      setConversations((previous) => previous.map((conversation) => conversation.id === conversationId
        ? { ...conversation, conversationTags: nextTags }
        : conversation));
      setConversationTags((previous) => previous.map((item) => item.id === tag.id
        ? { ...item, usageCount: Math.max(0, (item.usageCount || 0) + (assigned ? -1 : 1)) }
        : item));
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível atualizar as tags.');
    }
  }, [activeConv, isMock, setAssignmentFeedback, setConversations]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const pendingAttachments = attachmentDraftsRef.current;
    if ((!composerTextRef.current.trim() && pendingAttachments.length === 0) || !activeConv) return;
    if (pendingAttachments.length > 0) {
      await sendAttachmentDrafts(pendingAttachments.slice());
      return;
    }
    if (activeChatLocked) {
      setAssignmentFeedback(`Atendimento em andamento por ${activeLease?.ownerName || 'outro atendente'}.`);
      return;
    }
    if (!isInternalNote && !isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de enviar mensagens.');
      return;
    }

    const submission = captureComposerSubmission({
      text: composerTextRef.current,
      replyTarget: replyTo,
      isInternalNote,
    });
    const newMsgText = submission.text;
    const isInternalNoteToSend = submission.isInternalNote;
    const quotedMessage = submission.replyTarget ? toQuotedMessage(submission.replyTarget) : undefined;
    const replyTraceId = quotedMessage ? createReplyTraceId() : undefined;
    const clientMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setReplyTo(null);
    composerRef.current?.clear();
    const clearedDraftRevision = composerDraftRevisionRef.current;

    const restoreFailedDraft = () => {
      if (activeConversationIdRef.current === activeConv.id && canRestoreComposerDraft(composerDraftRevisionRef.current, clearedDraftRevision)) {
        composerRef.current?.setText(newMsgText);
      } else if (!readConversationDraft(composerDraftsRef.current, activeConv.id)) {
        writeConversationDraft(composerDraftsRef.current, activeConv.id, newMsgText);
      }
    };

    const newMsg: Message = {
      id: clientMessageId,
      conversationId: activeConv.id,
      sender: 'attendant',
      senderName: attendantName,
      content: newMsgText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
      status: isInternalNoteToSend ? 'sent' : 'pending',
      metadata: isInternalNoteToSend ? undefined : {
        sentByHub: true,
        sentByUserId: user?.id,
        sentByUserName: attendantName,
        clientMessageId,
        ...(quotedMessage ? { quotedMessage } : {}),
      },
      isInternalNote: isInternalNoteToSend
    };

    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const traceOutbound = !isInternalNoteToSend && !isMock
      ? createOutboundTrace({
        clientMessageId: newMsg.id,
        conversationId: activeConv.id,
        kind: 'text',
        replyTraceId,
        submitSource: submitter ? 'click' : 'keyboard',
      })
      : null;
    traceOutbound?.('submit');

    setMessages(prev => [...prev, newMsg]);
    traceOutbound?.('optimistic.rendered');
    window.setTimeout(() => scrollToBottom('outbound.text.optimistic'), 0);

    if (!isInternalNoteToSend) {
      updateConversationActivity(activeConv.id, {
        lastMessage: activeConv.isGroup ? `${attendantName}: ${newMsgText}` : newMsgText,
        lastMessageTimestamp: formatMessageTimestamp(newMsg.timestampMs, 'Agora'),
        lastMessageAt: newMsg.timestampMs || Date.now(),
        lastMessageFromMe: true,
        lastMessageKey: { id: newMsg.id, remoteJid: activeConv.id, fromMe: true },
        unreadCount: 0,
        needsResponse: false,
        moveToFront: true,
      });
    }

    // Se NÃO for nota interna e NÃO for mock, envia mensagem real no WhatsApp via Evolution API!
    if (isInternalNoteToSend && !isMock) {
      try {
        const savedNote = await EvolutionApiService.saveInternalNote(activeConv.id, activeConv.contact.phone, newMsgText);
        if (activeConversationIdRef.current === activeConv.id) {
          setMessages((previous) => previous.map((message) => message.id === newMsg.id ? savedNote : message));
        }
      } catch (error) {
        if (activeConversationIdRef.current === activeConv.id) {
          setMessages((previous) => previous.filter((message) => message.id !== newMsg.id));
        }
        restoreFailedDraft();
        setAssignmentFeedback(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel salvar a nota interna.');
        return;
      }
    }

    if (!isInternalNoteToSend && !isMock) {
      try {
      traceOutbound?.('http.started');
      const result = await EvolutionApiService.sendTextMessage(instanceName, activeConv.contact.phone, newMsgText, activeConv.id, newMsg.id, quotedMessage, replyTraceId);
      traceOutbound?.('http.completed', { ok: true, evolutionMessageId: result?.message?.evolutionMessageId || result?.message?.id || null });
      if (activeConversationIdRef.current === activeConv.id) {
        const providerMessageId = result?.message?.evolutionMessageId || result?.message?.id;
        setMessages((previous) => previous.map((message) => message.id === newMsg.id ? {
          ...message,
          id: providerMessageId || message.id,
          status: result?.message?.status || result?.status || 'sent',
          ...(providerMessageId ? { rawKey: { id: providerMessageId, remoteJid: activeConv.id, fromMe: true } } : {}),
        } : message));
        traceOutbound?.('optimistic.acknowledged', { status: result?.message?.status || result?.status || 'sent' });
      }
      const dailyResponder = result?.dailyResponder;
      if (dailyResponder?.id && dailyResponder?.name) {
        setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [{ id: `daily-responder-${dailyResponder.id}`, name: `👤 ${dailyResponder.name}`, color: '#A78BFA' }],
          },
        } : conversation));
      }
      } catch (error) {
        traceOutbound?.('http.completed', { ok: false });
        if (quotedMessage && replyTraceId) traceReplySendFailure({
          replyTraceId,
          conversationId: activeConv.id,
          localMessageId: newMsg.id,
          quote: quotedMessage,
          kind: 'text',
          status: typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : undefined,
          errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code || '') : undefined,
        });
        if (activeConversationIdRef.current === activeConv.id) {
          setMessages((previous) => previous.map((message) => message.id === newMsg.id ? { ...message, status: 'failed' } : message));
        }
        restoreFailedDraft();
        restoreFailedOptimisticActivity(activeConv, newMsg.id);
        setAssignmentFeedback(outboundErrorMessage(error, 'Não foi possível enviar a mensagem.'));
        return;
      }
    }

    if (!isInternalNoteToSend && pendingContactChatId === activeConv.id) {
      pendingContactChatRef.current = null;
      setPendingContactChatId(null);
    }

    // Atualiza última mensagem na lista lateral
    if (isInternalNoteToSend) {
      setConversations(prev => prev.map(c => c.id === activeConv.id ? {
        ...c,
        lastMessage: `[Nota Interna]: ${newMsgText}`,
        lastMessageTimestamp: 'Agora',
        unreadCount: 0,
        lastMessageFromMe: c.lastMessageFromMe,
        needsResponse: c.needsResponse,
      } : c));
    }
  };

  const sendAttachmentDrafts = async (drafts: AttachmentDraft[]) => {
    if (drafts.length === 0 || !activeConv || isInternalNote || sendingMedia) return;
    if (activeChatLocked) {
      setAssignmentFeedback(`Atendimento em andamento por ${activeLease?.ownerName || 'outro atendente'}.`);
      return;
    }
    if (!isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de enviar anexos.');
      return;
    }

    const conversation = activeConv;
    const submission = captureComposerSubmission({
      text: composerTextRef.current,
      replyTarget: replyTo,
      isInternalNote: false,
    });
    const caption = submission.text;
    const quotedMessage = submission.replyTarget ? toQuotedMessage(submission.replyTarget) : undefined;
    setReplyTo(null);
    setSendingMedia(true);
    setMediaSendProgress({ current: 0, total: drafts.length });
    composerRef.current?.clear();
    const clearedDraftRevision = composerDraftRevisionRef.current;
    let succeeded = 0;
    let failed = 0;
    let firstOptimisticMessageId: string | null = null;
    let optimisticActivityUpdated = false;
    const restoreFailedDraft = () => {
      if (!caption) return;
      if (activeConversationIdRef.current === conversation.id && canRestoreComposerDraft(composerDraftRevisionRef.current, clearedDraftRevision)) {
        composerRef.current?.setText(caption);
      } else if (!readConversationDraft(composerDraftsRef.current, conversation.id)) {
        writeConversationDraft(composerDraftsRef.current, conversation.id, caption);
      }
    };
    const updateDraftStatus = (id: string, status: 'pending' | 'failed') => {
      const next = attachmentDraftsRef.current.map((draft) => draft.id === id ? { ...draft, status } : draft);
      attachmentDraftsRef.current = next;
      setAttachmentDrafts(next);
    };
    const removeDraft = (id: string) => {
      replaceAttachmentDrafts(attachmentDraftsRef.current.filter((draft) => draft.id !== id));
    };

    try {
      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index];
        setMediaSendProgress({ current: index + 1, total: drafts.length });
        updateDraftStatus(draft.id, 'pending');
        const file = draft.file;
        const mediatype: ComposerMediaType = draft.mediaType;
        const fileExtension = file.name.toLowerCase().split('.').pop() || '';
        const label = mediatype === 'image' ? '[Imagem]' : mediatype === 'video' ? '[Vídeo]' : '[Documento]';
        const captionForAttachment = draft.captionEligible ? caption : '';
        const quoteForAttachment = draft.captionEligible ? quotedMessage : undefined;
        const replyTraceId = quoteForAttachment ? createReplyTraceId() : undefined;
        const clientMessageId = draft.clientMessageId || `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (!draft.clientMessageId) {
          const withId = attachmentDraftsRef.current.map((item) => item.id === draft.id ? { ...item, clientMessageId } : item);
          attachmentDraftsRef.current = withId;
          setAttachmentDrafts(withId);
        }
        if (!isMediaFileSizeAllowed(file.size)) {
          failed += 1;
          updateDraftStatus(draft.id, 'failed');
          setAssignmentFeedback('Um ou mais anexos excedem o limite de 10 MB.');
          continue;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Não foi possível ler o anexo'));
          reader.readAsDataURL(file);
        }).catch((error) => {
          setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível ler o anexo.');
          return '';
        });
        const media = dataUrl.split(',')[1];
        if (!dataUrl || !media || !isMediaBase64SizeAllowed(media.length)) {
          failed += 1;
          updateDraftStatus(draft.id, 'failed');
          if (dataUrl && media && !isMediaBase64SizeAllowed(media.length)) setAssignmentFeedback('Arquivo excede o limite permitido.');
          continue;
        }
        const localMessage: Message = {
          id: clientMessageId,
          conversationId: conversation.id,
          sender: 'attendant',
          senderName: attendantName,
          content: captionForAttachment || label,
          mediaUrl: dataUrl,
          mediaType: mediatype,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestampMs: Date.now(),
          status: 'pending',
          metadata: {
            sentByHub: true,
            sentByUserId: user?.id,
            sentByUserName: attendantName,
            clientMessageId,
            ...(mediatype === 'document'
              ? { document: { fileName: file.name, mimeType: file.type || undefined, fileSize: file.size } }
              : {}),
            ...(quoteForAttachment ? { quotedMessage: quoteForAttachment } : {}),
          },
        };
        firstOptimisticMessageId ||= localMessage.id;
        const traceOutbound = createOutboundTrace({ clientMessageId: localMessage.id, conversationId: conversation.id, kind: 'media', replyTraceId });
        traceOutbound('submit');
        setAssignmentFeedback('');
        setMessages((previous) => previous.some((message) => message.id === localMessage.id)
          ? previous.map((message) => message.id === localMessage.id ? { ...message, ...localMessage, status: 'pending' } : message)
          : [...previous, localMessage]);
        traceOutbound('optimistic.rendered');
        window.setTimeout(() => scrollToBottom('outbound.media.optimistic'), 0);
        if (!optimisticActivityUpdated) {
          updateConversationActivity(conversation.id, {
            lastMessage: conversation.isGroup ? `${attendantName}: ${captionForAttachment || label}` : (captionForAttachment || label),
            lastMessageTimestamp: formatMessageTimestamp(localMessage.timestampMs, 'Agora'),
            lastMessageAt: localMessage.timestampMs || Date.now(),
            lastMessageFromMe: true,
            lastMessageKey: { id: localMessage.id, remoteJid: conversation.id, fromMe: true },
            unreadCount: 0,
            needsResponse: false,
            moveToFront: true,
          });
          optimisticActivityUpdated = true;
        }
        try {
          traceOutbound('http.started');
          const result = await EvolutionApiService.sendMediaMessage({
            instanceName,
            number: conversation.contact.phone,
            remoteJid: conversation.id,
            mediatype,
            mimetype: file.type || (mediatype === 'image' ? 'image/jpeg' : mediatype === 'video' ? 'video/mp4' : fileExtension === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
            media,
            fileName: file.name,
            caption: captionForAttachment || undefined,
            clientMessageId: localMessage.id,
            quotedMessage: quoteForAttachment,
            replyTraceId,
          });
          succeeded += 1;
          traceOutbound('http.completed', { ok: true, evolutionMessageId: result?.message?.evolutionMessageId || result?.message?.id || null });
          if (activeConversationIdRef.current === conversation.id) {
            const providerMessageId = result?.message?.evolutionMessageId || result?.message?.id;
            setMessages((previous) => previous.map((message) => message.id === localMessage.id ? {
              ...message,
              id: providerMessageId || message.id,
              status: result?.message?.status || result?.status || 'sent',
              ...(providerMessageId ? { rawKey: { id: providerMessageId, remoteJid: conversation.id, fromMe: true } } : {}),
            } : message));
            traceOutbound('optimistic.acknowledged', { status: result?.message?.status || result?.status || 'sent' });
          }
          const dailyResponder = result?.dailyResponder;
          if (dailyResponder?.id && dailyResponder?.name) setConversations((previous) => previous.map((item) => item.id === conversation.id ? {
            ...item,
            contact: { ...item.contact, tags: [{ id: `daily-responder-${dailyResponder.id}`, name: `👤 ${dailyResponder.name}`, color: '#A78BFA' }] },
          } : item));
          removeDraft(draft.id);
        } catch (error) {
          failed += 1;
          traceOutbound('http.completed', { ok: false });
          if (quoteForAttachment && replyTraceId) traceReplySendFailure({
            replyTraceId,
            conversationId: conversation.id,
            localMessageId: localMessage.id,
            quote: quoteForAttachment,
            kind: mediatype,
            status: typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : undefined,
            errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code || '') : undefined,
          });
          updateDraftStatus(draft.id, 'failed');
          if (activeConversationIdRef.current === conversation.id) {
            setMessages((previous) => previous.map((message) => message.id === localMessage.id ? { ...message, status: 'failed' } : message));
          }
          setAssignmentFeedback(outboundErrorMessage(error, 'Não foi possível enviar um ou mais anexos.'));
        }
      }
    } finally {
      if (failed > 0) {
        restoreFailedDraft();
        if (succeeded === 0 && firstOptimisticMessageId) restoreFailedOptimisticActivity(conversation, firstOptimisticMessageId);
        setAssignmentFeedback(`${succeeded} anexo(s) enviado(s); ${failed} pendente(s) para tentar novamente.`);
      } else if (succeeded > 0 && pendingContactChatId === conversation.id) {
        pendingContactChatRef.current = null;
        setPendingContactChatId(null);
      }
      setSendingMedia(false);
      setMediaSendProgress(null);
    }
  };

  const handleAttachmentSelected = (files: File[]) => {
    if (files.length === 0 || !activeConv || isInternalNote || sendingMedia) return;
    if (activeChatLocked) {
      setAssignmentFeedback(`Atendimento em andamento por ${activeLease?.ownerName || 'outro atendente'}.`);
      return;
    }
    if (!isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de selecionar anexos.');
      return;
    }
    const currentBytes = attachmentDraftsRef.current.reduce((total, draft) => total + draft.size, 0);
    const selected = selectAttachmentFiles(files, attachmentDraftsRef.current.length, currentBytes);
    const accepted: AttachmentDraft[] = [];
    selected.accepted.forEach((file) => {
      const mediaType = classifyAttachmentFile(file)!;
      const previewUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : '';
      accepted.push({
        id: createAttachmentId(),
        file,
        mediaType,
        previewUrl,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        captionEligible: attachmentDraftsRef.current.length === 0 && accepted.length === 0,
      });
    });
    if (accepted.length > 0) replaceAttachmentDrafts([...attachmentDraftsRef.current, ...accepted]);
    setAssignmentFeedback(selected.rejected > 0
      ? `${selected.rejected} anexo(s) não foram adicionados. Limite: ${MAX_ATTACHMENTS_PER_MESSAGE} arquivos, 10 MB por arquivo e 25 MB no total.`
      : '');
  };

  const handleAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    handleAttachmentSelected(files);
  };

  const handleInputPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!activeConv || isInternalNote || sendingMedia) return;
    if (activeChatLocked) {
      setAssignmentFeedback(`Atendimento em andamento por ${activeLease?.ownerName || 'outro atendente'}.`);
      return;
    }
    if (!isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de enviar imagens.');
      return;
    }
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;
    event.preventDefault();
    handleAttachmentSelected(files);
  };

  const retryFailedMessage = useCallback(async (message: Message) => {
    if (!activeConv || isMock || message.status !== 'failed' || message.isInternalNote) return;
    if (activeChatLocked) {
      setAssignmentFeedback(`Atendimento em andamento por ${activeLease?.ownerName || 'outro atendente'}.`);
      return;
    }
    if (whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de tentar novamente.');
      return;
    }

    const conversationId = activeConv.id;
    const retryText = message.content.trim();
    const clientMessageId = message.metadata?.sentByHub === true
      && typeof message.metadata.clientMessageId === 'string'
      && message.metadata.clientMessageId.trim()
      ? message.metadata.clientMessageId
      : message.id;
    const replyTraceId = message.metadata?.quotedMessage ? createReplyTraceId() : undefined;
    if (!retryText && !message.mediaUrl) return;
    setAssignmentFeedback('');
    setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, status: 'pending' } : item));
    const retryTimestampMs = Date.now();
    updateConversationActivity(activeConv.id, {
      lastMessage: message.content || (message.mediaType ? `[${message.mediaType}]` : retryText),
      lastMessageTimestamp: formatMessageTimestamp(retryTimestampMs, 'Agora'),
      lastMessageAt: retryTimestampMs,
      lastMessageFromMe: true,
      lastMessageKey: { id: message.id, remoteJid: activeConv.id, fromMe: true },
      unreadCount: 0,
      needsResponse: false,
      moveToFront: true,
    });

    try {
      let result: any;
      if ((message.mediaType === 'image' || message.mediaType === 'video' || message.mediaType === 'document')
        && message.mediaUrl?.startsWith('data:')) {
        const [dataHeader, media] = message.mediaUrl.split(',', 2);
        if (!media) throw new Error('O anexo original não está disponível para nova tentativa.');
        const mimetype = dataHeader.match(/^data:([^;]+)/)?.[1]
          || (message.mediaType === 'image' ? 'image/jpeg' : message.mediaType === 'video' ? 'video/mp4' : 'application/pdf');
        result = await EvolutionApiService.sendMediaMessage({
          instanceName,
          number: activeConv.contact.phone,
          remoteJid: activeConv.id,
          mediatype: message.mediaType,
          mimetype,
          media,
          caption: retryText || undefined,
          clientMessageId,
          quotedMessage: message.metadata?.quotedMessage,
          replyTraceId,
        });
      } else if (message.mediaType) {
        throw new Error('O arquivo original não está disponível para nova tentativa.');
      } else {
        result = await EvolutionApiService.sendTextMessage(instanceName, activeConv.contact.phone, retryText, activeConv.id, clientMessageId, message.metadata?.quotedMessage, replyTraceId);
      }
      if (activeConversationIdRef.current === conversationId) {
        const providerMessageId = result?.message?.evolutionMessageId || result?.message?.id;
        setMessages((previous) => previous.map((item) => item.id === message.id ? {
          ...item,
          id: providerMessageId || item.id,
          status: result?.message?.status || result?.status || 'sent',
          ...(providerMessageId ? { rawKey: { id: providerMessageId, remoteJid: activeConv.id, fromMe: true } } : {}),
          metadata: item.metadata?.sentByHub === true
            ? { ...item.metadata, clientMessageId: item.metadata.clientMessageId || clientMessageId }
            : item.metadata,
        } : item));
      }
      const dailyResponder = result?.dailyResponder;
      if (dailyResponder?.id && dailyResponder?.name) {
        setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [{ id: `daily-responder-${dailyResponder.id}`, name: `👤 ${dailyResponder.name}`, color: '#A78BFA' }],
          },
        } : conversation));
      }
    } catch (error) {
      if (message.metadata?.quotedMessage && replyTraceId) traceReplySendFailure({
        replyTraceId,
        conversationId: conversationId,
        localMessageId: message.id,
        quote: message.metadata.quotedMessage,
        kind: message.mediaType || 'text',
        status: typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : undefined,
        errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code || '') : undefined,
      });
      if (activeConversationIdRef.current === conversationId) {
        setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, status: 'failed' } : item));
        setAssignmentFeedback(outboundErrorMessage(error, 'Não foi possível reenviar a mensagem.'));
      }
    }
  }, [activeChatLocked, activeConv, activeLease?.ownerName, attendantName, instanceName, isMock, updateConversationActivity, whatsappStatus]);

  const handleSelectConversation = useCallback((conversation: Conversation) => {
    captureScrollState(activeConvId);
    setActiveConvId(conversation.id);
    void markConversationAsRead(conversation);
  }, [activeConvId, captureScrollState, markConversationAsRead, setActiveConvId]);

  const handleLoadOlderMessages = useCallback(() => {
    void loadOlderMessages();
  }, [loadOlderMessages]);

  const handleRetryMessage = useCallback((message: Message) => {
    void retryFailedMessage(message);
  }, [retryFailedMessage]);

  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatNumber.trim() || !newChatMessage.trim() || startingNewChat) return;
    if (!isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de iniciar uma conversa.');
      return;
    }

    const cleanNum = newChatNumber.replace(/\D/g, '');
    if (cleanNum.length < 8) {
      setAssignmentFeedback('Informe um número válido com DDD.');
      return;
    }
    const jid = `${cleanNum}@s.whatsapp.net`;
    const contactName = newChatName.trim() || `+${cleanNum}`;
    const messageText = newChatMessage.trim();
    const clientMessageId = `new-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setStartingNewChat(true);
    setAssignmentFeedback('');
    let result: any = null;
    if (!isMock) {
      try {
        result = await EvolutionApiService.sendTextMessage(instanceName, cleanNum, messageText, jid, clientMessageId);
      } catch (error) {
        setAssignmentFeedback(outboundErrorMessage(error, 'Não foi possível iniciar a conversa.'));
        setStartingNewChat(false);
        return;
      }
    }

    const newConv: Conversation = {
      id: jid,
      contact: {
        id: jid,
        name: contactName,
        phone: `+${cleanNum}`,
        avatar: '',
        tags: [],
        createdAt: new Date().toISOString().split('T')[0]
      },
      lastMessage: messageText,
      lastMessageTimestamp: 'Agora',
      unreadCount: 0,
      lastMessageFromMe: true,
      needsResponse: false,
      status: 'open',
      department: 'Atendimento Geral'
    };

    setConversations(prev => [newConv, ...prev]);
    captureScrollState(activeConvId);
    setActiveConvId(jid);
    setMessages([{
      id: result?.message?.evolutionMessageId || result?.message?.id || clientMessageId,
      conversationId: jid,
      sender: 'attendant',
      senderName: attendantName,
      content: messageText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
      status: result?.message?.status || result?.status || 'sent',
      metadata: {
        sentByHub: true,
        sentByUserId: user?.id,
        sentByUserName: attendantName,
        clientMessageId,
      },
    }]);
    setShowNewChatModal(false);
    setNewChatNumber('');
    setNewChatName('');
    setNewChatMessage('');
    setStartingNewChat(false);
  };

  return (
    <div className="flex h-full w-full bg-[#11181d] overflow-hidden text-slate-100 font-overpass relative">
      
      {/* Modal para Nova Conversa Directa */}
      {whatsappConnected && showNewChatModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#121215] border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
              <Phone className="w-5 h-5 text-amber-400" /> Nova Conversa WhatsApp
            </h2>
            <form onSubmit={handleStartNewChat} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Número do WhatsApp (com DDD)</label>
                <input 
                  type="text" 
                  placeholder="Ex: 5521999998888"
                  value={newChatNumber}
                  onChange={e => setNewChatNumber(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Nome do Contato (Opcional)</label>
                <input 
                  type="text" 
                  placeholder="Ex: João da Silva"
                  value={newChatName}
                  onChange={e => setNewChatName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Primeira mensagem</label>
                <textarea
                  value={newChatMessage}
                  onChange={e => setNewChatMessage(e.target.value)}
                  placeholder="Escreva a mensagem que será enviada agora..."
                  rows={3}
                  className="w-full resize-none bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                  required
                />
              </div>
              {assignmentFeedback && <p className="text-xs font-semibold text-red-300">{assignmentFeedback}</p>}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowNewChatModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-xs font-bold text-zinc-400 hover:text-zinc-200"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={startingNewChat}
                  className="px-4 py-2 rounded-xl bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                >
                  {startingNewChat ? 'Enviando...' : 'Enviar e iniciar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Coluna 1: Lista de Conversas (Inbox) */}
      <div className="w-[360px] border-r border-[#344047] flex flex-col bg-[#182126] flex-shrink-0">
        
        {/* Topo do Inbox: Busca e Filtros */}
        <div className="space-y-3.5 border-b border-[#344047] bg-[#20292f] px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-[19px] font-extrabold tracking-[-0.02em] text-zinc-100">
              Atendimento
            </h1>
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setShowNewChatModal(true)}
                disabled={!whatsappConnected}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400 text-zinc-950 shadow-[0_4px_12px_rgba(238,187,44,0.2)] transition-colors hover:bg-amber-300"
                title="Nova Conversa"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => loadChats(true)} 
                disabled={!whatsappConnected}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#46535a] bg-[#2a343a] text-slate-300 transition-colors hover:border-amber-300/50 hover:text-amber-300"
                title="Sincronizar Mensagens"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingChats ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {whatsappConnected ? <>
          {/* Campo de Busca */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Buscar cliente, telefone..."
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              aria-label="Buscar atendimento por nome ou telefone"
              className="h-11 w-full rounded-xl border border-transparent bg-[#2a343a] pl-10 pr-3 text-[13px] text-slate-100 placeholder-slate-400 transition-colors focus:border-amber-400/70 focus:outline-none"
            />
          </div>

          {/* Filtros de atendimento */}
          <div className="hidden grid grid-cols-6 gap-1.5 rounded-xl border border-[#3a474e] bg-[#141d22] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_8px_24px_rgba(0,0,0,0.14)]">
            {(['all', 'unread', 'unanswered', 'delivery', 'resolved'] as const).map(tab => {
              const count = tab === 'all'
                ? conversations.length
                : tab === 'unread'
                  ? conversations.filter((conversation) => conversation.unreadCount > 0).length
                  : tab === 'unanswered'
                    ? conversations.filter(conversationNeedsResponse).length
                    : tab === 'delivery'
                      ? conversations.filter((conversation) => conversation.status === 'pending').length
                      : conversations.filter((conversation) => conversation.status === 'resolved').length;
              const tabLabel = tab === 'all'
                ? 'Todos'
                : tab === 'unread'
                  ? 'Não lidas'
                  : tab === 'unanswered'
                    ? 'Não respondidas'
                    : tab === 'delivery'
                      ? 'Entregas'
                      : 'Resolvidas';
              const tabWidth = tab === 'all' || tab === 'unread' || tab === 'unanswered'
                ? 'col-span-3'
                : tab === 'delivery'
                  ? 'col-span-2'
                : tab === 'resolved'
                    ? 'col-span-1'
                    : 'col-span-2';
              const isActive = filterTab === tab;

              return (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  title={tab === 'resolved' ? `${tabLabel}: ${count}` : undefined}
                  aria-label={`${tabLabel}: ${count}`}
                  aria-pressed={isActive}
                  className={`${tabWidth} group relative flex h-9 min-w-0 items-center overflow-hidden rounded-lg border ${tab === 'resolved' ? 'justify-center pl-2 pr-6' : 'justify-start pl-2.5 pr-8'} text-[11px] font-semibold tracking-[-0.01em] transition-all duration-200 ${
                    isActive
                      ? 'border-amber-300/80 bg-gradient-to-b from-amber-300 to-amber-400 text-[#17130a] shadow-[0_4px_14px_rgba(251,191,36,0.18),inset_0_1px_0_rgba(255,255,255,0.55)]'
                      : 'border-transparent bg-[#1b252a] text-slate-300 hover:border-[#46545c] hover:bg-[#222e34] hover:text-white'
                  }`}
                >
                  {tab === 'resolved' ? (
                    <Archive className="h-[17px] w-[17px] shrink-0" strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <span className="truncate whitespace-nowrap">{tabLabel}</span>
                  )}
                  <span className={`inline-flex shrink-0 items-center justify-center rounded-md border font-extrabold leading-none tabular-nums ${
                    tab === 'resolved'
                      ? 'absolute right-1 top-1 h-4 min-w-4 px-1 text-[9px]'
                      : 'absolute right-1.5 top-1/2 h-5 min-w-6 -translate-y-1/2 px-1.5 text-[10px]'
                  } ${
                    isActive
                      ? 'border-[#17130a]/15 bg-[#17130a] text-amber-300'
                      : 'border-[#3b484f] bg-[#263239] text-slate-200 group-hover:border-[#52616a]'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <ConversationTagRail
            conversations={conversations}
            tags={conversationTags}
            activeFilter={filterTab}
            onFilterChange={setFilterTab}
            onCreateTag={handleCreateConversationTag}
            onUpdateTag={handleUpdateConversationTag}
            onDeleteTag={handleDeleteConversationTag}
            needsResponse={conversationNeedsResponse}
          />
          </> : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-6 text-center">
              {whatsappStatus === 'connecting' ? (
                <RefreshCw className="h-7 w-7 animate-spin text-amber-300" aria-hidden="true" />
              ) : (
                <WifiOff className="h-7 w-7 text-red-300" aria-hidden="true" />
              )}
              <div>
                <p className="text-sm font-bold text-slate-100">
                  {whatsappStatus === 'connecting' ? 'Reconectando ao WhatsApp...' : 'WhatsApp desconectado'}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-300/80">
                  {whatsappStatus === 'connecting'
                    ? 'A caixa de entrada ficará disponível assim que a conexão for restabelecida.'
                    : 'Reconecte sua conta para voltar a receber e enviar mensagens.'}
                </p>
              </div>
              {whatsappStatus === 'disconnected' && (
                <button type="button" onClick={() => navigate('/configuracoes?tab=connections')} className="rounded-lg border border-amber-300/40 bg-amber-300 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-200">
                  Reconectar WhatsApp
                </button>
              )}
            </div>
          )}
        </div>

        {/* Lista de Conversas com Scroll */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {whatsappConnected && (
            <ConversationList
              conversations={conversations}
              visibleConversations={visibleConversations}
              activeConversationId={activeConvId}
              needsResponse={conversationNeedsResponse}
              needsAttention={needsAttention}
              onSelectConversation={handleSelectConversation}
            />
          )}
        </div>
      </div>

      {/* Coluna 2: Chat Principal (Bate-Papo Central) */}
      <div className="flex-1 flex flex-col bg-[#152027] overflow-hidden">
        {whatsappConnected && activeConv ? (
          <>
            {/* Cabeçalho do Chat */}
            <div className="h-16 px-5 border-b border-[#344047] bg-[#20292f] flex items-center justify-between flex-shrink-0">
              <button type="button" onClick={() => setShowContactInfo(true)} className="flex items-center gap-3 rounded-lg hover:bg-white/5 pr-3 py-1 transition-colors text-left">
                <ContactPhoto name={activeConv.contact.name} avatar={activeConv.isGroup ? (activeConv.groupAvatar || activeConv.contact.avatar) : activeConv.contact.avatar} emphasized />
                <div>
                  <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    {activeConv.contact.name}
                  </h2>
                  <p className="text-xs text-zinc-400 font-mono">{activeConv.isGroup ? 'Grupo WhatsApp' : formatPhoneForDisplay(activeConv.contact.phone)}</p>
                </div>
              </button>

              {/* Ações Rápidas do Atendimento */}
              <div className="flex items-center gap-2">
                {false && (activeConv!.assignedAttendant ? (
                  activeConv!.assignedAttendant!.id === user?.id ? (
                    <button type="button" onClick={releaseActiveChat} disabled={capturingChat} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-400/10 text-violet-300 border border-violet-400/30 hover:bg-violet-400 hover:text-zinc-950 transition-all flex items-center gap-1.5 disabled:opacity-60">
                      <UserCheck className="w-3.5 h-3.5" /> {capturingChat ? 'Atualizando...' : 'Liberar atendimento'}
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-400/10 text-violet-300 border border-violet-400/30 flex items-center gap-1.5" title="Este atendimento foi capturado por outro usuário">
                      <UserCheck className="w-3.5 h-3.5" /> {activeConv!.assignedAttendant!.name}
                    </span>
                  )
                ) : (
                  <button type="button" onClick={captureActiveChat} disabled={capturingChat} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-400/10 text-amber-300 border border-amber-400/30 hover:bg-amber-400 hover:text-zinc-950 transition-all flex items-center gap-1.5 disabled:opacity-60">
                    <UserCheck className="w-3.5 h-3.5" /> {capturingChat ? 'Capturando...' : 'Capturar atendimento'}
                  </button>
                ))}
                <button type="button" onClick={() => updateActiveChatStatus(activeConv.status === 'resolved' ? 'open' : 'resolved')} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-zinc-950 transition-all flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {activeConv.status === 'resolved' ? 'Reabrir Conversa' : 'Concluído'}
                </button>
                {activeConv.status !== 'resolved' && (
                  <button
                    type="button"
                    onClick={() => updateActiveChatStatus(activeConv.status === 'pending' ? 'open' : 'pending')}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-400/10 text-slate-300 border border-slate-400/20 hover:bg-slate-400 hover:text-zinc-950 transition-all"
                  >
                    {activeConv.status === 'pending' ? 'Retirar da Entrega' : 'Solicitar Entrega'}
                  </button>
                )}
                <div ref={conversationTagMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setShowConversationTagMenu((open) => !open)}
                    aria-label="Gerenciar tags da conversa"
                    aria-expanded={showConversationTagMenu}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#46535a] bg-[#2a343a] px-2.5 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-amber-300/50 hover:text-amber-300"
                  >
                    <TagIcon className="h-3.5 w-3.5" />
                    <span className="hidden xl:inline">Tags</span>
                  </button>
                  {showConversationTagMenu && (
                    <div role="menu" aria-label="Tags da conversa" className="absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border border-[#46535a] bg-[#182126] p-2 shadow-2xl">
                      <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Tags da conversa</p>
                      {conversationTags.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-slate-500">Crie uma tag na barra lateral.</p>
                      ) : conversationTags.map((tag) => {
                        const checked = activeConversationTags.some((item) => item.id === tag.id
                          || Boolean(tag.systemKey && item.systemKey === tag.systemKey));
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={checked}
                            onClick={() => void toggleConversationTag(tag)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
                          >
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                            <span className={`h-3.5 w-3.5 rounded border ${checked ? 'border-amber-300 bg-amber-300' : 'border-slate-600'}`} aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            {assignmentFeedback && <div className="px-5 py-2 text-xs font-semibold text-violet-200 bg-violet-400/10 border-b border-violet-400/20">{assignmentFeedback}</div>}

            {/* Mensagens com Scroll */}
            <MessageTimeline
              messages={messages}
              activeConversation={activeConv}
              instanceName={instanceName}
              containerRef={messagesContainerRef}
              hasMoreMessages={hasMoreMessages}
              loadingMessages={loadingMessages}
              historyExpanded={historyExpanded}
              loadingOlderMessages={loadingOlderMessages}
              isNearBottom={isNearBottom}
              newMessagesCount={newMessagesCount}
              onLoadOlder={handleLoadOlderMessages}
              onJumpToLatest={scrollToBottom}
              onLayoutChange={traceTimelineLayoutChange}
              onRetryMessage={handleRetryMessage}
              onReplyMessage={handleReplyMessage}
              onReactMessage={handleReactMessage}
            />

            <MessageComposer
              ref={composerRef}
              isInternalNote={isInternalNote}
              quickReplyOpen={quickReplyOpen}
              quickReplies={quickReplies}
              quickReplyContext={{
                contactName: activeConv?.contact.name,
                agentName: user?.name,
                companyName: user?.companyName,
              }}
              canCreateQuickReply={user?.role === 'admin'}
              onCreateQuickReply={handleCreateQuickReply}
              activeChatLocked={activeChatLocked}
              whatsappConnected={whatsappConnected}
              leaseOwnerName={activeLease?.ownerName}
              onPullConversation={pullActiveConversationLease}
              pullingConversation={capturingChat}
              sendingMedia={sendingMedia}
              attachmentInputRef={attachmentInputRef}
              onSubmit={handleSendMessage}
              onTextChange={handleComposerTextChange}
              onToggleInternalNote={handleToggleInternalNote}
              onToggleQuickReply={() => setQuickReplyOpen((open) => !open)}
              onUseQuickReply={handleQuickReplyUse}
              onAttachmentChange={handleAttachmentChange}
              onInputPaste={handleInputPaste}
              attachmentDrafts={attachmentDrafts}
              onRemoveAttachment={removeAttachmentDraft}
              onRemoveAllAttachments={clearAttachmentDrafts}
              mediaSendProgress={mediaSendProgress}
              activeConversationId={activeConvId}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </>
        ) : !whatsappConnected ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center text-zinc-500">
            {whatsappStatus === 'connecting' ? (
              <RefreshCw className="mb-4 h-12 w-12 animate-spin text-amber-300" aria-hidden="true" />
            ) : (
              <WifiOff className="mb-4 h-12 w-12 text-red-300" aria-hidden="true" />
            )}
            <h3 className="text-lg font-bold text-zinc-100">
              {whatsappStatus === 'connecting' ? 'Reconectando ao WhatsApp...' : 'WhatsApp desconectado'}
            </h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">
              {whatsappStatus === 'connecting'
                ? 'O Atendimento está aguardando a conexão ser restabelecida.'
                : 'O Atendimento está offline. Reconecte sua conta para voltar a receber e enviar mensagens.'}
            </p>
            {whatsappStatus === 'disconnected' && (
              <button type="button" onClick={() => navigate('/configuracoes?tab=connections')} className="mt-5 rounded-lg border border-amber-300/40 bg-amber-300 px-4 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-200">
                Reconectar WhatsApp
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-zinc-500">
            <MessageSquare className="w-12 h-12 mb-3 text-zinc-700 animate-pulse" />
            <h3 className="text-sm font-bold text-zinc-300 mb-1">Seu WhatsApp está conectado.</h3>
            <p className="text-xs max-w-sm text-zinc-500">
              As mensagens enviadas para o seu número aparecerão aqui automaticamente.
            </p>
          </div>
        )}
      </div>

      {/* Coluna 3: Ficha CRM */}
      {whatsappConnected && activeConv && (
        <div className="hidden 2xl:flex w-64 border-l border-[#344047] bg-[#182126] p-5 flex-col justify-between flex-shrink-0 overflow-y-auto">
          <div>
            <div className="text-center pb-5 border-b border-zinc-800/80">
              <div className="flex justify-center mb-3">
                <ContactPhoto name={activeConv.contact.name} avatar={activeConv.isGroup ? (activeConv.groupAvatar || activeConv.contact.avatar) : activeConv.contact.avatar} size="large" emphasized />
              </div>
              <h3 className="text-sm font-extrabold text-zinc-100">{activeConv.contact.name}</h3>
              <p className="text-xs text-amber-400 font-mono mt-0.5">{formatPhoneForDisplay(activeConv.contact.phone)}</p>
            </div>

            <div data-testid="conversation-tags-sidebar" className="py-4 border-b border-zinc-800/80">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-2">
                TAGS
              </span>
              <div className="flex flex-wrap gap-1.5">
                {activeConversationTags.length > 0 ? activeConversationTags.map(tag => (
                  <span 
                    key={tag.id}
                    className="text-xs font-bold px-2 py-1 rounded"
                    style={{ backgroundColor: `${tag.color}25`, color: tag.color, border: `1px solid ${tag.color}50` }}
                  >
                    {tag.name}
                  </span>
                )) : <span className="text-xs text-zinc-500">Nenhuma tag</span>}
              </div>
            </div>
          </div>

          <div className="pt-4" style={{ display: 'none' }}>
            <button className="w-full btn-primary text-xs justify-center py-2.5">
              <Kanban className="w-4 h-4" /> Criar Negócio no Funil
            </button>
          </div>
        </div>
      )}

      {whatsappConnected && showContactInfo && activeConv && (
        <div className="absolute inset-y-0 right-0 z-40 w-[340px] max-w-[90vw] bg-[#182126] border-l border-[#344047] shadow-2xl flex flex-col animate-fade-in">
          <div className="h-16 px-4 border-b border-[#344047] bg-[#20292f] flex items-center justify-between">
            <h3 className="font-extrabold text-sm text-slate-100">Informações do contato</h3>
            <button type="button" onClick={() => setShowContactInfo(false)} className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/5"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="text-center space-y-2">
              <div className="flex justify-center"><ContactPhoto name={activeConv.contact.name} avatar={activeConv.isGroup ? (activeConv.groupAvatar || activeConv.contact.avatar) : activeConv.contact.avatar} size="large" emphasized /></div>
              <h4 className="font-extrabold text-slate-100">{googleContactStatus === 'saved' && googleMatchedName ? googleMatchedName : businessProfile?.verifiedName || businessProfile?.name || activeConv.contact.name}</h4>
              <p className="text-xs text-amber-300 font-mono">{formatPhoneForDisplay(activeConv.contact.phone)}</p>
              {googleContactStatus === 'checking' ? (
                <span className="mx-auto mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2a343a] text-slate-300 text-xs font-bold"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verificando Google Contacts...</span>
              ) : googleContactStatus === 'saved' ? (
                <div className="flex flex-col items-center gap-1.5">
                  <span className="mx-auto mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 text-xs font-extrabold"><CheckCircle className="w-3.5 h-3.5" /> Já salvo no Google Contacts</span>
                  {googleMatchedName && <span className="text-[11px] text-slate-400">Salvo como: <strong className="text-slate-200">{googleMatchedName}</strong></span>}
                  <button type="button" onClick={openGoogleContactForm} className="mt-1 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300"><Pencil className="w-3.5 h-3.5" /> Editar contato</button>
                </div>
              ) : (
                <button type="button" onClick={openGoogleContactForm} disabled={savingGoogleContact} className="mx-auto mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300 disabled:opacity-60">
                  {savingGoogleContact ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                  {savingGoogleContact ? 'Salvando...' : googleContactStatus === 'unavailable' ? 'Salvar no Google Contacts' : 'Cadastrar no Google Contacts'}
                </button>
              )}
              {googleContactFeedback && <p className="text-[11px] text-emerald-300">{googleContactFeedback}</p>}
              {(businessProfile?.isBusiness || businessProfile?.verifiedName) && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/30 text-[10px] font-bold text-emerald-300"><Building2 className="w-3.5 h-3.5" /> Conta empresarial</span>
              )}
            </div>
            {googleContactStatus === 'saved' && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg bg-[#20292f] border border-[#344047]">
                  <span className="block text-slate-500 font-bold mb-2">Dados do Google Contacts</span>
                  <div className="space-y-1.5 text-slate-200">
                    {googleContactForm.otherPhones && <p><strong className="text-slate-400">Telefones:</strong> {googleContactForm.otherPhones}</p>}
                    {(googleContactForm.email || googleContactForm.emails) && <p><strong className="text-slate-400">E-mails:</strong> {[googleContactForm.email, googleContactForm.emails].filter(Boolean).join(', ')}</p>}
                    {googleContactForm.addresses && <p className="whitespace-pre-wrap"><strong className="text-slate-400">Endereços:</strong>{`\n${googleContactForm.addresses}`}</p>}
                    {googleContactForm.birthday && <p><strong className="text-slate-400">Aniversário:</strong> {googleContactForm.birthday}</p>}
                    {(googleContactForm.company || googleContactForm.jobTitle) && <p><strong className="text-slate-400">Profissional:</strong> {[googleContactForm.company, googleContactForm.jobTitle].filter(Boolean).join(' · ')}</p>}
                    {googleContactForm.occupation && <p><strong className="text-slate-400">Ocupação:</strong> {googleContactForm.occupation}</p>}
                    {googleContactForm.relations && <p className="whitespace-pre-wrap"><strong className="text-slate-400">Relações:</strong>{`\n${googleContactForm.relations}`}</p>}
                    {googleContactForm.events && <p className="whitespace-pre-wrap"><strong className="text-slate-400">Datas:</strong>{`\n${googleContactForm.events}`}</p>}
                    {googleContactForm.customFields && <p className="whitespace-pre-wrap"><strong className="text-slate-400">Campos personalizados:</strong>{`\n${googleContactForm.customFields}`}</p>}
                    {googleContactForm.website && <a href={googleContactForm.website} target="_blank" rel="noopener noreferrer" className="block text-emerald-300 hover:text-emerald-200 truncate">{googleContactForm.website}</a>}
                    {googleContactForm.notes && <p className="whitespace-pre-wrap"><strong className="text-slate-400">Observações:</strong>{`\n${googleContactForm.notes}`}</p>}
                  </div>
                </div>
              </div>
            )}
            {loadingBusinessProfile ? (
              <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-6"><RefreshCw className="w-4 h-4 animate-spin" /> Buscando perfil empresarial...</div>
            ) : businessProfile ? (
              <div className="space-y-3 text-xs">
                {businessProfile.description && <div className="p-3 rounded-lg bg-[#20292f] border border-[#344047]"><span className="block text-slate-500 font-bold mb-1">Descrição</span><p className="text-slate-200 whitespace-pre-wrap">{businessProfile.description}</p></div>}
                {businessProfile.category && <div className="p-3 rounded-lg bg-[#20292f] border border-[#344047]"><span className="text-slate-500 font-bold">Categoria: </span><span className="text-slate-200">{Array.isArray(businessProfile.category) ? businessProfile.category.map((item: any) => item.name || item).join(', ') : businessProfile.category}</span></div>}
                {businessProfile.email && <a href={`mailto:${businessProfile.email}`} className="block p-3 rounded-lg bg-[#20292f] border border-[#344047] text-amber-300">{businessProfile.email}</a>}
                {businessProfile.website && <a href={Array.isArray(businessProfile.website) ? businessProfile.website[0] : businessProfile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-lg bg-[#20292f] border border-[#344047] text-emerald-300"><Globe className="w-4 h-4" /> Abrir site empresarial</a>}
                {businessProfile.address && <div className="p-3 rounded-lg bg-[#20292f] border border-[#344047] text-slate-200">{businessProfile.address}</div>}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-[#20292f] border border-[#344047] text-xs text-slate-400 text-center">O WhatsApp não disponibilizou detalhes adicionais deste perfil empresarial.</div>
            )}
          </div>
        </div>
      )}

      {whatsappConnected && showGoogleContactForm && activeConv && (
        <div className="absolute inset-y-0 right-0 z-[70] w-[340px] max-w-[90vw] bg-[#182126] border-l border-[#344047] shadow-2xl animate-fade-in">
          <form onSubmit={saveGoogleContactForm} className="flex h-full flex-col gap-4 overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-4 border-b border-[#344047] pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-100">{googleContactStatus === 'saved' ? 'Editar contato no Google' : 'Cadastrar contato no Google'}</h3>
                <p className="text-xs text-slate-400 mt-1">Preencha os dados antes de salvar. O nome é obrigatório.</p>
              </div>
              <button type="button" onClick={() => setShowGoogleContactForm(false)} className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/5"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Nome completo *
                <input required minLength={2} value={googleContactForm.name} onChange={(event) => setGoogleContactForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Carlos Silva" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">Telefone WhatsApp *
                <input required readOnly value={googleContactForm.phone} className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#10171b] px-3 py-2.5 text-sm font-mono text-amber-300 outline-none" />
              </label>
              <label className="text-xs font-bold text-slate-300">Outro telefone
                <input value={googleContactForm.otherPhones} onChange={(event) => setGoogleContactForm((current) => ({ ...current, otherPhones: event.target.value }))} placeholder="Mais de um, separados por vírgula" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">E-mail
                <input type="email" value={googleContactForm.email} onChange={(event) => setGoogleContactForm((current) => ({ ...current, email: event.target.value }))} placeholder="cliente@email.com" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Outros e-mails
                <input value={googleContactForm.emails} onChange={(event) => setGoogleContactForm((current) => ({ ...current, emails: event.target.value }))} placeholder="Separe os e-mails por vírgula" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">CPF
                <input value={googleContactForm.cpf} onChange={(event) => setGoogleContactForm((current) => ({ ...current, cpf: event.target.value }))} placeholder="000.000.000-00" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Endereços (um por linha)
                <textarea rows={3} value={googleContactForm.addresses} onChange={(event) => setGoogleContactForm((current) => ({ ...current, addresses: event.target.value, address: event.target.value.split(/\r?\n/)[0] || '' }))} placeholder="Rua, número, bairro, cidade e estado" className="mt-1 w-full resize-y rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
            </div>
            <p className="text-[11px] text-slate-500">O CPF será salvo no campo personalizado do Google Contacts.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-slate-300">Aniversário
                <input value={googleContactForm.birthday} onChange={(event) => setGoogleContactForm((current) => ({ ...current, birthday: event.target.value }))} placeholder="AAAA-MM-DD ou DD/MM/AAAA" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">Apelido
                <input value={googleContactForm.nickname} onChange={(event) => setGoogleContactForm((current) => ({ ...current, nickname: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">Empresa
                <input value={googleContactForm.company} onChange={(event) => setGoogleContactForm((current) => ({ ...current, company: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">Cargo
                <input value={googleContactForm.jobTitle} onChange={(event) => setGoogleContactForm((current) => ({ ...current, jobTitle: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">Ocupação
                <input value={googleContactForm.occupation} onChange={(event) => setGoogleContactForm((current) => ({ ...current, occupation: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">Relações
                <textarea rows={2} value={googleContactForm.relations} onChange={(event) => setGoogleContactForm((current) => ({ ...current, relations: event.target.value }))} placeholder="Ex.: cônjuge: Ana" className="mt-1 w-full resize-y rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Datas importantes
                <textarea rows={2} value={googleContactForm.events} onChange={(event) => setGoogleContactForm((current) => ({ ...current, events: event.target.value }))} placeholder="Ex.: aniversário: 25/12/1990" className="mt-1 w-full resize-y rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Campos personalizados
                <textarea rows={3} value={googleContactForm.customFields} onChange={(event) => setGoogleContactForm((current) => ({ ...current, customFields: event.target.value }))} placeholder="Uma linha por campo, no formato chave: valor" className="mt-1 w-full resize-y rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Site
                <input type="url" value={googleContactForm.website} onChange={(event) => setGoogleContactForm((current) => ({ ...current, website: event.target.value }))} placeholder="https://..." className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Observações
                <textarea rows={4} value={googleContactForm.notes} onChange={(event) => setGoogleContactForm((current) => ({ ...current, notes: event.target.value }))} className="mt-1 w-full resize-y rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#344047] pt-4">
              <button type="button" onClick={() => setShowGoogleContactForm(false)} className="px-3 py-2 rounded-lg border border-[#46535a] text-xs font-bold text-slate-300 hover:bg-white/5">Cancelar</button>
              <button type="submit" disabled={savingGoogleContact || !googleContactForm.name.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300 disabled:opacity-60"><Save className="w-4 h-4" /> {savingGoogleContact ? 'Salvando...' : 'Salvar contato'}</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};
