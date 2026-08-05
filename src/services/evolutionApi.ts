import { ChatStatus, WhatsappInstance, Conversation, Message } from '../types';
import { mockInstances, mockConversations } from './mockData';
import { evolutionMessagePreview, normalizeEvolutionMessage } from './evolutionMessageAdapter';
import { phoneVariants } from '../utils/phone';

const unwrapEvolutionMessage = (message: any) => {
  let current = message || {};
  for (let index = 0; index < 6; index += 1) {
    const nested = current?.ephemeralMessage?.message
      || current?.viewOnceMessage?.message
      || current?.viewOnceMessageV2?.message
      || current?.documentWithCaptionMessage?.message
      || current?.associatedChildMessage?.message
      || current?.editedMessage?.message;
    if (!nested) break;
    current = nested;
  }
  return current;
};

const firstMessageText = (...values: unknown[]) => values.find(
  (value): value is string => typeof value === 'string' && value.trim().length > 0,
)?.trim();

const normalizeProviderMessageStatus = (value: unknown): Message['status'] => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (['ERROR', 'FAILED', 'FAILURE', 'REJECTED', '0'].includes(raw)) return 'failed';
  if (['READ', 'PLAYED', '4', '5'].includes(raw)) return 'read';
  if (['DELIVERY_ACK', 'DELIVERED', '2', '3'].includes(raw)) return 'delivered';
  return 'sent';
};

const parseAttendantSignature = (content: string) => {
  const match = content.match(/^\*(?:👤\s*)?([^*\r\n]+)\*\s*(?:\r?\n|$)/);
  if (!match) return { senderName: undefined, content };
  return {
    senderName: match[1].trim(),
    content: content.slice(match[0].length).trimStart(),
  };
};

const getInteractiveMessage = (message: any) => {
  const msg = unwrapEvolutionMessage(message);
  return msg.interactiveMessage
    || msg.templateMessage?.interactiveMessageTemplate
    || msg.templateMessage?.interactiveMessage
    || msg.viewOnceMessage?.message?.interactiveMessage
    || msg.viewOnceMessageV2?.message?.interactiveMessage;
};

const getInteractiveResponseText = (message: any) => {
  const response = unwrapEvolutionMessage(message).interactiveResponseMessage?.nativeFlowResponseMessage;
  if (!response?.paramsJson) return undefined;
  try {
    const params = JSON.parse(response.paramsJson);
    return firstMessageText(params.display_text, params.title, params.id);
  } catch {
    return undefined;
  }
};

const extractEvolutionMessageText = (message: any): string | undefined => {
  const msg = unwrapEvolutionMessage(message);
  const interactive = getInteractiveMessage(msg);
  const template = msg.templateMessage?.hydratedTemplate;
  const fourRowTemplate = msg.templateMessage?.hydratedFourRowTemplate;

  const text = firstMessageText(
    msg.conversation,
    msg.extendedTextMessage?.text,
    msg.imageMessage?.caption,
    msg.videoMessage?.caption,
    msg.audioMessage?.caption,
    msg.documentMessage?.caption,
    interactive?.body?.text,
    interactive?.header?.text,
    interactive?.header?.title,
    msg.buttonsMessage?.contentText,
    msg.buttonsMessage?.footerText,
    msg.listMessage?.description,
    msg.listMessage?.title,
    msg.listMessage?.footerText,
    template?.hydratedContentText,
    template?.hydratedTitleText,
    template?.hydratedFooterText,
    fourRowTemplate?.content,
    fourRowTemplate?.title,
    fourRowTemplate?.footer,
    msg.templateButtonReplyMessage?.selectedDisplayText,
    msg.buttonsResponseMessage?.selectedDisplayText,
    msg.listResponseMessage?.title,
    msg.listResponseMessage?.singleSelectReply?.selectedRowId,
    getInteractiveResponseText(msg),
  );

  if (text) return text;
  if (msg.reactionMessage?.text) return `Reagiu com: ${msg.reactionMessage.text}`;
  if (msg.contactMessage) {
    const vcard = String(msg.contactMessage.vcard || '');
    const phone = vcard.match(/waid=(\d+)/i)?.[1] || vcard.match(/(?:TEL[^:]*:)([^\n\r]+)/i)?.[1]?.trim();
    return `[Contato compartilhado]\n${msg.contactMessage.displayName || 'Contato'}${phone ? `\n+${phone.replace(/\D/g, '')}` : ''}`;
  }
  if (msg.locationMessage) return '[Localização compartilhada]';
  if (msg.callLogMessage || msg.call || msg.offerMessage) return '[Ligação de voz]';
  if (msg.protocolMessage) return Number(msg.protocolMessage.type) === 0 ? '[Mensagem apagada]' : '[Evento do WhatsApp]';
  if (msg.placeholderMessage) return '[Mensagem indisponível]';
  if (msg.secretEncryptedMessage) return '[Mensagem protegida]';
  if (msg.pollCreationMessage) return '[Enquete]';
  if (msg.pollUpdateMessage) return '[Resposta de enquete]';
  if (interactive || msg.buttonsMessage || msg.listMessage) return '🔘 [Mensagem interativa]';
  if (msg.stickerMessage) return '🧩 [Figurinha]';
  if (msg.audioMessage) return '🎵 [Mensagem de Áudio]';
  if (msg.imageMessage) return '🖼️ [Imagem]';
  if (msg.videoMessage) return '🎬 [Vídeo]';
  if (msg.documentMessage) return '📄 [Documento]';
  return undefined;
};

