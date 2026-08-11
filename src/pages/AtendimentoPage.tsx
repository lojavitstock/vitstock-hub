import React, { useCallback, useRef, useState, useEffect } from 'react';
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
import { Conversation, Message, WhatsappInstance } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';
import { useAuth } from '../auth/AuthContext';
import { ConversationFilters } from '../components/conversations/ConversationFilters';
import { ConversationList } from '../components/conversations/ConversationList';
import { ContactPhoto } from '../components/conversations/ContactPhoto';
import { MessageTimeline } from '../components/conversations/MessageTimeline';
import { MessageComposer, MessageComposerHandle } from '../components/conversations/MessageComposer';
import { formatMessageTimestamp } from '../components/conversations/conversationFormatters';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { conversationNeedsResponse, useConversationInbox } from '../hooks/useConversationInbox';
import { useContactPanel } from '../hooks/useContactPanel';


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
  const composerRef = useRef<MessageComposerHandle>(null);
  const composerTextRef = useRef('');
  const activeConversationIdRef = useRef<string | null>(null);
  const autoReadMarkersRef = useRef(new Map<string, string>());
  const handleComposerTextChange = useCallback((value: string) => {
    composerTextRef.current = value;
  }, []);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  // Estado para Nova Conversa por Telefone
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [startingNewChat, setStartingNewChat] = useState(false);

  const {
    conversations,
    setConversations,
    activeConversation: activeConv,
    activeConversationId: activeConvId,
    setActiveConversationId: setActiveConvId,
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
    capturingChat,
    assignmentFeedback,
    setAssignmentFeedback,
    captureActiveChat,
    releaseActiveChat,
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

  useEffect(() => {
    activeConversationIdRef.current = activeConvId;
  }, [activeConvId]);

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
    const state = location.state as { startChat?: { phone?: string; name?: string } } | null;
    if (!state?.startChat?.phone) return;
    setNewChatNumber(state.startChat.phone.replace(/\D/g, ''));
    setNewChatName(state.startChat.name || '');
    setNewChatMessage('');
    setAssignmentFeedback('');
    setShowNewChatModal(true);
  }, [location.state]);


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
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composerTextRef.current.trim() || !activeConv || activeChatLocked) return;
    if (!isInternalNote && !isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de enviar mensagens.');
      return;
    }

    const newMsgText = composerTextRef.current.trim();
    const outboundText = `*${attendantName}*\n${newMsgText}`;
    composerRef.current?.clear();

    const newMsg: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: activeConv.id,
      sender: 'attendant',
      senderName: attendantName,
      content: newMsgText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
      status: isInternalNote ? 'sent' : 'pending',
      isInternalNote
    };

    setMessages(prev => [...prev, newMsg]);
    window.setTimeout(scrollToBottom, 0);

    if (!isInternalNote) {
      updateConversationActivity(activeConv.id, {
        lastMessage: newMsgText,
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
    if (isInternalNote && !isMock) {
      try {
        const savedNote = await EvolutionApiService.saveInternalNote(activeConv.id, activeConv.contact.phone, newMsgText);
        if (activeConversationIdRef.current === activeConv.id) {
          setMessages((previous) => previous.map((message) => message.id === newMsg.id ? savedNote : message));
        }
      } catch (error) {
        if (activeConversationIdRef.current === activeConv.id) {
          setMessages((previous) => previous.filter((message) => message.id !== newMsg.id));
          composerRef.current?.setText(newMsgText);
        }
        setAssignmentFeedback(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel salvar a nota interna.');
        return;
      }
    }

    if (!isInternalNote && !isMock) {
      try {
      const result = await EvolutionApiService.sendTextMessage(instanceName, activeConv.contact.phone, outboundText, activeConv.id, newMsg.id);
      if (activeConversationIdRef.current === activeConv.id) {
        setMessages((previous) => previous.map((message) => message.id === newMsg.id ? {
          ...message,
          id: result?.message?.evolutionMessageId || result?.message?.id || message.id,
          status: result?.message?.status || result?.status || 'sent',
        } : message));
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
        if (activeConversationIdRef.current === activeConv.id) {
          setMessages((previous) => previous.map((message) => message.id === newMsg.id ? { ...message, status: 'failed' } : message));
          composerRef.current?.setText(newMsgText);
        }
        setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.');
        return;
      }
    }

    // Atualiza última mensagem na lista lateral
    if (isInternalNote) {
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

  const handleAttachmentFile = async (file: File) => {
    if (!file || !activeConv || activeChatLocked || isInternalNote || sendingMedia) return;
    if (!isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de enviar anexos.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAssignmentFeedback('O anexo deve ter no máximo 10 MB.');
      return;
    }
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const fileExtension = file.name.toLowerCase().split('.').pop() || '';
    const isDocument = file.type === 'application/pdf'
      || file.type.startsWith('application/msword')
      || file.type.startsWith('application/vnd.openxmlformats-officedocument')
      || ['pdf', 'doc', 'docx'].includes(fileExtension);
    if (!isImage && !isVideo && !isDocument) {
      setAssignmentFeedback('Formato não suportado. Envie uma imagem, vídeo ou documento.');
      return;
    }

    const mediatype: 'image' | 'video' | 'document' = isImage ? 'image' : isVideo ? 'video' : 'document';
    const label = mediatype === 'image' ? '[Imagem]' : mediatype === 'video' ? '[Vídeo]' : '[Documento]';
    const caption = composerTextRef.current.trim();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Não foi possível ler o anexo'));
      reader.readAsDataURL(file);
    }).catch((error) => {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível ler o anexo.');
      return '';
    });
    if (!dataUrl) return;
    const media = dataUrl.split(',')[1];
    if (!media) return;
    const localMessage: Message = {
      id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: activeConv.id,
      sender: 'attendant',
      senderName: attendantName,
      content: caption || label,
      mediaUrl: dataUrl,
      mediaType: mediatype,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
      status: 'pending',
    };
    setAssignmentFeedback('');
    setSendingMedia(true);
    composerRef.current?.clear();
    setMessages((previous) => [...previous, localMessage]);
    window.setTimeout(scrollToBottom, 0);
    updateConversationActivity(activeConv.id, {
      lastMessage: caption || label,
      lastMessageTimestamp: formatMessageTimestamp(localMessage.timestampMs, 'Agora'),
      lastMessageAt: localMessage.timestampMs || Date.now(),
      lastMessageFromMe: true,
      lastMessageKey: { id: localMessage.id, remoteJid: activeConv.id, fromMe: true },
      unreadCount: 0,
      needsResponse: false,
      moveToFront: true,
    });
    try {
      const result = await EvolutionApiService.sendMediaMessage({
        instanceName,
        number: activeConv.contact.phone,
        remoteJid: activeConv.id,
        mediatype,
        mimetype: file.type || (mediatype === 'image' ? 'image/jpeg' : mediatype === 'video' ? 'video/mp4' : fileExtension === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
        media,
        fileName: file.name,
        caption: caption || undefined,
        clientMessageId: localMessage.id,
      });
      if (activeConversationIdRef.current === activeConv.id) {
        setMessages((previous) => previous.map((message) => message.id === localMessage.id ? {
          ...message,
          id: result?.message?.evolutionMessageId || result?.message?.id || message.id,
          status: result?.message?.status || result?.status || 'sent',
        } : message));
      }
      const dailyResponder = result?.dailyResponder;
      if (dailyResponder?.id && dailyResponder?.name) setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        contact: dailyResponder?.id && dailyResponder?.name
          ? {
              ...conversation.contact,
              tags: [{ id: `daily-responder-${dailyResponder.id}`, name: `👤 ${dailyResponder.name}`, color: '#A78BFA' }],
            }
          : conversation.contact,
      } : conversation));
    } catch (error) {
      if (activeConversationIdRef.current === activeConv.id) {
        setMessages((previous) => previous.map((message) => message.id === localMessage.id ? { ...message, status: 'failed' } : message));
        composerRef.current?.setText(caption);
      }
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível enviar o anexo.');
    } finally {
      setSendingMedia(false);
    }
  };

  const handleAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await handleAttachmentFile(file);
  };

  const handleInputPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!activeConv || activeChatLocked || isInternalNote || sendingMedia) return;
    if (!isMock && whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de enviar imagens.');
      return;
    }
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const file = imageItem?.getAsFile()
      || Array.from(event.clipboardData.files).find((candidate) => candidate.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void handleAttachmentFile(file);
  };

  const retryFailedMessage = useCallback(async (message: Message) => {
    if (!activeConv || isMock || message.status !== 'failed' || message.isInternalNote) return;
    if (whatsappStatus !== 'connected') {
      setAssignmentFeedback('WhatsApp desconectado. Reconecte o WhatsApp antes de tentar novamente.');
      return;
    }

    const conversationId = activeConv.id;
    const retryText = message.content.trim();
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
          clientMessageId: message.id,
        });
      } else if (message.mediaType) {
        throw new Error('O arquivo original não está disponível para nova tentativa.');
      } else {
        const outboundText = `*${attendantName}*\n${retryText}`;
        result = await EvolutionApiService.sendTextMessage(instanceName, activeConv.contact.phone, outboundText, activeConv.id, message.id);
      }
      if (activeConversationIdRef.current === conversationId) {
        setMessages((previous) => previous.map((item) => item.id === message.id ? {
          ...item,
          id: result?.message?.evolutionMessageId || result?.message?.id || item.id,
          status: result?.message?.status || result?.status || 'sent',
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
      if (activeConversationIdRef.current === conversationId) {
        setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, status: 'failed' } : item));
        setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível reenviar a mensagem.');
      }
    }
  }, [activeConv, attendantName, instanceName, isMock, updateConversationActivity, whatsappStatus]);

  const handleSelectConversation = useCallback((conversation: Conversation) => {
    setActiveConvId(conversation.id);
    void markConversationAsRead(conversation);
  }, [markConversationAsRead, setActiveConvId]);

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
    const outboundText = `*${attendantName}*\n${messageText}`;
    const clientMessageId = `new-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setStartingNewChat(true);
    setAssignmentFeedback('');
    let result: any = null;
    if (!isMock) {
      try {
        result = await EvolutionApiService.sendTextMessage(instanceName, cleanNum, outboundText, jid, clientMessageId);
      } catch (error) {
        setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível iniciar a conversa.');
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
    }]);
    setShowNewChatModal(false);
    setNewChatNumber('');
    setNewChatName('');
    setNewChatMessage('');
    setStartingNewChat(false);
  };

  const whatsappConnected = whatsappStatus === 'connected';
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
          <ConversationFilters
            conversations={conversations}
            activeFilter={filterTab}
            onFilterChange={setFilterTab}
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
                <ContactPhoto name={activeConv.contact.name} avatar={activeConv.contact.avatar} emphasized />
                <div>
                  <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    {activeConv.contact.name}
                  </h2>
                  <p className="text-xs text-zinc-400 font-mono">{activeConv.contact.phone}</p>
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
              newMessagesCount={newMessagesCount}
              onLoadOlder={handleLoadOlderMessages}
              onJumpToLatest={scrollToBottom}
              onRetryMessage={handleRetryMessage}
            />

            <MessageComposer
              ref={composerRef}
              isInternalNote={isInternalNote}
              quickReplyOpen={quickReplyOpen}
              activeChatLocked={activeChatLocked}
              whatsappConnected={whatsappConnected}
              assignedAttendantName={activeConv.assignedAttendant?.name}
              sendingMedia={sendingMedia}
              attachmentInputRef={attachmentInputRef}
              onSubmit={handleSendMessage}
              onTextChange={handleComposerTextChange}
              onToggleInternalNote={setIsInternalNote}
              onToggleQuickReply={() => setQuickReplyOpen((open) => !open)}
              onAttachmentChange={handleAttachmentChange}
              onInputPaste={handleInputPaste}
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
                <ContactPhoto name={activeConv.contact.name} avatar={activeConv.contact.avatar} size="large" emphasized />
              </div>
              <h3 className="text-sm font-extrabold text-zinc-100">{activeConv.contact.name}</h3>
              <p className="text-xs text-amber-400 font-mono mt-0.5">{activeConv.contact.phone}</p>
            </div>

            <div className="py-4 border-b border-zinc-800/80">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-2">
                Etiquetas
              </span>
              <div className="flex flex-wrap gap-1.5">
                {activeConv.contact.tags.map(tag => (
                  <span 
                    key={tag.id}
                    className="text-xs font-bold px-2 py-1 rounded"
                    style={{ backgroundColor: `${tag.color}25`, color: tag.color, border: `1px solid ${tag.color}50` }}
                  >
                    {tag.name}
                  </span>
                ))}
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
              <div className="flex justify-center"><ContactPhoto name={activeConv.contact.name} avatar={activeConv.contact.avatar} size="large" emphasized /></div>
              <h4 className="font-extrabold text-slate-100">{googleContactStatus === 'saved' && googleMatchedName ? googleMatchedName : businessProfile?.verifiedName || businessProfile?.name || activeConv.contact.name}</h4>
              <p className="text-xs text-amber-300 font-mono">{activeConv.contact.phone}</p>
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