const extractEvolutionMessageMetadata = (message: any, record: any = {}) => {
  const msg = unwrapEvolutionMessage(message);
  const metadata = { ...(record?.metadata || {}) } as Record<string, any>;
  const context = record?.contextInfo
    || msg.contextInfo
    || msg.extendedTextMessage?.contextInfo
    || msg.imageMessage?.contextInfo
    || msg.videoMessage?.contextInfo
    || msg.documentMessage?.contextInfo
    || {};
  const externalAd = context?.externalAdReply || msg.extendedTextMessage?.contextInfo?.externalAdReply;
  const trafficSource = context?.conversionSource
    || context?.conversion_source
    || (context?.ctwaSignals || context?.conversionData || context?.conversion_data ? 'FB_Ads' : undefined);
  if (!metadata.trafficSource && typeof trafficSource === 'string' && trafficSource.trim()) metadata.trafficSource = trafficSource.trim();
  if (!metadata.trafficTitle && typeof externalAd?.title === 'string' && externalAd.title.trim()) metadata.trafficTitle = externalAd.title.trim();
  if (!metadata.trafficUrl && typeof (externalAd?.sourceUrl || externalAd?.sourceURL) === 'string') metadata.trafficUrl = externalAd.sourceUrl || externalAd.sourceURL;
  if (!metadata.contactCard && msg.contactMessage) {
    const vcard = String(msg.contactMessage.vcard || '');
    const phone = vcard.match(/waid=(\d+)/i)?.[1] || vcard.match(/(?:TEL[^:]*:)([^\n\r]+)/i)?.[1]?.trim();
    metadata.contactCard = { displayName: msg.contactMessage.displayName || 'Contato compartilhado', phone: phone ? `+${phone.replace(/\D/g, '')}` : undefined };
  }
  if (!metadata.location && msg.locationMessage && Number.isFinite(Number(msg.locationMessage.degreesLatitude)) && Number.isFinite(Number(msg.locationMessage.degreesLongitude))) {
    const latitude = Number(msg.locationMessage.degreesLatitude);
    const longitude = Number(msg.locationMessage.degreesLongitude);
    metadata.location = { latitude, longitude, name: msg.locationMessage.name, address: msg.locationMessage.address, url: msg.locationMessage.url || `https://www.google.com/maps?q=${latitude},${longitude}` };
  }
  if (!metadata.reaction && msg.reactionMessage?.text) metadata.reaction = msg.reactionMessage.text;
  const messageType = String(record?.messageType || metadata.providerType || '');
  if (!metadata.systemLabel && (msg.callLogMessage || msg.call || msg.offerMessage || /call/i.test(messageType))) metadata.systemLabel = 'Ligação de voz';
  if (!metadata.systemLabel && msg.protocolMessage) metadata.systemLabel = Number(msg.protocolMessage.type) === 0 ? 'Mensagem apagada' : 'Evento do WhatsApp';
  if (!metadata.systemLabel && msg.placeholderMessage) metadata.systemLabel = 'Mensagem indisponível';
  return metadata;
};

const extractEvolutionButtons = (message: any): NonNullable<Message['interactiveButtons']> => {
  const msg = unwrapEvolutionMessage(message);
  const interactive = getInteractiveMessage(msg);
  const buttons: NonNullable<Message['interactiveButtons']> = [];

  const addNativeFlowButton = (button: any) => {
    try {
      const params = JSON.parse(button?.buttonParamsJson || '{}');
      if (button?.name === 'cta_url' && /^https?:\/\//i.test(params.url || '')) {
        buttons.push({ type: 'url', label: params.display_text || 'Abrir link', url: params.url });
      } else if (button?.name === 'cta_copy') {
        buttons.push({ type: 'copy', label: params.display_text || 'Copiar', value: params.copy_code || params.code || '' });
      } else if (button?.name === 'quick_reply') {
        buttons.push({ type: 'quickReply', label: params.display_text || 'Responder', value: params.id || params.display_text || '' });
      } else if (button?.name === 'cta_call') {
        buttons.push({ type: 'call', label: params.display_text || 'Ligar', value: params.phone_number || params.number || '' });
      }
    } catch {
      // Mensagens comerciais podem conter botões sem JSON válido; o texto principal continua sendo exibido.
    }
  };

  const nativeButtons = interactive?.nativeFlowMessage?.buttons;
  if (Array.isArray(nativeButtons)) nativeButtons.forEach(addNativeFlowButton);

  const hydratedButtons = msg.templateMessage?.hydratedTemplate?.hydratedButtons;
  if (Array.isArray(hydratedButtons)) {
    hydratedButtons.forEach((button: any) => {
      const urlButton = button?.urlButton;
      const callButton = button?.callButton;
      const quickReplyButton = button?.quickReplyButton;
      if (urlButton?.url) buttons.push({ type: 'url', label: urlButton.displayText || 'Abrir link', url: urlButton.url });
      if (callButton?.phoneNumber) buttons.push({ type: 'call', label: callButton.displayText || 'Ligar', value: callButton.phoneNumber });
      if (quickReplyButton) buttons.push({ type: 'quickReply', label: quickReplyButton.displayText || 'Responder', value: quickReplyButton.id || quickReplyButton.displayText || '' });
    });
  }

  if (Array.isArray(msg.buttonsMessage?.buttons)) {
    msg.buttonsMessage.buttons.forEach((button: any) => {
      const label = button?.buttonText?.displayText || button?.displayText;
      if (label) buttons.push({ type: 'quickReply', label, value: button.buttonId || label });
    });
  }

  return buttons;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const USE_MOCK = import.meta.env.VITE_USE_MOCK_DATA === 'true';
const API_TIMEOUT_MS = 30_000;

const apiFetch = (path: string, init?: RequestInit) => fetch(`${API_URL}${path}`, {
  ...init,
  signal: init?.signal || AbortSignal.timeout(API_TIMEOUT_MS),
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    ...init?.headers,
  },
});

export type EvolutionRealtimeEvent = {
  type: string;
  remoteJid?: string;
  phone?: string;
  messageId?: string;
  timestampMs?: number;
  fromMe?: boolean;
  status?: string;
  [key: string]: unknown;
};

export class EvolutionApiService {
  private static lastKnownStatus: WhatsappInstance['status'] = 'connecting';
  private static businessProfileCache = new Map<string, { expiresAt: number; profile: any | null }>();
  private static businessProfileInFlight = new Map<string, Promise<any | null>>();
  private static mediaCache = new Map<string, { expiresAt: number; data: string | null }>();
  private static mediaInFlight = new Map<string, Promise<string | null>>();
  private static statusCache = new Map<string, { expiresAt: number; value: WhatsappInstance }>();
  private static statusInFlight = new Map<string, Promise<WhatsappInstance>>();
  private static realtimeSource: EventSource | null = null;
  private static realtimeListeners = new Set<(event: EvolutionRealtimeEvent) => void>();
  private static realtimeOnlineHandler: (() => void) | null = null;

  static subscribeToRealtimeEvents(listener: (event: EvolutionRealtimeEvent) => void) {
    if (USE_MOCK || typeof window === 'undefined' || typeof EventSource === 'undefined') return () => undefined;
    this.realtimeListeners.add(listener);
    this.ensureRealtimeStream();
    return () => {
      this.realtimeListeners.delete(listener);
      if (this.realtimeListeners.size === 0) this.closeRealtimeStream();
    };
  }

  private static ensureRealtimeStream() {
    if (this.realtimeSource || this.realtimeListeners.size === 0) return;
    try {
      const source = new EventSource(`${API_URL}/api/evolution/events`, { withCredentials: true });
      const handleMessage = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as EvolutionRealtimeEvent;
          if (!payload || typeof payload.type !== 'string') return;
          this.realtimeListeners.forEach((listener) => listener(payload));
        } catch {
          // Um heartbeat ou uma resposta intermediária não deve interromper o stream.
        }
      };
      source.addEventListener('evolution', handleMessage as EventListener);
      source.onmessage = handleMessage;
      this.realtimeSource = source;
      this.realtimeOnlineHandler = () => {
        if (this.realtimeSource?.readyState === EventSource.CLOSED) {
          this.closeRealtimeStream();
          this.ensureRealtimeStream();
        }
      };
      window.addEventListener('online', this.realtimeOnlineHandler);
    } catch {
      // Navegadores sem suporte a EventSource continuam usando o polling de segurança.
      this.realtimeSource = null;
    }
  }

  private static closeRealtimeStream() {
    this.realtimeSource?.close();
    this.realtimeSource = null;
    if (this.realtimeOnlineHandler) {
      window.removeEventListener('online', this.realtimeOnlineHandler);
      this.realtimeOnlineHandler = null;
    }
  }

  private static publishStatus(status: WhatsappInstance['status']) {
    this.lastKnownStatus = status;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vitstock:whatsapp-status', { detail: status }));
    }
  }

  /**
   * Buscar status da conexão da instância
   */
  static async getInstanceStatus(instanceName: string): Promise<WhatsappInstance> {
    const cached = this.statusCache.get(instanceName);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = this.statusInFlight.get(instanceName);
    if (pending) return pending;
    const request = this.fetchInstanceStatus(instanceName);
    this.statusInFlight.set(instanceName, request);
    try {
      const value = await request;
      this.statusCache.set(instanceName, { value, expiresAt: Date.now() + 5_000 });
      return value;
    } finally {
      this.statusInFlight.delete(instanceName);
    }
  }

  private static async fetchInstanceStatus(instanceName: string): Promise<WhatsappInstance> {
    if (USE_MOCK) {
      return mockInstances[0];
    }

    try {
      const res = await apiFetch('/api/evolution/status');
      if (!res.ok) throw new Error('Backend indisponível ou sessão expirada');
      const data = await res.json();
      const state = data?.instance?.state || data?.state;
      const status: WhatsappInstance['status'] = state === 'open'
        ? 'connected'
        : state === 'connecting'
          ? 'connecting'
          : 'disconnected';
      this.publishStatus(status);

      return {
        id: instanceName,
        name: instanceName,
        status,
        phone: data?.instance?.owner || ''
      };
    } catch (err) {
      console.warn('Evolution API indisponível ou em criação:', err);
      return {
        id: instanceName,
        name: instanceName,
        status: this.lastKnownStatus
      };
    }
  }

  /**
   * Criar nova instância na Evolution API v2
   */
  static async createInstance(instanceName: string): Promise<WhatsappInstance> {
    if (USE_MOCK) return mockInstances[0];
    return { id: instanceName, name: instanceName, status: 'disconnected' };
  }

  /**
   * Obter QR Code real para conectar WhatsApp
   */
  static async getConnectQrCode(instanceName: string): Promise<string | null> {
    if (USE_MOCK) return null;

    try {
      const res = await apiFetch('/api/evolution/connect');
      const data = await res.json();
      return data?.base64 || data?.qrcode?.base64 || data?.code || null;
    } catch (err) {
      console.error('Erro ao buscar QR Code:', err);
      return null;
    }
  }

  /**
   * Encerrar a sessão atual para permitir um novo pareamento por QR Code.
   */
  static async logoutInstance(instanceName: string) {
    if (USE_MOCK) return { status: 'SUCCESS' };

    const response = await apiFetch('/api/evolution/logout', {
      method: 'POST',
      body: '{}',
    });
    const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || 'Não foi possível desconectar o WhatsApp');
      }
      this.statusCache.delete(instanceName);
      return body;
  }

  /**
   * Buscar conversas reais diretamente da Evolution API no Railway
   */
  /**
   * Buscar conversas reais diretamente da Evolution API no Railway (com deduplicação e busca de nomes)
   */
  static async fetchRealChats(instanceName: string): Promise<Conversation[]> {
    if (USE_MOCK) return mockConversations;

    try {
      let rawChats: any[] = [];
      let contactsMap = new Map<string, { name: string; avatar: string }>();

      const response = await apiFetch('/api/evolution/chats');
      if (!response.ok) return [];
      const payload = await response.json();
      const contactsData = payload.contacts;
      const chatsData = payload.chats;
      const storedContactsData = payload.storedContacts;
      const storedContactsMap = new Map<string, { name: string; source: string }>();
      const whatsappNamesMap = new Map<string, { name: string; avatar?: string }>();
      const assignmentsMap = new Map<string, { id: string; name: string }>();
      const assignmentsByNumber = new Map<string, { id: string; name: string }>();
      const dailyRespondersByNumber = new Map<string, { id: string; name: string; date: string }>();
      const statusesMap = new Map<string, { status: ChatStatus; updatedAt: number }>();
      const statusesByNumber = new Map<string, { status: ChatStatus; updatedAt: number }>();
      const readStatesMap = new Map<string, number>();

      if (Array.isArray(payload.assignments)) {
        payload.assignments.forEach((assignment: any) => {
          if (assignment?.evolution_remote_jid && assignment?.user_id && assignment?.user_name) {
            const value = { id: assignment.user_id, name: assignment.user_name };
            assignmentsMap.set(assignment.evolution_remote_jid, value);
            const number = assignment.evolution_remote_jid.split('@')[0].replace(/\D/g, '');
            if (number) assignmentsByNumber.set(number, value);
          }
        });
      }

      if (Array.isArray(payload.dailyResponders)) {
        payload.dailyResponders.forEach((responder: any) => {
          if (!responder?.evolution_remote_jid || !responder?.user_id || !responder?.user_name) return;
          const number = responder.evolution_remote_jid.split('@')[0].replace(/\D/g, '');
          if (number) {
            dailyRespondersByNumber.set(number, {
              id: responder.user_id,
              name: responder.user_name,
              date: responder.response_date,
            });
          }
        });
      }

      if (Array.isArray(payload.statuses)) {
        payload.statuses.forEach((conversation: any) => {
          if (conversation?.evolution_remote_jid && ['open', 'pending', 'resolved'].includes(conversation.status)) {
            const value = {
              status: conversation.status as ChatStatus,
              updatedAt: conversation.updated_at ? Date.parse(conversation.updated_at) : 0,
            };
            statusesMap.set(conversation.evolution_remote_jid, value);
            const number = conversation.evolution_remote_jid.split('@')[0].replace(/\D/g, '');
            if (number) statusesByNumber.set(number, value);
          }
        });
      }

      if (Array.isArray(payload.readStates)) {
        payload.readStates.forEach((readState: any) => {
          const timestamp = Number(readState?.last_read_message_timestamp);
          if (readState?.evolution_remote_jid && Number.isFinite(timestamp)) {
            readStatesMap.set(readState.evolution_remote_jid, timestamp);
          }
        });
      }

      if (Array.isArray(storedContactsData)) {
        const ordered = [...storedContactsData].sort((a: any, b: any) => {
          const priority = (source: string) => source === 'google' ? 0 : source === 'hub' ? 1 : 2;
          return priority(a.source) - priority(b.source);
        });
        ordered.forEach((contact: any) => {
          if (!contact?.name || !contact?.phone) return;
          phoneVariants(contact.phone).forEach((phone) => {
            if (!storedContactsMap.has(phone)) {
              storedContactsMap.set(phone, { name: contact.name, source: contact.source });
            }
          });
        });
      }

      if (Array.isArray(payload.whatsappNames)) {
        payload.whatsappNames.forEach((contact: any) => {
          if (!contact?.phone || !contact?.name) return;
          phoneVariants(contact.phone).forEach((phone) => {
            if (!whatsappNamesMap.has(phone)) {
              whatsappNamesMap.set(phone, { name: contact.name, avatar: contact.avatar_url || undefined });
            }
          });
        });
      }

      // Popula o mapa de contatos para resolver nomes salvos
      if (Array.isArray(contactsData)) {
        contactsData.forEach((c: any) => {
          const rawJid = c.remoteJid || c.id || '';
          const phoneKey = rawJid.split('@')[0].replace(/\D/g, '');
          if (phoneKey && c.pushName && c.pushName !== 'WhatsApp Business' && c.pushName !== 'Você') {
            contactsMap.set(phoneKey, {
              name: c.pushName,
              avatar: c.profilePicUrl || ''
            });
          }
        });
      }

      if (Array.isArray(chatsData)) rawChats = chatsData;

      if (rawChats.length === 0 && contactsMap.size === 0) return [];

      // 2. Mapeamento e Deduplicação por número de telefone (cleanNumber)
      const conversationsMap = new Map<string, Conversation>();

      rawChats.forEach((item: any, index: number) => {
        // Ignora chats de grupos por enquanto se necessário, ou inclui se tiver remoteJid
        const isGroup = item.remoteJid?.includes('@g.us') || item.id?.includes('@g.us');
        if (isGroup) return; // Filtra grupos da aba principal de atendimento individual
        
        // Usa o remoteJid exato com que a Evolution API gravou o chat no banco do Railway
        const rawRemoteJid = item.remoteJid || item.id || `chat-${index}`;
        const altJid = item.lastMessage?.key?.remoteJidAlt;
        const cleanNumber = (altJid || rawRemoteJid).split('@')[0].replace(/\D/g, '');
        const assignment = assignmentsMap.get(rawRemoteJid)
          || (altJid ? assignmentsMap.get(altJid) : undefined)
          || phoneVariants(cleanNumber).map((phone) => assignmentsByNumber.get(phone)).find(Boolean);
        const dailyResponder = phoneVariants(cleanNumber)
          .map((phone) => dailyRespondersByNumber.get(phone))
          .find(Boolean);
        const lastMessageFromMe = Boolean(item.lastMessage?.key?.fromMe);
        const lastMessageAt = item.lastMessage?.messageTimestamp
          ? Number(item.lastMessage.messageTimestamp) * 1000
          : item.updatedAt
            ? Date.parse(item.updatedAt)
            : 0;
        const rawUnreadCount = Number(item.unreadCount) || 0;
        const hasReadState = readStatesMap.has(rawRemoteJid);
        const lastReadAt = readStatesMap.get(rawRemoteJid) || 0;
        const unreadCount = hasReadState && lastMessageAt > 0 && lastMessageAt <= lastReadAt
          ? 0
          : hasReadState && !lastMessageFromMe && lastMessageAt > lastReadAt
            ? Math.max(1, rawUnreadCount)
            : rawUnreadCount;
        const storedStatus = statusesMap.get(rawRemoteJid)
          || (altJid ? statusesMap.get(altJid) : undefined)
          || phoneVariants(cleanNumber).map((phone) => statusesByNumber.get(phone)).find(Boolean);
        const status = storedStatus?.status || 'open';
        const hasNewIncomingMessage = !lastMessageFromMe
          && lastMessageAt > 0
          && (!storedStatus?.updatedAt || lastMessageAt > storedStatus.updatedAt);
        const effectiveStatus = status === 'resolved' && hasNewIncomingMessage ? 'open' : status;
        const needsResponse = effectiveStatus !== 'resolved' && hasNewIncomingMessage;

        if (!cleanNumber) return;

        // Resolve o Nome Salvo (Prioridade: Mapa de Contatos > pushName da Mensagem > Nome do Chat > Número)
        const savedContact = contactsMap.get(cleanNumber);
        const storedContact = phoneVariants(cleanNumber)
          .map((phone) => storedContactsMap.get(phone))
          .find(Boolean);
        const savedName = storedContact?.name && !/^\+?[\d\s().-]+$/.test(storedContact.name.trim())
          ? storedContact.name
          : undefined;
        const whatsappContact = phoneVariants(cleanNumber)
          .map((phone) => whatsappNamesMap.get(phone))
          .find(Boolean);
        let displayName = savedName ||
                          savedContact?.name ||
                          whatsappContact?.name ||
                          item.lastMessage?.pushName || 
                          item.pushName || 
                          item.name || 
                          item.verifiedName;

        if (!displayName || displayName === 'Você' || displayName === 'WhatsApp Business') {
          displayName = `+${cleanNumber}`;
        }

        const messageContent = evolutionMessagePreview(item.lastMessage) || 'Conversa iniciada';

        const timestampStr = item.updatedAt || item.lastMessage?.messageTimestamp
          ? new Date(item.updatedAt || Number(item.lastMessage?.messageTimestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Hoje';

        const conversationObj: Conversation = {
          id: rawRemoteJid, // ID real para findMessages no Railway (ex: 267877160644613@lid)
          contact: {
            id: rawRemoteJid,
            name: displayName,
            phone: `+${cleanNumber}`,
            avatar: savedContact?.avatar || whatsappContact?.avatar || item.profilePicUrl || item.profilePictureUrl || '',
            tags: dailyResponder
              ? [{ id: `daily-responder-${dailyResponder.id}`, name: `👤 ${dailyResponder.name}`, color: '#A78BFA' }]
              : [],
            createdAt: new Date().toISOString().split('T')[0]
          },
          lastMessage: messageContent,
          lastMessageTimestamp: timestampStr,
          lastMessageAt,
          lastMessageFromMe,
          lastMessageKey: item.lastMessage?.key,
          unreadCount,
          status: effectiveStatus,
          needsResponse,
          department: 'Atendimento Geral',
          assignedAttendant: assignment ? { id: assignment.id, name: assignment.name } : undefined,
        };

        // Se o mapa já tiver este número, atualiza apenas se a mensagem for mais recente ou se o nome for melhor que a entrada existente
        if (conversationsMap.has(cleanNumber)) {
          const existing = conversationsMap.get(cleanNumber)!;
          if (existing.contact.name.startsWith('+') && !displayName.startsWith('+')) {
            existing.contact.name = displayName;
          }
        } else {
          conversationsMap.set(cleanNumber, conversationObj);
        }
      });

      return Array.from(conversationsMap.values());
    } catch (err) {
      console.error('[EvolutionAPI] Erro ao carregar chats/contatos:', err);
      return [];
    }
  }

  static async captureChat(remoteJid: string, phone?: string) {
    const response = await apiFetch('/api/evolution/chats/capture', {
      method: 'POST',
      body: JSON.stringify({ remoteJid, phone }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Não foi possível capturar o atendimento');
    return body as { remoteJid: string; user: { id: string; name: string } };
  }

  static async releaseChat(remoteJid: string, phone?: string) {
    const response = await apiFetch('/api/evolution/chats/release', {
      method: 'POST',
      body: JSON.stringify({ remoteJid, phone }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Não foi possível liberar o atendimento');
    return body as { released: boolean; remoteJid: string };
  }

  static async updateChatStatus(remoteJid: string, status: ChatStatus, phone?: string) {
    const response = await apiFetch('/api/evolution/chats/status', {
      method: 'PATCH',
      body: JSON.stringify({ remoteJid, status, phone }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'NÃ£o foi possÃ­vel atualizar o status');
    return body as { remoteJid: string; status: ChatStatus };
  }

  static async markChatAsRead(remoteJid: string, messageTimestamp: number, messageKey?: Conversation['lastMessageKey']) {
    if (USE_MOCK || !Number.isFinite(messageTimestamp) || messageTimestamp <= 0) return;

    const response = await apiFetch('/api/evolution/chats/read', {
      method: 'POST',
      body: JSON.stringify({ remoteJid, messageTimestamp, messageKey }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'NÃ£o foi possÃ­vel marcar a conversa como lida');
    return body as { remoteJid: string; messageTimestamp: number; providerMarked?: boolean };
  }

  static async saveInternalNote(remoteJid: string, phone: string, content: string) {
    const response = await apiFetch('/api/evolution/notes', {
      method: 'POST',
      body: JSON.stringify({ remoteJid, phone, content }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'NÃ£o foi possÃ­vel salvar a nota interna');
    return body.note as Message;
  }

  static async fetchInternalNotes(remoteJid: string, phone: string): Promise<Message[]> {
    const response = await apiFetch('/api/evolution/notes/list', {
      method: 'POST',
      body: JSON.stringify({ remoteJid, phone }),
    });
    if (!response.ok) return [];
    const body = await response.json().catch(() => ({}));
    return Array.isArray(body?.notes) ? body.notes as Message[] : [];
  }

  static async fetchConversationMessagesPage(
    instanceName: string,
    remoteJid: string,
    phone: string,
    attendantLabel = 'Atendente',
    reconcile = false,
    beforeTimestamp?: number,
    afterTimestamp?: number,
    limit = 100,
  ) {
    const [evolutionMessages, internalNotes] = await Promise.all([
      this.fetchMessagesPage(instanceName, remoteJid, phone, attendantLabel, reconcile, beforeTimestamp, afterTimestamp, limit),
      this.fetchInternalNotes(remoteJid, phone),
    ]);
    return {
      messages: [...evolutionMessages.messages, ...internalNotes]
        .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)),
      hasMore: evolutionMessages.hasMore,
    };
  }

  static async fetchConversationMessages(instanceName: string, remoteJid: string, phone: string, attendantLabel = 'Atendente', reconcile = false) {
    const page = await this.fetchConversationMessagesPage(instanceName, remoteJid, phone, attendantLabel, reconcile);
    return page.messages;
  }

  /**
   * Enviar mensagem de texto diretamente via Evolution API no Railway
   */
  static async sendTextMessage(instanceName: string, number: string, text: string, remoteJid?: string) {
    if (USE_MOCK) {
      console.log(`[MOCK EVOLUTION API] Enviar para ${number}: "${text}"`);
      return { status: 'SUCCESS', messageId: `msg-${Date.now()}` };
    }

    const cleanNumber = number.replace(/\D/g, '');

    try {
      const res = await apiFetch('/api/evolution/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          number: cleanNumber,
          text,
          remoteJid,
        })
      });

      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseData?.error || 'NÃ£o foi possÃ­vel enviar a mensagem');
      console.log('[EvolutionAPI] Resposta do envio real:', responseData);
      return responseData;
    } catch (err) {
      console.error('[EvolutionAPI] Erro ao enviar mensagem:', err);
      throw err;
    }
  }


  /**
   * Buscar histórico de mensagens de uma conversa diretamente da Evolution API no Railway
   */
  static async fetchMessagesPage(
    instanceName: string,
    remoteJid: string,
    phone = '',
    attendantLabel = 'Atendente',
    reconcile = false,
    beforeTimestamp?: number,
    afterTimestamp?: number,
    limit = 100,
  ): Promise<{ messages: Message[]; hasMore: boolean }> {
    if (USE_MOCK) return { messages: [], hasMore: false };

    try {
      const cleanJid = remoteJid.includes('@') ? remoteJid : `${remoteJid.replace(/\D/g, '')}@s.whatsapp.net`;

      const res = await apiFetch('/api/evolution/messages', {
        method: 'POST',
        body: JSON.stringify({ remoteJid: cleanJid, phone, reconcile, beforeTimestamp, afterTimestamp, limit })
      });

      if (!res.ok) return { messages: [], hasMore: false };
      const data = await res.json();
      const rawMsgs = data?.messages?.records || data?.records || (Array.isArray(data) ? data : []);

      if (!Array.isArray(rawMsgs) || rawMsgs.length === 0) {
        return { messages: [], hasMore: Boolean(data?.messages?.hasMore) };
      }

      // A Evolution API retorna do mais recente para o mais antigo. Invertemos para exibir cronologicamente.
      const chronologicalMsgs = [...rawMsgs].reverse();

      return {
        messages: chronologicalMsgs.map((m: any, idx: number) => normalizeEvolutionMessage(m, idx, remoteJid, attendantLabel)),
        hasMore: Boolean(data?.messages?.hasMore),
      };

      /* Legacy inline mapper kept temporarily while the adapter rollout is verified.
      return chronologicalMsgs.map((m: any, idx: number) => {
        const fromMe = m.key?.fromMe ?? false;
        
        let mediaUrl: string | undefined = undefined;
        let mediaType: 'image' | 'audio' | 'video' | 'document' | 'sticker' | undefined = undefined;

        const rawMessage = m.message || {};
        const msgObj = unwrapEvolutionMessage(rawMessage);
        const imgMsg = msgObj.imageMessage || rawMessage.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
        const audioMsg = msgObj.audioMessage || rawMessage.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
        const videoMsg = msgObj.videoMessage || rawMessage.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
        const docMsg = msgObj.documentMessage;
        const stickerMsg = msgObj.stickerMessage;
        const reactionMsg = msgObj.reactionMessage;
        const interactiveMsg = getInteractiveMessage(msgObj);
        const interactiveButtons = extractEvolutionButtons(msgObj);
        const metadata = extractEvolutionMessageMetadata(rawMessage, m);

        if (imgMsg) {
          mediaType = 'image';
          if (imgMsg.url && imgMsg.url.startsWith('http')) {
            mediaUrl = imgMsg.url;
          } else if (imgMsg.jpegThumbnail) {
            mediaUrl = imgMsg.jpegThumbnail.startsWith('data:') ? imgMsg.jpegThumbnail : `data:image/jpeg;base64,${imgMsg.jpegThumbnail}`;
          }
        } else if (audioMsg) {
          mediaType = 'audio';
          if (audioMsg.url && audioMsg.url.startsWith('http')) {
            mediaUrl = audioMsg.url;
          }
        } else if (videoMsg) {
          mediaType = 'video';
          if (videoMsg.url && videoMsg.url.startsWith('http')) {
            mediaUrl = videoMsg.url;
          }
        } else if (docMsg) {
          mediaType = 'document';
          mediaUrl = docMsg.url;
        } else if (stickerMsg) {
          mediaType = 'sticker';
          if (stickerMsg.url && stickerMsg.url.startsWith('data:')) {
            mediaUrl = stickerMsg.url;
          }
        }

        const rawContent = reactionMsg
          ? `Reagiu com: ${reactionMsg.text || '👍'}`
          : extractEvolutionMessageText(rawMessage) || '[Mensagem não identificada]';

        const signature = fromMe
          ? parseAttendantSignature(rawContent)
          : { senderName: undefined, content: rawContent };

        const timestampStr = m.messageTimestamp 
          ? new Date(Number(m.messageTimestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Agora';

        const senderType: 'attendant' | 'contact' = fromMe ? 'attendant' : 'contact';
        const msgStatus: Message['status'] = fromMe
          ? normalizeProviderMessageStatus(m.status || m.update?.status || m.key?.status)
          : 'read';

        return {
          id: m.key?.id || m.id || `real-msg-${idx}`,
          conversationId: remoteJid,
          sender: senderType,
          senderName: fromMe ? (signature.senderName || attendantLabel) : (m.pushName || 'Contato'),
          content: signature.content,
          mediaUrl: mediaUrl,
          mediaType: mediaType,
          mediaDuration: (audioMsg?.seconds || videoMsg?.seconds) ? Number(audioMsg?.seconds || videoMsg?.seconds) : undefined,
          interactiveTitle: interactiveMsg?.header?.title
            || interactiveMsg?.header?.text
            || msgObj.templateMessage?.hydratedTemplate?.hydratedTitleText
            || msgObj.templateMessage?.hydratedFourRowTemplate?.title
            || undefined,
          interactiveFooter: interactiveMsg?.footer?.text
            || msgObj.templateMessage?.hydratedTemplate?.hydratedFooterText
            || msgObj.templateMessage?.hydratedFourRowTemplate?.footer
            || undefined,
          interactiveButtons,
          metadata,
          rawKey: m.key,
          timestampMs: m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : undefined,
          timestamp: timestampStr,
          status: msgStatus,
          isInternalNote: false
        };
      }); */
    } catch (err) {
      console.error('[EvolutionAPI] Erro ao buscar mensagens:', err);
      return { messages: [], hasMore: false };
    }
  }

  static async fetchMessages(instanceName: string, remoteJid: string, phone = '', attendantLabel = 'Atendente', reconcile = false): Promise<Message[]> {
    const page = await this.fetchMessagesPage(instanceName, remoteJid, phone, attendantLabel, reconcile);
    return page.messages;
  }

  /**
   * Descriptografar e obter base64 de imagem/áudio via Evolution API no Railway
   */
  static async getDecodedMedia(instanceName: string, messageKey: any): Promise<string | null> {
    if (!messageKey || USE_MOCK) return null;

    const cacheKey = `${messageKey.id || ''}:${messageKey.remoteJid || ''}:${messageKey.fromMe ? 'out' : 'in'}`;
    const cached = this.mediaCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const pending = this.mediaInFlight.get(cacheKey);
    if (pending) return pending;

    const request = (async () => {
      try {
        const res = await apiFetch('/api/evolution/media', {
          method: 'POST',
          body: JSON.stringify({ messageKey })
        });

        if (!res.ok) return null;
        const data = await res.json();
        if (data.base64) {
          return data.base64.startsWith('data:') ? data.base64 : `data:${data.mimetype || 'image/jpeg'};base64,${data.base64}`;
        }
        return null;
      } catch (err) {
        console.error('[EvolutionAPI] Erro ao buscar mídia decodificada:', err);
        return null;
      }
    })();
    this.mediaInFlight.set(cacheKey, request);
    try {
      const data = await request;
      this.mediaCache.set(cacheKey, { data, expiresAt: Date.now() + (data ? 10 * 60_000 : 30_000) });
      return data;
    } finally {
      this.mediaInFlight.delete(cacheKey);
    }
  }

  static async sendMediaMessage(input: {
    instanceName: string;
    number: string;
    remoteJid?: string;
    mediatype: 'image' | 'video' | 'document';
    mimetype: string;
    media: string;
    fileName?: string;
    caption?: string;
  }) {
    if (USE_MOCK) {
      return { status: 'SUCCESS', message: { id: `media-${Date.now()}`, status: 'sent' } };
    }
    const response = await apiFetch('/api/evolution/messages/send-media', {
      method: 'POST',
      body: JSON.stringify({
        number: input.number.replace(/\D/g, ''),
        remoteJid: input.remoteJid,
        mediatype: input.mediatype,
        mimetype: input.mimetype,
        media: input.media,
        fileName: input.fileName,
        caption: input.caption,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Não foi possível enviar o anexo');
    return body;
  }

  static async fetchBusinessProfile(number: string): Promise<any | null> {
    const normalizedNumber = number.replace(/\D/g, '');
    const cached = this.businessProfileCache.get(normalizedNumber);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;
    const pending = this.businessProfileInFlight.get(normalizedNumber);
    if (pending) return pending;

    const request = (async () => {
    try {
      const res = await apiFetch('/api/evolution/business-profile', {
        method: 'POST',
        body: JSON.stringify({ number: normalizedNumber }),
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
    })();
    this.businessProfileInFlight.set(normalizedNumber, request);
    try {
      const profile = await request;
      this.businessProfileCache.set(normalizedNumber, { profile, expiresAt: Date.now() + 5 * 60_000 });
      return profile;
    } finally {
      this.businessProfileInFlight.delete(normalizedNumber);
    }
  }
}
